import * as mm from 'music-metadata';
import * as path from 'path';
import * as fs from 'fs';
import { MOCK_MODE } from '../config.js';

/**
 * ID3Service.ts
 *
 * Extracts audio metadata (artist and title) using music-metadata,
 * falling back to filename splitting.
 */

export async function extractMetadata(
  filepath: string
): Promise<{ artist: string; title: string }> {
  let artist: string | undefined;
  let title: string | undefined;

  // Bypassed if the file does not physically exist to prevent console pollution
  const fileExists = fs.existsSync(filepath);

  if (fileExists) {
    try {
      const metadata = await mm.parseFile(filepath);
      artist = metadata.common.artist;
      title = metadata.common.title;
    } catch {
      // Silently fall back to filename parsing without corrupting TUI screen buffer
    }
  }

  // Fallback to filename parsing if artist or title are missing
  if (!artist || !title) {
    let filename = path.basename(filepath, path.extname(filepath));

    // Normalize common patterns
    filename = filename.replace(/_-_/g, ' - ');

    // Try different separators in order of specificity
    const separators = [' - ', '-', '_'];
    let parts: string[] = [filename];
    let usedSeparator = '';

    for (const sep of separators) {
      const split = filename.split(sep);
      if (split.length >= 2) {
        parts = split;
        usedSeparator = sep;
        break;
      }
    }

    if (parts.length >= 2) {
      if (!artist) artist = parts[0]?.replace(/_/g, ' ').trim();

      const joinedTitle = parts.slice(1).join(usedSeparator === '_' ? ' ' : usedSeparator);
      if (!title) title = joinedTitle.replace(/_/g, ' ').trim();
    } else {
      // If we can't split by any known separator, use the whole filename as the title
      if (!title) title = filename.replace(/_/g, ' ').trim();
    }
  }

  return {
    artist: artist || 'Unknown',
    title: title || 'Unknown'
  };
}
export default extractMetadata;
