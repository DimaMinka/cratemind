import { getDB } from '../LocalDBService.js';
import { PocketRagSuggestion, PocketYouTubeScout, PocketYouTubeNeighbor } from './pocketTypes.js';
import {
  cleanMetadataString,
  bufferToFloat32Array,
  cosineSimilarity,
  isCamelotCompatible
} from './pocketDbUtils.js';

export * from './pocketDbUtils.js';

/**
 * pocketDbQueries.ts
 *
 * Pure SQLite queries and in-memory vector/acoustic similarity logic.
 * ZERO external AI/LLM network calls.
 */

/**
 * Returns total count of RAG examples currently stored in local SQLite database.
 */
export function getRagTotalExamples(): number {
  try {
    const db = getDB();
    const row = db.prepare('SELECT COUNT(*) AS count FROM rag_examples').get() as
      | { count: number }
      | undefined;
    return row ? row.count : 0;
  } catch {
    return 0;
  }
}

/**
 * Finds local RAG suggestion through a 4-tier pure SQLite & in-memory pipeline:
 * 1. Exact match in rag_examples (98% confidence)
 * 2. Artist match in rag_examples (85% confidence)
 * 3. 512-dim CLAP embedding in-memory cosine similarity (70-99% confidence)
 * 4. Acoustic proximity fallback (BPM +-3% & Camelot compatibility, 55-68% confidence)
 */
export function findLocalRagMatch(
  artist: string,
  title: string,
  clapEmbedding?: Buffer | null,
  bpm?: number | null,
  key?: string | null
): PocketRagSuggestion {
  try {
    const db = getDB();
    const cleanArt = cleanMetadataString(artist);
    const cleanTtl = cleanMetadataString(title);

    // 1. Stage 1: Exact match in rag_examples
    if (cleanArt && cleanTtl) {
      try {
        const exactRow = db
          .prepare(
            'SELECT artist, title, folders, source FROM rag_examples WHERE LOWER(artist) = ? AND LOWER(title) = ? LIMIT 1'
          )
          .get(cleanArt, cleanTtl) as
          | { artist: string; title: string; folders: string; source: string }
          | undefined;

        if (exactRow) {
          const folders = JSON.parse(exactRow.folders) as string[];
          if (folders.length > 0) {
            return {
              folder: folders[0],
              confidence: exactRow.source === 'manual' ? 98 : 95,
              matchType: 'exact',
              referenceTrack: `${exactRow.artist} - ${exactRow.title}`,
              neighbors: [
                {
                  artist: exactRow.artist,
                  title: exactRow.title,
                  folder: folders[0],
                  similarity: 1.0
                }
              ]
            };
          }
        }
      } catch {
        // Continue to next stage on SQLite error
      }
    }

    // 2. Stage 1b: Artist match in rag_examples
    if (cleanArt) {
      try {
        const artistRows = db
          .prepare(
            'SELECT artist, title, folders FROM rag_examples WHERE LOWER(artist) = ? ORDER BY ts DESC LIMIT 5'
          )
          .all(cleanArt) as { artist: string; title: string; folders: string }[];

        if (artistRows.length > 0) {
          const folderCounts = new Map<string, number>();
          for (const row of artistRows) {
            try {
              const fList = JSON.parse(row.folders) as string[];
              for (const f of fList) folderCounts.set(f, (folderCounts.get(f) ?? 0) + 1);
            } catch {
              /* ignore */
            }
          }
          let topFolder: string | null = null;
          let maxCount = 0;
          for (const [f, count] of folderCounts.entries()) {
            if (count > maxCount) {
              maxCount = count;
              topFolder = f;
            }
          }
          if (topFolder) {
            return {
              folder: topFolder,
              confidence: 85,
              matchType: 'artist',
              referenceTrack: `${artistRows[0].artist} - ${artistRows[0].title}`,
              neighbors: artistRows.slice(0, 3).map((r) => {
                let f = topFolder!;
                try {
                  f = (JSON.parse(r.folders) as string[])[0] ?? topFolder!;
                } catch {
                  /* ignore */
                }
                return { artist: r.artist, title: r.title, folder: f, similarity: 0.85 };
              })
            };
          }
        }
      } catch {
        // Continue to next stage
      }
    }

    // 3. Stage 2: 512-dim CLAP Embedding Cosine Similarity
    try {
      const queryVec = bufferToFloat32Array(clapEmbedding);
      if (queryVec) {
        const intelRows = db
          .prepare(
            'SELECT artist, title, folder, clap_embedding FROM track_intelligence WHERE clap_embedding IS NOT NULL'
          )
          .all() as { artist: string; title: string; folder: string; clap_embedding: Buffer }[];

        const scoredNeighbors: Array<{
          artist: string;
          title: string;
          folder: string;
          similarity: number;
        }> = [];

        for (const row of intelRows) {
          const rowVec = bufferToFloat32Array(row.clap_embedding);
          if (!rowVec) continue;
          const sim = cosineSimilarity(queryVec, rowVec);
          if (sim > 0.4) {
            scoredNeighbors.push({
              artist: row.artist,
              title: row.title,
              folder: row.folder,
              similarity: Math.round(sim * 100) / 100
            });
          }
        }

        scoredNeighbors.sort((a, b) => b.similarity - a.similarity);

        if (scoredNeighbors.length > 0 && scoredNeighbors[0].similarity >= 0.7) {
          const top = scoredNeighbors[0];
          return {
            folder: top.folder,
            confidence: Math.min(99, Math.round(top.similarity * 100)),
            matchType: 'clap_embedding',
            referenceTrack: `${top.artist} - ${top.title}`,
            neighbors: scoredNeighbors.slice(0, 3)
          };
        }
      }
    } catch {
      // Continue to next stage
    }

    // 4. Stage 3: Acoustic Proximity Fallback (BPM +-3% & Key compatibility)
    if (typeof bpm === 'number' && bpm > 0) {
      try {
        const minBpm = bpm * 0.97;
        const maxBpm = bpm * 1.03;
        const acousticRows = db
          .prepare(
            'SELECT artist, title, folder, bpm, key FROM track_intelligence WHERE bpm BETWEEN ? AND ? ORDER BY created_at DESC LIMIT 20'
          )
          .all(minBpm, maxBpm) as {
          artist: string;
          title: string;
          folder: string;
          bpm: number;
          key: string | null;
        }[];

        if (acousticRows.length > 0) {
          let matchedRow = acousticRows[0];
          let hasKeyMatch = false;

          if (key) {
            const compatible = acousticRows.find((r) => r.key && isCamelotCompatible(key, r.key));
            if (compatible) {
              matchedRow = compatible;
              hasKeyMatch = true;
            }
          }

          return {
            folder: matchedRow.folder,
            confidence: hasKeyMatch ? 68 : 55,
            matchType: 'acoustic',
            referenceTrack: `${matchedRow.artist} - ${matchedRow.title}`,
            neighbors: [
              {
                artist: matchedRow.artist,
                title: matchedRow.title,
                folder: matchedRow.folder,
                similarity: hasKeyMatch ? 0.68 : 0.55
              }
            ]
          };
        }
      } catch {
        // Return empty fallback
      }
    }

    return {
      folder: null,
      confidence: 0,
      matchType: 'none',
      neighbors: []
    };
  } catch {
    return {
      folder: null,
      confidence: 0,
      matchType: 'none',
      neighbors: []
    };
  }
}

