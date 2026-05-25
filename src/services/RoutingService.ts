import * as fs from 'fs';
import * as path from 'path';
import { SORTED_DIR, MOCK_MODE } from '../config.js';

/**
 * RoutingService.ts
 *
 * Handles physical file system operations like copying and unlinking files
 * when routing them to their respective crate folders.
 */

export async function routeFile(srcPath: string, selectedFolders: string[]): Promise<void> {
  // If in mock mode and the file doesn't physically exist, bypass routing gracefully
  if (MOCK_MODE && !fs.existsSync(srcPath)) {
    return;
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
