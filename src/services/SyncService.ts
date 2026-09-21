import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import Database from 'better-sqlite3';
import { useStore } from './UIService.js';
import {
  SD_CARD_SYNC_PATH,
  DRIVE_SYNC_SOURCE_PATH,
  DRIVE_SYNC_DEST_PATH,
  DRIVE_SYNC_ARCHIVE_DIR,
  AUDIO_EXTENSIONS,
  MOCK_MODE,
  SORTED_DIR
} from '../config.js';

let isSyncing = false;

/**
 * Recursively scans a directory and counts the number of audio files matching the configured extensions.
 *
 * @param {string} dir - The directory to count files in.
 * @returns {number} The total count of audio files.
 */
function countAudioFiles(dir: string): number {
  let count = 0;
  if (!fs.existsSync(dir)) {
    return 0;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countAudioFiles(fullPath);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if ((AUDIO_EXTENSIONS as readonly string[]).includes(ext)) {
        count++;
      }
    }
  }
  return count;
}

/**
 * Checks Sorted directory for folders with trailing spaces that duplicate other folders.
 * Warns the user about these duplicates to encourage clean directory structure.
 */
function checkDuplicateFolders(): void {
  const addLog = useStore.getState().addLog;
  if (!fs.existsSync(SORTED_DIR)) return;

  const entries = fs.readdirSync(SORTED_DIR, { withFileTypes: true });
  const folders = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  for (const folder of folders) {
    if (folder.endsWith(' ')) {
      const trimmed = folder.trim();
      if (folders.includes(trimmed)) {
        addLog(
          'SYSTEM',
          `WARNING: Duplicate folders detected: "${folder}" and "${trimmed}". Recommend merging/renaming them.`
        );
      }
    }
  }
}

/**
 * Syncs the local Sorted directory to the external collection path.
 */
export async function sync(): Promise<void> {
  const addLog = useStore.getState().addLog;

  if (isSyncing) {
    addLog('SYSTEM', 'Sync already in progress.');
    return;
  }

  isSyncing = true;

  try {
    // 1. Verify target directory existence
    if (!MOCK_MODE && !fs.existsSync(SD_CARD_SYNC_PATH)) {
      addLog('ERROR', `Sync aborted: Target directory does not exist at "${SD_CARD_SYNC_PATH}".`);
      isSyncing = false;
      return;
    }

    // 2. Warn about trailing space folders
    checkDuplicateFolders();

    const startTime = Date.now();
    const resolvedSource = path.resolve(SORTED_DIR);
    const resolvedDest = path.resolve(SD_CARD_SYNC_PATH);

    // 3. Count before sync
    const countBefore = MOCK_MODE ? 0 : countAudioFiles(resolvedDest);
    addLog('SYSTEM', `Sync started: "${resolvedSource}" -> "${resolvedDest}"`);

    if (MOCK_MODE) {
      addLog('SYSTEM', 'MOCK MODE: Simulating rsync file transfer...');
      // Read subdirectories to simulate folder progress
      if (fs.existsSync(resolvedSource)) {
        const entries = fs.readdirSync(resolvedSource, { withFileTypes: true });
        const folders = entries
          .filter((e) => e.isDirectory() && e.name !== 'skipped')
          .map((e) => e.name);
        for (const folder of folders) {
          addLog('SYSTEM', `Syncing folder: ${folder}...`);
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      } else {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      const mockCount = countAudioFiles(resolvedSource);
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      addLog(
        'SYSTEM',
        `Sync complete in ${duration}s — Before: 0 tracks | After: ${mockCount} tracks | New: ${mockCount} tracks added`
      );
      isSyncing = false;
      return;
    }

    // 4. Run real rsync in spawn
    // -a: archive mode
    // -v: verbose (lists files to stdout to track progress)
    // --ignore-existing: merge mode, don't overwrite existing destination files
    // --exclude='skipped'
    // --exclude='.DS_Store'
    const rsync = spawn('rsync', [
      '-av',
      '--ignore-existing',
      '--exclude=skipped',
      '--exclude=.DS_Store',
      resolvedSource + '/',
      resolvedDest + '/'
    ]);

    let lastLoggedFolder = '';
    rsync.stdout.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (
          !trimmed ||
          trimmed.startsWith('sending list') ||
          trimmed.startsWith('sent ') ||
          trimmed.startsWith('total size') ||
          trimmed.startsWith('building file list')
        ) {
          continue;
        }

        // Clean up rsync skip messages (e.g. "skip existing 'magic forest/track.mp3'")
        let cleanLine = trimmed;
        if (cleanLine.startsWith('skip existing ')) {
          cleanLine = cleanLine.substring('skip existing '.length);
        }
        // Remove surrounding quotes if present
        cleanLine = cleanLine.replace(/^['"]|['"]$/g, '');

        // Extract top-level folder name (e.g., "club party/track.mp3" -> "club party")
        const parts = cleanLine.split('/');
        if (parts.length > 0 && parts[0]) {
          const folder = parts[0];
          // Check if this is a directory we care about
          if (parts.length > 1 || cleanLine.endsWith('/')) {
            if (folder !== lastLoggedFolder && folder !== '.' && folder !== '..') {
              lastLoggedFolder = folder;
              addLog('SYSTEM', `Syncing folder: ${folder}...`);
            }
          }
        }
      }
    });

    rsync.stderr.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) {
        addLog('ERROR', `rsync: ${msg}`);
      }
    });

    await new Promise<void>((resolve, reject) => {
      rsync.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`rsync process exited with code ${code}`));
        }
      });
      rsync.on('error', (err) => {
        reject(err);
      });
    });

    // 5. Count after sync
    const countAfter = countAudioFiles(resolvedDest);
    const addedCount = countAfter - countBefore;
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    addLog(
      'SYSTEM',
      `Sync complete in ${duration}s — Before: ${countBefore} tracks | After: ${countAfter} tracks | New: ${addedCount} tracks added`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    addLog('ERROR', `Sync failed: ${msg}`);
  } finally {
    isSyncing = false;
  }
}

