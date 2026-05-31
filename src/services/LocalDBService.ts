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
