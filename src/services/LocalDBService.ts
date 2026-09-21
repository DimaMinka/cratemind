import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { TrackIntelligenceRecord, AssignedVibe } from '../types.js';

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

    CREATE TABLE IF NOT EXISTS track_intelligence (
      artist TEXT NOT NULL,
      title TEXT NOT NULL,
      filepath TEXT,
      folder TEXT NOT NULL,
      bpm REAL,
      key TEXT,
      energy_feel TEXT,
      dj_role TEXT,
      assigned_vibes TEXT,
      sub_bass_db REAL,
      bass_db REAL,
      mid_db REAL,
      high_db REAL,
      onset_density REAL,
      peak_energy REAL,
      avg_energy REAL,
      energy_variance REAL,
      spec_centroid REAL,
      spec_flatness REAL,
      energy_shape TEXT,
      drum_shape TEXT,
      drop_ratio REAL,
      buildup_ratio REAL,
      breakdown_ratio REAL,
      clap_embedding BLOB,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (artist, title)
    );

    CREATE INDEX IF NOT EXISTS idx_intel_folder ON track_intelligence(folder);
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

/**
 * Reads global lifetime classification statistics from the rag_examples table.
 */
export function getGlobalStats(): { total: number; auto: number; manual: number } {
  const db = getDB();
  try {
    const row = db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN source = 'auto' THEN 1 ELSE 0 END) AS auto,
           SUM(CASE WHEN source = 'manual' THEN 1 ELSE 0 END) AS manual
         FROM rag_examples`
      )
      .get() as { total: number; auto: number | null; manual: number | null };
    return {
      total: row.total ?? 0,
      auto: row.auto ?? 0,
      manual: row.manual ?? 0
    };
  } catch {
    return { total: 0, auto: 0, manual: 0 };
  }
}

/**
 * Maps a SQLite row to TrackIntelligenceRecord.
 */
function mapIntelRow(row: Record<string, unknown>): TrackIntelligenceRecord {
  let assignedVibes: AssignedVibe[] = [];
  if (typeof row.assigned_vibes === 'string') {
    try {
      assignedVibes = JSON.parse(row.assigned_vibes);
    } catch {
      assignedVibes = [];
    }
  }

  let energyShape: number[] | null = null;
  if (typeof row.energy_shape === 'string') {
    try {
      energyShape = JSON.parse(row.energy_shape);
    } catch {
      energyShape = null;
    }
  }

  let drumShape: number[] | null = null;
  if (typeof row.drum_shape === 'string') {
    try {
      drumShape = JSON.parse(row.drum_shape);
    } catch {
      drumShape = null;
    }
  }

  return {
    artist: String(row.artist),
    title: String(row.title),
    filepath: typeof row.filepath === 'string' ? row.filepath : null,
    folder: String(row.folder),
    bpm: typeof row.bpm === 'number' ? row.bpm : null,
    key: typeof row.key === 'string' ? row.key : null,
    energyFeel: typeof row.energy_feel === 'string' ? row.energy_feel : null,
    djRole: typeof row.dj_role === 'string' ? row.dj_role : null,
    assignedVibes,
    subBassDb: typeof row.sub_bass_db === 'number' ? row.sub_bass_db : null,
    bassDb: typeof row.bass_db === 'number' ? row.bass_db : null,
    midDb: typeof row.mid_db === 'number' ? row.mid_db : null,
    highDb: typeof row.high_db === 'number' ? row.high_db : null,
    onsetDensity: typeof row.onset_density === 'number' ? row.onset_density : null,
    peakEnergy: typeof row.peak_energy === 'number' ? row.peak_energy : null,
    avgEnergy: typeof row.avg_energy === 'number' ? row.avg_energy : null,
    energyVariance: typeof row.energy_variance === 'number' ? row.energy_variance : null,
    specCentroid: typeof row.spec_centroid === 'number' ? row.spec_centroid : null,
    specFlatness: typeof row.spec_flatness === 'number' ? row.spec_flatness : null,
    energyShape,
    drumShape,
    dropRatio: typeof row.drop_ratio === 'number' ? row.drop_ratio : null,
    buildupRatio: typeof row.buildup_ratio === 'number' ? row.buildup_ratio : null,
    breakdownRatio: typeof row.breakdown_ratio === 'number' ? row.breakdown_ratio : null,
    clapEmbedding: Buffer.isBuffer(row.clap_embedding) ? row.clap_embedding : null,
    createdAt: typeof row.created_at === 'number' ? row.created_at : undefined
  };
}

/**
 * Inserts or updates an acoustic & semantic intelligence record in local SQLite cratemind.db.
 */
export function saveTrackIntelligence(intel: TrackIntelligenceRecord): void {
  const db = getDB();
  try {
    db.prepare(
      `
      INSERT OR REPLACE INTO track_intelligence (
        artist, title, filepath, folder, bpm, key, energy_feel, dj_role, assigned_vibes,
        sub_bass_db, bass_db, mid_db, high_db, onset_density, peak_energy, avg_energy,
        energy_variance, spec_centroid, spec_flatness, energy_shape, drum_shape,
        drop_ratio, buildup_ratio, breakdown_ratio, clap_embedding, created_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?
      )
    `
    ).run(
      intel.artist,
      intel.title,
      intel.filepath ?? null,
      intel.folder,
      intel.bpm ?? null,
      intel.key ?? null,
      intel.energyFeel ?? null,
      intel.djRole ?? null,
      JSON.stringify(intel.assignedVibes || []),
      intel.subBassDb ?? null,
      intel.bassDb ?? null,
      intel.midDb ?? null,
      intel.highDb ?? null,
      intel.onsetDensity ?? null,
      intel.peakEnergy ?? null,
      intel.avgEnergy ?? null,
      intel.energyVariance ?? null,
      intel.specCentroid ?? null,
      intel.specFlatness ?? null,
      intel.energyShape ? JSON.stringify(intel.energyShape) : null,
      intel.drumShape ? JSON.stringify(intel.drumShape) : null,
      intel.dropRatio ?? null,
      intel.buildupRatio ?? null,
      intel.breakdownRatio ?? null,
      intel.clapEmbedding ?? null,
      intel.createdAt ?? Date.now()
    );
  } catch {
    // Ignore intelligence save errors
  }
}

/**
 * Retrieves track intelligence record by artist and title.
 */
export function getTrackIntelligence(
  artist: string,
  title: string
): TrackIntelligenceRecord | null {
  const db = getDB();
  try {
    const row = db
      .prepare('SELECT * FROM track_intelligence WHERE LOWER(artist) = ? AND LOWER(title) = ?')
      .get(artist.toLowerCase().trim(), title.toLowerCase().trim()) as
      | Record<string, unknown>
      | undefined;

    return row ? mapIntelRow(row) : null;
  } catch {
    return null;
  }
}

/**
 * Retrieves all track intelligence records routed to a specific crate folder.
 */
export function getTracksByCrate(folder: string): TrackIntelligenceRecord[] {
  const db = getDB();
  try {
    const rows = db
      .prepare('SELECT * FROM track_intelligence WHERE LOWER(folder) = ? ORDER BY created_at DESC')
      .all(folder.toLowerCase().trim()) as Record<string, unknown>[];

    return rows.map(mapIntelRow);
  } catch {
    return [];
  }
}
