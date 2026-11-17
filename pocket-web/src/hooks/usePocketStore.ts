import { create } from 'zustand';
import type {
  PocketStoreState,
  PocketView,
  QueueFilter,
  StorageQuotaInfo
} from './pocketStore.types.js';
import type { PocketDecision } from '../types/pocketWeb.types.js';
import {
  initIndexedDbStore,
  getBatchManifest,
  getAllDecisions,
  saveDecision,
  getTotalCachedAudioSize,
  enqueueMutation,
  getPendingMutations,
  clearPendingMutations
} from '../engine/indexedDbStore.js';
import { SEED_TRACKS, SEED_MANIFEST } from './seedTracks.js';
import {
  checkBridgeHealthAction,
  pullBatchFromMacAction,
  commitToMacAction,
  importLocalFilesAction
} from './pocketSyncActions.js';

export const usePocketStore = create<PocketStoreState>((set, get) => ({
  manifest: SEED_MANIFEST,
  tracks: SEED_TRACKS,
  activeTrackIndex: 0,
  decisions: {},
  selectedFolders: [],

  activeView: 'sorter',
  isInspectorOpen: false,
  queueFilter: 'all',
  queueSearchQuery: '',

  isPlaying: false,
  currentTime: 0,
  duration: 220,
  cachedAudioSize: 0,

  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  isBridgeConnected: false,
  isSyncing: false,
  syncError: null,
  storageQuota: { usage: 0, quota: 0, persisted: false },

  setActiveView: (view: PocketView) => set({ activeView: view }),
  setInspectorOpen: (open: boolean) => set({ isInspectorOpen: open }),
  setQueueFilter: (filter: QueueFilter) => set({ queueFilter: filter }),
  setQueueSearchQuery: (query: string) => set({ queueSearchQuery: query }),

  toggleFolder: (folder: string) => {
    const current = get().selectedFolders;
    const exists = current.includes(folder);
    const updated = exists ? current.filter((f) => f !== folder) : [...current, folder];
    set({ selectedFolders: updated });
  },

  setSelectedFolders: (folders: string[]) => set({ selectedFolders: folders }),

  routeTrack: async (folders?: string | string[]) => {
    const { tracks, activeTrackIndex, decisions, selectedFolders } = get();
    const currentTrack = tracks[activeTrackIndex];
    if (!currentTrack) return;

    let targetFolders: string[];
    if (typeof folders === 'string') {
      targetFolders = [folders];
    } else if (Array.isArray(folders) && folders.length > 0) {
      targetFolders = folders;
    } else {
      targetFolders = selectedFolders;
    }
    if (targetFolders.length === 0) return;

    const decision: PocketDecision = {
      trackId: currentTrack.id,
      filename: currentTrack.filename,
      status: 'tagged',
      selectedFolders: targetFolders,
      decisionTimestamp: Date.now()
    };

    const updatedDecisions = { ...decisions, [currentTrack.id]: decision };
    const nextIndex = activeTrackIndex + 1;

    if (nextIndex < tracks.length) {
      set({
        decisions: updatedDecisions,
        selectedFolders: [],
        activeTrackIndex: nextIndex
      });
    } else {
      set({
        decisions: updatedDecisions,
        selectedFolders: [],
        activeView: 'queue'
      });
    }

    await saveDecision(decision).catch(() => {});
    const { isBridgeConnected } = get();
    if (!isBridgeConnected) {
      await enqueueMutation({
        id: `mut_${currentTrack.id}_${Date.now()}`,
        trackId: currentTrack.id,
        decision,
        createdAt: Date.now()
      }).catch(() => {});
    }
  },

  skipTrack: async () => {
    const { tracks, activeTrackIndex, decisions } = get();
    const currentTrack = tracks[activeTrackIndex];
    if (!currentTrack) return;

    const decision: PocketDecision = {
      trackId: currentTrack.id,
      filename: currentTrack.filename,
      status: 'skipped',
      selectedFolders: [],
      decisionTimestamp: Date.now()
    };

    const updatedDecisions = { ...decisions, [currentTrack.id]: decision };
    const nextIndex = activeTrackIndex + 1;

    if (nextIndex < tracks.length) {
      set({
        decisions: updatedDecisions,
        selectedFolders: [],
        activeTrackIndex: nextIndex
      });
    } else {
      set({
        decisions: updatedDecisions,
        selectedFolders: [],
        activeView: 'queue'
      });
    }

    await saveDecision(decision).catch(() => {});
    const { isBridgeConnected } = get();
    if (!isBridgeConnected) {
      await enqueueMutation({
        id: `mut_${currentTrack.id}_${Date.now()}`,
        trackId: currentTrack.id,
        decision,
        createdAt: Date.now()
      }).catch(() => {});
    }
  },

  selectTrackIndex: (index: number) => {
    const { tracks, decisions } = get();
    if (index >= 0 && index < tracks.length) {
      const track = tracks[index];
      const existing = decisions[track.id];
      set({
        activeTrackIndex: index,
        selectedFolders: existing ? existing.selectedFolders : [],
        activeView: 'sorter'
      });
    }
  },

  prevTrack: () => {
    const { activeTrackIndex, tracks, decisions } = get();
    if (activeTrackIndex > 0) {
      const prevIdx = activeTrackIndex - 1;
      const prev = tracks[prevIdx];
      const existing = decisions[prev.id];
      set({
        activeTrackIndex: prevIdx,
        selectedFolders: existing ? existing.selectedFolders : []
      });
    }
  },

  nextTrack: () => {
    const { activeTrackIndex, tracks, decisions } = get();
    if (activeTrackIndex < tracks.length - 1) {
      const nextIdx = activeTrackIndex + 1;
      const next = tracks[nextIdx];
      const existing = decisions[next.id];
      set({
        activeTrackIndex: nextIdx,
        selectedFolders: existing ? existing.selectedFolders : []
      });
    }
  },

  undoDecision: async (trackId: string) => {
    const { decisions } = get();
    const existing = decisions[trackId];
    if (!existing) return;

    const updated: PocketDecision = {
      ...existing,
      status: 'pending',
      selectedFolders: [],
      decisionTimestamp: Date.now()
    };

    await saveDecision(updated).catch(() => {});
    set({ decisions: { ...decisions, [trackId]: updated } });
  },

  applyRagAndYtMatches: async () => {
    const { tracks, activeTrackIndex, routeTrack } = get();
    const currentTrack = tracks[activeTrackIndex];
    if (!currentTrack) return;

    const collected: string[] = [];
    if (currentTrack.ragSuggestions && currentTrack.ragSuggestions.length > 0) {
      collected.push(currentTrack.ragSuggestions[0].folder);
    } else if (currentTrack.ragSuggestion?.folder) {
      collected.push(currentTrack.ragSuggestion.folder);
    }

    if (currentTrack.ytScout) {
      const scout = currentTrack.ytScout;
      const ytFolder = scout.matchedFolder || scout.suggestedFolder;
      if (ytFolder && !collected.includes(ytFolder)) {
        collected.push(ytFolder);
      }
    }

    if (collected.length > 0) {
      set({ isInspectorOpen: false });
      await routeTrack(collected);
    }
  },

  setIsPlaying: (playing: boolean) => set({ isPlaying: playing }),
  setPlaybackTime: (currentTime: number, duration?: number) =>
    set({ currentTime, ...(duration ? { duration } : {}) }),
  setCachedAudioSize: (bytes: number) => set({ cachedAudioSize: bytes }),
  setStorageQuota: (storageQuota: StorageQuotaInfo) => set({ storageQuota }),
  setBridgeConnected: (connected: boolean) => set({ isBridgeConnected: connected }),

  checkBridgeHealth: () => checkBridgeHealthAction(set),

  initStore: async () => {
    // 1. Non-blocking storage persistence request in background
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      void navigator.storage.persist().catch(() => {});
    }

    // 2. Synchronous Local-First Hydration from IndexedDB (<50ms)
    try {
      await initIndexedDbStore();
      const cachedBytes = await getTotalCachedAudioSize();
      set({ cachedAudioSize: cachedBytes });

      const manifest = await getBatchManifest();
      if (manifest && manifest.tracks && manifest.tracks.length > 0) {
        const decisionsList = await getAllDecisions();
        const activeIds = new Set(manifest.tracks.map((t) => t.id));
        const decisionsMap: Record<string, PocketDecision> = {};
        for (const d of decisionsList) {
          if (activeIds.has(d.trackId)) {
            decisionsMap[d.trackId] = d;
          }
        }
        set({
          manifest,
          tracks: manifest.tracks,
          decisions: decisionsMap,
          cachedAudioSize: cachedBytes
        });
      }
    } catch (e) {
      console.warn('[CrateMind Pocket] Local storage hydration warning:', e);
    }

    // 3. Asynchronous non-blocking Mac bridge check with 1500ms timeout
    if (typeof fetch === 'function') {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1500);
      fetch('/api/health', { signal: ctrl.signal })
        .then((res) => {
          clearTimeout(timer);
          set({ isBridgeConnected: res.ok });
          if (res.ok) {
            void get().flushPendingMutations();
          }
        })
        .catch(() => {
          clearTimeout(timer);
          set({ isBridgeConnected: false });
        });
    }
  },

  flushPendingMutations: async () => {
    const mutations = await getPendingMutations().catch(() => []);
    if (!mutations || mutations.length === 0) return;

    const payload = {
      batchId: get().manifest?.batchId || 'offline_batch',
      committedAt: Date.now(),
      decisions: mutations.map((m) => m.decision as PocketDecision)
    };

    try {
      const res = await fetch('/api/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const ids = mutations.map((m) => m.id);
        await clearPendingMutations(ids);
      }
    } catch {
      // Retained in queue for next sync window
    }
  },

  pullBatchFromMac: (limit = 30, append = true) => pullBatchFromMacAction(set, get, limit, append),

  commitToMac: () => commitToMacAction(set, get),

  importLocalFiles: (files: File[]) => importLocalFilesAction(set, files)
}));
