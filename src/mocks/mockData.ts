import { EngineTrack, RagExample, YouTubePlaylist, YouTubePlaylistItem } from '../types.js';

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

// 4. Mock YouTube playlists with full tracklists for NetworkScoutService.
//    Strategic cross-playlist overlaps test the Playlist Memory warming effect:
//    - Bonobo "Kong" → Melodic Sunset + Organic Forest
//    - Stephan Bodzin "Strand" → Melodic Sunset + Dark Space Voyage
//    - Recondite "Shun" → Dark Space Voyage + Northern Lights
//    - Kiasmos "Looped" → Dark Space Voyage + Northern Lights
//    - Burial "Archangel" → Dark Space Voyage + Northern Lights
//    - Bedouin "Hologram" → Organic Forest + Desert Caravan
//    - Nils Frahm "Says" → Melodic Sunset + Northern Lights
export const MOCK_YOUTUBE_PLAYLISTS: YouTubePlaylist[] = [
  {
    id: 'yt_melodic_sunset_2026',
    title: 'Melodic Sunset 2026 | Deep Progressive Mix',
    description: 'A deep melodic journey through sunlit horizons and cosmic dawns',
    channelName: 'Cercle'
  },
  {
    id: 'yt_dark_space_voyage',
    title: 'Dark Space Voyage | Hypnotic Techno',
    description: 'Enter the void — cold minimal techno for midnight explorers',
    channelName: 'Afterlife'
  },
  {
    id: 'yt_organic_forest_ritual',
    title: 'Organic Forest Ritual | Nature & Mysticism',
    description: 'Earthy percussion, wooden textures, and shamanic energy',
    channelName: 'All Day I Dream'
  },
  {
    id: 'yt_ibiza_club_night',
    title: 'Ibiza Club Night 2026 | Peak-Time Energy',
    description: 'High-octane club grooves for the dance floor',
    channelName: 'Boiler Room'
  },
  {
    id: 'yt_northern_lights_ambient',
    title: 'Northern Lights | Arctic Ambient Journey',
    description: 'Frozen landscapes, ice drones, and monochrome minimalism',
    channelName: 'Anjunadeep'
  },
  {
    id: 'yt_desert_caravan',
    title: 'Desert Caravan | Ethnic Deep House',
    description: 'Dusty grooves, shimmering heat, and ancient rhythms',
    channelName: 'The Soundgarden'
  }
];

