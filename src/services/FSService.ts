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

// Module-level task queue to ensure sequential processing
const queue = new (PQueue as any)({ concurrency: 1 });

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

  if (MOCK_MODE) {
    addLog('RAG', 'MOCK MODE active. Starting simulated track discovery loop...');

    MOCK_DISCOVERIES.forEach((discovery) => {
      setTimeout(() => {
        queue.add(() => processFile(discovery.filepath));
      }, discovery.delayMs);
    });

    return;
  }

  // Ensure Incoming & Sorted directories exist physically
  if (!fs.existsSync(INCOMING_DIR)) {
    fs.mkdirSync(INCOMING_DIR, { recursive: true });
  }
  if (!fs.existsSync(SORTED_DIR)) {
    fs.mkdirSync(SORTED_DIR, { recursive: true });
  }

  addLog('RAG', `Initializing file watcher inside ${INCOMING_DIR}...`);

  // Initialize Chokidar watch loop
  const watcher = chokidar.watch(INCOMING_DIR, {
    ignored: /(^|[/\\])\../, // Ignore dotfiles
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 1000,
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

    // Auto-trigger audio preview when a new track is processed
    previewAudio(filepath);

    // 1. ID3 Metadata extraction
    const meta = await extractMetadata(filepath);
    addLog('ID3', `Tags: ${meta.artist} - ${meta.title}`);

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
  if (MOCK_MODE) {
    return; // Skip physical moves in simulation
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
export function previewAudio(filepath: string): void {
  if (MOCK_MODE) {
    return; // Bypassed in mock simulation
  }

  try {
    stopAudio(); // Stop any active playback first

    // Spawn native macOS background player
    activeAudioProcess = spawn('afplay', [filepath], { stdio: 'ignore' });

    activeAudioProcess.on('exit', () => {
      activeAudioProcess = null;
    });
  } catch {
    // Graceful recovery if afplay fails or is missing (e.g. non-macOS systems)
  }
}

/**
 * Stops any active background audio process.
 */
function stopAudio(): void {
  if (activeAudioProcess) {
    try {
      activeAudioProcess.kill('SIGKILL');
    } catch {
      // Ignore process kill issues
    }
    activeAudioProcess = null;
  }
}
