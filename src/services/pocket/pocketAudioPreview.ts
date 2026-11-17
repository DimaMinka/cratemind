import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const DEFAULT_PREVIEW_CACHE_DIR = path.resolve('.pocket-cache/previews');

export interface PreviewResult {
  filePath: string;
  mimeType: string;
  isCached: boolean;
}

export interface StreamAudioOptions {
  cacheDir?: string;
  bitrate?: string; // default '256k'
}

/**
 * Returns the appropriate MIME type for an audio file by extension.
 */
export function getAudioMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.m4a':
    case '.mp4':
    case '.aac':
      return 'audio/mp4';
    case '.mp3':
      return 'audio/mpeg';
    case '.wav':
      return 'audio/wav';
    case '.flac':
      return 'audio/flac';
    case '.ogg':
    case '.oga':
      return 'audio/ogg';
    case '.aiff':
    case '.aif':
      return 'audio/aiff';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Generates or retrieves an AAC preview audio file cached by content hash.
 * Falls back to streaming the original file if ffmpeg transcoding is unavailable.
 */
export async function getOrCreatePreview(
  sourcePath: string,
  options?: StreamAudioOptions
): Promise<PreviewResult> {
  const cacheDir = options?.cacheDir ?? DEFAULT_PREVIEW_CACHE_DIR;
  const bitrate = options?.bitrate ?? '256k';

  if (!fs.existsSync(cacheDir)) {
    await fs.promises.mkdir(cacheDir, { recursive: true });
  }

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(sourcePath);
  } catch {
    return {
      filePath: sourcePath,
      mimeType: getAudioMimeType(sourcePath),
      isCached: false
    };
  }

  const keyData = `${path.resolve(sourcePath)}:${stat.mtimeMs}:${stat.size}:${bitrate}`;
  const hash = crypto.createHash('sha256').update(keyData).digest('hex');
  const cachedPath = path.join(cacheDir, `${hash}.m4a`);

  // Check cache hit
  if (fs.existsSync(cachedPath)) {
    try {
      const cachedStat = await fs.promises.stat(cachedPath);
      if (cachedStat.size > 0) {
        return { filePath: cachedPath, mimeType: 'audio/mp4', isCached: true };
      }
    } catch {
      // Regenerate on read error
    }
  }

  // Transcode via ffmpeg to temporary file with atomic rename
  const tempPath = path.join(
    cacheDir,
    `${hash}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}.m4a`
  );

  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-i',
      sourcePath,
      '-vn',
      '-c:a',
      'aac',
      '-b:a',
      bitrate,
      '-ar',
      '44100',
      tempPath
    ]);

    if (fs.existsSync(tempPath) && (await fs.promises.stat(tempPath)).size > 0) {
      await fs.promises.rename(tempPath, cachedPath);
      return { filePath: cachedPath, mimeType: 'audio/mp4', isCached: true };
    }
  } catch {
    // Cleanup temporary file on error
    try {
      if (fs.existsSync(tempPath)) {
        await fs.promises.unlink(tempPath);
      }
    } catch {
      /* ignore */
    }
  }

  // Graceful fallback to original audio file
  return {
    filePath: sourcePath,
    mimeType: getAudioMimeType(sourcePath),
    isCached: false
  };
}

/**
 * Handles HTTP streaming for audio requests, supporting HTTP 206 byte ranges for iOS Safari.
 */
export async function streamAudioResponse(
  sourcePath: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options?: StreamAudioOptions
): Promise<void> {
  const { filePath, mimeType } = await getOrCreatePreview(sourcePath, options);
  const stat = await fs.promises.stat(filePath);
  const totalSize = stat.size;

  const rangeHeader = req.headers.range;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');

  if (!rangeHeader) {
    // 200 OK: Full file delivery
    res.writeHead(200, {
      'Content-Type': mimeType,
      'Content-Length': totalSize,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600'
    });
    const stream = fs.createReadStream(filePath);
    req.on('close', () => stream.destroy());
    stream.on('error', () => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
    stream.pipe(res);
    return;
  }

  // Parse Range header: "bytes=start-end"
  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) {
    res.writeHead(416, {
      'Content-Range': `bytes */${totalSize}`,
      'Accept-Ranges': 'bytes'
    });
    res.end();
    return;
  }

  let start: number;
  let end: number;

  if (match[1] && match[2]) {
    start = parseInt(match[1], 10);
    end = parseInt(match[2], 10);
  } else if (match[1]) {
    start = parseInt(match[1], 10);
    end = totalSize - 1;
  } else if (match[2]) {
    const suffix = parseInt(match[2], 10);
    start = Math.max(0, totalSize - suffix);
    end = totalSize - 1;
  } else {
    res.writeHead(416, {
      'Content-Range': `bytes */${totalSize}`,
      'Accept-Ranges': 'bytes'
    });
    res.end();
    return;
  }

  if (isNaN(start) || isNaN(end) || start > end || start >= totalSize) {
    res.writeHead(416, {
      'Content-Range': `bytes */${totalSize}`,
      'Accept-Ranges': 'bytes'
    });
    res.end();
    return;
  }

  end = Math.min(end, totalSize - 1);
  const chunkSize = end - start + 1;

  res.writeHead(206, {
    'Content-Type': mimeType,
    'Content-Range': `bytes ${start}-${end}/${totalSize}`,
    'Content-Length': chunkSize,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=3600'
  });

  const stream = fs.createReadStream(filePath, { start, end });
  req.on('close', () => stream.destroy());
  stream.on('error', () => {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
  stream.pipe(res);
}
