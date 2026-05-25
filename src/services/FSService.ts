import * as path from 'path';
import { useStore } from './UIService.js';
import * as RAGService from './RAGService.js';
import * as LLMService from './LLMService.js';
import { extractMetadata } from './ID3Service.js';
import { MOCK_MODE, FOLDERS } from '../config.js';
import { MOCK_DISCOVERIES } from '../mocks/mockData.js';

/**
 * FSService.ts
 *
 * Manages file system watching (chokidar), the task queue (p-queue),
 * audio routing (move/copy), and system-level audio previewing.
 */

export async function initWatcher(): Promise<void> {
  const addLog = useStore.getState().addLog;

  if (MOCK_MODE) {
    addLog('RAG', 'MOCK MODE active. Starting simulated track discovery loop...');

    // Schedule each mock discovery based on its specific delay time
    MOCK_DISCOVERIES.forEach((discovery) => {
      setTimeout(() => {
        processFile(discovery.filepath);
      }, discovery.delayMs);
    });

    return;
  }

  addLog('RAG', 'Initializing file watcher in ./Incoming...');
  // TODO: Implement chokidar watcher and file queue processing
}

export async function processFile(filepath: string): Promise<void> {
  const addLog = useStore.getState().addLog;
  const incrementStat = useStore.getState().incrementStat;
  const setOverride = useStore.getState().setOverride;

  try {
    addLog('DETECTED', `Discovered track: ${path.basename(filepath)}`);

    // 1. ID3 Metadata extraction
    const meta = await extractMetadata(filepath);
    addLog('ID3', `Tags: ${meta.artist} - ${meta.title}`);

    // 2. Load RAG Context
    const ragContext = RAGService.getContext();
    if (ragContext) {
      addLog('RAG', 'Context loaded: 4 few-shot examples injected');
    }

    // 3. LLM Vibe classification
    const llmResponse = await LLMService.classifyTrack(meta.artist, meta.title, ragContext);
    addLog('LLM_REASONING', `[LLM reasoning] ${llmResponse.reasoning}`);

    let selectedFolders: string[] = [];

    // 4. Decision: Auto-route or Trigger Manual Override
    if (llmResponse.confidence >= 0.7) {
      selectedFolders = llmResponse.folders;
      addLog(
        'ROUTED',
        `Auto-routing -> /${selectedFolders.join(' & /')}/${path.basename(filepath)}`
      );

      // Save RAG example
      RAGService.addExample({
        artist: meta.artist,
        title: meta.title,
        folders: selectedFolders,
        reasoning: llmResponse.reasoning,
        source: 'auto',
        ts: Date.now()
      });
    } else {
      addLog(
        'NEEDS_MANUAL',
        `Confidence below threshold (${llmResponse.confidence}). Prompting user override...`
      );
      incrementStat('overrides');

      // Block execution and await user checklist selection
      selectedFolders = await new Promise<string[]>((resolve) => {
        setOverride({
          filename: path.basename(filepath),
          filepath: filepath,
          folders: [...FOLDERS],
          suggested: llmResponse.folders,
          selected: [],
          resolve: (folders) => {
            setOverride(null);
            resolve(folders);
          }
        });
      });

      addLog(
        'ROUTED',
        `Manual routing -> /${selectedFolders.join(' & /')}/${path.basename(filepath)}`
      );

      // Save RAG example
      RAGService.addExample({
        artist: meta.artist,
        title: meta.title,
        folders: selectedFolders,
        reasoning: 'Routed via manual user override checklist',
        source: 'manual',
        ts: Date.now()
      });
    }

    // Update global processing stats
    incrementStat('processed');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    addLog('ERROR', `Failed processing: ${msg}`);
    incrementStat('errors');
  }
}

export async function route(_srcPath: string, _selectedFolders: string[]): Promise<void> {
  // TODO: Implement copy / move routing logic
}

export function previewAudio(_filepath: string): void {
  // TODO: Spawn default platform media player asynchronously
}
