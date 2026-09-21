import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
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
import { countAudioFiles, discoverFilesToTransfer, runRsync } from './sync/rsyncRunner.js';
import { restoreRelocatedFromArchive, archiveRemovedFiles } from './sync/archiveManager.js';
import { rewriteDatabasePaths } from './sync/dbRewriter.js';

// Re-export submodules for seamless 100% backward compatibility
export { countAudioFiles, discoverFilesToTransfer, runRsync } from './sync/rsyncRunner.js';
export {
  buildAudioFileIndex,
  restoreRelocatedFromArchive,
  archiveRemovedFiles
} from './sync/archiveManager.js';
export { rewriteDatabasePaths } from './sync/dbRewriter.js';

let isSyncing = false;

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
    await runRsync([
      '-av',
      '--progress',
      '--ignore-existing',
      '--exclude=skipped',
      '--exclude=.DS_Store',
      resolvedSource + '/',
      resolvedDest + '/'
    ]);

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
 * Executes a full mirror synchronization from the Master SD card to the Target backup drive.
 *
 * Workflow:
 * 1. [1/4] Safely moves tracks missing on SD from target to 'Removed from SD/' archive,
 *          recovering any mislocated active tracks and relocating moved crates locally.
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

        const tempTransferList = path.join(
          os.tmpdir(),
          `cratemind-transfer-${Date.now()}-${process.pid}.txt`
        );
        fs.writeFileSync(tempTransferList, filesToTransfer.join('\n'));

        try {
          await runRsync(
            [
              '-av',
              '--progress',
              `--files-from=${tempTransferList}`,
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
        } finally {
          try {
            if (fs.existsSync(tempTransferList)) {
              fs.unlinkSync(tempTransferList);
            }
          } catch {
            // Ignore temp file cleanup error
          }
        }
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
