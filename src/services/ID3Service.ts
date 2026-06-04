import * as mm from 'music-metadata';
import * as path from 'path';
import * as fs from 'fs';
import * as AubioService from './AubioService.js';
import { getCachedMetadata, setCachedMetadata } from './LocalDBService.js';

/**
 * ID3Service.ts
 *
 * Extracts audio metadata (artist and title) using music-metadata,
 * falling back to filename splitting.
 */

export async function extractMetadata(filepath: string): Promise<{
  artist: string;
  title: string;
  duration: number;
  bpm?: number;
  key?: string;
  genre?: string;
  comment?: string;
  label?: string;
  fromCache?: boolean;
}> {
  let artist: string | undefined;
  let title: string | undefined;
  let duration = 180; // Default mock fallback (3 minutes)
  let bpm: number | undefined;
  let key: string | undefined;
  let genre: string | undefined;
  let comment: string | undefined;
  let label: string | undefined;

  // Bypassed if the file does not physically exist to prevent console pollution
  const fileExists = fs.existsSync(filepath);
  let mtime = 0;
  let size = 0;

  if (fileExists) {
    try {
      const stats = fs.statSync(filepath);
      mtime = stats.mtimeMs;
      size = stats.size;
      const cached = getCachedMetadata(filepath, mtime, size);
      if (cached) {
        return { ...cached, fromCache: true };
      }
    } catch {
      // Ignore stat/cache errors, proceed to full extraction
    }
  }

  if (fileExists) {
    try {
      const metadata = await mm.parseFile(filepath);
      artist =
        metadata.common.artist ||
        metadata.common.albumartist ||
        (metadata.common.artists && metadata.common.artists.join(', ')) ||
        undefined;
      title = metadata.common.title;
      if (metadata.format.duration) {
        duration = Math.round(metadata.format.duration);
      }
      if (metadata.common.bpm) {
        bpm = Math.round(metadata.common.bpm);
      }
      if (metadata.common.key) {
        key = metadata.common.key;
      }
      if (metadata.common.genre && metadata.common.genre.length > 0) {
        genre = metadata.common.genre.join(', ');
      }
      if (metadata.common.comment && metadata.common.comment.length > 0) {
        const c = metadata.common.comment[0];
        comment = typeof c === 'string' ? c : (c as { text?: string })?.text;
      }
      if (metadata.common.label && metadata.common.label.length > 0) {
        label = metadata.common.label.join(', ');
      }
    } catch {
      // Silently fall back to filename parsing without corrupting TUI screen buffer
    }

    // Run offline analysis tools (aubio and keyfinder-cli) for missing fields
    if (!bpm) {
      const estimated = AubioService.estimateBpm(filepath);
      if (estimated) bpm = estimated;
    }
    if (!key) {
      const detected = AubioService.detectKey(filepath);
      if (detected) key = detected;
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

  // Clean up track number prefixes (e.g., "17. ", "01 - ", "01 ") from artist and title
  const cleanPrefix = (str: string): string => {
    return str.replace(/^\d+[\s.-]+/, '').trim();
  };

  const finalArtist = cleanPrefix(artist || 'Unknown');
  const finalTitle = cleanPrefix(title || 'Unknown');

  const result = {
    artist: finalArtist || 'Unknown',
    title: finalTitle || 'Unknown',
    duration,
    bpm,
    key,
    genre,
    comment,
    label
  };

  if (fileExists && mtime > 0 && size > 0) {
    setCachedMetadata(filepath, mtime, size, result);
  }

  return result;
}

/**
 * Safely writes estimated/detected BPM and musical key tags to MP3 and FLAC files using FFmpeg.
 * Writes to a temporary file in the same directory first, and overwrites the original file only on success.
 *
 * @param {string} filepath - Path to the audio file.
 * @param {object} tags - Metadata tags to be written.
 * @param {number} [tags.bpm] - Beats Per Minute value.
 * @param {string} [tags.key] - Musical Key in Camelot or original format.
 * @returns {Promise<boolean>} True if the write succeeded, false otherwise.
 */
export async function writeMetadata(
  filepath: string,
  tags: { bpm?: number; key?: string }
): Promise<boolean> {
  if (!tags.bpm && !tags.key) {
    return false;
  }

  const ext = path.extname(filepath).toLowerCase();
  if (ext !== '.mp3' && ext !== '.flac') {
    return false;
  }

  const absolutePath = path.resolve(filepath);
  if (!fs.existsSync(absolutePath)) {
    return false;
  }

  const dir = path.dirname(absolutePath);
  const base = path.basename(absolutePath, ext);
  const tempPath = path.join(dir, `.cratemind_temp_${Date.now()}_${base}${ext}`);

  try {
    let metadataArgs = '';
    const bpm = tags.bpm ? Math.round(tags.bpm) : undefined;

    if (ext === '.mp3') {
      if (bpm) {
        metadataArgs += ` -metadata TBPM="${bpm}"`;
      }
      if (tags.key) {
        metadataArgs += ` -metadata TKEY="${tags.key}"`;
      }
    } else if (ext === '.flac') {
      if (bpm) {
        metadataArgs += ` -metadata bpm="${bpm}"`;
      }
      if (tags.key) {
        metadataArgs += ` -metadata key="${tags.key}"`;
      }
    }

    if (!metadataArgs) {
      return false;
    }

    const cmd = `ffmpeg -y -i "${absolutePath}" ${metadataArgs} -codec copy "${tempPath}"`;
    const { execSync } = await import('child_process');
    execSync(cmd, { stdio: 'ignore' });

    if (fs.existsSync(tempPath) && fs.statSync(tempPath).size > 0) {
      fs.renameSync(tempPath, absolutePath);
      return true;
    }
  } catch {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch {
      // ignore
    }
  }

  return false;
}

export default extractMetadata;
