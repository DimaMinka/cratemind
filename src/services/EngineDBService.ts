import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EngineTrack } from '../types.js';
import { ENGINE_DB_PATH, MOCK_MODE } from '../config.js';
import { MOCK_ENGINE_TRACKS } from '../mocks/mockData.js';

interface DBTrackRow {
  id: number;
  path: string;
  filename: string;
  title: string | null;
  artist: string | null;
  bpm: number | null;
  keyVal: number | null;
  genre: string | null;
  comment: string | null;
  label: string | null;
}

/**
 * EngineDBService.ts
 *
 * READ-ONLY integration with Engine DJ's SQLite library (m.db).
 *
 * Key optimization (v4.6):
 * - Lazy singleton connection: the database is opened once and reused across all queries.
 *   Eliminates per-query open/close overhead and keeps connection warm for future extensions.
 * - Connection is closed cleanly on process exit.
 */

// Helper to resolve home directory tilde (~) in database path
function resolvePath(filePath: string): string {
  if (filePath.startsWith('~')) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return path.resolve(filePath);
}

// ── Lazy Singleton Connection ───────────────────────────────────────────────

let _db: Database.Database | null = null;
let _cachedTracks: EngineTrack[] | null = null;
let _cachedPlaylistVibes: { trackId: number; vibe: string }[] | null = null;

/**
 * Returns the lazy singleton read-only Database connection.
 * Returns null if the database file does not exist or cannot be opened.
 */
