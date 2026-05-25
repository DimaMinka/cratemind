import { create } from 'zustand';
import { AppState } from '../types.js';
import { LOG_MAX } from '../config.js';

/**
 * UIService.ts
 * Manages the global Zustand state store and mounts the Ink terminal render loop.
 */

export const useStore = create<AppState>((set) => ({
  status: 'listening',
  stats: { processed: 0, overrides: 0, errors: 0 },
  ragStatus: 'first-run',
  ragStats: { total: 0, folders: 0, scannedAt: null },
  bootPrompt: null,
  log: [],
  override: null,
  setStatus: (status) => set({ status }),
  incrementStat: (key) =>
    set((state) => ({
      stats: { ...state.stats, [key]: state.stats[key] + 1 }
    })),
  addLog: (type, message) =>
    set((state) => {
      const nextLog = [...state.log, { type, message, ts: Date.now() }];
      if (nextLog.length > LOG_MAX) nextLog.shift(); // FIFO eviction
      return { log: nextLog };
    }),
  setOverride: (override) => set({ override }),
  setRagStatus: (ragStatus, stats) =>
    set((state) => ({
      ragStatus,
      ragStats: { ...state.ragStats, ...stats }
    })),
  setBootPrompt: (bootPrompt) => set({ bootPrompt })
}));

export function startTUI(): void {
  // TODO: Implement Ink React render loop wrapping
}
