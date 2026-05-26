import * as fs from 'fs';
import * as path from 'path';
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
 */

function loadMemory(): RagMemory {
  try {
    if (fs.existsSync(RAG_MEMORY_FILE)) {
      const data = fs.readFileSync(RAG_MEMORY_FILE, 'utf8');
      const parsed = JSON.parse(data) as RagMemory;
      if (parsed && Array.isArray(parsed.examples)) {
        return parsed;
      }
    }
  } catch {
    // Graceful recovery: return a fresh, empty structure
  }
  return { version: 1, examples: [], lastScanDir: null };
}

function saveMemory(memory: RagMemory): void {
  try {
    fs.writeFileSync(RAG_MEMORY_FILE, JSON.stringify(memory, null, 2), 'utf8');
  } catch {
    // Ignore save errors, or handle gracefully
  }
}

import * as EngineDBService from './EngineDBService.js';

export async function bootstrap(sortedDir: string, useEngineDB = false): Promise<BootstrapResult> {
  const currentSortedDir = path.resolve(sortedDir);

  if (MOCK_MODE) {
    const memory = {
      version: 1 as const,
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

      const isDuplicate = memory.examples.some(
        (ex) =>
          ex.artist.toLowerCase() === file.toLowerCase() ||
          (ex.folders.includes(folder) &&
            (ex.title.toLowerCase() === file.toLowerCase() ||
              fullPath.toLowerCase().endsWith(ex.title.toLowerCase())))
      );

      if (isDuplicate) {
        continue;
      }

      const meta = await extractMetadata(fullPath);

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
  const memory = loadMemory();
  if (memory.examples.length === 0) {
    return '';
  }

  const lines: string[] = [];

  for (const folder of FOLDERS) {
    const folderExamples = memory.examples
      .filter((ex) => ex.folders.includes(folder))
      .sort((a, b) => b.ts - a.ts)
      .slice(0, RAG_EXAMPLES_PER_FOLDER);

    if (folderExamples.length > 0) {
      const formattedTracks = folderExamples.map((ex) => `${ex.artist} - ${ex.title}`).join(' | ');
      lines.push(`[${folder}]: ${formattedTracks}`);
    }
  }

  if (lines.length === 0) {
    return '';
  }

  return [
    '=== Memory of already sorted tracks (use as reference) ===',
    ...lines,
    '==========================================================='
  ].join('\n');
}

export function clear(): void {
  saveMemory({ version: 1, examples: [], lastScanDir: null });
}
