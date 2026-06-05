import * as path from 'path';
import * as fs from 'fs';
import chokidar from 'chokidar';
import PQueue from 'p-queue';
import { useStore } from './UIService.js';
import { processTracksBatch } from './TrackProcessor.js';
import { MOCK_MODE, INCOMING_DIR, SORTED_DIR, AUDIO_EXTENSIONS, BATCH_SIZE } from '../config.js';
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

  const processPendingBatch = (force = false) => {
    if (pendingFiles.length === 0) return;

    const isDownloadOnly = useStore.getState().telegramDownloadOnly;
    if (isDownloadOnly) {
      addLog(
        'SYSTEM',
        `Download-only mode active. Skipping batch analysis for ${pendingFiles.length} track(s).`
      );
      pendingFiles = [];
      return;
    }

    if (!force && pendingFiles.length < BATCH_SIZE) {
      return;
    }

    const filesToProcess = force ? [...pendingFiles] : pendingFiles.slice(0, BATCH_SIZE);
    if (force) {
      pendingFiles = [];
    } else {
      pendingFiles = pendingFiles.slice(BATCH_SIZE);
    }

    addLog(
      'SYSTEM',
      `Batch threshold reached / forced. Initiating analysis for ${filesToProcess.length} track(s)...`
    );
    queue.add(() => processTracksBatch(filesToProcess));

    if (pendingFiles.length > 0) {
      if (batchTimeout) clearTimeout(batchTimeout);
      batchTimeout = setTimeout(() => processPendingBatch(force), 1000);
    }
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
        processPendingBatch(true);
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
        batchTimeout = setTimeout(() => processPendingBatch(false), 1000);
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
      const isDownloadOnly = useStore.getState().telegramDownloadOnly;
      if (isDownloadOnly) {
        addLog(
          'SYSTEM',
          `Detected: ${path.basename(filepath)} (Download-only mode - skipping analysis)`
        );
        return;
      }
      pendingFiles.push(filepath);
      if (!isInitialScan) {
        const remaining = BATCH_SIZE - pendingFiles.length;
        if (remaining > 0) {
          addLog(
            'SYSTEM',
            `Queued ${path.basename(filepath)}. Waiting for ${remaining} more track(s) to start batch analysis...`
          );
        }
        if (batchTimeout) clearTimeout(batchTimeout);
        batchTimeout = setTimeout(() => processPendingBatch(false), 1000);
      }
    }
  });

  watcher.on('ready', () => {
    isInitialScan = false;
    const isDownloadOnly = useStore.getState().telegramDownloadOnly;
    if (isDownloadOnly) {
      addLog(
        'SYSTEM',
        `Initial scan complete. Download-only mode active. Skipping analysis for ${pendingFiles.length} leftover track(s).`
      );
      pendingFiles = [];
      return;
    }
    if (pendingFiles.length >= BATCH_SIZE) {
      addLog(
        'SYSTEM',
        `Initial scan complete. Found ${pendingFiles.length} tracks. Starting batch analysis in 3 seconds...`
      );
      if (batchTimeout) clearTimeout(batchTimeout);
      batchTimeout = setTimeout(() => processPendingBatch(false), 3000);
    } else if (pendingFiles.length > 0) {
      const remaining = BATCH_SIZE - pendingFiles.length;
      addLog(
        'SYSTEM',
        `Initial scan complete. Found ${pendingFiles.length} leftover track(s). Waiting for ${remaining} more track(s) to start batch analysis...`
      );
    } else {
      addLog('SYSTEM', 'Initial scan complete. Waiting for new tracks...');
    }
  });
}
