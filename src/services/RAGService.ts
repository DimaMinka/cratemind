import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { RagExample, RagMemory, BootstrapResult } from '../types.js';
import {
  RAG_MEMORY_FILE,
  RAG_EXAMPLES_PER_FOLDER,
  RAG_MAX_STORED,
  FOLDERS,
  AUDIO_EXTENSIONS,
  MOCK_MODE
} from '../config.js';
import { extractMetadata } from './ID3Service.js';
import { MOCK_RAG_EXAMPLES } from '../mocks/mockData.js';

/**
 * RAGService.ts
 *
 * Implements few-shot retrieval-augmented memory for vibe classification.
 *
 * Key optimizations (v4.6):
 * - Module-level `_memoryCache` prevents repeated synchronous disk reads on every LLM call.
 * - Zod schema validates the memory file on load to prevent silent corruption.
 * - Fixed duplicate detection in filesystem bootstrap (was comparing artist to filename — broken).
 */

// ── Zod Schema ─────────────────────────────────────────────────────────────

const RagExampleSchema = z.object({
  artist: z.string(),
  title: z.string(),
  folders: z.array(z.string()),
  reasoning: z.string(),
  source: z.enum(['auto', 'manual', 'scan', 'engine-dj']),
  ts: z.number()
});

const RagMemorySchema = z.object({
  version: z.literal(1),
  examples: z.array(RagExampleSchema),
  lastScanDir: z.string().nullable()
});

// ── In-memory Cache ─────────────────────────────────────────────────────────

/**
 * Module-level cache for RAG memory.
 * Eliminates repeated `fs.readFileSync` calls on every `getContext()` invocation.
 * Invalidated on every write via `saveMemory()`.
 */
let _memoryCache: RagMemory | null = null;

function loadMemory(): RagMemory {
  if (_memoryCache) return _memoryCache;

  try {
    if (fs.existsSync(RAG_MEMORY_FILE)) {
      const data = fs.readFileSync(RAG_MEMORY_FILE, 'utf8');
      const parsed: unknown = JSON.parse(data);
      const result = RagMemorySchema.safeParse(parsed);
      if (result.success) {
        _memoryCache = result.data;
        return _memoryCache;
      }
      // Zod validation failed — fall through to fresh state
    }
  } catch {
    // Graceful recovery: return a fresh, empty structure
  }

  _memoryCache = { version: 1, examples: [], lastScanDir: null };
  return _memoryCache;
}

function saveMemory(memory: RagMemory): void {
  _memoryCache = memory; // update in-memory cache first
  try {
    fs.writeFileSync(RAG_MEMORY_FILE, JSON.stringify(memory, null, 2), 'utf8');
  } catch {
    // Ignore save errors, or handle gracefully
  }
}

/** Invalidates the in-memory cache, forcing the next read from disk. */
export function invalidateCache(): void {
  _memoryCache = null;
}

import * as EngineDBService from './EngineDBService.js';

export async function bootstrap(sortedDir: string, useEngineDB = false): Promise<BootstrapResult> {
  // Invalidate cache so bootstrap always reads a fresh state from disk
  _memoryCache = null;

  const currentSortedDir = path.resolve(sortedDir);

  if (MOCK_MODE) {
    const memory: RagMemory = {
      version: 1,
      examples: [...MOCK_RAG_EXAMPLES],
      lastScanDir: currentSortedDir
    };
    saveMemory(memory);
    return { found: MOCK_RAG_EXAMPLES.length, added: MOCK_RAG_EXAMPLES.length, folders: 4 };
  }

  const memory = loadMemory();
  let found = 0;
  let added = 0;
  let foldersScanned = 0;

  if (memory.lastScanDir && path.resolve(memory.lastScanDir) !== currentSortedDir) {
    memory.examples = [];
  }

  // 1. If Engine DJ DB import is requested, query database tracks and extract vibe from path
  if (useEngineDB) {
    const dbTracks = EngineDBService.getTracks();
    const folderVibeSet = new Set<string>();

    // Track count per vibe folder to enforce a strict import limit
    const vibeCounts: Record<string, number> = {};
    const maxPerVibe = RAG_EXAMPLES_PER_FOLDER * 2; // e.g., max 4 tracks per vibe folder

    for (const track of dbTracks) {
      found++;

      // Safety guard: skip invalid records that miss physical paths
      if (!track || !track.path) {
        continue;
      }

      // Determine if track path matches any of our atmospheric vibe folders
      const pathParts = track.path.toLowerCase().split(/[/\\]/);
      const matchedVibe = FOLDERS.find((vibe) => pathParts.includes(vibe.toLowerCase()));

      if (!matchedVibe) {
        continue; // Path doesn't belong to any known vibe folders
      }

      // Enforce per-vibe limit to keep RAG memory lightweight
      const currentCount = vibeCounts[matchedVibe] ?? 0;
      if (currentCount >= maxPerVibe) {
        continue;
      }

      const trackArtist = track.artist || 'Unknown Artist';
      const trackTitle = track.title || track.filename || 'Unknown Title';

      const isDuplicate = memory.examples.some(
        (ex) =>
          ex.artist.toLowerCase() === trackArtist.toLowerCase() &&
          ex.title.toLowerCase() === trackTitle.toLowerCase()
      );

      if (isDuplicate) {
        continue;
      }

      folderVibeSet.add(matchedVibe);
      vibeCounts[matchedVibe] = currentCount + 1;

      memory.examples.push({
        artist: trackArtist,
        title: trackTitle,
        folders: [matchedVibe],
        reasoning: 'Imported from Engine DJ database',
        source: 'engine-dj',
        ts: Date.now()
      });

      added++;
    }

    if (memory.examples.length > RAG_MAX_STORED) {
      memory.examples = memory.examples.slice(-RAG_MAX_STORED);
    }

    memory.lastScanDir = currentSortedDir;
    saveMemory(memory);

    return {
      found,
      added,
      folders: folderVibeSet.size
    };
  }

  // 2. Filesystem scan path
  for (const folder of FOLDERS) {
    const folderPath = path.join(currentSortedDir, folder);
    if (!fs.existsSync(folderPath)) {
      continue;
    }

    foldersScanned++;
    const files = fs.readdirSync(folderPath);

    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (!AUDIO_EXTENSIONS.includes(ext as (typeof AUDIO_EXTENSIONS)[number])) {
        continue;
      }

      found++;
      const fullPath = path.join(folderPath, file);

      // Extract metadata FIRST so we can do a proper artist+title duplicate check.
      // This is the fix for the broken duplicate detection that was comparing
      // ex.artist against the raw filename string (which never matched).
      const meta = await extractMetadata(fullPath);

      const isDuplicate = memory.examples.some(
        (ex) =>
          ex.artist.toLowerCase() === meta.artist.toLowerCase() &&
          ex.title.toLowerCase() === meta.title.toLowerCase()
      );

      if (isDuplicate) {
        continue;
      }

      memory.examples.push({
        artist: meta.artist,
        title: meta.title,
        folders: [folder],
        reasoning: 'Added during bootstrap scan',
        source: 'scan',
        ts: Date.now()
      });

      added++;
    }
  }

  if (memory.examples.length > RAG_MAX_STORED) {
    memory.examples = memory.examples.slice(-RAG_MAX_STORED);
  }

  memory.lastScanDir = currentSortedDir;
  saveMemory(memory);

  return {
    found,
    added,
    folders: foldersScanned
  };
}

