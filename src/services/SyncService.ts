import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { useStore } from './UIService.js';
import {
  SD_CARD_SYNC_PATH,
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
      addLog(
        'ERROR',
        `Sync aborted: Target directory does not exist at "${SD_CARD_SYNC_PATH}".`
      );
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
    addLog(
      'SYSTEM',
      `Sync started: "${resolvedSource}" -> "${resolvedDest}"`
    );

    if (MOCK_MODE) {
      addLog('SYSTEM', 'MOCK MODE: Simulating rsync file transfer...');
      // Sleep for a short duration to simulate sync
      await new Promise((resolve) => setTimeout(resolve, 1500));
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
    // --ignore-existing: merge mode, don't overwrite existing destination files
    // --exclude='skipped'
    // --exclude='.DS_Store'
    const rsync = spawn('rsync', [
      '-a',
      '--ignore-existing',
      '--exclude=skipped',
      '--exclude=.DS_Store',
      resolvedSource + '/',
      resolvedDest + '/'
    ]);

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
