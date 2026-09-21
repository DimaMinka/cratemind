import dotenv from 'dotenv';

// Ensure environment variables are loaded immediately on static import analysis
dotenv.config();

export const AUTO_MULTI = false;
export const MOCK_MODE = process.env.MOCK_MODE === 'true';
export const FORCE_MANUAL_MODE = process.env.FORCE_MANUAL_MODE === 'true';

export const FOLDERS = [
  'mountain sunset',
  'magic forest',
  'nargila vibe',
  'club party',
  'new day vibe',
  'tropical vibe',
  'beach party',
  'earth',
  'iceland',
  'desert vibe',
  'spain vibe',
  'india jungle',
  'galaxy trip',
  'psy',
  'epic',
  'mantra',
  "drum 'n' bass",
  'retro',
  'robotic',
  'rock',
  'intro outro'
] as const;

export const INCOMING_DIR = './Incoming';
export const SORTED_DIR = './Sorted';
export const LOG_MAX = 200;
export const LLM_MODEL = 'gemini-3.5-flash-lite';
export const CONFIDENCE_THRESHOLD = 0.99;

// Caching and API limit configurations
export const DAILY_REQUEST_LIMIT = 50;
export const BATCH_SIZE = 5;
export const CACHE_FILE_PATH = './.cratemind-cache.json';
export const STATS_FILE_PATH = './.cratemind-stats.json';

// RAG configuration constants
export const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.wav', '.aiff', '.m4a', '.ogg'] as const;
export const RAG_MEMORY_FILE = './cratemind-memory.json';
export const RAG_EXAMPLES_PER_FOLDER = 5;
export const RAG_SCAN_ON_BOOT = true;
export const ENGINE_DB_PATH = process.env.ENGINE_DB_PATH ?? '~/Music/Engine Library/Database2/m.db';
export const VIBES_DB_PATH =
  process.env.VIBES_DB_PATH ??
  `${process.env.HOME}/Library/Application Support/com.benmdg.vibes/vibes.sqlite`;

export const SD_CARD_SYNC_PATH =
  process.env.SD_CARD_SYNC_PATH ?? '/Volumes/EngineDJ SD/Music Collection/Atmosphere';
export const DRIVE_SYNC_SOURCE_PATH = process.env.DRIVE_SYNC_SOURCE_PATH ?? '/Volumes/EngineDJ SD';
export const DRIVE_SYNC_DEST_PATH = process.env.DRIVE_SYNC_DEST_PATH ?? '/Volumes/EngineDJ';
export const DRIVE_SYNC_ARCHIVE_DIR = process.env.DRIVE_SYNC_ARCHIVE_DIR ?? 'Removed from SD';
export const MAX_TRACK_DURATION_MINUTES = parseInt(
  process.env.MAX_TRACK_DURATION_MINUTES || '20',
  10
);
export const MAX_TRACK_DURATION_SEC = MAX_TRACK_DURATION_MINUTES * 60;

// Telegram file size filtering (in megabytes)
export const MIN_SIZE_LOSSLESS_MB = 10;
export const MIN_SIZE_LOSSY_MB = 3;

// YouTube Network Scout configuration
export const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';
export const YT_SCOUT_ENABLED = !!YOUTUBE_API_KEY.trim();
export const YT_SCOUT_NETWORK_DELAY_MS = 2000;
export const YT_SCOUT_MAX_PLAYLISTS = 3;
export const YT_SCOUT_NEIGHBOR_RADIUS = 10;

// SPOTIFY DISABLED: Spotify Web API is closed / inaccessible for personal developer keys (403 errors).
// Superseded by Vibes.app acoustic intelligence and YouTube Network Scout.
export const SPOTIFY_ENABLED = false;
