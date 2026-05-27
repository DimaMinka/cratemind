import Database from 'better-sqlite3';
import * as path from 'path';

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
      ts INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_stats (
      date TEXT PRIMARY KEY,
      count INTEGER DEFAULT 0
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
