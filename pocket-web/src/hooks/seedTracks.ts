import type { PocketBatchManifest, PocketTrackItem } from '../types/pocketWeb.types.js';

export const SEED_TRACKS: PocketTrackItem[] = [];

export const SEED_MANIFEST: PocketBatchManifest = {
  batchId: 'empty-batch',
  generatedAt: Date.now(),
  totalTracks: 0,
  tracks: []
};