export const MOCK_YOUTUBE_PLAYLIST_ITEMS: YouTubePlaylistItem[] = [
  // ── Melodic Sunset 2026 ──────────────────────────────
  { playlistId: 'yt_melodic_sunset_2026', index: 0, artist: 'Ben Böhmer', title: 'Beyond Beliefs' },
  { playlistId: 'yt_melodic_sunset_2026', index: 1, artist: 'Lane 8', title: 'Keep On' },
  { playlistId: 'yt_melodic_sunset_2026', index: 2, artist: 'Yotto', title: 'Nova' },
  { playlistId: 'yt_melodic_sunset_2026', index: 3, artist: 'Bonobo', title: 'Kong' },
  {
    playlistId: 'yt_melodic_sunset_2026',
    index: 4,
    artist: 'Rufus Du Sol',
    title: 'Innerbloom'
  },
  { playlistId: 'yt_melodic_sunset_2026', index: 5, artist: 'Nils Frahm', title: 'Says' },
  {
    playlistId: 'yt_melodic_sunset_2026',
    index: 6,
    artist: 'Stephan Bodzin',
    title: 'Strand'
  },
  { playlistId: 'yt_melodic_sunset_2026', index: 7, artist: 'Joris Voorn', title: 'Antigone' },
  {
    playlistId: 'yt_melodic_sunset_2026',
    index: 8,
    artist: 'Patrice Bäumel',
    title: 'Roar'
  },
  {
    playlistId: 'yt_melodic_sunset_2026',
    index: 9,
    artist: 'Eelke Kleijn',
    title: 'Transmission'
  },

  // ── Dark Space Voyage ────────────────────────────────
  { playlistId: 'yt_dark_space_voyage', index: 0, artist: 'Recondite', title: 'Shun' },
  { playlistId: 'yt_dark_space_voyage', index: 1, artist: 'Kiasmos', title: 'Looped' },
  { playlistId: 'yt_dark_space_voyage', index: 2, artist: 'Stephan Bodzin', title: 'Strand' },
  {
    playlistId: 'yt_dark_space_voyage',
    index: 3,
    artist: 'Tale Of Us',
    title: 'Notte Senza Fine'
  },
  { playlistId: 'yt_dark_space_voyage', index: 4, artist: 'Âme', title: 'Rej' },
  { playlistId: 'yt_dark_space_voyage', index: 5, artist: 'Burial', title: 'Archangel' },
  { playlistId: 'yt_dark_space_voyage', index: 6, artist: 'Moderat', title: 'Bad Kingdom' },
  { playlistId: 'yt_dark_space_voyage', index: 7, artist: 'Apparat', title: 'Goodbye' },
  {
    playlistId: 'yt_dark_space_voyage',
    index: 8,
    artist: 'Agents Of Time',
    title: 'Polaris'
  },
  { playlistId: 'yt_dark_space_voyage', index: 9, artist: 'Mind Against', title: 'Atlant' },

  // ── Organic Forest Ritual ────────────────────────────
  {
    playlistId: 'yt_organic_forest_ritual',
    index: 0,
    artist: 'Viken Arman',
    title: 'Fading Memory'
  },
  {
    playlistId: 'yt_organic_forest_ritual',
    index: 1,
    artist: 'Hraach',
    title: 'Slow Motion'
  },
  { playlistId: 'yt_organic_forest_ritual', index: 2, artist: 'Bonobo', title: 'Kong' },
  { playlistId: 'yt_organic_forest_ritual', index: 3, artist: 'Bedouin', title: 'Hologram' },
  { playlistId: 'yt_organic_forest_ritual', index: 4, artist: 'Be Svendsen', title: 'Catch' },
  {
    playlistId: 'yt_organic_forest_ritual',
    index: 5,
    artist: 'Nicola Cruz',
    title: 'Prender el Alma'
  },
  { playlistId: 'yt_organic_forest_ritual', index: 6, artist: 'Acid Pauli', title: 'Nana' },
  {
    playlistId: 'yt_organic_forest_ritual',
    index: 7,
    artist: 'DJ Tennis',
    title: 'Certain Angles'
  },

  // ── Ibiza Club Night ─────────────────────────────────
  { playlistId: 'yt_ibiza_club_night', index: 0, artist: 'Bicep', title: 'Glue' },
  { playlistId: 'yt_ibiza_club_night', index: 1, artist: 'Peggy Gou', title: 'Starry Night' },
  {
    playlistId: 'yt_ibiza_club_night',
    index: 2,
    artist: 'Solomun',
    title: 'Customer Is King'
  },
  { playlistId: 'yt_ibiza_club_night', index: 3, artist: 'Adam Port', title: 'Planet 9' },
  {
    playlistId: 'yt_ibiza_club_night',
    index: 4,
    artist: 'Adriatique',
    title: 'Raytracing'
  },
  { playlistId: 'yt_ibiza_club_night', index: 5, artist: 'Kölsch', title: 'Grey' },
  { playlistId: 'yt_ibiza_club_night', index: 6, artist: 'Dixon', title: 'Transmoderna' },
  { playlistId: 'yt_ibiza_club_night', index: 7, artist: 'Sven Väth', title: 'Robot' },

  // ── Northern Lights ──────────────────────────────────
  {
    playlistId: 'yt_northern_lights_ambient',
    index: 0,
    artist: 'Ólafur Arnalds',
    title: 'Near Light'
  },
  { playlistId: 'yt_northern_lights_ambient', index: 1, artist: 'Nils Frahm', title: 'Says' },
  {
    playlistId: 'yt_northern_lights_ambient',
    index: 2,
    artist: 'Kiasmos',
    title: 'Looped'
  },
  {
    playlistId: 'yt_northern_lights_ambient',
    index: 3,
    artist: 'Recondite',
    title: 'Shun'
  },
  {
    playlistId: 'yt_northern_lights_ambient',
    index: 4,
    artist: 'Burial',
    title: 'Archangel'
  },
  {
    playlistId: 'yt_northern_lights_ambient',
    index: 5,
    artist: 'Jon Hopkins',
    title: 'Immunity'
  },
  {
    playlistId: 'yt_northern_lights_ambient',
    index: 6,
    artist: 'Max Cooper',
    title: 'Repetition'
  },
  {
    playlistId: 'yt_northern_lights_ambient',
    index: 7,
    artist: 'Rival Consoles',
    title: 'Articulation'
  },

  // ── Desert Caravan ───────────────────────────────────
  { playlistId: 'yt_desert_caravan', index: 0, artist: 'Bedouin', title: 'Hologram' },
  { playlistId: 'yt_desert_caravan', index: 1, artist: 'Talaboman', title: 'Sideral' },
  { playlistId: 'yt_desert_caravan', index: 2, artist: 'Acid Pauli', title: 'Nana' },
  { playlistId: 'yt_desert_caravan', index: 3, artist: 'Goldcap', title: 'Sun Comes Up' },
  { playlistId: 'yt_desert_caravan', index: 4, artist: 'Stavroz', title: 'The Finishing' },
  { playlistId: 'yt_desert_caravan', index: 5, artist: 'Valeron', title: 'Esperanza' },
  {
    playlistId: 'yt_desert_caravan',
    index: 6,
    artist: 'Sebastien Leger',
    title: 'Lanarka'
  },
  {
    playlistId: 'yt_desert_caravan',
    index: 7,
    artist: 'Blond:ish',
    title: 'Wizard of Love'
  }
];
