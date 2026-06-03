import * as fs from 'fs';
import * as path from 'path';
import { SORTED_DIR, MOCK_MODE } from '../config.js';
import { writeMetadata } from './ID3Service.js';

/**
 * RoutingService.ts
 *
 * Handles physical file system operations like copying and unlinking files
 * when routing them to their respective crate folders.
 */

/**
 * Routes a track file from Incoming to one or more sorted vibe folders.
 * Safely writes estimated/detected BPM and Key to the track's metadata before copying.
 *
 * @param {string} srcPath - Path to the original audio file.
 * @param {string[]} selectedFolders - Target vibe folder names.
 * @param {object} [metadata] - Optional BPM and Key tags to inject.
 * @param {number} [metadata.bpm] - Beats Per Minute.
 * @param {string} [metadata.key] - Musical Key.
 */
export async function routeFile(
  srcPath: string,
  selectedFolders: string[],
  metadata?: { bpm?: number; key?: string }
): Promise<void> {
  // If in mock mode and the file doesn't physically exist, bypass routing gracefully
  if (MOCK_MODE && !fs.existsSync(srcPath)) {
    return;
  }

  // Inject metadata (BPM & Key) into the source file before copying it
  if (metadata && !MOCK_MODE) {
    try {
      await writeMetadata(srcPath, metadata);
    } catch {
      // Ignore tag writing failures to guarantee routing success
    }
  }

  const filename = path.basename(srcPath);

  // Copy file to all target subfolders
  for (const folder of selectedFolders) {
    const targetDir = path.join(SORTED_DIR, folder);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const targetPath = path.join(targetDir, filename);
    fs.copyFileSync(srcPath, targetPath);
  }

  // Delete the original file from Incoming to avoid double-processing
  if (fs.existsSync(srcPath)) {
    fs.unlinkSync(srcPath);
  }
}
