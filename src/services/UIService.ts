import { createStore } from 'zustand/vanilla';
import { AppState } from '../types.js';

/**
 * UIService.ts
 * Manages the global Zustand state store and mounts the Ink terminal render loop.
 */

export const useStore = createStore<AppState>((set) => ({
  status: 'listening',
  stats: { processed: 0, overrides: 0, errors: 0 },
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
      if (nextLog.length > 200) nextLog.shift(); // FIFO eviction
      return { log: nextLog };
    }),
  setOverride: (override) => set({ override })
}));

export function startTUI(): void {
  // TODO: Implement Ink React render loop wrapping
}
