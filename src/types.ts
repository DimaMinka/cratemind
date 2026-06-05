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
  filepath?: string;
  filename?: string;
  artist: string;
  title: string;
  duration: number;
  bpm?: number;
  key?: string;
  genre?: string;
  comment?: string;
  label?: string;
  fromCache?: boolean;
};

export type RagStatus = 'first-run' | 'scanning' | 'ready';

export type RagStats = {
  total: number;
  folders: number;
  scannedAt: number | null;
  progress?: string;
};

export type BootstrapResult = {
  found: number;
  added: number;
  folders: number;
  total?: number;
  totalFolders?: number;
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
  yesLabel?: string;
  noLabel?: string;
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
  artist?: string;
  title?: string;
  bpm?: number;
  key?: string;
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
    isPaused?: boolean;
    bpm?: number;
    key?: string;
  } | null;
  isLLMAnalyzing: boolean;
  isTelegramDownloading: boolean;
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
  setTelegramDownloading: (isDownloading: boolean) => void;
  clearLogs: () => void;
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

// ── Embedding Pipeline Types ───────────────────────────────────────────────

/**
 * Standardized semantic passport assembled from Engine DJ, Spotify, and YouTube data.
 * This plain-text representation is passed to text-embedding-004 for vectorization.
 */
export type TrackPassport = {
  /** Full formatted passport string ready for embedding */
  text: string;
  /** Schema version — bump when passport format changes to invalidate old vectors */
  version: number;
  /** Individual field values for diagnostics and debugging */
  fields: {
    artist: string;
    title: string;
    bpm?: number;
    key?: string;
    durationFormatted?: string;
    year?: number;
    label?: string;
    genreTags: string[];
    ytVibeContext: string[];
  };
};

/**
 * A single result from the vector similarity search —
 * a track already sorted by the user that is musically close to the query.
 */
export type VectorNeighbor = {
  artist: string;
  title: string;
  folder: string;
  /** Cosine similarity score, 0.0–1.0 (higher = more similar) */
  similarity: number;
  /** Passport text of the neighbor, for diagnostics */
  passport?: string;
};

/** Energy + mood profile of a single structural phase inside a track */
export type TrackSegment = {
  phase: 'Intro' | 'Build-up' | 'Peak-time' | 'Outro';
  /** 0.0 (ambient/quiet) → 1.0 (full peak-time energy) */
  energyLevel: number;
  /** 0.0 (dark/minor/melancholy) → 1.0 (bright/major/joyful) */
  emotionalValence: number;
  /** Key sonic elements active during this phase, e.g. ["kick drum", "synth lead"] */
  dominantElements: string[];
};

/** Extended LLM response that includes segment-level structural analysis */
export type LLMDetailedResponse = {
  suggestedCrate: string;
  confidence: number;
  reasoning: string;
  technicalProfile: {
    estimatedBPM: number;
    estimatedKey: string;
  };
  segments: TrackSegment[];
};
