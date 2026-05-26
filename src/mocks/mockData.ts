import { EngineTrack, RagExample } from '../types.js';

/**
 * mockData.ts
 *
 * Centralized store for all CrateMind simulated data.
 * Used exclusively when MOCK_MODE=true is enabled in .env.
 */

// 1. Mock tracks registered in the simulated Engine DJ library
export const MOCK_ENGINE_TRACKS: EngineTrack[] = [
  {
    id: 1,
    path: 'galaxy trip/Recondite - Shun.mp3',
    filename: 'Recondite - Shun.mp3',
    title: 'Shun',
    artist: 'Recondite'
  },
  {
    id: 2,
    path: 'iceland/Nils Frahm - Says.wav',
    filename: 'Nils Frahm - Says.wav',
    title: 'Says',
    artist: 'Nils Frahm'
  },
  {
    id: 3,
    path: 'mountain sunset/Bonobo - Kong.mp3',
    filename: 'Bonobo - Kong.mp3',
    title: 'Kong',
    artist: 'Bonobo'
  },
  {
    id: 4,
    path: 'magic forest/Kiasmos - Looped.flac',
    filename: 'Kiasmos - Looped.flac',
    title: 'Looped',
    artist: 'Kiasmos'
  },
  {
    id: 5,
    path: 'club party/Bicep - Glue.mp3',
    filename: 'Bicep - Glue.mp3',
    title: 'Glue',
    artist: 'Bicep'
  },
  {
    id: 6,
    path: 'desert vibe/Bedouin - Hologram.mp3',
    filename: 'Bedouin - Hologram.mp3',
    title: 'Hologram',
    artist: 'Bedouin'
  },
  {
    id: 7,
    path: 'spain vibe/Talaboman - Sideral.mp3',
    filename: 'Talaboman - Sideral.mp3',
    title: 'Sideral',
    artist: 'Talaboman'
  },
  {
    id: 8,
    path: 'galaxy trip/Burial - Archangel.wav',
    filename: 'Burial - Archangel.wav',
    title: 'Archangel',
    artist: 'Burial'
  }
];

// 2. Mock few-shot memory examples used to seed the simulated RAG Service
export const MOCK_RAG_EXAMPLES: RagExample[] = [
  {
    artist: 'Stephan Bodzin',
    title: 'Strand',
    folders: ['galaxy trip'],
    overriddenFolders: ['club party'],
    reasoning: 'Routed via manual user override checklist',
    source: 'manual',
    ts: Date.now()
  },
  {
    artist: 'Recondite',
    title: 'Shun',
    folders: ['galaxy trip', 'iceland'],
    reasoning: 'Added during mock scan',
    source: 'scan',
    ts: Date.now()
  },
  {
    artist: 'Nils Frahm',
    title: 'Says',
    folders: ['iceland'],
    reasoning: 'Added during mock scan',
    source: 'scan',
    ts: Date.now()
  },
  {
    artist: 'Bonobo',
    title: 'Kong',
    folders: ['mountain sunset'],
    reasoning: 'Added during mock scan',
    source: 'scan',
    ts: Date.now()
  },
  {
    artist: 'Kiasmos',
    title: 'Looped',
    folders: ['magic forest'],
    reasoning: 'Added during mock scan',
    source: 'scan',
    ts: Date.now()
  }
];

// 3. Mock track discoveries to simulate chokidar file drops with custom timing offsets
export const MOCK_DISCOVERIES = [
  { filepath: './Incoming/Recondite - Shun.mp3', delayMs: 4000 },
  { filepath: './Incoming/Stephan Bodzin - Strand.flac', delayMs: 12000 },
  { filepath: './Incoming/Bonobo - Kong.mp3', delayMs: 28000 }
];
