export type LogEntry = {
  type:
    | 'DETECTED'
    | 'ID3'
    | 'LLM_REASONING'
    | 'ROUTED'
    | 'ERROR'
    | 'NEEDS_MANUAL'
    | 'RAG'
    | 'SYSTEM'
    | 'YT_SEARCH'
    | 'YT_HIT'
    | 'YT_CACHE_HIT';
  message: string;
  ts: number;
};

export type TrackMeta = {
  filepath: string;
  filename: string;
  artist: string;
  title: string;
  duration: number;
  bpm?: number;
  key?: string;
  genre?: string;
  comment?: string;
  label?: string;
};

export type RagStatus = 'first-run' | 'scanning' | 'ready';

export type RagStats = {
  total: number;
  folders: number;
  scannedAt: number | null;
};

export type BootstrapResult = {
  found: number;
  added: number;
  folders: number;
};

export type RagExample = {
  artist: string;
  title: string;
  folders: string[];
  overriddenFolders?: string[];
  reasoning: string;
  source: 'auto' | 'manual' | 'scan' | 'engine-dj';
  ts: number;
};

export type RagMemory = {
  version: 1;
  examples: RagExample[];
  lastScanDir: string | null;
};

export type BootPromptState = {
  message: string;
  detail: string;
  resolve: (confirmed: boolean) => void;
};

export type EngineTrack = {
  id: number;
  path: string;
  filename: string;
  title: string;
  artist: string;
  bpm?: number;
  key?: string;
  genre?: string;
  comment?: string;
  label?: string;
};

export type OverrideState = {
  filename: string;
  filepath: string;
  folders: string[];
  suggested: string[];
  selected: string[];
  reason?: string;
  resolve: (folders: string[]) => void;
};

export type AppState = {
  status: 'listening' | 'paused';
  stats: {
    processed: number;
    overrides: number;
    errors: number;
  };
  dailyRequestsUsed: number;
  dailyRequestsLimit: number;
  totalCacheHits: number;
  ragStatus: RagStatus;
  ragStats: RagStats;
  bootPrompt: BootPromptState | null;
  log: LogEntry[];
  override: OverrideState | null;
  playback: {
    filepath: string;
    filename: string;
    duration: number;
    offset: number;
    lastStartedAt: number;
  } | null;
  isLLMAnalyzing: boolean;
  setStatus: (status: 'listening' | 'paused') => void;
  incrementStat: (key: 'processed' | 'overrides' | 'errors') => void;
  addLog: (type: LogEntry['type'], message: string) => void;
  setOverride: (override: OverrideState | null) => void;
  setRagStatus: (status: RagStatus, stats?: Partial<RagStats>) => void;
  setBootPrompt: (prompt: BootPromptState | null) => void;
  setPlayback: (playback: AppState['playback']) => void;
  setLimitStats: (stats: {
    dailyRequestsUsed: number;
    dailyRequestsLimit: number;
    totalCacheHits: number;
  }) => void;
  setLLMAnalyzing: (isAnalyzing: boolean) => void;
};

export type LLMResponse = {
  folders: string[];
  reasoning: string;
  confidence: number;
};

// ── YouTube Network Scout Types ────────────────────────────────────────────

/** YouTube playlist/mix metadata */
export type YouTubePlaylist = {
  id: string;
  title: string;
  description: string;
  channelName: string;
};

/** A single track's appearance inside a YouTube playlist */
export type YouTubePlaylistItem = {
  playlistId: string;
  index: number;
  artist: string;
  title: string;
};

/** Result of network scouting for a specific track */
export type NetworkScoutResult = {
  playlists: YouTubePlaylist[];
  neighbors: YouTubePlaylistItem[];
  source: 'cache' | 'network';
};

/** In-memory cached playlist entry */
export type CachedPlaylist = {
  playlist: YouTubePlaylist;
  items: YouTubePlaylistItem[];
  cachedAt: number;
};