/**
 * Checks if both source and destination storage drive mount paths are accessible.
 *
 * @param {string} [sourcePath] - Optional override for source mount path.
 * @param {string} [destPath] - Optional override for destination mount path.
 * @returns {boolean} True if both drives exist on disk.
 */
export function areDrivesConnected(
  sourcePath: string = DRIVE_SYNC_SOURCE_PATH,
  destPath: string = DRIVE_SYNC_DEST_PATH
): boolean {
  if (MOCK_MODE) return true;
  return fs.existsSync(sourcePath) && fs.existsSync(destPath);
}

/**
 * Recursively scans destination directory and safely moves any audio files that no longer exist
 * in the source directory into an archive directory, preserving the folder structure.
 *
 * @param {string} sourceMusicDir - Source audio collection root.
 * @param {string} destMusicDir - Destination audio collection root.
 * @param {string} archiveDir - Target archive root directory.
 * @returns {number} Number of tracks safely moved into archive.
 */
export function archiveRemovedFiles(
  sourceMusicDir: string,
  destMusicDir: string,
  archiveDir: string
): number {
  const addLog = useStore.getState().addLog;
  if (!fs.existsSync(destMusicDir) || !fs.existsSync(sourceMusicDir)) {
    return 0;
  }

  let movedCount = 0;

  function scanAndArchive(currentRelative: string): void {
    const fullDest = path.join(destMusicDir, currentRelative);
    if (!fs.existsSync(fullDest)) return;

    const entries = fs.readdirSync(fullDest, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = path.join(currentRelative, entry.name);
      const destEntryPath = path.join(destMusicDir, relPath);
      const sourceEntryPath = path.join(sourceMusicDir, relPath);

      if (entry.isDirectory()) {
        scanAndArchive(relPath);
        // Clean up empty directory in destination
        try {
          if (fs.readdirSync(destEntryPath).length === 0) {
            fs.rmdirSync(destEntryPath);
          }
        } catch {
          // Ignore directory removal issues
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if ((AUDIO_EXTENSIONS as readonly string[]).includes(ext)) {
          // If file no longer exists in source, move it to archive
          if (!fs.existsSync(sourceEntryPath)) {
            const targetArchivePath = path.join(archiveDir, relPath);
            fs.mkdirSync(path.dirname(targetArchivePath), { recursive: true });
            fs.renameSync(destEntryPath, targetArchivePath);
            movedCount++;
            addLog('SYSTEM', `Archived deleted track: ${relPath}`);
          }
        }
      }
    }
  }

  scanAndArchive('');
  return movedCount;
}

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

/**
 * Spawns an rsync process with real-time TUI progress logging.
 *
 * @param {string[]} args - Arguments to pass to rsync command.
 * @returns {Promise<void>} Resolves when rsync finishes successfully.
 */
function runRsync(args: string[]): Promise<void> {
  const addLog = useStore.getState().addLog;

  return new Promise<void>((resolve, reject) => {
    const rsync = spawn('rsync', args);
    let lastLoggedItem = '';

    rsync.stdout.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (
          !trimmed ||
          trimmed.startsWith('sending list') ||
          trimmed.startsWith('sent ') ||
          trimmed.startsWith('total size') ||
          trimmed.startsWith('building file list')
        ) {
          continue;
        }

        let cleanLine = trimmed;
        if (cleanLine.startsWith('skip existing ')) {
          cleanLine = cleanLine.substring('skip existing '.length);
        } else if (cleanLine.startsWith('deleting ')) {
          cleanLine = cleanLine.substring('deleting '.length);
        }
        cleanLine = cleanLine.replace(/^['"]|['"]$/g, '');

        const parts = cleanLine.split('/');
        if (parts.length > 0 && parts[0]) {
          const topFolder = parts[0];
          if (topFolder !== lastLoggedItem && topFolder !== '.' && topFolder !== '..') {
            lastLoggedItem = topFolder;
            addLog('SYSTEM', `Syncing: ${topFolder}...`);
          }
        }
      }
    });

    rsync.stderr.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) {
        addLog('ERROR', `rsync: ${msg}`);
      }
    });

    rsync.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`rsync exited with code ${code}`));
      }
    });

    rsync.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Executes a full mirror synchronization from the Master SD card to the Target backup drive.
 *
 * Workflow:
 * 1. Verifies drive connectivity.
 * 2. Safely moves tracks missing on SD from target to 'Removed from SD/' archive.
 * 3. Rsyncs Music Collection (--ignore-existing).
 * 4. Rsyncs Engine Library (--delete, excluding journals).
 * 5. Rewrites target SQLite database paths (m.db, hm.db) to target volume name.
 * 6. Logs complete duration, track delta, and archive statistics.
 *
 * @param {string} [customSource] - Optional source path override.
 * @param {string} [customDest] - Optional destination path override.
 */
