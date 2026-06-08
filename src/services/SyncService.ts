import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { useStore } from './UIService.js';
import { SD_CARD_SYNC_PATH, AUDIO_EXTENSIONS, MOCK_MODE, SORTED_DIR } from '../config.js';

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

        // Extract top-level folder name (e.g., "club party/track.mp3" -> "club party")
        const parts = trimmed.split('/');
        if (parts.length > 0 && parts[0]) {
          const folder = parts[0];
          // Check if this is a directory we care about
          if (parts.length > 1 || trimmed.endsWith('/')) {
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
