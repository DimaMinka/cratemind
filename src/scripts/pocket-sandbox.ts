import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FOLDERS } from '../config.js';
import { getDB, resetDBForTests } from '../services/LocalDBService.js';
import { PocketBridgeService } from '../services/pocket/PocketBridgeService.js';
import { getLocalNetworkIp } from '../services/pocket/pocketCli.js';
import { getRagTotalExamples } from '../services/pocket/pocketDbQueries.js';

interface SandboxTrackSpec {
  filename: string;
  artist: string;
  title: string;
  bpm: number;
  key: string;
  genre: string;
  durationSeconds?: number;
}

const SANDBOX_TRACKS: SandboxTrackSpec[] = [
  {
    filename: 'Bedouin - Desert Nomad.wav',
    artist: 'Bedouin',
    title: 'Desert Nomad',
    bpm: 121,
    key: '8A',
    genre: 'Organic House'
  },
  {
    filename: 'Stephan Bodzin - Strand.wav',
    artist: 'Stephan Bodzin',
    title: 'Strand',
    bpm: 124,
    key: '4A',
    genre: 'Melodic Techno'
  },
  {
    filename: 'Recondite - Shun.wav',
    artist: 'Recondite',
    title: 'Shun',
    bpm: 125,
    key: '9A',
    genre: 'Minimal Techno'
  },
  {
    filename: 'Innellea - Vigilance.wav',
    artist: 'Innellea',
    title: 'Vigilance',
    bpm: 126,
    key: '6A',
    genre: 'Melodic Techno'
  },
  {
    filename: 'Ben Bohmer - Beyond Beliefs.wav',
    artist: 'Ben Bohmer',
    title: 'Beyond Beliefs',
    bpm: 122,
    key: '11A',
    genre: 'Melodic House'
  },
  {
    filename: 'Colyn - Resolve.wav',
    artist: 'Colyn',
    title: 'Resolve',
    bpm: 123,
    key: '5A',
    genre: 'Melodic Techno'
  }
];

function createId3TextFrame(frameId: string, value: string): Buffer {
  const textBytes = Buffer.from(value, 'latin1');
  const payloadSize = 1 + textBytes.length;
  const frame = Buffer.alloc(10 + payloadSize);
  frame.write(frameId, 0, 4, 'ascii');
  frame.writeUInt32BE(payloadSize, 4);
  frame.writeUInt16BE(0, 8);
  frame[10] = 0x00; // ISO-8859-1 encoding
  textBytes.copy(frame, 11);
  return frame;
}

function encodeSynchsafeInt(value: number): Buffer {
  return Buffer.from([
    (value >> 21) & 0x7f,
    (value >> 14) & 0x7f,
    (value >> 7) & 0x7f,
    value & 0x7f
  ]);
}

function createId3RiffChunk(tags: SandboxTrackSpec): Buffer {
  const frames = Buffer.concat([
    createId3TextFrame('TPE1', tags.artist),
    createId3TextFrame('TIT2', tags.title),
    createId3TextFrame('TBPM', String(tags.bpm)),
    createId3TextFrame('TKEY', tags.key),
    createId3TextFrame('TCON', tags.genre)
  ]);

  const id3Header = Buffer.concat([
    Buffer.from('ID3', 'ascii'),
    Buffer.from([0x03, 0x00, 0x00]),
    encodeSynchsafeInt(frames.length)
  ]);
  const id3Tag = Buffer.concat([id3Header, frames]);
  const needsPad = id3Tag.length % 2 === 1;
  const chunk = Buffer.alloc(8 + id3Tag.length + (needsPad ? 1 : 0));
  chunk.write('id3 ', 0, 4, 'ascii');
  chunk.writeUInt32LE(id3Tag.length, 4);
  id3Tag.copy(chunk, 8);
  return chunk;
}

/**
 * Generates a valid RIFF/WAVE PCM buffer (silent audio) with an embedded ID3v2.3 RIFF chunk.
 */
function createTaggedWavBuffer(tags: SandboxTrackSpec, durationSeconds = 4): Buffer {
  const sampleRate = 8000;
  const numChannels = 1;
  const bitsPerSample = 8;
  const dataSize = sampleRate * numChannels * (bitsPerSample / 8) * durationSeconds;
  const id3Chunk = createId3RiffChunk(tags);
  const buffer = Buffer.alloc(44 + dataSize + id3Chunk.length);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // PCM chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  buffer.fill(128, 44, 44 + dataSize); // 8-bit unsigned PCM silence midpoint
  id3Chunk.copy(buffer, 44 + dataSize);

  return buffer;
}

