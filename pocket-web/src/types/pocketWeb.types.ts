export interface PocketAcousticProfile {
  bpm: number | null;
  key: string | null;
  energyShape: number[] | null;
  subBassPercent?: number | null;
  midPercent?: number | null;
  highPercent?: number | null;
  onsetPercent?: number | null;
}

export interface PocketSpectralProfile {
  subBassDb: number | null;
  bassDb: number | null;
  midDb: number | null;
  highDb: number | null;
  onsetDensity: number | null;
}

export interface PocketRagNeighbor {
  artist: string;
  title: string;
  folder: string;
  similarity: number;
}

export interface PocketRagSuggestion {
  folder: string | null;
  confidence: number;
  matchType: 'exact' | 'artist' | 'clap_embedding' | 'acoustic' | 'none';
  referenceTrack?: string;
  neighbors: PocketRagNeighbor[];
}

export interface PocketYouTubeNeighbor {
  index: number;
  artist: string;
  title: string;
  folder: string | null;
}

export interface PocketYouTubeScout {
  hasMatch?: boolean;
  playlistId?: string | null;
  playlistTitle?: string | null;
  playlistName?: string;
  trackIndex?: number | null;
  matchedFolder?: string | null;
  suggestedFolder?: string;
  neighbors?: PocketYouTubeNeighbor[];
}

export interface PocketRagSuggestionItem {
  folder: string;
  similarity: number;
  matchSource?: 'clap' | 'token' | 'acoustic' | 'exact';
}

export interface PocketTrackItem {
  id: string;
  filename: string;
  filepath?: string;
  artist: string;
  title: string;
  duration: number;
  durationFormatted?: string;
  bpm?: number | null;
  key?: string | null;
  fileSizeBytes?: number;
  previewAudioUrl?: string;
  mode?: 'pre-analyzed' | 'raw-manual';
  status?: 'pending' | 'tagged' | 'skipped';
  selectedFolders?: string[];
  acoustic?: PocketAcousticProfile;
  energyShape?: number[] | null;
  spectralProfile?: PocketSpectralProfile | null;
  ragSuggestions?: PocketRagSuggestionItem[];
  ragSuggestion?: PocketRagSuggestion;
  ytScout?: PocketYouTubeScout;
}

export interface PocketDecision {
  trackId: string;
  filename: string;
  status: 'pending' | 'tagged' | 'skipped';
  selectedFolders: string[];
  decisionTimestamp?: number;
  updatedAt?: number;
}

export interface PocketBatchManifest {
  batchId: string;
  createdAt?: number;
  generatedAt?: number;
  mode?: 'pre-analyzed' | 'raw-manual';
  totalTracks: number;
  totalSizeMb?: number;
  ragExamplesCount?: number;
  ragTotalExamples?: number;
  tracks: PocketTrackItem[];
}

export interface PocketCommitResult {
  success: boolean;
  batchId: string;
  processedCount: number;
  routedCount: number;
  skippedCount: number;
  pendingCount: number;
  unmodifiedCount?: number;
  ragExamplesAdded?: number;
  errors: string[];
}

export interface PocketHealthStatus {
  status: 'ok' | 'busy';
  uptime?: number;
  incomingCount: number;
  ragCount: number;
  isBusy: boolean;
  activeTask: string | null;
}

export interface CrateCategory {
  name: string;
  color: string;
  borderColor: string;
  activeColor: string;
  glowRgba: string;
  folders: string[];
}
