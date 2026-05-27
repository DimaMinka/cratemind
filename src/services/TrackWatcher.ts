import * as path from 'path';
import * as fs from 'fs';
import chokidar from 'chokidar';
import PQueue from 'p-queue';
import { useStore } from './UIService.js';
import { processTrack } from './TrackProcessor.js';
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

export async function initWatcher(): Promise<void> {
  const addLog = useStore.getState().addLog;

  if (!fs.existsSync(INCOMING_DIR)) {
    fs.mkdirSync(INCOMING_DIR, { recursive: true });
  }
  if (!fs.existsSync(SORTED_DIR)) {
    fs.mkdirSync(SORTED_DIR, { recursive: true });
  }

  if (MOCK_MODE) {
    addLog('SYSTEM', 'MOCK MODE active. Starting simulated track discovery loop...');

    MOCK_DISCOVERIES.forEach((discovery) => {
      setTimeout(() => {
        queue.add(() => processTrack(discovery.filepath));
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
      queue.add(() => processTrack(filepath));
    }
  });
}
