import * as fs from 'fs';
import * as path from 'path';
import { RagExample, RagMemory, BootstrapResult, VectorNeighbor, TrackMeta } from '../types.js';
import { RAG_EXAMPLES_PER_FOLDER, FOLDERS, AUDIO_EXTENSIONS, MOCK_MODE } from '../config.js';
import { extractMetadata } from './ID3Service.js';
import { MOCK_RAG_EXAMPLES } from '../mocks/mockData.js';
import { getDB, getSetting, setSetting } from './LocalDBService.js';
import { SpotifyAudioFeatures } from './SpotifyService.js';
import * as EmbeddingService from './EmbeddingService.js';
import { buildPassport } from './TrackPassportService.js';
import { YouTubePlaylist } from '../types.js';

/**
 * RAGService.ts
 *
 * Implements few-shot retrieval-augmented memory for vibe classification.
 *
 * Key optimizations (v4.6):
 * - Module-level cache prevents repeated SQLite lookups on every LLM call.
 * - SQLite backend cratemind.db replaces RAG_MEMORY_FILE for fast transactions.
 */

// ── In-memory Cache ─────────────────────────────────────────────────────────

let _memoryCache: RagMemory | null = null;

function loadMemory(): RagMemory {
  if (_memoryCache) return _memoryCache;

  const db = getDB();
  try {
    const rows = db
      .prepare(
        'SELECT artist, title, folders, overridden_folders, reasoning, source, ts FROM rag_examples ORDER BY ts ASC'
      )
      .all() as {
      artist: string;
      title: string;
      folders: string;
      overridden_folders: string | null;
      reasoning: string;
      source: string;
      ts: number;
    }[];
    const examples: RagExample[] = rows.map((r) => ({
      artist: r.artist,
      title: r.title,
      folders: JSON.parse(r.folders) as string[],
      overriddenFolders: r.overridden_folders
        ? (JSON.parse(r.overridden_folders) as string[])
        : undefined,
      reasoning: r.reasoning,
      source: r.source as RagExample['source'],
      ts: r.ts
    }));
    const lastScanDir = getSetting('lastScanDir');
    _memoryCache = { version: 1, examples, lastScanDir };
    return _memoryCache;
  } catch {
    _memoryCache = { version: 1, examples: [], lastScanDir: null };
    return _memoryCache;
  }
}

function saveMemory(memory: RagMemory): void {
  _memoryCache = memory;
  const db = getDB();
  try {
    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO rag_examples (artist, title, folders, overridden_folders, reasoning, source, ts)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = db.transaction((examples: RagExample[]) => {
      db.prepare('DELETE FROM rag_examples').run();
      for (const ex of examples) {
        insertStmt.run(
          ex.artist,
          ex.title,
          JSON.stringify(ex.folders),
          ex.overriddenFolders ? JSON.stringify(ex.overriddenFolders) : null,
          ex.reasoning,
          ex.source,
          ex.ts
        );
      }
    });

    transaction(memory.examples);

    if (memory.lastScanDir) {
      setSetting('lastScanDir', memory.lastScanDir);
    } else {
      db.prepare("DELETE FROM settings WHERE key = 'lastScanDir'").run();
    }
  } catch {
    // Ignore database write errors
  }
}

/** Invalidates the in-memory cache, forcing the next read from disk. */
export function invalidateCache(): void {
  _memoryCache = null;
}

import * as EngineDBService from './EngineDBService.js';

