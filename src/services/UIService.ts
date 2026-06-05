import React from 'react';
import { render } from 'ink';
import { create } from 'zustand';
import { logToFile } from './LoggerService.js';
import { AppState } from '../types.js';
import { LOG_MAX } from '../config.js';
import { App } from '../components/App.js';
import * as CacheService from './CacheService.js';

/**
 * UIService.ts
 * Manages the global Zustand state store and mounts the Ink terminal render loop.
 */

// Retrieve initial persist state on boot
const initialStats = CacheService.getStats();

export const useStore = create<AppState>((set) => ({
  status: 'paused',
  stats: { processed: 0, overrides: 0, errors: 0 },
  dailyRequestsUsed: initialStats.dailyRequestsUsed,
  dailyRequestsLimit: initialStats.dailyRequestsLimit,
  totalCacheHits: initialStats.totalCacheHits,
  ragStatus: 'first-run',
  ragStats: { total: 0, folders: 0, scannedAt: null },
  bootPrompt: null,
  log: [],
  override: null,
  playback: null,
  isLLMAnalyzing: false,
  isTelegramDownloading: false,
  telegramDownloadOnly: false,
  setStatus: (status) => set({ status }),
  incrementStat: (key) =>
    set((state) => ({
      stats: { ...state.stats, [key]: state.stats[key] + 1 }
    })),
  addLog: (type, message) => {
    // Perform the side-effect (writing to disk) via the dedicated service
    logToFile(type, message);

    set((state) => {
      const nextLog = [...state.log, { type, message, ts: Date.now() }];
      if (nextLog.length > LOG_MAX) nextLog.shift(); // FIFO eviction

      const stats = { ...state.stats };
      if (type === 'ERROR') {
        stats.errors += 1;
      }

      return { log: nextLog, stats };
    });
  },
  setOverride: (override) => set({ override }),
  setRagStatus: (ragStatus, stats) =>
    set((state) => ({
      ragStatus,
      ragStats: { ...state.ragStats, ...stats }
    })),
  setBootPrompt: (bootPrompt) => set({ bootPrompt }),
  setPlayback: (playback) => set({ playback }),
  setLimitStats: (stats) =>
    set({
      dailyRequestsUsed: stats.dailyRequestsUsed,
      dailyRequestsLimit: stats.dailyRequestsLimit,
      totalCacheHits: stats.totalCacheHits
    }),
  setLLMAnalyzing: (isLLMAnalyzing) => set({ isLLMAnalyzing }),
  setTelegramDownloading: (isTelegramDownloading) => set({ isTelegramDownloading }),
  setTelegramDownloadOnly: (telegramDownloadOnly) => set({ telegramDownloadOnly }),
  clearLogs: () => set({ log: [] })
}));

/**
 * Clean cleanup function to restore standard terminal properties (unhide cursor,
 * exit alternate screen buffer) when the app shuts down.
 */
function cleanupTerminal(): void {
  // Exit alternate screen buffer
  process.stdout.write('\x1b[?1049l');
  // Show cursor
  process.stdout.write('\x1b[?25h');
}

/**
 * Starts the React-Ink terminal interface.
 * Mounts the <App /> root layout to standard output and blocks the CLI.
 *
 * Fullscreen Alternate Buffer:
 * - Emits ANSI escape codes to open a dedicated, clean fullscreen buffer (like vim/nano).
 * - Hides the native blinking cursor for a premium custom TUI console look.
 * - Wire SIGINT and exit events to gracefully restore the user's terminal back to normal.
 */
export function startTUI(): void {
  // Enter alternate screen buffer (fullscreen mode)
  process.stdout.write('\x1b[?1049h');
  // Hide blinking cursor
  process.stdout.write('\x1b[?25l');

  // Register cleanups
  process.on('exit', () => {
    cleanupTerminal();
  });

  process.on('SIGINT', () => {
    cleanupTerminal();
    process.exit(0);
  });

  process.on('uncaughtException', (err) => {
    cleanupTerminal();
    console.error('Fatal Uncaught Exception:', err);
    process.exit(1);
  });

  render(React.createElement(App));
}