function getDB(): Database.Database | null {
  if (_db) return _db;

  const resolvedPath = resolvePath(ENGINE_DB_PATH);
  if (!fs.existsSync(resolvedPath)) {
    return null;
  }

  try {
    _db = new Database(resolvedPath, { readonly: true, timeout: 5000 });

    // Register cleanup on process exit to ensure WAL/journal files are flushed
    process.once('exit', () => {
      try {
        _db?.close();
      } catch {
        // Ignore close errors on exit
      }
    });

    return _db;
  } catch {
    return null;
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Checks if the Engine DJ database is available and can be successfully opened.
 * Returns false if the file does not exist or opening it fails.
 */
export function isAvailable(): boolean {
  if (MOCK_MODE) {
    return true; // Mock mode overrides file check
  }

  const resolvedPath = resolvePath(ENGINE_DB_PATH);
  if (!fs.existsSync(resolvedPath)) {
    return false;
  }

  // Attempt to acquire the singleton — success means the DB is accessible
  return getDB() !== null;
}

function convertKeyToCamelot(keyVal: number | null | undefined): string | undefined {
  if (keyVal === null || keyVal === undefined || keyVal < 0 || keyVal > 23) return undefined;
  const num = (Math.floor(keyVal / 2) + 8) % 12 || 12;
  const letter = keyVal % 2 === 0 ? 'B' : 'A';
  return `${num.toString().padStart(2, '0')}${letter}`;
}

/**
 * Retrieves all tracks registered in the Engine DJ database.
 * Key Columns: id, path, filename, title, artist, bpm, key, genre, comment, label.
 */
export function getTracks(): EngineTrack[] {
  if (MOCK_MODE) {
    return MOCK_ENGINE_TRACKS;
  }

  if (_cachedTracks) {
    return _cachedTracks;
  }

  const db = getDB();
  if (!db) return [];

  try {
    const rows = db
      .prepare(
        'SELECT id, path, filename, title, artist, bpmAnalyzed AS bpm, key AS keyVal, genre, comment, label FROM Track'
      )
      .all() as DBTrackRow[];

    _cachedTracks = rows.map((t) => ({
      id: t.id,
      path: t.path,
      filename: t.filename,
      title: t.title || t.filename || 'Unknown Title',
      artist: t.artist || 'Unknown Artist',
      bpm: t.bpm ? Math.round(t.bpm) : undefined,
      key: convertKeyToCamelot(t.keyVal),
      genre: t.genre || undefined,
      comment: t.comment || undefined,
      label: t.label || undefined
    }));
    return _cachedTracks;
  } catch {
    return [];
  }
}

/**
 * Retrieves only the tracks whose file path starts with the given sorted directory.
 * Used for RAG bootstrap scanning within a specific collection directory.
 */
export function getTracksInPath(dirPath: string): EngineTrack[] {
  if (MOCK_MODE) {
    return MOCK_ENGINE_TRACKS.map((t) => ({
      ...t,
      path: path.join(dirPath, t.path)
    }));
  }

  const db = getDB();
  if (!db) return [];

  try {
    const normalizedDir = dirPath.endsWith(path.sep) ? dirPath : dirPath + path.sep;
    const rows = db
      .prepare(
        "SELECT id, path, filename, title, artist, bpmAnalyzed AS bpm, key AS keyVal, genre, comment, label FROM Track WHERE path LIKE ? || '%'"
      )
      .all(normalizedDir) as DBTrackRow[];

    return rows.map((t) => ({
      id: t.id,
      path: t.path,
      filename: t.filename,
      title: t.title || t.filename || 'Unknown Title',
      artist: t.artist || 'Unknown Artist',
      bpm: t.bpm ? Math.round(t.bpm) : undefined,
      key: convertKeyToCamelot(t.keyVal),
      genre: t.genre || undefined,
      comment: t.comment || undefined,
      label: t.label || undefined
    }));
  } catch {
    return [];
  }
}

/**
 * Retrieves a single track by its artist and title using a fast SQLite index lookup.
 */
export function getTrackByMeta(artist: string, title: string): EngineTrack | null {
  if (MOCK_MODE) {
    return (
      MOCK_ENGINE_TRACKS.find(
        (t) =>
          t.artist.toLowerCase() === artist.toLowerCase() &&
          t.title.toLowerCase() === title.toLowerCase()
      ) || null
    );
  }

  const db = getDB();
  if (!db) return null;

  try {
    const row = db
      .prepare(
        'SELECT id, path, filename, title, artist, bpmAnalyzed AS bpm, key AS keyVal, genre, comment, label FROM Track WHERE LOWER(artist) = ? AND LOWER(title) = ? LIMIT 1'
      )
      .get(artist.toLowerCase().trim(), title.toLowerCase().trim()) as DBTrackRow | undefined;

    if (!row) return null;

    return {
      id: row.id,
      path: row.path,
      filename: row.filename,
      title: row.title || row.filename || 'Unknown Title',
      artist: row.artist || 'Unknown Artist',
      bpm: row.bpm ? Math.round(row.bpm) : undefined,
      key: convertKeyToCamelot(row.keyVal),
      genre: row.genre || undefined,
      comment: row.comment || undefined,
      label: row.label || undefined
    };
  } catch {
    return null;
  }
}

/**
 * Retrieves track ID mappings to playlist titles for playlist-based RAG bootstrapping.
 */
export function getTrackPlaylistVibes(): { trackId: number; vibe: string }[] {
  if (MOCK_MODE) {
    return [];
  }

  if (_cachedPlaylistVibes) {
    return _cachedPlaylistVibes;
  }

  const db = getDB();
  if (!db) return [];

  try {
    const rows = db
      .prepare(
        `
      SELECT pe.trackId, p.title AS vibe
      FROM PlaylistEntity pe
      JOIN Playlist p ON pe.listId = p.id
    `
      )
      .all() as { trackId: number; vibe: string }[];
    _cachedPlaylistVibes = rows;
    return _cachedPlaylistVibes;
  } catch {
    return [];
  }
}

/**
 * Retrieves playlist titles for a specific track ID.
 */
export function getTrackPlaylists(trackId: number): string[] {
  if (MOCK_MODE) {
    return [];
  }
  const vibes = getTrackPlaylistVibes();
  return vibes.filter((v) => v.trackId === trackId).map((v) => v.vibe);
}

/**
 * Retrieves a single track by its filename using a fast SQLite index lookup.
 */
export function getTrackByFilename(filename: string): EngineTrack | null {
  if (MOCK_MODE) {
    return (
      MOCK_ENGINE_TRACKS.find((t) => t.filename.toLowerCase() === filename.toLowerCase()) || null
    );
  }

  const db = getDB();
  if (!db) return null;

  try {
    const row = db
      .prepare(
        'SELECT id, path, filename, title, artist, bpmAnalyzed AS bpm, key AS keyVal, genre, comment, label FROM Track WHERE LOWER(filename) = ? LIMIT 1'
      )
      .get(filename.toLowerCase().trim()) as DBTrackRow | undefined;

    if (!row) return null;

    return {
      id: row.id,
      path: row.path,
      filename: row.filename,
      title: row.title || row.filename || 'Unknown Title',
      artist: row.artist || 'Unknown Artist',
      bpm: row.bpm ? Math.round(row.bpm) : undefined,
      key: convertKeyToCamelot(row.keyVal),
      genre: row.genre || undefined,
      comment: row.comment || undefined,
      label: row.label || undefined
    };
  } catch {
    return null;
  }
}
