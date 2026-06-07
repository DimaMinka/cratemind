import * as path from 'path';
import * as fs from 'fs';
import chokidar from 'chokidar';
import PQueue from 'p-queue';
import { useStore } from './UIService.js';
import { processTracksBatch } from './TrackProcessor.js';
import { getGlobalStats } from './LocalDBService.js';
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

    const status = useStore.getState().status;
    if (status === 'paused' && !force) {
      return;
    }

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

    const remainingText =
      pendingFiles.length > 0 ? ` (${pendingFiles.length} remaining in queue)` : '';
    addLog(
      'SYSTEM',
      `Queueing batch of ${filesToProcess.length} track(s) for analysis${remainingText}...`
    );
    queue.add(async () => {
      await processTracksBatch(filesToProcess);
      useStore.getState().setGlobalStats(getGlobalStats());
    });

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

  // Subscribe to system status changes (pause/resume)
  let prevStatus = useStore.getState().status;
  useStore.subscribe((state) => {
    const currentStatus = state.status;
    if (prevStatus === 'paused' && currentStatus === 'listening') {
      prevStatus = currentStatus;
      if (pendingFiles.length > 0) {
        addLog('SYSTEM', 'System resumed. Initiating analysis for pending tracks...');
        processPendingBatch(false);
      }
    } else {
      prevStatus = currentStatus;
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
      useStore.getState().setIncomingCount(useStore.getState().incomingCount + 1);
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
        const status = useStore.getState().status;
        if (status === 'paused') {
          addLog(
            'SYSTEM',
            `Queued ${path.basename(filepath)}. System is PAUSED (Press [Space] to resume and start analysis).`
          );
          return;
        }
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

  watcher.on('unlink', (filepath) => {
    const ext = path.extname(filepath).toLowerCase();
    if (AUDIO_EXTENSIONS.includes(ext as (typeof AUDIO_EXTENSIONS)[number])) {
      const { incomingCount, setIncomingCount } = useStore.getState();
      setIncomingCount(Math.max(0, incomingCount - 1));
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
        `Initial scan complete. Found ${pendingFiles.length} tracks. System is PAUSED. Press [Space] to start batch analysis.`
      );
    } else if (pendingFiles.length > 0) {
      const remaining = BATCH_SIZE - pendingFiles.length;
      addLog(
        'SYSTEM',
        `Initial scan complete. Found ${pendingFiles.length} leftover track(s). System is PAUSED (Waiting for ${remaining} more track(s)).`
      );
    } else {
      addLog(
        'SYSTEM',
        'Initial scan complete. Waiting for new tracks (System is PAUSED. Press [Space] to resume).'
      );
    }
  });
}
