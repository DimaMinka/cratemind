export type LogEntry = {
  type: 'DETECTED' | 'ID3' | 'LLM_REASONING' | 'ROUTED' | 'ERROR';
  message: string;
  ts: number;
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
  log: LogEntry[];
  override: OverrideState | null;
  setStatus: (status: 'listening' | 'paused') => void;
  incrementStat: (key: 'processed' | 'overrides' | 'errors') => void;
  addLog: (type: LogEntry['type'], message: string) => void;
  setOverride: (override: OverrideState | null) => void;
};

export type LLMResponse = {
  folders: string[];
  reasoning: string;
  confidence: number;
};
