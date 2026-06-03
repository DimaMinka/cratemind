import { useStore } from './UIService.js';
import * as EngineDBService from './EngineDBService.js';
import * as EmbeddingService from './EmbeddingService.js';
import { getDB as getLocalDB } from './LocalDBService.js';
import { FOLDERS } from '../config.js';
import { TrackMeta } from '../types.js';

let isIndexing = false;

function convertKeyToCamelot(keyVal: number | null | undefined): string {
  if (keyVal === null || keyVal === undefined || keyVal < 0 || keyVal > 23) return '';
  const num = (Math.floor(keyVal / 2) + 8) % 12 || 12;
  const letter = keyVal % 2 === 0 ? 'B' : 'A';
  return `${num.toString().padStart(2, '0')}${letter}`;
}

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
  addLog('SYSTEM', 'Scanning Engine DJ database for tracks in vibe folders...');

  try {
    const dbTracks = EngineDBService.getTracks();
    addLog('SYSTEM', `Loaded ${dbTracks.length} tracks from Engine DJ DB.`);

    const targets: { vibe: string; track: (typeof dbTracks)[0] }[] = [];
    const folderCounts: Record<string, number> = {};

    for (const track of dbTracks) {
      if (!track.path) continue;

      const pathParts = track.path.toLowerCase().split(/[/\\]/);
      const matchedVibe = FOLDERS.find((vibe) => pathParts.includes(vibe.toLowerCase()));

      if (matchedVibe) {
        targets.push({ vibe: matchedVibe, track });
        folderCounts[matchedVibe] = (folderCounts[matchedVibe] ?? 0) + 1;
      }
    }

    if (targets.length === 0) {
      addLog('SYSTEM', 'No tracks matching CrateMind vibe folders found in paths.');
      isIndexing = false;
      return;
    }

    addLog(
      'SYSTEM',
      `Found ${targets.length} tracks matching vibe folders. Checking existing indexes...`
    );

    // Get list of already indexed tracks
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
          key: convertKeyToCamelot(item.track.id ? item.track.bpm : undefined), // Use converted keyVal or pass fallback
          duration: 0
        };
        // Retrieve proper key mapping or leave empty if undefined
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
