import dotenv from 'dotenv';
import { startTUI, useStore } from './services/UIService.js';
import * as EngineDBService from './services/EngineDBService.js';
import * as RAGService from './services/RAGService.js';
import { initWatcher } from './services/TrackWatcher.js';
import { SORTED_DIR } from './config.js';

// Load environment variables
dotenv.config();

/**
 * index.tsx
 *
 * Entry point of CrateMind Vibe Sorter.
 * Orchestrates the bootstrap sequence (user-first validation) and mounts TUI.
 */

async function runBootstrap(useEngineDB = false): Promise<void> {
  const addLog = useStore.getState().addLog;
  const setRagStatus = useStore.getState().setRagStatus;

  if (useEngineDB) {
    addLog('RAG', 'Starting bootstrap import from Engine DJ database (m.db) and local folders...');
  } else {
    addLog('RAG', `Starting bootstrap scan inside physical folder ${SORTED_DIR}...`);
  }
  try {
    const result = await RAGService.bootstrap(SORTED_DIR, useEngineDB);
    if (useEngineDB) {
      addLog(
        'RAG',
        `Import complete: ${result.found} tracks checked (m.db & local), ${result.added} new added to RAG (Total: ${result.total ?? result.added} tracks across ${result.totalFolders ?? result.folders} vibes).`
      );
    } else {
      addLog(
        'RAG',
        `Scan complete: ${result.found} files found in ${SORTED_DIR}, ${result.added} new added to RAG (Total: ${result.total ?? result.added} tracks across ${result.totalFolders ?? result.folders} vibes).`
      );
    }
    setRagStatus('ready', {
      total: result.total ?? result.added,
      folders: result.totalFolders ?? result.folders,
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

  // 2. Automatically check and use Engine DJ Database if available
  const useEngineDB = EngineDBService.isAvailable();
  if (useEngineDB) {
    addLog('SYSTEM', 'Engine DJ SQLite library detected. Automatically scanning database and local folders...');
  } else {
    addLog('SYSTEM', 'Engine DJ library not detected. Scanning local folders...');
  }

  // 3. Run Bootstrap
  await runBootstrap(useEngineDB);

  // 4. Initialize file-watching service
  await initWatcher();
}

main().catch((err) => {
  console.error('[CRATEMIND] Fatal boot error:', err);
  process.exit(1);
});
