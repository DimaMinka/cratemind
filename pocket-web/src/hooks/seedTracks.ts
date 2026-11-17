import type { PocketBatchManifest, PocketTrackItem } from '../types/pocketWeb.types.js';

export const SEED_TRACKS: PocketTrackItem[] = [
  {
    id: 'track-0',
    filename: '01 Desert Nomad.mp3',
    title: 'Desert Nomad',
    artist: 'Bedouin',
    duration: 220,
    bpm: 122,
    key: '8A',
    energyShape: [0.1, 0.3, 0.5, 0.7, 0.9, 1.0, 0.8, 0.9, 0.7, 0.4, 0.3, 0.5, 0.8, 0.9, 0.6, 0.3],
    ragSuggestions: [{ folder: 'desert vibe', similarity: 0.94, matchSource: 'clap' }],
    ragSuggestion: {
      folder: 'desert vibe',
      confidence: 94,
      matchType: 'clap_embedding',
      neighbors: []
    },
    ytScout: {
      playlistName: 'Bedouin Chill Sessions',
      suggestedFolder: 'nargila vibe',
      matchedFolder: 'nargila vibe'
    }
  },
  {
    id: 'track-1',
    filename: '02 Stephan Bodzin - Strand.mp3',
    title: 'Strand',
    artist: 'Stephan Bodzin',
    duration: 260,
    bpm: 124,
    key: '9A',
    energyShape: [0.2, 0.4, 0.6, 0.8, 0.9, 0.9, 0.7, 0.6, 0.5, 0.4, 0.5, 0.7, 0.8, 0.8, 0.5, 0.2],
    ragSuggestions: [{ folder: 'magic forest', similarity: 0.89, matchSource: 'clap' }],
    ragSuggestion: {
      folder: 'magic forest',
      confidence: 89,
      matchType: 'clap_embedding',
      neighbors: []
    }
  },
  {
    id: 'track-2',
    filename: '03 Recondite - Shun.mp3',
    title: 'Shun',
    artist: 'Recondite',
    duration: 310,
    bpm: 126,
    key: '10A',
    energyShape: [0.3, 0.5, 0.7, 0.9, 1.0, 0.8, 0.7, 0.5, 0.4, 0.6, 0.8, 0.9, 0.9, 0.7, 0.4, 0.1]
  }
];

export const SEED_MANIFEST: PocketBatchManifest = {
  batchId: 'seed-batch-01',
  generatedAt: Date.now(),
  totalTracks: SEED_TRACKS.length,
  tracks: SEED_TRACKS
};
