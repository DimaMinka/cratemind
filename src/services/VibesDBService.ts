import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { VIBES_DB_PATH } from '../config.js';
import { VibesTrackData, AssignedVibe, VibesSoundProfile, VibesIntelligence } from '../types.js';
import { logToFile } from './LoggerService.js';

/**
 * VibesDBService.ts
 *
 * STRICTLY READ-ONLY connection to Vibes.app SQLite database (vibes.sqlite).
 * Extracts acoustic features, 57 curated vibes, structural energy/drum shapes,
 * and phase cues for zero-latency batch classification.
 *
 * Mirrored after EngineDBService with safe read-only guarantees.
 */

let _db: Database.Database | null = null;
let _hasLoggedMissing = false;

function resolveDbPath(): string {
  const p = VIBES_DB_PATH;
  if (p.startsWith('~')) {
    return path.resolve(p.replace(/^~(?=$|\/|\\)/, process.env.HOME || ''));
  }
  return path.resolve(p);
}

/**
 * Returns true if the Vibes database exists on disk and is readable.
 */
export function isAvailable(): boolean {
  try {
    const resolved = resolveDbPath();
    return fs.existsSync(resolved);
  } catch {
    return false;
  }
}

/**
 * Returns the read-only SQLite database connection for Vibes.app.
 */
export function getDB(): Database.Database | null {
  if (_db) return _db;

  const resolved = resolveDbPath();
  if (!fs.existsSync(resolved)) {
    if (!_hasLoggedMissing) {
      logToFile('VIBES', `Vibes DB not found at: ${resolved}`);
      _hasLoggedMissing = true;
    }
    return null;
  }

  try {
    _db = new Database(resolved, { readonly: true, fileMustExist: true });
    logToFile('VIBES', `Connected (READ-ONLY) to Vibes DB: ${resolved}`);
    return _db;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logToFile('VIBES_ERROR', `Failed to open Vibes DB: ${msg}`);
    return null;
  }
}

/**
 * Closes the active database connection if open.
 */
export function close(): void {
  if (_db) {
    try {
      _db.close();
    } catch {
      /* ignore */
    }
    _db = null;
  }
}

/**
 * Maps raw SQLite row to VibesTrackData.
 */
function mapTrackRow(row: Record<string, unknown>): VibesTrackData {
  let vibeFeatures: VibesTrackData['vibeFeatures'] = null;
  if (typeof row.vibe_features === 'string') {
    try {
      vibeFeatures = JSON.parse(row.vibe_features);
    } catch {
      vibeFeatures = null;
    }
  }

  return {
    id: Number(row.id),
    filename: String(row.filename || ''),
    filepath: String(row.filepath || ''),
    title: row.title ? String(row.title) : null,
    artist: row.artist ? String(row.artist) : null,
    bpm: typeof row.bpm === 'number' ? row.bpm : null,
    key: row.key ? String(row.key) : null,
    duration: typeof row.duration === 'number' ? row.duration : null,
    energy: typeof row.energy === 'number' ? row.energy : null,
    loudness: typeof row.loudness === 'number' ? row.loudness : null,
    spectralCentroid: typeof row.spectral_centroid === 'number' ? row.spectral_centroid : null,
    danceability: typeof row.danceability === 'number' ? row.danceability : null,
    clapEmbedding: Buffer.isBuffer(row.clap_embedding) ? row.clap_embedding : null,
    vibeFeatures
  };
}

/**
 * Maps raw JSON profile string to VibesSoundProfile.
 */
function parseSoundProfileJson(trackId: number, jsonStr: string): VibesSoundProfile | null {
  try {
    const raw = JSON.parse(jsonStr);
    return {
      trackId,
      avgEnergy: Number(raw.avg_energy ?? 0),
      peakEnergy: Number(raw.peak_energy ?? 0),
      energyVariance: Number(raw.energy_variance ?? 0),
      energySlope: typeof raw.energy_slope === 'number' ? raw.energy_slope : undefined,
      dropRatio: typeof raw.drop_ratio === 'number' ? raw.drop_ratio : undefined,
      buildupRatio: typeof raw.buildup_ratio === 'number' ? raw.buildup_ratio : undefined,
      breakdownRatio: typeof raw.breakdown_ratio === 'number' ? raw.breakdown_ratio : undefined,
      energyShape: Array.isArray(raw.energy_shape) ? raw.energy_shape.map(Number) : [],
      drumShape: Array.isArray(raw.drum_shape) ? raw.drum_shape.map(Number) : []
    };
  } catch {
    return null;
  }
}

/**
 * Retrieves track metadata from Vibes DB by absolute path or filename.
 */
