import * as fs from 'fs';
import * as path from 'path';
import { AUDIO_EXTENSIONS } from '../../config.js';
import { useStore } from '../UIService.js';

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
          // Ignore directory removal issues
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
