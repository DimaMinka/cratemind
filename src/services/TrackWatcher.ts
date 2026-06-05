import * as path from 'path';
import * as fs from 'fs';
import chokidar from 'chokidar';
import PQueue from 'p-queue';
import { useStore } from './UIService.js';
import { processTracksBatch } from './TrackProcessor.js';
import { MOCK_MODE, INCOMING_DIR, SORTED_DIR, AUDIO_EXTENSIONS } from '../config.js';
import { MOCK_DISCOVERIES } from '../mocks/mockData.js';

const PQueueClass = ('default' in PQueue ? PQueue.default : PQueue) as unknown as new (opts: {
  concurrency: number;
}) => { add: (fn: () => Promise<void>) => void };
const queue = new PQueueClass({ concurrency: 1 });

/**
 * TrackWatcher.ts
 *
 * Infrastructure layer: initializes chokidar file watcher and manages
 * the sequential task queue (PQueue) for track processing.
 *
 * Responsibilities:
 * - Watch the Incoming directory for new audio files
 * - Filter by supported audio extensions
 * - Enqueue discovered tracks into the sequential processing pipeline
 * - In MOCK_MODE: simulate file discoveries with timed delays
 *
 * Extracted from FSService to separate infrastructure from business logic.
 */

let pendingFiles: string[] = [];
let batchTimeout: ReturnType<typeof setTimeout> | null = null;

export async function initWatcher(): Promise<void> {
  const addLog = useStore.getState().addLog;

  if (!fs.existsSync(INCOMING_DIR)) {
    fs.mkdirSync(INCOMING_DIR, { recursive: true });
  }
  if (!fs.existsSync(SORTED_DIR)) {
    fs.mkdirSync(SORTED_DIR, { recursive: true });
  }

  const processPendingBatch = () => {
    if (pendingFiles.length === 0) return;

    const isDownloading = useStore.getState().isTelegramDownloading;
    if (isDownloading) {
      if (pendingFiles.length < 5) {
        const remaining = 5 - pendingFiles.length;
        addLog(
          'SYSTEM',
          `Queued ${path.basename(pendingFiles[pendingFiles.length - 1])}. Waiting for ${remaining} more track(s) to start batch analysis...`
        );
        return;
      }

      const filesToProcess = pendingFiles.slice(0, 5);
      pendingFiles = pendingFiles.slice(5);
      addLog('SYSTEM', `Batch threshold reached (5 tracks). Initiating bulk analysis...`);
      queue.add(() => processTracksBatch(filesToProcess));

      if (pendingFiles.length > 0) {
        if (batchTimeout) clearTimeout(batchTimeout);
        batchTimeout = setTimeout(processPendingBatch, 1000);
      }
      return;
    }

    const filesToProcess = [...pendingFiles];
    pendingFiles = [];
    queue.add(() => processTracksBatch(filesToProcess));
  };

  // Subscribe to Telegram download completion to process remaining queue
  let wasDownloading = false;
  useStore.subscribe((state) => {
    const isDownloading = state.isTelegramDownloading;
    if (wasDownloading && !isDownloading) {
      wasDownloading = false;
      if (pendingFiles.length > 0) {
        addLog(
          'SYSTEM',
          'Telegram download completed. Processing remaining tracks in incoming queue...'
        );
        processPendingBatch();
      }
    } else if (!wasDownloading && isDownloading) {
      wasDownloading = true;
    }
  });

  let isInitialScan = true;

  if (MOCK_MODE) {
    addLog('SYSTEM', 'MOCK MODE active. Starting simulated track discovery loop...');

    MOCK_DISCOVERIES.forEach((discovery) => {
      setTimeout(() => {
        pendingFiles.push(discovery.filepath);
        if (batchTimeout) clearTimeout(batchTimeout);
        batchTimeout = setTimeout(processPendingBatch, 1000);
      }, discovery.delayMs);
    });
  }

  addLog('SYSTEM', `Initializing file watcher inside ${INCOMING_DIR}...`);

  const watcher = chokidar.watch(INCOMING_DIR, {
    ignored: /(^|[/\\])\../,
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100
    }
  });

  watcher.on('add', (filepath) => {
    const ext = path.extname(filepath).toLowerCase();
    if (AUDIO_EXTENSIONS.includes(ext as (typeof AUDIO_EXTENSIONS)[number])) {
      pendingFiles.push(filepath);
      if (!isInitialScan) {
        if (batchTimeout) clearTimeout(batchTimeout);
        batchTimeout = setTimeout(processPendingBatch, 1000);
      }
    }
  });

  watcher.on('ready', () => {
    isInitialScan = false;
    if (pendingFiles.length > 1) {
      addLog(
        'SYSTEM',
        `Initial scan complete. Found ${pendingFiles.length} tracks. Starting batch analysis...`
      );
      processPendingBatch();
    } else if (pendingFiles.length === 1) {
      addLog(
        'SYSTEM',
        `Initial scan complete. Found 1 leftover track (${path.basename(pendingFiles[0])}). Waiting for more tracks before starting analysis...`
      );
    } else {
      addLog('SYSTEM', 'Initial scan complete. Waiting for new tracks...');
    }
  });
}