export function addExample(example: RagExample): void {
  const memory = loadMemory();
  memory.examples = memory.examples.filter(
    (ex) =>
      !(
        ex.artist.toLowerCase() === example.artist.toLowerCase() &&
        ex.title.toLowerCase() === example.title.toLowerCase()
      )
  );
  memory.examples.push(example);
  if (memory.examples.length > RAG_MAX_STORED) {
    memory.examples.shift();
  }
  saveMemory(memory);
}

export function getContext(): string {
  const memory = loadMemory(); // returns in-memory cache — zero disk I/O on subsequent calls
  if (memory.examples.length === 0) {
    return '';
  }

  // Separate user-confirmed manual overrides from auto-classified examples.
  // LLM receives explicit signals: manual choices carry much higher weight
  // than engine-dj imports or auto-classifications.
  const manualExamples = memory.examples.filter((ex) => ex.source === 'manual');
  const autoExamples = memory.examples.filter((ex) => ex.source !== 'manual');

  const userConfirmedLines: string[] = [];
  const referenceLines: string[] = [];

  // ── Block 1: User-confirmed choices (pinned, highest priority) ─────────────
  // Group all manual picks by folder and label them explicitly.
  // These directly represent the user's taste and override any LLM tendency.
  for (const folder of FOLDERS) {
    const confirmed = manualExamples
      .filter((ex) => ex.folders.includes(folder))
      .sort((a, b) => b.ts - a.ts);

    if (confirmed.length > 0) {
      const formatted = confirmed.map((ex) => `${ex.artist} - ${ex.title}`).join(' | ');
      userConfirmedLines.push(`[${folder}]: ${formatted}`);
    }
  }

  // ── Block 2: Reference examples (engine-dj / scan / auto) ──────────────────
  // Fill up to RAG_EXAMPLES_PER_FOLDER slots per folder, preferring
  // manual slots already consumed above (skip duplicates).
  const manualKeys = new Set(
    manualExamples.map((ex) => `${ex.artist.toLowerCase()}|${ex.title.toLowerCase()}`)
  );

  for (const folder of FOLDERS) {
    const refs = autoExamples
      .filter((ex) => ex.folders.includes(folder))
      .filter((ex) => !manualKeys.has(`${ex.artist.toLowerCase()}|${ex.title.toLowerCase()}`))
      .sort((a, b) => b.ts - a.ts)
      .slice(0, RAG_EXAMPLES_PER_FOLDER);

    if (refs.length > 0) {
      const formatted = refs.map((ex) => `${ex.artist} - ${ex.title}`).join(' | ');
      referenceLines.push(`[${folder}]: ${formatted}`);
    }
  }

  const sections: string[] = [];

  if (userConfirmedLines.length > 0) {
    sections.push(
      '=== [USER CONFIRMED] Tracks personally routed by the user — highest priority, match this taste ===',
      ...userConfirmedLines,
      '================================================================================================='
    );
  }

  if (referenceLines.length > 0) {
    sections.push(
      '=== Reference tracks already sorted in the library (use as secondary context) ===',
      ...referenceLines,
      '==================================================================================='
    );
  }

  return sections.length > 0 ? sections.join('\n') : '';
}

export function clear(): void {
  saveMemory({ version: 1, examples: [], lastScanDir: null });
}
