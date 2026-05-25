export type LogEntry = {
  type: 'DETECTED' | 'ID3' | 'LLM_REASONING' | 'ROUTED' | 'ERROR' | 'NEEDS_MANUAL' | 'RAG';
  message: string;
  ts: number;
};

export type TrackMeta = {
  filepath: string;
  filename: string;
  artist: string;
  title: string;
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
};

export type OverrideState = {
  filename: string;
  filepath: string;
  folders: string[];
  suggested: string[];
  selected: string[];
  resolve: (folders: string[]) => void;
};

export type AppState = {
  status: 'listening' | 'paused';
  stats: {
    processed: number;
    overrides: number;
    errors: number;
  };
  ragStatus: RagStatus;
  ragStats: RagStats;
  bootPrompt: BootPromptState | null;
  log: LogEntry[];
  override: OverrideState | null;
  setStatus: (status: 'listening' | 'paused') => void;
  incrementStat: (key: 'processed' | 'overrides' | 'errors') => void;
  addLog: (type: LogEntry['type'], message: string) => void;
  setOverride: (override: OverrideState | null) => void;
  setRagStatus: (status: RagStatus, stats?: Partial<RagStats>) => void;
  setBootPrompt: (prompt: BootPromptState | null) => void;
};

export type LLMResponse = {
  folders: string[];
  reasoning: string;
  confidence: number;
};
