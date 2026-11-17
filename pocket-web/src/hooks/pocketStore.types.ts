import type {
  PocketBatchManifest,
  PocketDecision,
  PocketTrackItem
} from '../types/pocketWeb.types.js';

export type PocketView = 'sorter' | 'queue' | 'sync';
export type QueueFilter = 'all' | 'pending' | 'tagged' | 'skipped';

export interface StorageQuotaInfo {
  usage: number;
  quota: number;
  persisted: boolean;
}

export interface PocketStoreState {
  // Domain data
  manifest: PocketBatchManifest | null;
  tracks: PocketTrackItem[];
  activeTrackIndex: number;
  decisions: Record<string, PocketDecision>;
  selectedFolders: string[];

  // Navigation & Modal
  activeView: PocketView;
  isInspectorOpen: boolean;
  queueFilter: QueueFilter;
  queueSearchQuery: string;

  // Audio state
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  cachedAudioSize: number;

  // Network & Sync state
  isOnline: boolean;
  isBridgeConnected: boolean;
  isSyncing: boolean;
  syncError: string | null;
  storageQuota: StorageQuotaInfo;

  // Actions
  setActiveView: (view: PocketView) => void;
  setInspectorOpen: (open: boolean) => void;
  setQueueFilter: (filter: QueueFilter) => void;
  setQueueSearchQuery: (query: string) => void;
  toggleFolder: (folder: string) => void;
  setSelectedFolders: (folders: string[]) => void;
  routeTrack: (folders?: string | string[]) => Promise<void>;
  skipTrack: () => Promise<void>;
  selectTrackIndex: (index: number) => void;
  prevTrack: () => void;
  nextTrack: () => void;
  undoDecision: (trackId: string) => Promise<void>;
  applyRagAndYtMatches: () => Promise<void>;
  setIsPlaying: (playing: boolean) => void;
  setPlaybackTime: (currentTime: number, duration?: number) => void;
  setCachedAudioSize: (bytes: number) => void;
  setStorageQuota: (quota: StorageQuotaInfo) => void;
  setBridgeConnected: (connected: boolean) => void;
  checkBridgeHealth: () => Promise<boolean>;
  initStore: () => Promise<void>;
  pullBatchFromMac: (limit?: number, append?: boolean) => Promise<boolean>;
  commitToMac: () => Promise<boolean>;
  flushPendingMutations: () => Promise<void>;
  importLocalFiles: (files: File[]) => Promise<void>;
}
