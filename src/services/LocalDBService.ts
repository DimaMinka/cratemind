import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

/**
 * LocalDBService.ts
 *
 * READ-WRITE connection to CrateMind's local SQLite database (cratemind.db).
 * Stores RAG few-shot examples, LLM offline cache, daily request stats,
 * and persistent YouTube playlist scout cache.
 *
 * Engine DJ database remains STRICTLY READ-ONLY in EngineDBService.ts.
 */

let _db: Database.Database | null = null;
const LOCAL_DB_PATH = path.resolve('cratemind.db');

/**
 * Returns the write-enabled local SQLite database connection.
 * Automatically initializes tables on first request.
 */
export function getDB(): Database.Database {
  if (_db) return _db;

  _db = new Database(LOCAL_DB_PATH, { timeout: 5000 });

  // Enable WAL mode for high concurrency TUI updates
  _db.pragma('journal_mode = WAL');

  // Cleanup obsolete JSON files on startup if they exist
  const obsoleteFiles = [
    path.resolve('cratemind-memory.json'),
    path.resolve('.cratemind-cache.json'),
    path.resolve('.cratemind-stats.json')
  ];
  for (const file of obsoleteFiles) {
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    } catch {
      /* ignore */
    }
  }

  // Initialize DB tables
  _db.exec(`
    CREATE TABLE IF NOT EXISTS rag_examples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artist TEXT NOT NULL,
      title TEXT NOT NULL,
      folders TEXT NOT NULL, -- JSON string array
      overridden_folders TEXT, -- JSON string array
      reasoning TEXT NOT NULL,
      source TEXT NOT NULL,
      ts INTEGER NOT NULL,
      UNIQUE(artist, title) ON CONFLICT REPLACE
    );

    CREATE TABLE IF NOT EXISTS llm_cache (
      context_hash TEXT PRIMARY KEY,
      artist TEXT NOT NULL,
      title TEXT NOT NULL,
      folders TEXT NOT NULL, -- JSON string array
      reasoning TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1.0,
      ts INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_stats (
      date TEXT PRIMARY KEY,
      count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS yt_playlists (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      channel_name TEXT,
      cached_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS yt_playlist_items (
      playlist_id TEXT NOT NULL,
      track_index INTEGER NOT NULL,
      artist TEXT NOT NULL,
      title TEXT NOT NULL,
      PRIMARY KEY (playlist_id, track_index),
      FOREIGN KEY (playlist_id) REFERENCES yt_playlists(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS spotify_cache (
      artist TEXT NOT NULL,
      title TEXT NOT NULL,
      danceability REAL,
      energy REAL,
      acousticness REAL,
      instrumentalness REAL,
      valence REAL,
      tempo REAL,
      spotify_genres TEXT, -- JSON string array
      cached_at INTEGER NOT NULL,
      PRIMARY KEY (artist, title)
    );

    CREATE TABLE IF NOT EXISTS track_vectors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artist TEXT NOT NULL,
      title TEXT NOT NULL,
      folder TEXT NOT NULL,
      passport TEXT NOT NULL,          -- full passport text used to generate this embedding
      embedding BLOB NOT NULL,         -- Float32Array serialized as raw bytes (768 * 4 bytes)
      passport_version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      UNIQUE(artist, title) ON CONFLICT REPLACE
    );

    CREATE TABLE IF NOT EXISTS file_metadata_cache (
      filepath TEXT PRIMARY KEY,
      mtime INTEGER NOT NULL,
      size INTEGER NOT NULL,
      artist TEXT NOT NULL,
      title TEXT NOT NULL,
      duration INTEGER NOT NULL,
      bpm INTEGER,
      key TEXT,
      genre TEXT,
      comment TEXT,
      label TEXT
    );
  `);

  // Clean exit handling
  process.once('exit', () => {
    try {
      _db?.close();
    } catch {
      /* ignore close errors on exit */
    }
  });

  return _db;
}

export interface CachedMetadata {
  artist: string;
  title: string;
  duration: number;
  bpm?: number;
  key?: string;
  genre?: string;
  comment?: string;
  label?: string;
}

/**
 * Retrieves cached audio metadata if modification time and size match.
 */
export function getCachedMetadata(
  filepath: string,
  mtime: number,
  size: number
): CachedMetadata | null {
  const db = getDB();
  try {
    const targetFilename = path.basename(filepath).toLowerCase();
    const rows = db
      .prepare(
        'SELECT filepath, mtime, artist, title, duration, bpm, key, genre, comment, label FROM file_metadata_cache WHERE size = ?'
      )
      .all(size) as {
      filepath: string;
      mtime: number;
      artist: string;
      title: string;
      duration: number;
      bpm: number | null;
      key: string | null;
      genre: string | null;
      comment: string | null;
      label: string | null;
    }[];

    const filenameMatches = rows.filter(
      (r) => path.basename(r.filepath).toLowerCase() === targetFilename
    );
    if (filenameMatches.length === 0) return null;

    // Best match has matching mtime, otherwise fall back to first size/filename match
    const exactMatch = filenameMatches.find((r) => r.mtime === mtime);
    const match = exactMatch || filenameMatches[0];

    return {
      artist: match.artist,
      title: match.title,
      duration: match.duration,
      bpm: match.bpm !== null ? match.bpm : undefined,
      key: match.key !== null ? match.key : undefined,
      genre: match.genre !== null ? match.genre : undefined,
      comment: match.comment !== null ? match.comment : undefined,
      label: match.label !== null ? match.label : undefined
    };
  } catch {
    return null;
  }
}

/**
 * Stores audio metadata in the local cache.
 */
export function setCachedMetadata(
  filepath: string,
  mtime: number,
  size: number,
  meta: CachedMetadata
): void {
  const db = getDB();
  try {
    db.prepare(
      `
      INSERT OR REPLACE INTO file_metadata_cache (filepath, mtime, size, artist, title, duration, bpm, key, genre, comment, label)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      filepath,
      mtime,
      size,
      meta.artist,
      meta.title,
      meta.duration,
      meta.bpm ?? null,
      meta.key ?? null,
      meta.genre ?? null,
      meta.comment ?? null,
      meta.label ?? null
    );
  } catch {
    // Ignore cache write errors
  }
}

/**
 * Retrieves a string value from the settings table.
 */
export function getSetting(key: string): string | null {
  const db = getDB();
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row ? row.value : null;
  } catch {
    return null;
  }
}

/**
 * Inserts or replaces a key-value setting.
 */
export function setSetting(key: string, value: string): void {
  const db = getDB();
  try {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  } catch {
    // Ignore setting write errors
  }
}
