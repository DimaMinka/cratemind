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
    let stdoutBuffer = '';
    rsync.stdout.on('data', (data: Buffer) => {
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (
          !trimmed ||
          trimmed.startsWith('Transfer starting:') ||
          trimmed.startsWith('sending incremental file list') ||
          trimmed.startsWith('sending list') ||
          trimmed.startsWith('sent ') ||
          trimmed.startsWith('total size') ||
          trimmed.startsWith('building file list') ||
          /^skip existing/i.test(trimmed)
        ) {
          continue;
        }

        const cleanLine = trimmed.replace(/^['"]|['"]$/g, '');

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
 * Recursively scans a directory and builds a Map indexing audio filenames to their relative path.
 *
 * @param {string} rootDir - Root directory to index.
 * @returns {Map<string, string>} Mapping of lowercased filename to relative path.
 */
export function buildAudioFileIndex(rootDir: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!fs.existsSync(rootDir)) return map;

  function walk(currentDir: string, currentRel: string): void {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const relPath = path.join(currentRel, entry.name);
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, relPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if ((AUDIO_EXTENSIONS as readonly string[]).includes(ext)) {
          map.set(entry.name.toLowerCase(), relPath);
        }
      }
    }
  }

  walk(rootDir, '');
  return map;
}

/**
 * Inspects the archive directory and restores any tracks that still exist anywhere
 * on the source SD card back into their matching destination location.
 *
 * @param {string} archiveDir - Archive directory (e.g., '/Volumes/EngineDJ/Removed from SD').
 * @param {string} sourceMusicDir - Master SD audio directory (e.g., '/Volumes/EngineDJ SD/Music Collection').
 * @param {string} destMusicDir - Destination audio directory (e.g., '/Volumes/EngineDJ/Music Collection').
 * @returns {number} Number of tracks restored from archive.
 */
export function restoreRelocatedFromArchive(
  archiveDir: string,
  sourceMusicDir: string,
  destMusicDir: string
): number {
  const addLog = useStore.getState().addLog;
  if (!fs.existsSync(archiveDir) || !fs.existsSync(sourceMusicDir)) {
    return 0;
  }

  const sourceIndex = buildAudioFileIndex(sourceMusicDir);
  let restoredCount = 0;

  function walkArchive(currentDir: string, currentRel: string): void {
    if (!fs.existsSync(currentDir)) return;
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const relPath = path.join(currentRel, entry.name);
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        walkArchive(fullPath, relPath);
        try {
          if (fs.readdirSync(fullPath).length === 0) {
            fs.rmdirSync(fullPath);
          }
        } catch {
          // ignore directory removal issues
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if ((AUDIO_EXTENSIONS as readonly string[]).includes(ext)) {
          const sdRelPath = sourceIndex.get(entry.name.toLowerCase());
          if (sdRelPath) {
            // Track exists on SD! Restore it to destMusicDir at its current SD location
            const targetPath = path.join(destMusicDir, sdRelPath);
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
            fs.renameSync(fullPath, targetPath);
            restoredCount++;
            addLog(
              'SYSTEM',
              `Restored mislocated track from archive: "${entry.name}" -> "${sdRelPath}"`
            );
          }
        }
      }
    }
  }

  walkArchive(archiveDir, '');
  return restoredCount;
}

/**
 * Recursively scans destination directory and:
 * 1. If an audio file exists at the exact same path on source SD: leaves it untouched.
 * 2. If it was moved/relocated on SD (filename found elsewhere on SD): moves it locally on the destination disk to the new relative path.
 * 3. If it does not exist anywhere on SD: moves it to the archive directory preserving the relative path.
 *
 * @param {string} sourceMusicDir - Source audio collection root.
 * @param {string} destMusicDir - Destination audio collection root.
 * @param {string} archiveDir - Target archive root directory.
 * @returns {{ archivedCount: number; relocatedCount: number }} Summary of archived and relocated tracks.
 */
