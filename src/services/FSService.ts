import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import chokidar from 'chokidar';
import PQueue from 'p-queue';
import { useStore } from './UIService.js';
import * as RAGService from './RAGService.js';
import * as LLMService from './LLMService.js';
import { extractMetadata } from './ID3Service.js';
import { MOCK_MODE, FOLDERS, INCOMING_DIR, SORTED_DIR, AUDIO_EXTENSIONS } from '../config.js';
import { MOCK_DISCOVERIES } from '../mocks/mockData.js';

// Safe fallback resolution for PQueue constructability in NodeNext ESM contexts
const PQueueClass = (PQueue as any).default || PQueue;
const queue = new PQueueClass({ concurrency: 1 });

// Active background audio player process
let activeAudioProcess: ChildProcess | null = null;

/**
 * FSService.ts
 *
 * Manages file system watching (chokidar), sequential task queue (p-queue),
 * audio file routing (copy & unlink), and background afplay audio playback.
 */

export async function initWatcher(): Promise<void> {
  const addLog = useStore.getState().addLog;

  // Ensure Incoming & Sorted directories exist physically
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

  // Initialize Chokidar watch loop
  const watcher = chokidar.watch(INCOMING_DIR, {
    ignored: /(^|[/\\])\../, // Ignore dotfiles
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

    // 1. ID3 Metadata extraction
    const meta = await extractMetadata(filepath);
    addLog('ID3', `Tags: ${meta.artist} - ${meta.title}`);

    // Auto-trigger audio preview when a new track is processed
    previewAudio(filepath, 0, meta.duration);

    // 2. Load RAG Context
    const ragContext = RAGService.getContext();
    if (ragContext) {
      addLog('RAG', 'Context loaded: few-shot examples injected');
    }

    // 3. LLM Vibe classification
    const llmResponse = await LLMService.classifyTrack(meta.artist, meta.title, ragContext);
    addLog('LLM_REASONING', `[LLM reasoning] ${llmResponse.reasoning}`);

    let selectedFolders: string[] = [];

    // 4. Decision: Auto-route or Trigger Manual Override
    if (llmResponse.confidence >= 0.7) {
      selectedFolders = llmResponse.folders;
      addLog('ROUTED', `Auto-routing -> /${selectedFolders.join(' & /')}/${filename}`);

      // Perform physical file system routing
      await route(filepath, selectedFolders);

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

      // Block sequential queue and await user checklist selection
      selectedFolders = await new Promise<string[]>((resolve) => {
        setOverride({
          filename: filename,
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

      if (selectedFolders.length === 0) {
        addLog('ROUTED', `Manual routing skipped: track left in Incoming`);
      } else {
        addLog('ROUTED', `Manual routing -> /${selectedFolders.join(' & /')}/${filename}`);

        // Perform physical file system routing
        await route(filepath, selectedFolders);

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
    }

    // Stop audio playback once track is successfully routed
    stopAudio();

    // Update global processing stats
    incrementStat('processed');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    addLog('ERROR', `Failed processing: ${msg}`);
    incrementStat('errors');
    stopAudio();
  }
}

/**
 * Performs physical file system copy-routing into sorted vibe directories,
 * then cleanly unlinks (deletes) the original incoming file.
 */
export async function route(srcPath: string, selectedFolders: string[]): Promise<void> {
  // If in mock mode and the file doesn't physically exist, bypass routing gracefully
  if (MOCK_MODE && !fs.existsSync(srcPath)) {
    return;
  }

  const filename = path.basename(srcPath);

  // Copy file to all target subfolders
  for (const folder of selectedFolders) {
    const targetDir = path.join(SORTED_DIR, folder);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const targetPath = path.join(targetDir, filename);
    fs.copyFileSync(srcPath, targetPath);
  }

  // Delete the original file from Incoming to avoid double-processing
  if (fs.existsSync(srcPath)) {
    fs.unlinkSync(srcPath);
  }
}

/**
 * Triggers background audio playback using macOS native 'afplay'.
 * Auto-kills any currently active audio process to prevent multiple overlays.
 */
export function previewAudio(filepath: string, offset = 0, duration = 180): void {
  const setPlayback = useStore.getState().setPlayback;
  const addLog = useStore.getState().addLog;
  const filename = path.basename(filepath);

  // If in mock mode and the file doesn't physically exist, bypass preview gracefully
  if (MOCK_MODE && !fs.existsSync(filepath)) {
    setPlayback({
      filepath,
      filename,
      duration,
      offset,
      lastStartedAt: Date.now()
    });
    return;
  }

  try {
    stopAudio(); // Stop any active playback first

    const absolutePath = path.resolve(filepath);

    // Check if the file is empty (0 bytes), which commonly happens during 'touch' command tests
    if (fs.existsSync(absolutePath)) {
      const stats = fs.statSync(absolutePath);
      if (stats.size === 0) {
        addLog('ERROR', `Skipping audio preview: file is empty (0 bytes)`);
        return;
      }
    }

    // Spawn ffplay with precise seeking (-ss) and disabled video window (-nodisp)
    activeAudioProcess = spawn('ffplay', ['-nodisp', '-ss', String(offset), absolutePath], { stdio: 'ignore' });

    activeAudioProcess.on('error', (err) => {
      addLog('ERROR', `ffplay launch failed: ${err.message}`);
    });

    activeAudioProcess.on('exit', (code) => {
      if (code !== null && code !== 0 && code !== 15 && code !== 9) {
        addLog('ERROR', `ffplay exited with error code: ${code}`);
      }
      // Auto-clear playback if ended naturally
      const currentPlayback = useStore.getState().playback;
      if (currentPlayback?.filepath === filepath && activeAudioProcess === null) {
        setPlayback(null);
      }
    });

    setPlayback({
      filepath,
      filename,
      duration,
      offset,
      lastStartedAt: Date.now()
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    addLog('ERROR', `Playback trigger failed: ${msg}`);
  }
}

/**
 * Stops any active background audio process.
 */
export function stopAudio(): void {
  const setPlayback = useStore.getState().setPlayback;
  setPlayback(null);

  if (activeAudioProcess) {
    try {
      activeAudioProcess.kill('SIGKILL');
    } catch {
      // Ignore process kill issues
    }
    activeAudioProcess = null;
  }
}

/**
 * Visual time formatting helper (e.g., 125 -> "2:05").
 */
export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Seeks forward/backward in the current playing track by deltaSeconds.
 * Re-spawns afplay with the computed starting offset.
 */
export function seekPlayback(deltaSeconds: number): void {
  const playback = useStore.getState().playback;
  if (!playback) return;

  const elapsed = Math.round((Date.now() - playback.lastStartedAt) / 1000);
  let newOffset = playback.offset + elapsed + deltaSeconds;

  if (newOffset < 0) {
    newOffset = 0;
  }
  if (newOffset > playback.duration) {
    newOffset = playback.duration - 2; // Stay at least 2 seconds before end
  }

  previewAudio(playback.filepath, newOffset, playback.duration);
}