export function getTrackByPath(filePath: string): VibesTrackData | null {
  const db = getDB();
  if (!db) return null;

  try {
    const fullPath = path.resolve(filePath);
    const basename = path.basename(filePath);
    const row = db
      .prepare(
        `SELECT id, filename, filepath, title, artist, bpm, key, duration, energy, loudness, spectral_centroid, danceability, clap_embedding, vibe_features
         FROM tracks WHERE filepath = ? OR filename = ? LIMIT 1`
      )
      .get(fullPath, basename) as Record<string, unknown> | undefined;

    return row ? mapTrackRow(row) : null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logToFile('VIBES_ERROR', `getTrackByPath error for ${filePath}: ${msg}`);
    return null;
  }
}

/**
 * Retrieves assigned vibes for a track ID.
 */
export function getVibesForTrack(trackId: number): AssignedVibe[] {
  const db = getDB();
  if (!db) return [];

  try {
    const rows = db
      .prepare(
        `SELECT v.name as name, vc.name as category
         FROM track_vibes tv
         JOIN vibes v ON tv.vibe_id = v.id
         JOIN vibe_categories vc ON v.category_id = vc.id
         WHERE tv.track_id = ?
         ORDER BY vc.sort_order ASC, v.sort_order ASC`
      )
      .all(trackId) as { name: string; category: string }[];

    return rows;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logToFile('VIBES_ERROR', `getVibesForTrack error for ${trackId}: ${msg}`);
    return [];
  }
}

/**
 * Retrieves structural sound profile for a track ID.
 */
export function getSoundProfileForTrack(trackId: number): VibesSoundProfile | null {
  const db = getDB();
  if (!db) return null;

  try {
    const row = db
      .prepare('SELECT profile_json FROM track_sound_profiles WHERE track_id = ? LIMIT 1')
      .get(trackId) as { profile_json: string } | undefined;

    return row?.profile_json ? parseSoundProfileJson(trackId, row.profile_json) : null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logToFile('VIBES_ERROR', `getSoundProfileForTrack error for ${trackId}: ${msg}`);
    return null;
  }
}

/**
 * Preloads all analyzed tracks in incomingDir in 3 fast batch queries.
 * Returns a map keyed by both absolute file path and filename for O(1) lookup.
 */
export function getAllAnalyzedIncomingTracks(incomingDir: string): Map<string, VibesIntelligence> {
  const result = new Map<string, VibesIntelligence>();
  const db = getDB();
  if (!db) return result;

  try {
    const fullDir = path.resolve(incomingDir);

    // Batch Query 1: All tracks matching incoming directory path
    const trackRows = db
      .prepare(
        `SELECT id, filename, filepath, title, artist, bpm, key, duration, energy, loudness, spectral_centroid, danceability, clap_embedding, vibe_features
         FROM tracks WHERE filepath LIKE ? || '%'`
      )
      .all(fullDir) as Record<string, unknown>[];

    if (trackRows.length === 0) return result;

    const trackDataList = trackRows.map(mapTrackRow);
    const trackIds = trackDataList.map((t) => t.id);

    // Batch Query 2: All vibes for these tracks
    const placeholders = trackIds.map(() => '?').join(',');
    const vibeRows = db
      .prepare(
        `SELECT tv.track_id, v.name as name, vc.name as category
         FROM track_vibes tv
         JOIN vibes v ON tv.vibe_id = v.id
         JOIN vibe_categories vc ON v.category_id = vc.id
         WHERE tv.track_id IN (${placeholders})
         ORDER BY vc.sort_order ASC, v.sort_order ASC`
      )
      .all(...trackIds) as { track_id: number; name: string; category: string }[];

    const vibesByTrack = new Map<number, AssignedVibe[]>();
    for (const row of vibeRows) {
      if (!vibesByTrack.has(row.track_id)) {
        vibesByTrack.set(row.track_id, []);
      }
      vibesByTrack.get(row.track_id)!.push({ name: row.name, category: row.category });
    }

    // Batch Query 3: All sound profiles for these tracks
    const profileRows = db
      .prepare(
        `SELECT track_id, profile_json FROM track_sound_profiles WHERE track_id IN (${placeholders})`
      )
      .all(...trackIds) as { track_id: number; profile_json: string }[];

    const profilesByTrack = new Map<number, VibesSoundProfile>();
    for (const row of profileRows) {
      const parsed = parseSoundProfileJson(row.track_id, row.profile_json);
      if (parsed) {
        profilesByTrack.set(row.track_id, parsed);
      }
    }

    // Assemble final Map
    for (const track of trackDataList) {
      const intelligence: VibesIntelligence = {
        track,
        assignedVibes: vibesByTrack.get(track.id) || [],
        soundProfile: profilesByTrack.get(track.id) || null
      };

      if (track.filepath) {
        result.set(path.resolve(track.filepath), intelligence);
      }
      if (track.filename) {
        result.set(track.filename, intelligence);
      }
    }

    logToFile(
      'VIBES',
      `Preloaded ${trackDataList.length} tracks with acoustic intelligence from Vibes DB.`
    );
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logToFile('VIBES_ERROR', `getAllAnalyzedIncomingTracks error: ${msg}`);
    return result;
  }
}