export async function bootstrap(
  sortedDir: string,
  useEngineDB = false,
  onProgress?: (current: number, total: number) => void
): Promise<BootstrapResult> {
  // Invalidate cache so bootstrap always reads a fresh state from disk
  _memoryCache = null;

  const currentSortedDir = path.resolve(sortedDir);

  if (MOCK_MODE) {
    const memory: RagMemory = {
      version: 1,
      examples: [...MOCK_RAG_EXAMPLES],
      lastScanDir: currentSortedDir
    };
    saveMemory(memory);
    return {
      found: MOCK_RAG_EXAMPLES.length,
      added: MOCK_RAG_EXAMPLES.length,
      folders: 4,
      total: MOCK_RAG_EXAMPLES.length,
      totalFolders: 4
    };
  }

  const memory = loadMemory();
  let found = 0;
  let added = 0;
  let foldersScanned = 0;

  if (memory.lastScanDir && path.resolve(memory.lastScanDir) !== currentSortedDir) {
    memory.examples = [];
  }

  // 1. If Engine DJ DB import is requested, query database tracks and extract vibe from path or playlists
  if (useEngineDB) {
    const dbTracks = EngineDBService.getTracks();
    const folderVibeSet = new Set<string>();

    // Fetch track playlist vibes to resolve vibes using Denon DJ playlists
    const playlistVibes = EngineDBService.getTrackPlaylistVibes();
    const trackPlaylistMap = new Map<number, string[]>();
    for (const pv of playlistVibes) {
      if (!trackPlaylistMap.has(pv.trackId)) {
        trackPlaylistMap.set(pv.trackId, []);
      }
      trackPlaylistMap.get(pv.trackId)!.push(pv.vibe);
    }

    for (const track of dbTracks) {
      found++;

      // Safety guard: skip invalid records that miss physical paths
      if (!track || !track.path) {
        continue;
      }

      let matchedVibe: string | undefined = undefined;

      // 1. Try matching by playlist name first
      const trackVibes = trackPlaylistMap.get(track.id);
      if (trackVibes) {
        matchedVibe = FOLDERS.find((vibe) =>
          trackVibes.some((tv) => tv.toLowerCase() === vibe.toLowerCase())
        );
      }

      // 2. Try matching by path if no playlist match
      if (!matchedVibe) {
        const pathParts = track.path.toLowerCase().split(/[/\\]/);
        matchedVibe = FOLDERS.find((vibe) => pathParts.includes(vibe.toLowerCase()));
      }

      if (!matchedVibe) {
        continue; // Path/playlist doesn't belong to any known vibe folders
      }

      const trackArtist = track.artist || 'Unknown Artist';
      const trackTitle = track.title || track.filename || 'Unknown Title';

      const existingIdx = memory.examples.findIndex(
        (ex) =>
          ex.artist.toLowerCase() === trackArtist.toLowerCase() &&
          ex.title.toLowerCase() === trackTitle.toLowerCase()
      );

      if (existingIdx !== -1) {
        // Upgrade auto source to engine-dj since it's confirmed in the DB
        if (memory.examples[existingIdx].source === 'auto') {
          memory.examples[existingIdx].source = 'engine-dj';
          memory.examples[existingIdx].reasoning = 'Confirmed in Engine DJ database';
          memory.examples[existingIdx].folders = [matchedVibe];
        }
        continue;
      }

      folderVibeSet.add(matchedVibe);

      memory.examples.push({
        artist: trackArtist,
        title: trackTitle,
        folders: [matchedVibe],
        reasoning: 'Imported from Engine DJ database',
        source: 'engine-dj',
        ts: Date.now()
      });

      added++;
    }

    // Also scan physical Sorted/ directory for local-only tracks
    if (fs.existsSync(currentSortedDir)) {
      const filesToProcess: { folder: string; file: string; fullPath: string }[] = [];
      for (const folder of FOLDERS) {
        const folderPath = path.join(currentSortedDir, folder);
        if (!fs.existsSync(folderPath)) continue;

        const files = fs.readdirSync(folderPath);
        for (const file of files) {
          const ext = path.extname(file).toLowerCase();
          if (AUDIO_EXTENSIONS.includes(ext as (typeof AUDIO_EXTENSIONS)[number])) {
            filesToProcess.push({
              folder,
              file,
              fullPath: path.join(folderPath, file)
            });
          }
        }
      }

      let currentIndex = 0;
      const totalLocalFiles = filesToProcess.length;

      for (const item of filesToProcess) {
        currentIndex++;
        if (onProgress) {
          onProgress(currentIndex, totalLocalFiles);
        }
        found++;

        try {
          const meta = await extractMetadata(item.fullPath);

          const existingIdx = memory.examples.findIndex(
            (ex) =>
              ex.artist.toLowerCase() === meta.artist.toLowerCase() &&
              ex.title.toLowerCase() === meta.title.toLowerCase()
          );

          if (existingIdx !== -1) {
            // Upgrade auto source to scan since it's physically present in Sorted/
            if (memory.examples[existingIdx].source === 'auto') {
              memory.examples[existingIdx].source = 'scan';
              memory.examples[existingIdx].reasoning = 'Confirmed physically in Sorted folder';
              memory.examples[existingIdx].folders = [item.folder];
            }
            continue;
          }

          folderVibeSet.add(item.folder);

          memory.examples.push({
            artist: meta.artist,
            title: meta.title,
            folders: [item.folder],
            reasoning: 'Added from local Sorted folder during bootstrap',
            source: 'scan',
            ts: Date.now()
          });

          added++;
        } catch {
          // ignore
        }
      }
    }

    memory.lastScanDir = currentSortedDir;
    saveMemory(memory);

    const totalFolders = new Set(memory.examples.flatMap((ex) => ex.folders)).size;
    return {
      found,
      added,
      folders: folderVibeSet.size,
      total: memory.examples.length,
      totalFolders
    };
  }

  // 2. Filesystem scan path
  const filesToProcess: { folder: string; file: string; fullPath: string }[] = [];
  for (const folder of FOLDERS) {
    const folderPath = path.join(currentSortedDir, folder);
    if (!fs.existsSync(folderPath)) {
      continue;
    }

    foldersScanned++;
    const files = fs.readdirSync(folderPath);

    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (AUDIO_EXTENSIONS.includes(ext as (typeof AUDIO_EXTENSIONS)[number])) {
        filesToProcess.push({
          folder,
          file,
          fullPath: path.join(folderPath, file)
        });
      }
    }
  }

  let currentIndex = 0;
  const totalLocalFiles = filesToProcess.length;

  for (const item of filesToProcess) {
    currentIndex++;
    if (onProgress) {
      onProgress(currentIndex, totalLocalFiles);
    }
    found++;

    try {
      const meta = await extractMetadata(item.fullPath);

      const existingIdx = memory.examples.findIndex(
        (ex) =>
          ex.artist.toLowerCase() === meta.artist.toLowerCase() &&
          ex.title.toLowerCase() === meta.title.toLowerCase()
      );

      if (existingIdx !== -1) {
        // Upgrade auto source to scan since it's physically present in Sorted/
        if (memory.examples[existingIdx].source === 'auto') {
          memory.examples[existingIdx].source = 'scan';
          memory.examples[existingIdx].reasoning = 'Confirmed physically in Sorted folder';
          memory.examples[existingIdx].folders = [item.folder];
        }
        continue;
      }

      memory.examples.push({
        artist: meta.artist,
        title: meta.title,
        folders: [item.folder],
        reasoning: 'Added during bootstrap scan',
        source: 'scan',
        ts: Date.now()
      });

      added++;
    } catch {
      // ignore
    }
  }

  memory.lastScanDir = currentSortedDir;
  saveMemory(memory);

  const totalFolders = new Set(memory.examples.flatMap((ex) => ex.folders)).size;
  return {
    found,
    added,
    folders: foldersScanned,
    total: memory.examples.length,
    totalFolders
  };
}