/**
 * Resolves YouTube mix neighbor context from yt_playlist_items and maps neighbors to known crates.
 */
export function findYouTubeScoutMatch(artist: string, title: string): PocketYouTubeScout {
  const cleanArt = cleanMetadataString(artist);
  const cleanTtl = cleanMetadataString(title);

  if (!cleanArt && !cleanTtl) {
    return {
      hasMatch: false,
      playlistId: null,
      playlistTitle: null,
      trackIndex: null,
      matchedFolder: null,
      neighbors: []
    };
  }

  try {
    const db = getDB();

    // 1. Locate track in yt_playlist_items
    const itemRow = db
      .prepare(
        `
        SELECT p.playlist_id, p.track_index, pl.title AS playlist_title
        FROM yt_playlist_items p LEFT JOIN yt_playlists pl ON p.playlist_id = pl.id
        WHERE LOWER(p.artist) = ? AND (LOWER(p.title) = ? OR LOWER(p.title) LIKE ?) LIMIT 1
      `
      )
      .get(cleanArt, cleanTtl, `%${cleanTtl}%`) as
      | { playlist_id: string; track_index: number; playlist_title: string | null }
      | undefined;

    if (!itemRow) {
      return {
        hasMatch: false,
        playlistId: null,
        playlistTitle: null,
        trackIndex: null,
        matchedFolder: null,
        neighbors: []
      };
    }

    const { playlist_id, track_index, playlist_title } = itemRow;

    // 2. Fetch neighbor tracks within +-5 indices
    const neighborRows = db
      .prepare(
        `
        SELECT p.track_index, p.artist, p.title FROM yt_playlist_items p
        WHERE p.playlist_id = ? AND p.track_index BETWEEN ? AND ? AND p.track_index != ?
        ORDER BY p.track_index ASC LIMIT 4
      `
      )
      .all(playlist_id, track_index - 5, track_index + 5, track_index) as {
      track_index: number;
      artist: string;
      title: string;
    }[];

    // 3. Resolve crate assignments for neighbors from rag_examples or track_intelligence
    let primaryFolder: string | null = null;
    const resolvedNeighbors: PocketYouTubeNeighbor[] = [];

    const findFolderStmt = db.prepare(
      'SELECT folders FROM rag_examples WHERE LOWER(artist) = LOWER(?) AND LOWER(title) = LOWER(?) LIMIT 1'
    );
    const findIntelFolderStmt = db.prepare(
      'SELECT folder FROM track_intelligence WHERE LOWER(artist) = LOWER(?) AND LOWER(title) = LOWER(?) LIMIT 1'
    );

    for (const nb of neighborRows) {
      let assignedFolder: string | null = null;
      try {
        const ragMatch = findFolderStmt.get(nb.artist, nb.title) as { folders: string } | undefined;
        if (ragMatch) {
          const list = JSON.parse(ragMatch.folders) as string[];
          if (list.length > 0) assignedFolder = list[0];
        }
        if (!assignedFolder) {
          const intelMatch = findIntelFolderStmt.get(nb.artist, nb.title) as
            | { folder: string }
            | undefined;
          if (intelMatch) assignedFolder = intelMatch.folder;
        }
      } catch {
        /* ignore */
      }

      if (assignedFolder && !primaryFolder) {
        primaryFolder = assignedFolder;
      }

      resolvedNeighbors.push({
        index: nb.track_index,
        artist: nb.artist,
        title: nb.title,
        folder: assignedFolder
      });
    }

    return {
      hasMatch: true,
      playlistId: playlist_id,
      playlistTitle: playlist_title || 'YouTube DJ Set',
      trackIndex: track_index,
      matchedFolder: primaryFolder,
      neighbors: resolvedNeighbors
    };
  } catch {
    return {
      hasMatch: false,
      playlistId: null,
      playlistTitle: null,
      trackIndex: null,
      matchedFolder: null,
      neighbors: []
    };
  }
}
