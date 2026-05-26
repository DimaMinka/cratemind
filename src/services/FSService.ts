import * as path from 'path';
import * as fs from 'fs';
import chokidar from 'chokidar';
import PQueue from 'p-queue';
import { useStore } from './UIService.js';
import * as RAGService from './RAGService.js';
import * as LLMService from './LLMService.js';
import { extractMetadata } from './ID3Service.js';
import { previewAudio, stopAudio } from './AudioService.js';
import { routeFile } from './RoutingService.js';
import { MOCK_MODE, FOLDERS, INCOMING_DIR, SORTED_DIR, AUDIO_EXTENSIONS } from '../config.js';
import { MOCK_DISCOVERIES } from '../mocks/mockData.js';
import * as CacheService from './CacheService.js';

const PQueueClass = (PQueue as any).default || PQueue;
const queue = new PQueueClass({ concurrency: 1 });

/**
 * FSService.ts
 *
 * Manages file system watching (chokidar) and sequential task queue (p-queue).
 */

export async function initWatcher(): Promise<void> {
  const addLog = useStore.getState().addLog;

  if (!fs.existsSync(INCOMING_DIR)) {
    fs.mkdirSync(INCOMING_DIR, { recursive: true });
  }
  if (!fs.existsSync(SORTED_DIR)) {
    fs.mkdirSync(SORTED_DIR, { recursive: true });
  }

  if (MOCK_MODE) {
    addLog('RAG', 'MOCK MODE active. Starting simulated track discovery loop...');

    MOCK_DISCOVERIES.forEach((discovery) => {
      setTimeout(() => {
        queue.add(() => processFile(discovery.filepath));
      }, discovery.delayMs);
    });
  }

  addLog('RAG', `Initializing file watcher inside ${INCOMING_DIR}...`);

  const watcher = chokidar.watch(INCOMING_DIR, {
    ignored: /(^|[/\\])\../,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100
    }
  });

  watcher.on('add', (filepath) => {
    const ext = path.extname(filepath).toLowerCase();
    if (AUDIO_EXTENSIONS.includes(ext as (typeof AUDIO_EXTENSIONS)[number])) {
      queue.add(() => processFile(filepath));
    }
  });
}

export async function processFile(filepath: string): Promise<void> {
  const addLog = useStore.getState().addLog;
  const incrementStat = useStore.getState().incrementStat;
  const setOverride = useStore.getState().setOverride;

  try {
    const filename = path.basename(filepath);
    addLog('DETECTED', `Discovered track: ${filename}`);

    const meta = await extractMetadata(filepath);
    addLog('ID3', `Tags: ${meta.artist} - ${meta.title}`);

    previewAudio(filepath, 0, meta.duration);

    const ragContext = RAGService.getContext();
    if (ragContext) {
      addLog('RAG', 'Context loaded: few-shot examples injected');
    }

    let llmResponse;
    let limitExceeded = false;
    let missingApiKey = false;
    let networkError = false;
    let schemaError = false;
    let errorMsg = '';

    try {
      llmResponse = await LLMService.classifyTrack(meta.artist, meta.title, ragContext);
      addLog('LLM_REASONING', `[LLM reasoning] ${llmResponse.reasoning}`);
    } catch (err) {
      if (err instanceof LLMService.RequestLimitExceededError) {
        limitExceeded = true;
        errorMsg = 'Daily API request limit reached';
      } else if (err instanceof LLMService.MissingApiKeyError) {
        missingApiKey = true;
        errorMsg = 'Configuration: GEMINI_API_KEY is missing';
      } else if (
        err instanceof Error &&
        (err.name === 'ZodError' ||
          err.message.includes('JSON') ||
          err.message.includes('parsing') ||
          err.message.includes('validation'))
      ) {
        schemaError = true;
        errorMsg = 'Error: Invalid schema response format';
      } else {
        networkError = true;
        errorMsg = 'Network Error: Google Gemini API unreachable';
      }

      llmResponse = {
        folders: [],
        reasoning: errorMsg,
        confidence: 0
      };
    }

    let selectedFolders: string[] = [];
    const hasError = limitExceeded || missingApiKey || networkError || schemaError;

    if (llmResponse.confidence >= 0.7 && !hasError) {
      selectedFolders = llmResponse.folders;
      addLog('ROUTED', `Auto-routing -> /${selectedFolders.join(' & /')}/${filename}`);

      await routeFile(filepath, selectedFolders);

      RAGService.addExample({
        artist: meta.artist,
        title: meta.title,
        folders: selectedFolders,
        reasoning: llmResponse.reasoning,
        source: 'auto',
        ts: Date.now()
      });
    } else {
      const reasonText = hasError
        ? `Error occurred (${errorMsg}). Prompting user override...`
        : `Confidence below threshold (${llmResponse.confidence}). Prompting user override...`;

      addLog('NEEDS_MANUAL', reasonText);
      incrementStat('overrides');

      selectedFolders = await new Promise<string[]>((resolve) => {
        setOverride({
          filename: filename,
          filepath: filepath,
          folders: [...FOLDERS],
          suggested: llmResponse.folders,
          selected: [],
          reason: hasError ? errorMsg : undefined,
          resolve: (folders) => {
            setOverride(null);
            resolve(folders);
          }
        });
      });

      if (selectedFolders.length === 0) {
        addLog('ROUTED', `Manual routing skipped: track left in Incoming`);
      } else {
        addLog('ROUTED', `Manual routing -> /${selectedFolders.join(' & /')}/${filename}`);

        await routeFile(filepath, selectedFolders);

        RAGService.addExample({
          artist: meta.artist,
          title: meta.title,
          folders: selectedFolders,
          reasoning: hasError
            ? `Routed via manual user override (API issue: ${errorMsg})`
            : 'Routed via manual user override checklist',
          source: 'manual',
          ts: Date.now()
        });
      }
    }

    stopAudio();
    incrementStat('processed');
    
    // Sync cache hits and daily limits stats to the global Zustand store
    const currentStats = CacheService.getStats();
    useStore.getState().setLimitStats(currentStats);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    addLog('ERROR', `Failed processing: ${msg}`);
    incrementStat('errors');
    stopAudio();

    // Sync stats in case limit count was incremented before failure
    const currentStats = CacheService.getStats();
    useStore.getState().setLimitStats(currentStats);
  }
}
