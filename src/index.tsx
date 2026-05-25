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
 *
 * Boot sequence flow:
 * 1. startTUI() - Immediately mounts TUI so logs/status are visible.
 * 2. Check EngineDBService.isAvailable()
 *    - If YES: Show ConfirmPrompt to bootstrap using Engine DJ library.
 *    - If NO / User skipped: Show ConfirmPrompt to scan sorted folders directly.
 * 3. Await user confirmation asynchronously.
 * 4. Run RAGService.bootstrap() -> populate RAG memory.
 * 5. initWatcher() -> start active Incoming directory monitoring.
 */

async function main() {
  // 1. Launch terminal UI immediately
  startTUI();

  const addLog = useStore.getState().addLog;
  const setRagStatus = useStore.getState().setRagStatus;
  const setBootPrompt = useStore.getState().setBootPrompt;

  addLog('RAG', 'CrateMind starting up...');
  setRagStatus('scanning');

  let useEngineDB = false;
  let useManualScan = false;

  // 2. Check Engine DJ Database
  if (EngineDBService.isAvailable()) {
    addLog('RAG', 'Engine DJ SQLite library detected.');

    // Await user confirmation for Engine DJ import
    const confirm = await new Promise<boolean>((resolve) => {
      setBootPrompt({
        message: 'Engine DJ library detected! Scan tracks into memory?',
        detail: 'Reads track metadata from m.db (Strictly Read-Only)',
        resolve: (val) => {
          setBootPrompt(null);
          resolve(val);
        }
      });
    });

    if (confirm) {
      useEngineDB = true;
      addLog('RAG', 'User accepted Engine DJ import.');
    } else {
      addLog('RAG', 'User skipped Engine DJ import. Falling back to folder scan.');
    }
  }

  // 3. Fallback to direct folder scan if Engine DJ was skipped or unavailable
  if (!useEngineDB) {
    const confirm = await new Promise<boolean>((resolve) => {
      setBootPrompt({
        message: 'Scan local sorted directories into few-shot memory?',
        detail: `Reads ID3 tags from files in ${SORTED_DIR}`,
        resolve: (val) => {
          setBootPrompt(null);
          resolve(val);
        }
      });
    });

    if (confirm) {
      useManualScan = true;
      addLog('RAG', 'User accepted local folder scan.');
    } else {
      addLog('RAG', 'User skipped memory bootstrap.');
    }
  }

  // 4. Run Bootstrap
  if (useEngineDB || useManualScan) {
    addLog('RAG', `Starting bootstrap scan inside ${SORTED_DIR}...`);
    try {
      const result = await RAGService.bootstrap(SORTED_DIR);
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
  } else {
    addLog('RAG', 'Memory is empty. Starting fresh without RAG context.');
    setRagStatus('first-run');
  }

  // 5. Initialize file-watching service
  await initWatcher();
}

main().catch((err) => {
  console.error('[CRATEMIND] Fatal boot error:', err);
  process.exit(1);
});
