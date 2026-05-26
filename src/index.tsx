import dotenv from 'dotenv';
import { startTUI, useStore } from './services/UIService.js';
import * as EngineDBService from './services/EngineDBService.js';
import * as RAGService from './services/RAGService.js';
import { initWatcher } from './services/FSService.js';
import { SORTED_DIR } from './config.js';

// Load environment variables
dotenv.config();

/**
 * index.tsx
 *
 * Entry point of CrateMind Vibe Sorter.
 * Orchestrates the bootstrap sequence (user-first validation) and mounts TUI.
 */

async function promptEngineDB(): Promise<boolean> {
  const addLog = useStore.getState().addLog;
  const setBootPrompt = useStore.getState().setBootPrompt;

  addLog('SYSTEM', 'Engine DJ SQLite library detected.');

  return new Promise<boolean>((resolve) => {
    setBootPrompt({
      message: 'Engine DJ library detected! Scan tracks into memory?',
      detail: 'Reads track metadata from m.db (Strictly Read-Only)',
      resolve: (val) => {
        setBootPrompt(null);
        if (val) {
          addLog('SYSTEM', 'User accepted Engine DJ import.');
        } else {
          addLog('SYSTEM', 'User skipped Engine DJ import. Falling back to folder scan.');
        }
        resolve(val);
      }
    });
  });
}

async function promptManualScan(): Promise<boolean> {
  const addLog = useStore.getState().addLog;
  const setBootPrompt = useStore.getState().setBootPrompt;

  return new Promise<boolean>((resolve) => {
    setBootPrompt({
      message: 'Scan local sorted directories into few-shot memory?',
      detail: `Reads ID3 tags from files in ${SORTED_DIR}`,
      resolve: (val) => {
        setBootPrompt(null);
        if (val) {
          addLog('SYSTEM', 'User accepted local folder scan.');
        } else {
          addLog('SYSTEM', 'User skipped memory bootstrap.');
        }
        resolve(val);
      }
    });
  });
}

async function runBootstrap(useEngineDB = false): Promise<void> {
  const addLog = useStore.getState().addLog;
  const setRagStatus = useStore.getState().setRagStatus;

  addLog('RAG', `Starting bootstrap scan inside ${SORTED_DIR}...`);
  try {
    const result = await RAGService.bootstrap(SORTED_DIR, useEngineDB);
    addLog(
      'RAG',
      `Scan complete: ${result.found} tracks found, ${result.added} added to RAG across ${result.folders} folders.`
    );
    setRagStatus('ready', {
      total: result.added,
      folders: result.folders,
      scannedAt: Date.now()
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    addLog('ERROR', `Bootstrap scan failed: ${msg}`);
    setRagStatus('first-run');
  }
}

async function main() {
  // 1. Launch terminal UI immediately
  startTUI();

  const addLog = useStore.getState().addLog;
  const setRagStatus = useStore.getState().setRagStatus;

  addLog('SYSTEM', 'CrateMind starting up...');
  setRagStatus('scanning');

  let useEngineDB = false;
  let useManualScan = false;

  // 2. Check Engine DJ Database
  if (EngineDBService.isAvailable()) {
    useEngineDB = await promptEngineDB();
  }

  // 3. Fallback to direct folder scan if Engine DJ was skipped or unavailable
  if (!useEngineDB) {
    useManualScan = await promptManualScan();
  }

  // 4. Run Bootstrap
  if (useEngineDB || useManualScan) {
    await runBootstrap(useEngineDB);
  } else {
    addLog('SYSTEM', 'Memory is empty. Starting fresh without RAG context.');
    setRagStatus('first-run');
  }

  // 5. Initialize file-watching service
  await initWatcher();
}

main().catch((err) => {
  console.error('[CRATEMIND] Fatal boot error:', err);
  process.exit(1);
});
