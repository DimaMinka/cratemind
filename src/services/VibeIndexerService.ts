import { useStore } from './UIService.js';
import * as EngineDBService from './EngineDBService.js';
import * as EmbeddingService from './EmbeddingService.js';
import { getDB as getLocalDB } from './LocalDBService.js';
import { FOLDERS, SORTED_DIR, AUDIO_EXTENSIONS } from '../config.js';
import { TrackMeta } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';
import { extractMetadata } from './ID3Service.js';

let isIndexing = false;

export async function indexAllDBVibes(): Promise<void> {
  const addLog = useStore.getState().addLog;

  if (isIndexing) {
    addLog('SYSTEM', 'Vibe indexer is already running.');
    return;
  }

  if (!EngineDBService.isAvailable()) {
    addLog('ERROR', 'Engine DJ database is not available.');
    return;
  }

  if (!process.env.GEMINI_API_KEY) {
    addLog('ERROR', 'GEMINI_API_KEY is missing. Indexing aborted.');
    return;
  }

  isIndexing = true;
  addLog('SYSTEM', 'Scanning Engine DJ database (Paths & Playlists)...');

  try {
    const dbTracks = EngineDBService.getTracks();
    addLog('SYSTEM', `Loaded ${dbTracks.length} tracks from Engine DJ DB.`);

    // Load playlist vibes map
    const playlistVibes = EngineDBService.getTrackPlaylistVibes();
    const trackPlaylistMap = new Map<number, string[]>();
    for (const pv of playlistVibes) {
      if (!trackPlaylistMap.has(pv.trackId)) {
        trackPlaylistMap.set(pv.trackId, []);
      }
      trackPlaylistMap.get(pv.trackId)!.push(pv.vibe);
    }

    const targets: { vibe: string; track: (typeof dbTracks)[0] }[] = [];
    const folderCounts: Record<string, number> = {};

    for (const track of dbTracks) {
      if (!track.path) continue;

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

      if (matchedVibe) {
        targets.push({ vibe: matchedVibe, track });
        folderCounts[matchedVibe] = (folderCounts[matchedVibe] ?? 0) + 1;
      }
    }

    // Add local Sorted/ directory tracks if they are not already collected from DB
    const existingKeys = new Set(
      targets.map((t) => {
        const artist = t.track.artist || 'Unknown Artist';
        const title = t.track.title || t.track.filename || 'Unknown Title';
        return `${artist.toLowerCase()}|${title.toLowerCase()}`;
      })
    );

    // Get list of already indexed tracks from cratemind.db
    const cmDb = getLocalDB();
    const indexedKeys = new Set<string>();
    try {
      const indexedRows = cmDb.prepare('SELECT artist, title FROM track_vectors').all() as {
        artist: string;
        title: string;
      }[];
      for (const r of indexedRows) {
        indexedKeys.add(`${r.artist.toLowerCase()}|${r.title.toLowerCase()}`);
      }
    } catch {
      // Table may not exist yet
    }

    if (fs.existsSync(SORTED_DIR)) {
      addLog('SYSTEM', `Scanning physical sorted directory: ${SORTED_DIR}...`);

      // Pre-scan directories to get list of audio files and show processing progress
      const filesToProcess: { folder: string; file: string; fullPath: string }[] = [];
      for (const folder of FOLDERS) {
        const folderPath = path.join(SORTED_DIR, folder);
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

      let localCount = 0;
      let alreadyIndexedCount = 0;
      let currentIndex = 0;
      const totalLocalFiles = filesToProcess.length;

      for (const item of filesToProcess) {
        currentIndex++;
        try {
          const meta = await extractMetadata(item.fullPath);
          const key = `${meta.artist.toLowerCase()}|${meta.title.toLowerCase()}`;
          if (!existingKeys.has(key)) {
            existingKeys.add(key);

            const isIndexed = indexedKeys.has(key);
            if (!isIndexed) {
              addLog(
                'SYSTEM',
                `└─ Local-only track [${currentIndex}/${totalLocalFiles}]: ${meta.artist} - ${meta.title} → /${item.folder}`
              );
              localCount++;
            } else {
              alreadyIndexedCount++;
            }

            targets.push({
              vibe: item.folder,
              track: {
                id: -1, // placeholder for non-DB local tracks
                path: item.fullPath,
                filename: item.file,
                title: meta.title,
                artist: meta.artist,
                bpm: meta.bpm,
                key: meta.key,
                genre: meta.genre,
                comment: meta.comment,
                label: meta.label
              }
            });
          }
        } catch {
          // ignore
        }
      }
      if (localCount > 0) {
        addLog(
          'SYSTEM',
          `Added ${localCount} additional tracks found only in physical Sorted/ folder.`
        );
      }
      if (alreadyIndexedCount > 0) {
        addLog(
          'SYSTEM',
          `Skipped logging for ${alreadyIndexedCount} physical Sorted/ tracks (already indexed in cratemind.db).`
        );
      }
    }

    if (targets.length === 0) {
      addLog('SYSTEM', 'No tracks matching CrateMind vibe folders/playlists found.');
      isIndexing = false;
      return;
    }

    addLog('SYSTEM', `Found ${targets.length} tracks matching vibes. Checking existing indexes...`);

    const toProcess = targets.filter((t) => {
      const artist = t.track.artist || 'Unknown Artist';
      const title = t.track.title || t.track.filename || 'Unknown Title';
      const key = `${artist.toLowerCase()}|${title.toLowerCase()}`;
      return !indexedKeys.has(key);
    });

    addLog(
      'SYSTEM',
      `Vector index: ${indexedKeys.size} tracks already indexed. ${toProcess.length} remaining.`
    );

    if (toProcess.length === 0) {
      addLog('SYSTEM', 'All eligible library tracks are already indexed!');
      isIndexing = false;
      return;
    }

    addLog('SYSTEM', `Starting vector generation for ${toProcess.length} tracks in background...`);

    // Process in batches of 5
    let successCount = 0;
    let failedCount = 0;

    for (let i = 0; i < toProcess.length; i += 5) {
      const batch = toProcess.slice(i, i + 5);

      const promises = batch.map(async (item) => {
        const artist = item.track.artist || 'Unknown Artist';
        const title = item.track.title || item.track.filename || 'Unknown Title';
        const bpmValue = item.track.bpm ? Math.round(item.track.bpm) : 0;

        const meta: TrackMeta = {
          filepath: item.track.path,
          filename: item.track.filename,
          title,
          artist,
          bpm: bpmValue,
          key: '',
          duration: 0
        };

        if (item.track.key) {
          meta.key = item.track.key;
        }

        try {
          const stored = await EmbeddingService.storeTrackVector(
            artist,
            title,
            item.vibe,
            meta,
            null,
            [],
            undefined
          );

          if (stored) {
            successCount++;
          } else {
            failedCount++;
          }
        } catch {
          failedCount++;
        }
      });

      await Promise.all(promises);

      // Report progress periodically (every 10 or 25 tracks)
      const doneCount = i + batch.length;
      if (doneCount % 10 === 0 || doneCount === toProcess.length) {
        addLog(
          'SYSTEM',
          `Vibe Indexing Progress: ${doneCount}/${toProcess.length} (${Math.round((doneCount / toProcess.length) * 100)}%) | Added: ${successCount} | Failed: ${failedCount}`
        );
      }

      // 500ms delay between batches to stay within rate limits safely
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    addLog(
      'SYSTEM',
      `Vibe Indexing complete! Newly indexed: ${successCount} tracks. Failed/skipped: ${failedCount} tracks.`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    addLog('ERROR', `Vibe Indexing failed: ${msg}`);
  } finally {
    isIndexing = false;
  }
}