export function findExample(artist: string, title: string): RagExample | null {
  const memory = loadMemory();
  const found = memory.examples.find(
    (ex) =>
      ex.artist.toLowerCase() === artist.toLowerCase() &&
      ex.title.toLowerCase() === title.toLowerCase()
  );
  return found ?? null;
}

export function addExample(example: RagExample): void {
  const memory = loadMemory();
  memory.examples = memory.examples.filter(
    (ex) =>
      !(
        ex.artist.toLowerCase() === example.artist.toLowerCase() &&
        ex.title.toLowerCase() === example.title.toLowerCase()
      )
  );
  memory.examples.push(example);
  saveMemory(memory);
}

export function getContext(): string {
  const memory = loadMemory(); // returns in-memory cache — zero disk I/O on subsequent calls
  if (memory.examples.length === 0) {
    return '';
  }

  // Separate user-confirmed manual overrides from auto-classified examples.
  // LLM receives explicit signals: manual choices carry much higher weight
  // than engine-dj imports or auto-classifications.
  const manualExamples = memory.examples.filter((ex) => ex.source === 'manual');
  const autoExamples = memory.examples.filter((ex) => ex.source !== 'manual');

  const userConfirmedLines: string[] = [];
  const referenceLines: string[] = [];

  // ── Block 1: User-confirmed choices (pinned, highest priority) ─────────────
  // Group all manual picks by folder and label them explicitly.
  // These directly represent the user's taste and override any LLM tendency.
  for (const folder of FOLDERS) {
    const confirmed = manualExamples
      .filter((ex) => ex.folders.includes(folder))
      .sort((a, b) => b.ts - a.ts);

    if (confirmed.length > 0) {
      const formatted = confirmed.map((ex) => `${ex.artist} - ${ex.title}`).join(' | ');
      userConfirmedLines.push(`[${folder}]: ${formatted}`);
    }
  }

  // ── Block 2: Reference examples (engine-dj / scan / auto) ──────────────────
  // Fill up to RAG_EXAMPLES_PER_FOLDER slots per folder, preferring
  // manual slots already consumed above (skip duplicates).
  const manualKeys = new Set(
    manualExamples.map((ex) => `${ex.artist.toLowerCase()}|${ex.title.toLowerCase()}`)
  );

  for (const folder of FOLDERS) {
    const refs = autoExamples
      .filter((ex) => ex.folders.includes(folder))
      .filter((ex) => !manualKeys.has(`${ex.artist.toLowerCase()}|${ex.title.toLowerCase()}`))
      .sort((a, b) => b.ts - a.ts)
      .slice(0, RAG_EXAMPLES_PER_FOLDER);

    if (refs.length > 0) {
      const formatted = refs.map((ex) => `${ex.artist} - ${ex.title}`).join(' | ');
      referenceLines.push(`[${folder}]: ${formatted}`);
    }
  }

  const sections: string[] = [];

  if (userConfirmedLines.length > 0) {
    sections.push(
      '=== [USER CONFIRMED] Tracks personally routed by the user — highest priority, match this taste ===',
      ...userConfirmedLines,
      '================================================================================================='
    );
  }

  if (referenceLines.length > 0) {
    sections.push(
      '=== Reference tracks already sorted in the library (use as secondary context) ===',
      ...referenceLines,
      '==================================================================================='
    );
  }

  return sections.length > 0 ? sections.join('\n') : '';
}

