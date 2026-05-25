import dotenv from 'dotenv';
import { startTUI } from './services/UIService.js';
import { initWatcher } from './services/FSService.js';

// Load environment variables
dotenv.config();

/**
 * index.tsx
 * Entry point of CrateMind Vibe Sorter.
 * Wires the file-watching pipeline and mounts the React Ink terminal interface.
 */

async function main() {
  // 1. Initialize file-watching service
  await initWatcher();

  // 2. Launch the terminal interface
  startTUI();
}

main().catch((err) => {
  console.error('[CRATEMIND] Fatal boot error:', err);
  process.exit(1);
});
