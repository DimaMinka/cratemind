import { useStore } from './UIService.js';
import * as RAGService from './RAGService.js';
import * as LLMService from './LLMService.js';
import { extractMetadata } from './ID3Service.js';

/**
 * FSService.ts
 *
 * Manages file system watching (chokidar), the task queue (p-queue),
 * audio routing (move/copy), and system-level audio previewing.
 *
 * Core Processing Pipeline (per-file):
 * 1. File detected in INCOMING_DIR -> Added to sequential queue (concurrency=1)
 * 2. Extract artist/title using ID3Service.extractMetadata()
 * 3. Retrieve few-shot vibes from RAGService.getContext()
 * 4. Call LLMService.classifyTrack(artist, title, ragContext)
 * 5. If confidence >= CONFIDENCE_THRESHOLD:
 *      - Auto-route file to SORTED_DIR/<folder>/
 *      - RAGService.addExample() with source: 'auto'
 *    If confidence < CONFIDENCE_THRESHOLD:
 *      - Open ManualOverride UI in TUI
 *      - Block queue and await user selection
 *      - Route to selected folders
 *      - RAGService.addExample() with source: 'manual'
 * 6. Update UI Zustand store statistics and add log entries.
 */

export async function initWatcher(): Promise<void> {
  useStore.getState().addLog('RAG', 'Initializing file watcher in ./Incoming...');
  // TODO: Implement chokidar watcher and file queue processing
}

export async function processFile(filepath: string): Promise<void> {
  try {
    useStore.getState().addLog('DETECTED', `New track: ${filepath}`);

    // 1. ID3 Metadata extraction
    const meta = await extractMetadata(filepath);
    useStore.getState().addLog('ID3', `Metadata: ${meta.artist} - ${meta.title}`);

    // 2. Load RAG Context
    const ragContext = RAGService.getContext();
    if (ragContext) {
      useStore.getState().addLog('RAG', 'Context loaded from past few-shot memory');
    }

    // 3. LLM Vibe classification
    const llmResponse = await LLMService.classifyTrack(meta.artist, meta.title, ragContext);
    useStore.getState().addLog('LLM_REASONING', `[LLM] Reasoning: ${llmResponse.reasoning}`);

    // TODO: Route track using either auto or manual override based on confidence
    useStore.getState().incrementStat('processed');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    useStore.getState().addLog('ERROR', `Failed processing: ${msg}`);
    useStore.getState().incrementStat('errors');
  }
}

export async function route(_srcPath: string, _selectedFolders: string[]): Promise<void> {
  // TODO: Implement copy / move routing logic
}

export function previewAudio(_filepath: string): void {
  // TODO: Spawn default platform media player asynchronously
}