export function getPersonalHints(): string {
  const memory = loadMemory();

  // 1. Recency Bias: Retrieve only fresh corrections (sorted descending by ts, limit 50)
  const manualExamples = memory.examples
    .filter((ex) => ex.source === 'manual')
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 50);

  if (manualExamples.length === 0) {
    return '';
  }

  // 2. Count confirmation frequencies per folder
  const confirmedCounts: Record<string, number> = {};
  for (const ex of manualExamples) {
    for (const folder of ex.folders) {
      confirmedCounts[folder] = (confirmedCounts[folder] ?? 0) + 1;
    }
  }

  const topFolders = Object.entries(confirmedCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5) // top-5
    .map(([folder, count]) => `${folder} (${count})`)
    .join(', ');

  // 3. Precise Diff of corrections: llmFolder -> userFolder
  const corrections: Record<string, Record<string, number>> = {};
  for (const ex of manualExamples) {
    if (ex.overriddenFolders && ex.overriddenFolders.length > 0) {
      const rejectedFolders = ex.overriddenFolders.filter((f) => !ex.folders.includes(f));
      const addedFolders = ex.folders.filter((f) => !ex.overriddenFolders!.includes(f));

      for (const llmF of rejectedFolders) {
        if (!corrections[llmF]) {
          corrections[llmF] = {};
        }
        if (addedFolders.length === 0) {
          // User just removed the folder without adding any replacements
          corrections[llmF]['none'] = (corrections[llmF]['none'] ?? 0) + 1;
        } else {
          for (const userF of addedFolders) {
            corrections[llmF][userF] = (corrections[llmF][userF] ?? 0) + 1;
          }
        }
      }
    }
  }

  // 4. Generate and limit rules (Top-10 by frequency)
  interface CorrectionEntry {
    llmFolder: string;
    userFolder: string;
    count: number;
  }
  const flatCorrections: CorrectionEntry[] = [];
  for (const [llmF, targets] of Object.entries(corrections)) {
    for (const [userF, count] of Object.entries(targets)) {
      flatCorrections.push({ llmFolder: llmF, userFolder: userF, count });
    }
  }

  flatCorrections.sort((a, b) => b.count - a.count);
  const topCorrections = flatCorrections.slice(0, 10);

  const correctionLines = topCorrections.map(({ llmFolder, userFolder, count }) => {
    const times = count === 1 ? 'time' : 'times';
    if (userFolder === 'none') {
      return `- Avoid "${llmFolder}" → do not assign this folder (corrected ${count} ${times})`;
    } else {
      return `- Avoid "${llmFolder}" → prefer "${userFolder}" (corrected ${count} ${times})`;
    }
  });

  const sections: string[] = [];
  sections.push('=== Personal routing preferences (derived from your override history) ===');
  if (topFolders) {
    sections.push(`Top confirmed folders: ${topFolders}`);
  }
  if (correctionLines.length > 0) {
    sections.push('Routing corrections — apply when instinct conflicts with user taste:');
    sections.push(...correctionLines);
  }
  sections.push('========================================================================');

  return sections.length > 0 ? sections.join('\n') : '';
}

