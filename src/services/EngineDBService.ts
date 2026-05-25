import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EngineTrack } from '../types.js';
import { ENGINE_DB_PATH } from '../config.js';

/**
 * EngineDBService.ts
 *
 * READ-ONLY integration with Engine DJ's SQLite library (m.db).
 *
 * Denon DJ/Engine DJ Database Architecture:
 * - SQLite database engines.
 * - Main Database (m.db): Contains track metadata, playlists, history.
 * - Performance Database (p.db): Contains cues, beatgrids, loops, waveforms.
 *
 * SAFETY INSTRUCTION:
 * - This service MUST operate in STRICTLY READ-ONLY mode.
 * - Under no circumstances should any write/update/insert queries be run.
 * - Connecting is strictly enforced with `{ readonly: true }` flag.
 */

// Helper to resolve home directory tilde (~) in database path
function resolvePath(filePath: string): string {
  if (filePath.startsWith('~')) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return path.resolve(filePath);
}

/**
 * Checks if the Engine DJ database is available and can be successfully opened.
 * Returns false if the file does not exist or opening it fails.
 */
export function isAvailable(): boolean {
  const resolvedPath = resolvePath(ENGINE_DB_PATH);
  if (!fs.existsSync(resolvedPath)) {
    return false;
  }
  try {
    const db = new Database(resolvedPath, { readonly: true, timeout: 2000 });
    db.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * Helper to execute a read-only query safely and close the connection immediately.
 */
function runQuery<T>(queryFn: (db: Database.Database) => T): T | [] {
  const resolvedPath = resolvePath(ENGINE_DB_PATH);
  if (!fs.existsSync(resolvedPath)) {
    return [];
  }
  let db: Database.Database | undefined;
  try {
    db = new Database(resolvedPath, { readonly: true, timeout: 5000 });
    const result = queryFn(db);
    return result;
  } catch {
    return [];
  } finally {
    if (db) {
      db.close();
    }
  }
}

/**
 * Retrieves all tracks registered in the Engine DJ database.
 * Key Columns: id, path, filename, title, artist.
 */
export function getTracks(): EngineTrack[] {
  return runQuery((db) => {
    return db.prepare('SELECT id, path, filename, title, artist FROM Track').all() as EngineTrack[];
  }) as EngineTrack[];
}

/**
 * Retrieves only the tracks whose file path starts with the given sorted directory.
 * Used for RAG bootstrap scanning within a specific collection directory.
 *
 * Query: SELECT ... FROM Track WHERE path LIKE ? || '%'
 */
export function getTracksInPath(dirPath: string): EngineTrack[] {
  // Ensure the directory path has a trailing separator to prevent matching similar prefix folder names
  const normalizedDir = dirPath.endsWith(path.sep) ? dirPath : dirPath + path.sep;
  return runQuery((db) => {
    return db
      .prepare("SELECT id, path, filename, title, artist FROM Track WHERE path LIKE ? || '%'")
      .all(normalizedDir) as EngineTrack[];
  }) as EngineTrack[];
}
