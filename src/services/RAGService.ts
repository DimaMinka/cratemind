import * as fs from 'fs';
import * as path from 'path';
import { RagExample, RagMemory, BootstrapResult } from '../types.js';
import {
  RAG_MEMORY_FILE,
  RAG_EXAMPLES_PER_FOLDER,
  RAG_MAX_STORED,
  FOLDERS,
  AUDIO_EXTENSIONS
} from '../config.js';
import { extractMetadata } from './ID3Service.js';

/**
 * RAGService.ts
 *
 * Implements few-shot retrieval-augmented memory for vibe classification.
 *
 * Storage: Flat JSON file (RAG_MEMORY_FILE = cratemind-memory.json)
 * FIFO Eviction policy when total examples exceed RAG_MAX_STORED (500)
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
  } catch (err) {
    // Graceful recovery: return a fresh, empty structure
  }
  return { version: 1, examples: [], lastScanDir: null };
}

function saveMemory(memory: RagMemory): void {
  try {
    fs.writeFileSync(RAG_MEMORY_FILE, JSON.stringify(memory, null, 2), 'utf8');
  } catch (err) {
    // Ignore save errors, or handle gracefully
  }
}

/**
 * Performs a deep bootstrap scan across already sorted vibe directories to populate
 * the RAG memories.
 *
 * Employs collection change detection: If the active SORTED_DIR changes compared to the
 * last scan, it clears the stale memory first to maintain library consistency.
 */
export async function bootstrap(sortedDir: string): Promise<BootstrapResult> {
  const memory = loadMemory();
  const currentSortedDir = path.resolve(sortedDir);
  
  let found = 0;
  let added = 0;
  let foldersScanned = 0;

  // Collection change detection: Reset memory if collection dir changed
  if (memory.lastScanDir && path.resolve(memory.lastScanDir) !== currentSortedDir) {
    memory.examples = [];
  }

  // Walk through each known vibe folder inside the sorted directory
  for (const folder of FOLDERS) {
    const folderPath = path.join(currentSortedDir, folder);
    if (!fs.existsSync(folderPath)) {
      continue;
    }

    foldersScanned++;
    const files = fs.readdirSync(folderPath);

    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (!AUDIO_EXTENSIONS.includes(ext as any)) {
        continue;
      }

      found++;
      const fullPath = path.join(folderPath, file);

      // Check if this example is already recorded in memory (deduplication)
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

      // Extract metadata
      const meta = await extractMetadata(fullPath);

      // Add to memory
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

  // Cap memory size (FIFO)
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

/**
 * Add a successfully classified track to the memory ledger.
 */
export function addExample(example: RagExample): void {
  const memory = loadMemory();
  
  // Deduplicate: remove matching track before adding new one
  memory.examples = memory.examples.filter(
    (ex) => !(ex.artist.toLowerCase() === example.artist.toLowerCase() && ex.title.toLowerCase() === example.title.toLowerCase())
  );

  memory.examples.push(example);

  // FIFO eviction
  if (memory.examples.length > RAG_MAX_STORED) {
    memory.examples.shift();
  }

  saveMemory(memory);
}

/**
 * Generates the Few-shot RAG prompt injection context for the LLM classifier.
 * Selects up to RAG_EXAMPLES_PER_FOLDER most recent examples for each folder.
 */
export function getContext(): string {
  const memory = loadMemory();
  if (memory.examples.length === 0) {
    return '';
  }

  const lines: string[] = [];

  for (const folder of FOLDERS) {
    // Find all examples associated with the current folder, sorted by timestamp descending
    const folderExamples = memory.examples
      .filter((ex) => ex.folders.includes(folder))
      .sort((a, b) => b.ts - a.ts)
      .slice(0, RAG_EXAMPLES_PER_FOLDER);

    if (folderExamples.length > 0) {
      const formattedTracks = folderExamples
        .map((ex) => `${ex.artist} - ${ex.title}`)
        .join(' | ');
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

/**
 * Completely clears the persistent memory store.
 */
export function clear(): void {
  saveMemory({ version: 1, examples: [], lastScanDir: null });
}