export function archiveRemovedFiles(
  sourceMusicDir: string,
  destMusicDir: string,
  archiveDir: string
): { archivedCount: number; relocatedCount: number } {
  const addLog = useStore.getState().addLog;
  if (!fs.existsSync(destMusicDir) || !fs.existsSync(sourceMusicDir)) {
    return { archivedCount: 0, relocatedCount: 0 };
  }

  const sourceIndex = buildAudioFileIndex(sourceMusicDir);
  let archivedCount = 0;
  let relocatedCount = 0;

  function scanDirectory(currentRelative: string): void {
    const fullDest = path.join(destMusicDir, currentRelative);
    if (!fs.existsSync(fullDest)) return;

    const entries = fs.readdirSync(fullDest, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const relPath = path.join(currentRelative, entry.name);
      const destEntryPath = path.join(destMusicDir, relPath);
      const exactSourcePath = path.join(sourceMusicDir, relPath);

      if (entry.isDirectory()) {
        scanDirectory(relPath);
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
          // Check if file exists at exact same relative path on SD
          if (fs.existsSync(exactSourcePath)) {
            continue; // Perfect match, leave alone
          }

          // Check if file exists anywhere on SD under a different path
          const newSdRelPath = sourceIndex.get(entry.name.toLowerCase());
          if (newSdRelPath) {
            // Relocate locally on destination disk
            const targetDestPath = path.join(destMusicDir, newSdRelPath);
            fs.mkdirSync(path.dirname(targetDestPath), { recursive: true });
            if (!fs.existsSync(targetDestPath)) {
              fs.renameSync(destEntryPath, targetDestPath);
              relocatedCount++;
              addLog('SYSTEM', `Relocated moved track: "${relPath}" -> "${newSdRelPath}"`);
            } else {
              // Target already exists, clean up old redundant copy
              fs.unlinkSync(destEntryPath);
            }
          } else {
            // File does NOT exist anywhere on SD — genuinely deleted!
            const targetArchivePath = path.join(archiveDir, relPath);
            fs.mkdirSync(path.dirname(targetArchivePath), { recursive: true });
            fs.renameSync(destEntryPath, targetArchivePath);
            archivedCount++;
            addLog('SYSTEM', `Archived deleted track: "${relPath}"`);
          }
        }
      }
    }
  }

  scanDirectory('');
  return { archivedCount, relocatedCount };
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
 * Performs a dry-run rsync scan to determine exactly which audio tracks need to be copied.
 *
 * @param {string} sourceDir - Source directory path.
 * @param {string} destDir - Destination directory path.
 * @returns {Promise<string[]>} Array of relative paths for audio files to be transferred.
 */