export function clear(): void {
  saveMemory({ version: 1, examples: [], lastScanDir: null });
}

// ── Vector Context ─────────────────────────────────────────────────────────

/**
 * Builds the track passport and performs a vector similarity search against
 * all sorted library tracks stored in track_vectors.
 *
 * Returns the TOP-K nearest neighbors along with the passport text used
 * for the query, or an empty array if the Gemini API is unavailable.
 *
 * @param artist  - Track artist
 * @param title   - Track title
 * @param meta    - Full TrackMeta (BPM, key, duration, label, genre, etc.)
 * @param spotify - Optional Spotify audio features (genres, energy, etc.)
 * @param ytPlaylists - Optional YouTube playlists found for this track
 * @param releaseYear - Optional release year override
 */
export async function getVectorContext(
  artist: string,
  title: string,
  meta: TrackMeta,
  spotify?: SpotifyAudioFeatures | null,
  ytPlaylists?: YouTubePlaylist[],
  releaseYear?: number,
  topK = 5
): Promise<{ neighbors: VectorNeighbor[]; passport: string }> {
  const passport = buildPassport({ meta, spotify, ytPlaylists, releaseYear });

  const excludeKey = `${artist.toLowerCase()}|${title.toLowerCase()}`;
  const neighbors = await EmbeddingService.findNeighbors(passport.text, topK, excludeKey);

  return { neighbors, passport: passport.text };
}

export function getStats(): { total: number; folders: number } {
  const memory = loadMemory();
  const folders = new Set(memory.examples.flatMap((ex) => ex.folders)).size;
  return {
    total: memory.examples.length,
    folders
  };
}