export async function syncDrives(customSource?: string, customDest?: string): Promise<void> {
  const addLog = useStore.getState().addLog;

  if (isSyncing) {
    addLog('SYSTEM', 'Sync already in progress.');
    return;
  }

  isSyncing = true;

  try {
    const sourceRoot = path.resolve(customSource ?? DRIVE_SYNC_SOURCE_PATH);
    const destRoot = path.resolve(customDest ?? DRIVE_SYNC_DEST_PATH);

    if (!MOCK_MODE && (!fs.existsSync(sourceRoot) || !fs.existsSync(destRoot))) {
      addLog(
        'ERROR',
        `Drive sync aborted: Ensure both "${sourceRoot}" and "${destRoot}" are connected.`
      );
      isSyncing = false;
      return;
    }

    const startTime = Date.now();
    addLog('SYSTEM', `Drive mirror started: "${sourceRoot}" -> "${destRoot}"`);

    const sourceMusic = path.join(sourceRoot, 'Music Collection');
    const destMusic = path.join(destRoot, 'Music Collection');
    const archiveDir = path.join(destRoot, DRIVE_SYNC_ARCHIVE_DIR);

    const sourceEngine = path.join(sourceRoot, 'Engine Library');
    const destEngine = path.join(destRoot, 'Engine Library');

    const countBefore = MOCK_MODE ? 0 : countAudioFiles(destMusic);

    // Step 1: Safely archive files removed from SD
    let archivedCount = 0;
    if (fs.existsSync(sourceMusic) && fs.existsSync(destMusic)) {
      addLog('SYSTEM', 'Checking for obsolete tracks on target drive...');
      archivedCount = archiveRemovedFiles(sourceMusic, destMusic, archiveDir);
      if (archivedCount > 0) {
        addLog(
          'SYSTEM',
          `Safely moved ${archivedCount} obsolete tracks to "${DRIVE_SYNC_ARCHIVE_DIR}".`
        );
      }
    }

    if (MOCK_MODE) {
      addLog('SYSTEM', 'MOCK MODE: Simulating drive mirror transfer...');
      await new Promise((res) => setTimeout(res, 600));
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      addLog(
        'SYSTEM',
        `Drive mirror complete in ${duration}s — Before: 0 | After: 0 | Archived: ${archivedCount}`
      );
      isSyncing = false;
      return;
    }

    // Step 2: Rsync Music Collection
    if (fs.existsSync(sourceMusic)) {
      fs.mkdirSync(destMusic, { recursive: true });
      addLog('SYSTEM', 'Mirroring Music Collection...');
      await runRsync([
        '-av',
        '--ignore-existing',
        '--exclude=skipped',
        '--exclude=.DS_Store',
        '--exclude=.Spotlight*',
        '--exclude=.Trashes',
        '--exclude=.fseventsd',
        '--exclude=.TemporaryItems',
        '--exclude=.DocumentRevisions*',
        sourceMusic + '/',
        destMusic + '/'
      ]);
    }

    // Step 3: Rsync Engine Library
    if (fs.existsSync(sourceEngine)) {
      fs.mkdirSync(destEngine, { recursive: true });
      addLog('SYSTEM', 'Mirroring Engine Library metadata and databases...');
      await runRsync([
        '-av',
        '--delete',
        '--exclude=*-journal',
        '--exclude=*.lock',
        '--exclude=.DS_Store',
        '--exclude=.Spotlight*',
        '--exclude=.Trashes',
        '--exclude=.fseventsd',
        sourceEngine + '/',
        destEngine + '/'
      ]);

      // Step 4: Rewrite SQLite database paths
      const destDbDir = path.join(destEngine, 'Database2');
      rewriteDatabasePaths(destDbDir, sourceRoot, destRoot);
    }

    // Step 5: Count tracks and output summary
    const countAfter = countAudioFiles(destMusic);
    const addedCount = countAfter - (countBefore - archivedCount);
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    addLog(
      'SYSTEM',
      `Drive mirror complete in ${duration}s — Before: ${countBefore} | After: ${countAfter} | New: ${addedCount} | Archived: ${archivedCount}`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    addLog('ERROR', `Drive sync failed: ${msg}`);
  } finally {
    isSyncing = false;
  }
}
