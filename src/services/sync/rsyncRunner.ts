import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { AUDIO_EXTENSIONS } from '../../config.js';
import { useStore } from '../UIService.js';

/**
 * Recursively scans a directory and counts the number of audio files matching the configured extensions.
 *
 * @param {string} dir - The directory to count files in.
 * @returns {number} The total count of audio files.
 */
export function countAudioFiles(dir: string): number {
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
      const lines = stdoutBuffer.split(/\r?\n|\r/);
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
export function runRsync(args: string[], onFileLine?: (line: string) => void): Promise<void> {
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
        trimmed.includes('speedup is') ||
        trimmed.includes('to-check=') ||
        trimmed.includes('xfer#') ||
        /\b\d+%\b/.test(trimmed) ||
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
      const lines = stdoutBuffer.split(/\r?\n|\r/);
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
        const remainingLines = stdoutBuffer.split(/\r?\n|\r/);
        for (const line of remainingLines) {
          processLine(line);
        }
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