export async function discoverFilesToTransfer(
  sourceDir: string,
  destDir: string
): Promise<string[]> {
  if (!fs.existsSync(sourceDir)) {
    return [];
  }

  return new Promise<string[]>((resolve, reject) => {
    const args = [
      '-avn',
      '--ignore-existing',
      '--exclude=skipped',
      '--exclude=.DS_Store',
      '--exclude=.Spotlight*',
      '--exclude=.Trashes',
      '--exclude=.fseventsd',
      '--exclude=.TemporaryItems',
      '--exclude=.DocumentRevisions*',
      sourceDir.endsWith('/') ? sourceDir : `${sourceDir}/`,
      destDir.endsWith('/') ? destDir : `${destDir}/`
    ];

    const rsync = spawn('rsync', args);
    const files: string[] = [];
    let stdoutBuffer = '';

    rsync.stdout.on('data', (data: Buffer) => {
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (
          !line ||
          line.startsWith('Transfer starting:') ||
          line.startsWith('sending incremental file list') ||
          line.startsWith('sending list') ||
          line.startsWith('sent ') ||
          line.startsWith('total size') ||
          line.startsWith('building file list') ||
          line.endsWith('/') ||
          /^skip existing/i.test(line)
        ) {
          continue;
        }

        const clean = line.replace(/^['"]|['"]$/g, '');
        const ext = path.extname(clean).toLowerCase();
        if ((AUDIO_EXTENSIONS as readonly string[]).includes(ext)) {
          files.push(clean);
        }
      }
    });

    rsync.on('close', (code) => {
      if (stdoutBuffer.trim()) {
        const line = stdoutBuffer.trim();
        if (!line.endsWith('/') && !/^skip existing/i.test(line)) {
          const clean = line.replace(/^['"]|['"]$/g, '');
          const ext = path.extname(clean).toLowerCase();
          if ((AUDIO_EXTENSIONS as readonly string[]).includes(ext)) {
            files.push(clean);
          }
        }
      }
      if (code === 0) {
        resolve(files);
      } else {
        reject(new Error(`rsync dry-run discovery failed with code ${code}`));
      }
    });

    rsync.on('error', (err) => reject(err));
  });
}

/**
 * Spawns an rsync process with line-buffered stdout streaming and real-time item callbacks.
 *
 * @param {string[]} args - Arguments to pass to rsync command.
 * @param {(line: string) => void} [onFileLine] - Optional callback for each file transferred.
 * @returns {Promise<void>} Resolves when rsync finishes successfully.
 */
function runRsync(args: string[], onFileLine?: (line: string) => void): Promise<void> {
  const addLog = useStore.getState().addLog;

  return new Promise<void>((resolve, reject) => {
    const rsync = spawn('rsync', args);
    let stdoutBuffer = '';
    let lastLoggedFolder = '';

    const processLine = (rawLine: string) => {
      const trimmed = rawLine.trim();
      if (
        !trimmed ||
        trimmed.startsWith('Transfer starting:') ||
        trimmed.startsWith('sending incremental file list') ||
        trimmed.startsWith('sending list') ||
        trimmed.startsWith('sent ') ||
        trimmed.startsWith('total size') ||
        trimmed.startsWith('building file list') ||
        trimmed.endsWith('/')
      ) {
        return;
      }

      // Ignore skipped existing files and deleted files from progress callback
      if (/^skip existing/i.test(trimmed) || /^deleting/i.test(trimmed)) {
        return;
      }

      const cleanLine = trimmed.replace(/^['"]|['"]$/g, '');

      if (onFileLine) {
        onFileLine(cleanLine);
      } else {
        // Fallback: log top-level directory updates
        const parts = cleanLine.split('/');
        if (parts.length > 0 && parts[0]) {
          const topFolder = parts[0];
          if (topFolder !== lastLoggedFolder && topFolder !== '.' && topFolder !== '..') {
            lastLoggedFolder = topFolder;
            addLog('SYSTEM', `Syncing: ${topFolder}...`);
          }
        }
      }
    };

    rsync.stdout.on('data', (data: Buffer) => {
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        processLine(line);
      }
    });

    rsync.stderr.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) {
        addLog('ERROR', `rsync: ${msg}`);
      }
    });

    rsync.on('close', (code) => {
      if (stdoutBuffer.trim()) {
        processLine(stdoutBuffer);
      }
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
 * 1. [1/4] Safely moves tracks missing on SD from target to 'Removed from SD/' archive.
 * 2. [2/4] Discovers exact list of audio tracks to transfer using dry-run rsync.
 * 3. [3/4] Rsyncs Music Collection with real-time per-file telemetry and percentage progress.
 * 4. [4/4] Rsyncs Engine Library (--delete) and rewrites target SQLite database paths.
 * 5. Logs complete duration, track delta, and archive statistics.
 *
 * @param {string} [customSource] - Optional source path override.
 * @param {string} [customDest] - Optional destination path override.
 */
export async function syncDrives(customSource?: string, customDest?: string): Promise<void> {
  const addLog = useStore.getState().addLog;
  const setDriveSyncProgress = useStore.getState().setDriveSyncProgress;

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

    // Initial Progress
    setDriveSyncProgress({
      isActive: true,
      stage: 'archiving',
      stageLabel: '[1/4] Archiving obsolete files...',
      currentFileIndex: 0,
      totalFiles: 0,
      percent: 0,
      archivedCount: 0
    });

    // Step 1: Recover any mislocated tracks from archive, relocate moved tracks, and archive deleted tracks
    let archivedCount = 0;
    let relocatedCount = 0;
    if (fs.existsSync(sourceMusic) && fs.existsSync(destMusic)) {
      addLog('SYSTEM', '[1/4] Checking for obsolete and relocated tracks on target drive...');

      // First recover any previously mis-archived tracks that still exist on SD
      if (fs.existsSync(archiveDir)) {
        const restored = restoreRelocatedFromArchive(archiveDir, sourceMusic, destMusic);
        if (restored > 0) {
          addLog(
            'SYSTEM',
            `[1/4] Restored ${restored} active tracks from "${DRIVE_SYNC_ARCHIVE_DIR}" to Music Collection.`
          );
        }
      }

      // Then relocate moved tracks and archive genuinely deleted tracks
      const result = archiveRemovedFiles(sourceMusic, destMusic, archiveDir);
      archivedCount = result.archivedCount;
      relocatedCount = result.relocatedCount;

      if (relocatedCount > 0) {
        addLog('SYSTEM', `[1/4] Relocated ${relocatedCount} moved tracks locally on target drive.`);
      }
      if (archivedCount > 0) {
        addLog(
          'SYSTEM',
          `[1/4] Safely moved ${archivedCount} obsolete tracks to "${DRIVE_SYNC_ARCHIVE_DIR}".`
        );
      } else {
        addLog('SYSTEM', '[1/4] No obsolete tracks to archive.');
      }
    }

    if (MOCK_MODE) {
      addLog('SYSTEM', 'MOCK MODE: Simulating drive mirror transfer...');
      // Stage 1: Archiving
      setDriveSyncProgress({
        isActive: true,
        stage: 'archiving',
        stageLabel: '[1/4] Archiving obsolete files...',
        currentFileIndex: 0,
        totalFiles: 0,
        percent: 0,
        archivedCount: 2
      });
      addLog('SYSTEM', '[1/4] Checking for obsolete tracks on target drive...');
      await new Promise((res) => setTimeout(res, 800));
      addLog('SYSTEM', '[1/4] Safely moved 2 obsolete tracks to "Removed from SD".');

      // Stage 2: Analyzing (Dry-run)
      setDriveSyncProgress({
        isActive: true,
        stage: 'analyzing',
        stageLabel: '[2/4] Analyzing files to transfer...',
        currentFileIndex: 0,
        totalFiles: 0,
        percent: 0,
        archivedCount: 2
      });
      addLog('SYSTEM', '[2/4] Analyzing files to transfer...');
      await new Promise((res) => setTimeout(res, 1000));
      addLog('SYSTEM', '[2/4] Identified 6 tracks to copy.');

      // Stage 3: Copying Music Collection
      const mockFiles = [
        'Solomun - Customer Is King.mp3',
        'Tale Of Us - Astral.flac',
        'ARTBAT - Upperground.wav',
        'Bicep - Glue.mp3',
        'Boris Brejcha - Gravity.mp3',
        'Stephan Bodzin - Singularity.flac'
      ];
      const totalMock = mockFiles.length;

      for (let i = 0; i < totalMock; i++) {
        const fileIdx = i + 1;
        const pct = Math.round((fileIdx / totalMock) * 100);
        const fileName = mockFiles[i]!;
        setDriveSyncProgress({
          isActive: true,
          stage: 'copying-music',
          stageLabel: '[3/4] Mirroring Music Collection...',
          currentFile: fileName,
          currentFileIndex: fileIdx,
          totalFiles: totalMock,
          percent: pct,
          archivedCount: 2
        });
        addLog('SYSTEM', `[${fileIdx}/${totalMock}] (${pct}%) Copying: ${fileName}`);
        await new Promise((res) => setTimeout(res, 700));
      }

      // Stage 4: Copying Engine Library & Rewriting DB
      setDriveSyncProgress({
        isActive: true,
        stage: 'copying-library',
        stageLabel: '[4/4] Mirroring Engine Library metadata...',
        currentFile: 'Engine Library/Database2/m.db',
        currentFileIndex: totalMock,
        totalFiles: totalMock,
        percent: 92,
        archivedCount: 2
      });
      addLog('SYSTEM', '[4/4] Mirroring Engine Library metadata and databases...');
      await new Promise((res) => setTimeout(res, 800));

      setDriveSyncProgress({
        isActive: true,
        stage: 'rewriting-db',
        stageLabel: '[4/4] Rewriting database paths in m.db and hm.db...',
        currentFile: 'Database2/m.db',
        currentFileIndex: totalMock,
        totalFiles: totalMock,
        percent: 98,
        archivedCount: 2
      });
      addLog('SYSTEM', 'Rewrote 6 track paths in target m.db to /Volumes/EngineDJ/');
      await new Promise((res) => setTimeout(res, 800));

      // Done
      setDriveSyncProgress({
        isActive: true,
        stage: 'done',
        stageLabel: 'Drive mirror complete!',
        currentFile: '',
        currentFileIndex: totalMock,
        totalFiles: totalMock,
        percent: 100,
        archivedCount: 2
      });
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      addLog(
        'SYSTEM',
        `Drive mirror complete in ${duration}s — Before: 42 | After: 48 | New: 6 | Archived: 2`
      );
      setTimeout(() => {
        useStore.getState().setDriveSyncProgress(null);
      }, 4000);
      isSyncing = false;
      return;
    }

    // Step 2: Dry-run discovery of audio tracks
    setDriveSyncProgress({
      isActive: true,
      stage: 'analyzing',
      stageLabel: '[2/4] Analyzing files to transfer...',
      currentFileIndex: 0,
      totalFiles: 0,
      percent: 0,
      archivedCount
    });
    addLog('SYSTEM', '[2/4] Analyzing files to transfer...');

    fs.mkdirSync(destMusic, { recursive: true });
    const filesToTransfer = await discoverFilesToTransfer(sourceMusic, destMusic);
    const totalFiles = filesToTransfer.length;
    addLog('SYSTEM', `[2/4] Identified ${totalFiles} tracks to copy.`);

    // Step 3: Rsync Music Collection with live telemetry
    if (fs.existsSync(sourceMusic)) {
      if (totalFiles === 0) {
        addLog('SYSTEM', '[3/4] Music Collection is up to date (0 tracks to transfer).');
      } else {
        addLog('SYSTEM', `[3/4] Transferring ${totalFiles} tracks to Music Collection...`);
        let copiedCount = 0;

        setDriveSyncProgress({
          isActive: true,
          stage: 'copying-music',
          stageLabel: '[3/4] Mirroring Music Collection...',
          currentFile: '',
          currentFileIndex: 0,
          totalFiles,
          percent: 0,
          archivedCount
        });

        await runRsync(
          [
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
          ],
          (cleanLine) => {
            if (cleanLine.endsWith('/')) return;
            const ext = path.extname(cleanLine).toLowerCase();
            if ((AUDIO_EXTENSIONS as readonly string[]).includes(ext)) {
              copiedCount++;
              const pct = Math.min(100, Math.round((copiedCount / totalFiles) * 100));
              const fileName = path.basename(cleanLine);
              setDriveSyncProgress({
                isActive: true,
                stage: 'copying-music',
                stageLabel: '[3/4] Mirroring Music Collection...',
                currentFile: fileName,
                currentFileIndex: copiedCount,
                totalFiles,
                percent: pct,
                archivedCount
              });
              addLog('SYSTEM', `[${copiedCount}/${totalFiles}] (${pct}%) Copying: ${fileName}`);
            }
          }
        );
      }
    }

    // Step 4: Rsync Engine Library and rewrite database paths
    if (fs.existsSync(sourceEngine)) {
      fs.mkdirSync(destEngine, { recursive: true });
      setDriveSyncProgress({
        isActive: true,
        stage: 'copying-library',
        stageLabel: '[4/4] Mirroring Engine Library metadata...',
        currentFile: 'Engine Library',
        currentFileIndex: totalFiles,
        totalFiles,
        percent: 95,
        archivedCount
      });
      addLog('SYSTEM', '[4/4] Mirroring Engine Library metadata and databases...');

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

      // Step 4b: Rewrite SQLite database paths
      setDriveSyncProgress({
        isActive: true,
        stage: 'rewriting-db',
        stageLabel: '[4/4] Rewriting database paths in m.db and hm.db...',
        currentFile: 'Database2/m.db',
        currentFileIndex: totalFiles,
        totalFiles,
        percent: 98,
        archivedCount
      });
      const destDbDir = path.join(destEngine, 'Database2');
      rewriteDatabasePaths(destDbDir, sourceRoot, destRoot);
    }

    // Step 5: Count tracks and output summary
    const countAfter = countAudioFiles(destMusic);
    const addedCount = countAfter - (countBefore - archivedCount);
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    setDriveSyncProgress({
      isActive: true,
      stage: 'done',
      stageLabel: 'Drive mirror complete!',
      currentFile: '',
      currentFileIndex: totalFiles,
      totalFiles,
      percent: 100,
      archivedCount
    });

    addLog(
      'SYSTEM',
      `Drive mirror complete in ${duration}s — Before: ${countBefore} | After: ${countAfter} | New: ${addedCount} | Archived: ${archivedCount}`
    );

    setTimeout(() => {
      useStore.getState().setDriveSyncProgress(null);
    }, 4000);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    addLog('ERROR', `Drive sync failed: ${msg}`);
    useStore.getState().setDriveSyncProgress(null);
  } finally {
    isSyncing = false;
  }
}