function seedSandboxDatabase(): void {
  const db = getDB();
  const now = Date.now();

  const insertRag = db.prepare(`
    INSERT INTO rag_examples (artist, title, folders, reasoning, source, ts)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  insertRag.run(
    'Bedouin',
    'Desert Nomad',
    JSON.stringify(['desert vibe', 'nargila vibe']),
    'Warm organic percussion with hypnotic desert atmosphere',
    'manual',
    now - 100000
  );
  insertRag.run(
    'Stephan Bodzin',
    'Strand',
    JSON.stringify(['galaxy trip']),
    'Melodic synth arpeggios and analog drive',
    'manual',
    now - 90000
  );
  insertRag.run(
    'Colyn',
    'Resolve',
    JSON.stringify(['magic forest']),
    'Deep melodic progressive layers',
    'manual',
    now - 80000
  );

  // Seed 512-dim CLAP embeddings & acoustic profile (matches Recondite - Shun via BPM 125 & Key 9A)
  const vecA = new Float32Array(512).fill(0.05);
  vecA[0] = 0.95;
  const bufA = Buffer.from(vecA.buffer);

  db.prepare(
    `
    INSERT OR REPLACE INTO track_intelligence (artist, title, filepath, folder, bpm, key, clap_embedding, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    'Recondite',
    'Levo',
    '/sandbox/Sorted/iceland/Recondite - Levo.wav',
    'iceland',
    124,
    '9A',
    bufA,
    now
  );

  // Seed YouTube Network Scout playlist neighbors
  const playlistId = 'PL_cratemind_sandbox_set';
  db.prepare(
    `
    INSERT OR REPLACE INTO yt_playlists (id, title, description, channel_name, cached_at)
    VALUES (?, ?, ?, ?, ?)
  `
  ).run(playlistId, 'Cercle Desert Sunset Mix 2026', 'Organic & Melodic Live Set', 'Cercle', now);

  const insertYtItem = db.prepare(`
    INSERT OR REPLACE INTO yt_playlist_items (playlist_id, track_index, artist, title)
    VALUES (?, ?, ?, ?)
  `);
  insertYtItem.run(playlistId, 1, 'Innellea', 'Vigilance');
  insertYtItem.run(playlistId, 2, 'Colyn', 'Resolve');
  insertYtItem.run(playlistId, 3, 'Ben Bohmer', 'Beyond Beliefs');
}

function seedSandboxTracks(incomingDir: string): SandboxTrackSpec[] {
  for (const track of SANDBOX_TRACKS) {
    const wavBuffer = createTaggedWavBuffer(track, track.durationSeconds ?? 4);
    fs.writeFileSync(path.join(incomingDir, track.filename), wavBuffer);
  }
  return SANDBOX_TRACKS;
}

const ESC = String.fromCharCode(27);
const ANSI = {
  reset: `${ESC}[0m`,
  bold: `${ESC}[1m`,
  dim: `${ESC}[2m`,
  cyan: `${ESC}[36m`,
  green: `${ESC}[32m`,
  yellow: `${ESC}[33m`,
  magenta: `${ESC}[35m`
};
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');

function visibleLength(text: string): number {
  return text.replace(ANSI_PATTERN, '').length;
}

function wrapPlainText(text: string, maxWidth: number): string[] {
  if (text.length <= maxWidth) return [text];
  const lines: string[] = [];
  for (let i = 0; i < text.length; i += maxWidth) {
    lines.push(text.slice(i, i + maxWidth));
  }
  return lines;
}

function printSandboxBanner(
  localUrl: string,
  networkUrl: string,
  sandboxDir: string,
  trackCount: number,
  folderCount: number,
  ragCount: number
): void {
  const width = 80;
  const maxInner = width - 4;
  const top = `${ANSI.cyan}╔${'═'.repeat(width)}╗${ANSI.reset}`;
  const mid = `${ANSI.cyan}╠${'═'.repeat(width)}╣${ANSI.reset}`;
  const bot = `${ANSI.cyan}╚${'═'.repeat(width)}╝${ANSI.reset}`;

  const row = (text = ''): string => {
    const pad = Math.max(0, width - visibleLength(text) - 2);
    return `${ANSI.cyan}║${ANSI.reset}  ${text}${' '.repeat(pad)}${ANSI.cyan}║${ANSI.reset}`;
  };

  const lines: string[] = [
    top,
    row(
      `${ANSI.bold}${ANSI.yellow}★ CRATEMIND POCKET SANDBOX (ISOLATED TEST ENVIRONMENT)${ANSI.reset}`
    ),
    mid,
    row(`${ANSI.bold}Local URL:${ANSI.reset}     ${ANSI.green}${localUrl}${ANSI.reset}`),
    row(`${ANSI.bold}Network URL:${ANSI.reset}   ${ANSI.cyan}${networkUrl}${ANSI.reset}`),
    row(
      `${ANSI.bold}iPhone PWA:${ANSI.reset}    Open Network URL in Safari -> Share -> ${ANSI.yellow}"Add to Home Screen"${ANSI.reset}`
    ),
    row(
      `${ANSI.bold}Mock Library:${ANSI.reset}  ${trackCount} tagged WAV tracks in Incoming/ (${folderCount} crates in Sorted/)`
    ),
    row(
      `${ANSI.bold}RAG Memory:${ANSI.reset}    ${ANSI.magenta}${ragCount} rag_examples${ANSI.reset} | 1 CLAP vector | 3 YT Scout neighbors`
    ),
    row(
      `${ANSI.bold}Engine DJ DB:${ANSI.reset}  ${ANSI.yellow}Bypassed / Sandbox Isolated${ANSI.reset}`
    )
  ];

  const tempPrefix = 'Temp Root:     ';
  const tempLines = wrapPlainText(sandboxDir, maxInner - tempPrefix.length);
  tempLines.forEach((line, idx) => {
    const label =
      idx === 0 ? `${ANSI.bold}${tempPrefix}${ANSI.reset}` : ' '.repeat(tempPrefix.length);
    lines.push(row(`${label}${ANSI.dim}${line}${ANSI.reset}`));
  });

  lines.push(
    mid,
    row(
      `${ANSI.green}Production DB (cratemind.db), ./Incoming & ./Sorted are UNTOUCHED.${ANSI.reset}`
    ),
    row('Press Ctrl+C to stop sandbox and clean up temporary files.'),
    bot
  );
  console.log(lines.join('\n'));
}

export async function runPocketSandbox(): Promise<void> {
  const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cratemind-pocket-sandbox-'));
  const incomingDir = path.join(sandboxDir, 'Incoming');
  const sortedDir = path.join(sandboxDir, 'Sorted');
  const cacheDir = path.join(sandboxDir, 'cache');
  const dbPath = path.join(sandboxDir, 'cratemind.sandbox.db');

  fs.mkdirSync(incomingDir, { recursive: true });
  fs.mkdirSync(sortedDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });

  for (const folder of FOLDERS) {
    fs.mkdirSync(path.join(sortedDir, folder), { recursive: true });
  }

  process.env.CRATEMIND_DB_PATH = dbPath;
  process.env.INCOMING_DIR = incomingDir;
  process.env.SORTED_DIR = sortedDir;
  resetDBForTests();

  seedSandboxDatabase();
  const tracks = seedSandboxTracks(incomingDir);
  const ragCount = getRagTotalExamples();

  const parsedPort = process.env.POCKET_PORT ? parseInt(process.env.POCKET_PORT, 10) : 8080;
  const port = !Number.isNaN(parsedPort) && parsedPort >= 0 ? parsedPort : 8080;
  const host = '0.0.0.0';
  const lanIp = getLocalNetworkIp();

  const bridge = new PocketBridgeService({
    port,
    host,
    incomingDir,
    sortedDir,
    cacheDir,
    staticDir: path.resolve('dist/pocket-web')
  });

  const { port: actualPort } = await bridge.start();
  const localUrl = `http://localhost:${actualPort}`;
  const networkUrl = `http://${lanIp}:${actualPort}`;

  printSandboxBanner(localUrl, networkUrl, sandboxDir, tracks.length, FOLDERS.length, ragCount);

  let cleanedUp = false;
  let shuttingDown = false;
  const removeSandboxFiles = (): void => {
    if (cleanedUp) return;
    cleanedUp = true;
    resetDBForTests();
    try {
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  };

  const shutdown = async (): Promise<void> => {
    removeSandboxFiles();
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\nStopping CrateMind Pocket Sandbox...');
    try {
      await bridge.stop();
    } catch {
      // ignore stop errors
    }
    console.log('Sandbox cleaned up. Goodbye.');
    process.exit(0);
  };

  const handleSignal = (): void => {
    removeSandboxFiles();
    void shutdown();
  };

  process.prependListener('SIGINT', handleSignal);
  process.prependListener('SIGTERM', handleSignal);
  process.on('exit', removeSandboxFiles);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runPocketSandbox().catch((err) => {
    console.error('Failed to start CrateMind Pocket Sandbox:', err);
    process.exit(1);
  });
}
