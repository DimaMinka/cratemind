import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { useStore } from '../UIService.js';

/**
 * Rewrites absolute file paths in target Engine DJ databases (m.db and hm.db)
 * from the source drive volume name to the target drive volume name.
 *
 * @param {string} destDbDir - Directory containing Database2 SQLite files.
 * @param {string} sourceVolume - Source drive volume root (e.g., '/Volumes/EngineDJ SD').
 * @param {string} destVolume - Destination drive volume root (e.g., '/Volumes/EngineDJ').
 * @returns {{ mCount: number; hmCount: number }} Number of records rewritten in m.db and hm.db.
 */
export function rewriteDatabasePaths(
  destDbDir: string,
  sourceVolume: string,
  destVolume: string
): { mCount: number; hmCount: number } {
  const addLog = useStore.getState().addLog;
  const result = { mCount: 0, hmCount: 0 };
  const sourcePrefix = sourceVolume.endsWith('/') ? sourceVolume : `${sourceVolume}/`;
  const destPrefix = destVolume.endsWith('/') ? destVolume : `${destVolume}/`;

  const mDbPath = path.join(destDbDir, 'm.db');
  if (fs.existsSync(mDbPath)) {
    try {
      const db = new Database(mDbPath);
      const updateStmt = db.prepare(
        "UPDATE Track SET path = REPLACE(path, ?, ?) WHERE path LIKE ? || '%'"
      );
      const info = updateStmt.run(sourcePrefix, destPrefix, sourcePrefix);
      result.mCount = info.changes;
      db.close();
      if (result.mCount > 0) {
        addLog('SYSTEM', `Rewrote ${result.mCount} track paths in target m.db to ${destPrefix}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog('ERROR', `Failed to rewrite paths in m.db: ${msg}`);
    }
  }

  const hmDbPath = path.join(destDbDir, 'hm.db');
  if (fs.existsSync(hmDbPath)) {
    try {
      const db = new Database(hmDbPath);
      const updateStmt = db.prepare(
        "UPDATE Track SET path = REPLACE(path, ?, ?) WHERE path LIKE ? || '%'"
      );
      const info = updateStmt.run(sourcePrefix, destPrefix, sourcePrefix);
      result.hmCount = info.changes;
      db.close();
      if (result.hmCount > 0) {
        addLog('SYSTEM', `Rewrote ${result.hmCount} track paths in target hm.db to ${destPrefix}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog('ERROR', `Failed to rewrite paths in hm.db: ${msg}`);
    }
  }

  return result;
}
