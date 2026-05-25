export const AUTO_MULTI = false;

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
export const LLM_MODEL = 'gemini-2.5-flash';
export const CONFIDENCE_THRESHOLD = 0.7;

// RAG configuration constants
export const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.wav', '.aiff', '.m4a', '.ogg'] as const;
export const RAG_MEMORY_FILE = './cratemind-memory.json';
export const RAG_EXAMPLES_PER_FOLDER = 2;
export const RAG_MAX_STORED = 500;
export const RAG_SCAN_ON_BOOT = true;
export const ENGINE_DB_PATH = process.env.ENGINE_DB_PATH ?? '~/Music/Engine Library/Database2/m.db';
