import {
  YouTubePlaylist,
  YouTubePlaylistItem,
  NetworkScoutResult,
  CachedPlaylist
} from '../types.js';
import {
  MOCK_MODE,
  YT_SCOUT_NETWORK_DELAY_MS,
  YT_SCOUT_MAX_PLAYLISTS,
  YT_SCOUT_NEIGHBOR_RADIUS,
  YOUTUBE_API_KEY
} from '../config.js';
import { MOCK_YOUTUBE_PLAYLISTS, MOCK_YOUTUBE_PLAYLIST_ITEMS } from '../mocks/mockData.js';
import { getDB } from './LocalDBService.js';
import { logToFile } from './LoggerService.js';

/**
 * NetworkScoutService.ts
 *
 * Searches for musical context by finding the track in YouTube mixes/playlists.
 * Returns playlists where the track appears and neighboring tracks within those mixes.
 *
 * Core concept — Playlist Memory Effect:
 * When a track is found in a playlist, the ENTIRE playlist is cached in local SQLite cratemind.db.
 * All other tracks from that mix will resolve instantly on subsequent lookups,
 * eliminating redundant network requests. This is critical for surviving within
 * YouTube Data API v3 free tier quota (10,000 units/day, ~100 searches/day).
 */

// ── In-memory Playlist Cache ────────────────────────────────────────────────

const playlistCache = new Map<string, CachedPlaylist>();
const trackIndex = new Map<string, Set<string>>();

function cleanMetadataString(s: string): string {
  return s
    .replace(
      /\s*[[(](?:original|extended|radio|dub|club|official|lyric)?\s*(?:mix|edit|version|video|audio|track|remix)?[\])]/gi,
      ''
    ) // strips (Original Mix), [Extended Mix] etc
    .replace(/\s*\[[^\]]+\]/gi, '') // strips label names like [Truesoul]
    .replace(/\s*\([^)]+\)/gi, '') // strips remaining brackets
    .replace(/\s*\|.+$/g, '') // strips label suffixes like " | Truesoul" or " | Drumcode"
    .trim();
}

function normalizeKey(artist: string, title: string): string {
  const cleanArtist = cleanMetadataString(artist);
  const cleanTitle = cleanMetadataString(title);
  return `${cleanArtist.toLowerCase()}|${cleanTitle.toLowerCase()}`;
}

// ── Cache Operations ────────────────────────────────────────────────────────

/**
 * Warms the cache with an entire playlist and indexes all its tracks in-memory + SQLite.
 */
function cachePlaylist(playlist: YouTubePlaylist, items: YouTubePlaylistItem[]): void {
  if (playlistCache.has(playlist.id)) return;

  playlistCache.set(playlist.id, {
    playlist,
    items,
    cachedAt: Date.now()
  });

  // Index every track in this playlist for instant reverse lookups in memory
  for (const item of items) {
    const key = normalizeKey(item.artist, item.title);
    if (!trackIndex.has(key)) {
      trackIndex.set(key, new Set());
    }
    trackIndex.get(key)!.add(playlist.id);
  }

  // Write through to SQLite cratemind.db
  const db = getDB();
  try {
    db.prepare(
      `
      INSERT OR REPLACE INTO yt_playlists (id, title, description, channel_name, cached_at)
      VALUES (?, ?, ?, ?, ?)
    `
    ).run(playlist.id, playlist.title, playlist.description, playlist.channelName, Date.now());

    const insertItem = db.prepare(`
      INSERT OR REPLACE INTO yt_playlist_items (playlist_id, track_index, artist, title)
      VALUES (?, ?, ?, ?)
    `);

    const transaction = db.transaction((playlistItems: YouTubePlaylistItem[]) => {
      for (const item of playlistItems) {
        insertItem.run(
          item.playlistId,
          item.index,
          cleanMetadataString(item.artist),
          cleanMetadataString(item.title)
        );
      }
    });

    transaction(items);
  } catch {
    // Ignore SQLite write errors
  }
}

/**
 * Lazy loads a playlist from cratemind.db into the in-memory cache singleton.
 */
function loadPlaylistFromDB(playlistId: string): void {
  if (playlistCache.has(playlistId)) return;

  const db = getDB();
  try {
    const plRow = db
      .prepare('SELECT id, title, description, channel_name FROM yt_playlists WHERE id = ?')
      .get(playlistId) as
      | {
          id: string;
          title: string;
          description: string | null;
          channel_name: string | null;
        }
      | undefined;

    if (!plRow) return;

    const itemRows = db
      .prepare(
        'SELECT playlist_id, track_index, artist, title FROM yt_playlist_items WHERE playlist_id = ? ORDER BY track_index ASC'
      )
      .all(playlistId) as {
      playlist_id: string;
      track_index: number;
      artist: string;
      title: string;
    }[];

    const playlist: YouTubePlaylist = {
      id: plRow.id,
      title: plRow.title,
      description: plRow.description || '',
      channelName: plRow.channel_name || ''
    };

    const items: YouTubePlaylistItem[] = itemRows.map((r) => ({
      playlistId: r.playlist_id,
      index: r.track_index,
      artist: r.artist,
      title: r.title
    }));

    // Warm memory cache
    playlistCache.set(playlist.id, {
      playlist,
      items,
      cachedAt: Date.now()
    });

    // Populate trackIndex
    for (const item of items) {
      const key = normalizeKey(item.artist, item.title);
      if (!trackIndex.has(key)) {
        trackIndex.set(key, new Set());
      }
      trackIndex.get(key)!.add(playlist.id);
    }
  } catch {
    // Ignore db load errors
  }
}

/**
 * Extracts neighbor tracks within ±radius positions around the target track.
 */
function extractNeighbors(
  items: YouTubePlaylistItem[],
  targetIndex: number,
  radius: number
): YouTubePlaylistItem[] {
  const start = Math.max(0, targetIndex - radius);
  const end = Math.min(items.length - 1, targetIndex + radius);
  return items.filter((_, i) => i >= start && i <= end && i !== targetIndex);
}

// ── Cache Result Builder ────────────────────────────────────────────────────

function buildResultFromCache(playlistIds: Set<string>, trackKey: string): NetworkScoutResult {
  const playlists: YouTubePlaylist[] = [];
  const allNeighbors: YouTubePlaylistItem[] = [];

  for (const plId of playlistIds) {
    const cached = playlistCache.get(plId);
    if (!cached) continue;

    playlists.push(cached.playlist);

    // Find the track's index in this playlist
    const trackIdx = cached.items.findIndex(
      (item) => normalizeKey(item.artist, item.title) === trackKey
    );
    if (trackIdx !== -1) {
      const neighbors = extractNeighbors(cached.items, trackIdx, YT_SCOUT_NEIGHBOR_RADIUS);
      allNeighbors.push(...neighbors);
    }
  }

  // Deduplicate neighbors
  const seen = new Set<string>();
  seen.add(trackKey);
  const uniqueNeighbors = allNeighbors.filter((n) => {
    const key = normalizeKey(n.artist, n.title);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    playlists: playlists.slice(0, YT_SCOUT_MAX_PLAYLISTS),
    neighbors: uniqueNeighbors,
    source: 'cache'
  };
}

// ── Mock Implementation ─────────────────────────────────────────────────────

async function getMockContext(artist: string, title: string): Promise<NetworkScoutResult> {
  const trackKey = normalizeKey(artist, title);

  // 1. Check in-memory cache
  let cachedPlaylistIds = trackIndex.get(trackKey);

  // 2. If memory cache miss, check SQLite database
  if (!cachedPlaylistIds || cachedPlaylistIds.size === 0) {
    const db = getDB();
    try {
      const cleanArt = cleanMetadataString(artist).toLowerCase();
      const cleanTtl = cleanMetadataString(title).toLowerCase();
      const rows = db
        .prepare(
          'SELECT DISTINCT playlist_id FROM yt_playlist_items WHERE LOWER(artist) = ? AND LOWER(title) = ?'
        )
        .all(cleanArt, cleanTtl) as { playlist_id: string }[];
      if (rows.length > 0) {
        for (const row of rows) {
          loadPlaylistFromDB(row.playlist_id);
        }
        cachedPlaylistIds = trackIndex.get(trackKey);
      }
    } catch {
      // Ignore SQLite read errors
    }
  }

  // 3. Return cache hit if found
  if (cachedPlaylistIds && cachedPlaylistIds.size > 0) {
    return buildResultFromCache(cachedPlaylistIds, trackKey);
  }

  // 4. Simulate network latency
  await new Promise((resolve) => setTimeout(resolve, YT_SCOUT_NETWORK_DELAY_MS));

  // 5. Search mock playlist corpus
  const matchingItems = MOCK_YOUTUBE_PLAYLIST_ITEMS.filter(
    (item) => normalizeKey(item.artist, item.title) === trackKey
  );

  if (matchingItems.length === 0) {
    return { playlists: [], neighbors: [], source: 'network' };
  }

  // 6. Warm database and in-memory caches
  const resultPlaylists: YouTubePlaylist[] = [];
  const allNeighbors: YouTubePlaylistItem[] = [];

  for (const matchedItem of matchingItems) {
    const playlist = MOCK_YOUTUBE_PLAYLISTS.find((p) => p.id === matchedItem.playlistId);
    if (!playlist) continue;

    const playlistItems = MOCK_YOUTUBE_PLAYLIST_ITEMS.filter(
      (item) => item.playlistId === playlist.id
    ).sort((a, b) => a.index - b.index);

    cachePlaylist(playlist, playlistItems);
    resultPlaylists.push(playlist);

    const neighbors = extractNeighbors(playlistItems, matchedItem.index, YT_SCOUT_NEIGHBOR_RADIUS);
    allNeighbors.push(...neighbors);
  }

  const seen = new Set<string>();
  seen.add(trackKey);
  const uniqueNeighbors = allNeighbors.filter((n) => {
    const key = normalizeKey(n.artist, n.title);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    playlists: resultPlaylists.slice(0, YT_SCOUT_MAX_PLAYLISTS),
    neighbors: uniqueNeighbors,
    source: 'network'
  };
}

// ── Real YouTube API Search & Description Regex Parser ───────────────────────────

/**
 * Parses full video descriptions using specialized regexes to reconstruct tracklists.
 */
function parseTracklist(description: string, playlistId: string): YouTubePlaylistItem[] {
  const lines = description.split('\n');
  const items: YouTubePlaylistItem[] = [];
  let index = 0;

  // Regex 1: captures timestamps e.g. "01:23 Lane 8 - Keep On" or "12.34 Ben Böhmer - Beyond Beliefs"
  const timestampRegex = /(\d{1,2}[:.]\d{2})\s+([^-\n]+)\s*-\s*([^\n]+)/;
  // Regex 2: captures structured lists e.g. "1. Lane 8 - Keep On" or "Lane 8 - Keep On"
  const listRegex = /^(?:\d+[\s.-]+)?([^-\n\d]+[^-\n]*)\s*-\s*([^\n]+)$/;

  for (const line of lines) {
    const cleanLine = line.trim();
    if (!cleanLine) continue;

    let match = cleanLine.match(timestampRegex);
    if (match) {
      const artist = match[2].trim();
      const title = match[3].trim();
      if (artist && title) {
        items.push({ playlistId, index: index++, artist, title });
      }
      continue;
    }

    match = cleanLine.match(listRegex);
    if (match) {
      const artist = match[1].trim();
      const title = match[2].trim();
      if (artist && title) {
        items.push({ playlistId, index: index++, artist, title });
      }
    }
  }
  return items;
}

async function getRealYouTubeContext(artist: string, title: string): Promise<NetworkScoutResult> {
  const trackKey = normalizeKey(artist, title);

  // 1. Check memory cache and SQLite first
  let cachedPlaylistIds = trackIndex.get(trackKey);
  if (!cachedPlaylistIds || cachedPlaylistIds.size === 0) {
    const db = getDB();
    try {
      const cleanArt = cleanMetadataString(artist).toLowerCase();
      const cleanTtl = cleanMetadataString(title).toLowerCase();
      const rows = db
        .prepare(
          'SELECT DISTINCT playlist_id FROM yt_playlist_items WHERE LOWER(artist) = ? AND LOWER(title) = ?'
        )
        .all(cleanArt, cleanTtl) as { playlist_id: string }[];
      if (rows.length > 0) {
        for (const row of rows) {
          loadPlaylistFromDB(row.playlist_id);
        }
        cachedPlaylistIds = trackIndex.get(trackKey);
      }
    } catch {
      // Ignore read errors
    }
  }

  if (cachedPlaylistIds && cachedPlaylistIds.size > 0) {
    const result = buildResultFromCache(cachedPlaylistIds, trackKey);
    let logMsg = `\n================== YT SCOUT LOCAL CACHE HIT ==================\n`;
    logMsg += `Target Track: [${artist} - ${title}]\n`;
    logMsg += `Loaded ${result.playlists.length} playlists from SQLite database:\n`;
    for (const pl of result.playlists) {
      logMsg += `  • "${pl.title}" (https://youtu.be/${pl.id}) by "${pl.channelName}"\n`;
      // Find track's position in this playlist
      const cached = playlistCache.get(pl.id);
      if (cached) {
        const itemIdx = cached.items.findIndex(
          (item) => normalizeKey(item.artist, item.title) === trackKey
        );
        logMsg += `    Track position: ${itemIdx !== -1 ? `#${itemIdx + 1}` : 'Unknown'}\n`;
        // Log nearby neighbor tracks
        const plNeighbors = result.neighbors.filter((n) =>
          cached.items.some(
            (item) =>
              normalizeKey(item.artist, item.title) === normalizeKey(n.artist, n.title) &&
              item.playlistId === pl.id
          )
        );
        if (plNeighbors.length > 0) {
          logMsg += `    Neighbors: ${plNeighbors.map((n) => `${n.artist} - ${n.title}`).join(' | ')}\n`;
        }
      }
    }
    logMsg += `=============================================================`;
    logToFile('YT_SCOUT_CACHE', logMsg);
    return result;
  }

  // 2. Quit if no API key provided
  if (!YOUTUBE_API_KEY) {
    return { playlists: [], neighbors: [], source: 'network' };
  }

  try {
    // 3. Search videos AND playlists separately on YouTube
    // For video (mix) search: plain query "Artist Title" to find DJ sets and mixes
    const videoQuery = encodeURIComponent(`${artist} ${title}`);
    // For playlist search: exact phrase match '"Artist - Title"' to find playlists containing the track
    const playlistQuery = encodeURIComponent(`"${artist} - ${title}"`);

    const videoSearchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${videoQuery}&type=video&maxResults=5&key=${YOUTUBE_API_KEY}`;
    const playlistSearchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${playlistQuery}&type=playlist&maxResults=10&key=${YOUTUBE_API_KEY}`;

    const [videoRes, playlistRes] = await Promise.all([
      globalThis.fetch(videoSearchUrl),
      globalThis.fetch(playlistSearchUrl)
    ]);

    const videoIds: string[] = [];
    const ytPlaylists: { id: string; title: string; description: string; channelName: string }[] =
      [];
    let scoutError: string | undefined = undefined;

    interface YTErrorResponse {
      error?: {
        message?: string;
      };
    }

    if (videoRes.ok) {
      const videoData = (await videoRes.json()) as { items?: { id?: { videoId?: string } }[] };
      const videoItems = videoData.items || [];
      for (const item of videoItems) {
        if (item.id?.videoId) {
          videoIds.push(item.id.videoId);
        }
      }
    } else {
      let errText = `Status ${videoRes.status}`;
      try {
        const errorJson = (await videoRes.json()) as YTErrorResponse;
        if (errorJson?.error?.message) {
          errText = errorJson.error.message;
        }
      } catch (e) {
        logToFile('YT_SCOUT_ERROR', `Error parsing video search failure response: ${String(e)}`);
      }
      logToFile('YT_SCOUT_ERROR', `Video search request failed: ${errText}`);
      scoutError = `Video search: ${errText}`;
    }

    if (playlistRes.ok) {
      const playlistData = (await playlistRes.json()) as {
        items?: {
          id?: { playlistId?: string };
          snippet?: { title?: string; description?: string; channelTitle?: string };
        }[];
      };
      const playlistItems = playlistData.items || [];
      for (const item of playlistItems) {
        if (item.id?.playlistId) {
          ytPlaylists.push({
            id: item.id.playlistId,
            title: item.snippet?.title || '',
            description: item.snippet?.description || '',
            channelName: item.snippet?.channelTitle || ''
          });
        }
      }
    } else {
      let errText = `Status ${playlistRes.status}`;
      try {
        const errorJson = (await playlistRes.json()) as YTErrorResponse;
        if (errorJson?.error?.message) {
          errText = errorJson.error.message;
        }
      } catch (e) {
        logToFile('YT_SCOUT_ERROR', `Error parsing playlist search failure response: ${String(e)}`);
      }
      logToFile('YT_SCOUT_ERROR', `Playlist search request failed: ${errText}`);
      if (!scoutError) {
        scoutError = `Playlist search: ${errText}`;
      } else {
        scoutError += ` | Playlist search: ${errText}`;
      }
    }

    if (videoIds.length === 0 && ytPlaylists.length === 0) {
      logToFile('YT_SCOUT_MISS', `No videos or playlists returned for query: "${artist} ${title}"`);
      return { playlists: [], neighbors: [], source: 'network', error: scoutError };
    }

    const videos: {
      id: string;
      snippet?: {
        title?: string;
        description?: string;
        channelTitle?: string;
      };
    }[] = [];
    if (videoIds.length > 0) {
      // 4a. Fetch full descriptions to retrieve tracklists for videos
      const detailsUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoIds.join(',')}&key=${YOUTUBE_API_KEY}`;
      const detailsRes = await globalThis.fetch(detailsUrl);
      if (detailsRes.ok) {
        const detailsData = await detailsRes.json();
        if (detailsData.items) videos.push(...detailsData.items);
      } else {
        let errText = `Status ${detailsRes.status}`;
        try {
          const errorJson = (await detailsRes.json()) as YTErrorResponse;
          if (errorJson?.error?.message) {
            errText = errorJson.error.message;
          }
        } catch (e) {
          logToFile('YT_SCOUT_ERROR', `Error parsing video details failure response: ${String(e)}`);
        }
        logToFile('YT_SCOUT_ERROR', `Video details request failed: ${errText}`);
        if (!scoutError) {
          scoutError = `Video details: ${errText}`;
        } else {
          scoutError += ` | Video details: ${errText}`;
        }
      }
    }

    const resultPlaylists: YouTubePlaylist[] = [];
    const allNeighbors: YouTubePlaylistItem[] = [];

    // Beautiful detailed search log block
    let logMsg = `\n================== YT SCOUT NETWORK SEARCH ==================\n`;
    logMsg += `Target Track: [${artist} - ${title}]\n`;
    logMsg += `Search Query: "${artist} ${title}"\n`;
    logMsg += `Found ${videos.length} videos and ${ytPlaylists.length} playlists.\n\n`;

    // 5. Parse descriptions and warm caches
    // 5a. Process Mix Videos
    for (const video of videos) {
      const id = video.id;
      const vTitle = video.snippet?.title || '';
      const description = video.snippet?.description || '';
      const channelName = video.snippet?.channelTitle || '';

      const parsedItems = parseTracklist(description, id);

      logMsg += `Video Title:   "${vTitle}"\n`;
      logMsg += `Video Link:    https://youtu.be/${id}\n`;
      logMsg += `Channel Name:  "${channelName}"\n`;
      logMsg += `Parsed Tracks: ${parsedItems.length}\n`;

      if (parsedItems.length === 0) {
        logMsg += `Status:        ❌ No tracklist parsed from description.\n`;
        logMsg += `-------------------------------------------------------------\n`;
        continue;
      }

      const playlist: YouTubePlaylist = {
        id,
        title: vTitle,
        description,
        channelName
      };

      // Find matched index in parsed items to grab neighbors
      const matchedIdx = parsedItems.findIndex(
        (item) => normalizeKey(item.artist, item.title) === trackKey
      );

      if (matchedIdx !== -1) {
        cachePlaylist(playlist, parsedItems);
        resultPlaylists.push(playlist);

        logMsg += `Status:        ✅ Target track FOUND at index #${matchedIdx + 1}\n`;
        const neighbors = extractNeighbors(parsedItems, matchedIdx, YT_SCOUT_NEIGHBOR_RADIUS);
        allNeighbors.push(...neighbors);

        logMsg += `Parsed Tracklist Snippet around target:\n`;
        parsedItems.forEach((item, idx) => {
          const isTarget = idx === matchedIdx;
          const isNeighbor = Math.abs(idx - matchedIdx) <= YT_SCOUT_NEIGHBOR_RADIUS && !isTarget;
          if (isTarget || isNeighbor) {
            logMsg += `  ${isTarget ? '👉' : '  '} [#${item.index + 1}] ${item.artist} - ${item.title}\n`;
          }
        });
      } else {
        logMsg += `Status:        ❓ Target track not directly listed in parsed description.\n`;
      }
      logMsg += `-------------------------------------------------------------\n`;
    }

    // 5b. Process Real Playlists
    for (const pl of ytPlaylists) {
      const listUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${pl.id}&key=${YOUTUBE_API_KEY}`;
      const listRes = await globalThis.fetch(listUrl);
      if (!listRes.ok) {
        let errText = `Status ${listRes.status}`;
        try {
          const errorJson = (await listRes.json()) as YTErrorResponse;
          if (errorJson?.error?.message) {
            errText = errorJson.error.message;
          }
        } catch (e) {
          logToFile(
            'YT_SCOUT_ERROR',
            `Error parsing playlist items failure response: ${String(e)}`
          );
        }
        logToFile(
          'YT_SCOUT_ERROR',
          `Playlist items fetch failed for playlist ${pl.id}: ${errText}`
        );
        if (!scoutError) {
          scoutError = `Playlist items (${pl.id}): ${errText}`;
        } else {
          scoutError += ` | Playlist items (${pl.id}): ${errText}`;
        }
        continue;
      }
      const listData = await listRes.json();
      const itemsData = listData.items || [];

      if (itemsData.length === 0) continue;

      const parsedItems: YouTubePlaylistItem[] = [];
      let index = 0;

      const listRegex = /^([^-\n\d]+[^-\n]*)\s*-\s*([^\n]+)$/;

      for (const item of itemsData) {
        const iTitle = item.snippet?.title || '';
        const iChannel = item.snippet?.videoOwnerChannelTitle || '';

        // If it's a private/deleted video, title might be "Private video"
        if (iTitle === 'Private video' || iTitle === 'Deleted video') continue;

        let iArtist = '';
        let iTrackTitle = '';

        const match = iTitle.match(listRegex);
        if (match) {
          iArtist = match[1].trim();
          iTrackTitle = match[2].trim();
        } else {
          iArtist = iChannel.replace(/ - Topic$/i, '').trim() || 'Unknown';
          iTrackTitle = iTitle.trim();
        }

        parsedItems.push({
          playlistId: pl.id,
          index: index++,
          artist: iArtist,
          title: iTrackTitle
        });
      }

      // Heuristic to ignore EP/Album/Single playlists (low artist diversity or album keywords in title)
      const artists = parsedItems.map((item) => item.artist.toLowerCase());
      const artistCounts: Record<string, number> = {};
      for (const art of artists) {
        artistCounts[art] = (artistCounts[art] ?? 0) + 1;
      }
      const maxArtistCount = Math.max(...Object.values(artistCounts));
      const dominantArtistRatio = parsedItems.length > 0 ? maxArtistCount / parsedItems.length : 0;

      const isEPOrAlbum =
        /\b(?:EP|LP|Album|Single|Release)\b/i.test(pl.title) ||
        (parsedItems.length >= 3 && dominantArtistRatio > 0.65);

      if (isEPOrAlbum) {
        logMsg += `Playlist Title:"${pl.title}"\n`;
        logMsg += `Playlist Link: https://youtube.com/playlist?list=${pl.id}\n`;
        logMsg += `Channel Name:  "${pl.channelName}"\n`;
        logMsg += `Status:        ❌ Skipped EP/Album/Single release playlist (Dominant artist: ${Math.round(dominantArtistRatio * 100)}%).\n`;
        logMsg += `-------------------------------------------------------------\n`;
        continue;
      }

      logMsg += `Playlist Title:"${pl.title}"\n`;
      logMsg += `Playlist Link: https://youtube.com/playlist?list=${pl.id}\n`;
      logMsg += `Channel Name:  "${pl.channelName}"\n`;
      logMsg += `Fetched Items: ${parsedItems.length}\n`;

      const matchedIdx = parsedItems.findIndex(
        (item) => normalizeKey(item.artist, item.title) === trackKey
      );

      if (matchedIdx !== -1) {
        const playlist: YouTubePlaylist = {
          id: pl.id,
          title: pl.title,
          description: pl.description,
          channelName: pl.channelName
        };
        cachePlaylist(playlist, parsedItems);
        resultPlaylists.push(playlist);

        logMsg += `Status:        ✅ Target track FOUND at index #${matchedIdx + 1}\n`;
        const neighbors = extractNeighbors(parsedItems, matchedIdx, YT_SCOUT_NEIGHBOR_RADIUS);
        allNeighbors.push(...neighbors);

        logMsg += `Parsed Playlist Snippet around target:\n`;
        parsedItems.forEach((item, idx) => {
          const isTarget = idx === matchedIdx;
          const isNeighbor = Math.abs(idx - matchedIdx) <= YT_SCOUT_NEIGHBOR_RADIUS && !isTarget;
          if (isTarget || isNeighbor) {
            logMsg += `  ${isTarget ? '👉' : '  '} [#${item.index + 1}] ${item.artist} - ${item.title}\n`;
          }
        });
      } else {
        logMsg += `Status:        ❓ Target track not directly listed in fetched items.\n`;
      }
      logMsg += `-------------------------------------------------------------\n`;
    }

    const seen = new Set<string>();
    seen.add(trackKey);
    const uniqueNeighbors = allNeighbors.filter((n) => {
      const key = normalizeKey(n.artist, n.title);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    logMsg += `Summary:\n`;
    logMsg += `  Matched Playlists: ${resultPlaylists.length}\n`;
    logMsg += `  Unique Neighbor Tracks Discovered: ${uniqueNeighbors.length}\n`;
    if (uniqueNeighbors.length > 0) {
      logMsg += `  Neighbors: ${uniqueNeighbors.map((n) => `${n.artist} - ${n.title}`).join(' | ')}\n`;
    }
    logMsg += `=============================================================`;
    logToFile('YT_SCOUT_NETWORK', logMsg);

    return {
      playlists: resultPlaylists.slice(0, YT_SCOUT_MAX_PLAYLISTS),
      neighbors: uniqueNeighbors,
      source: 'network',
      error: scoutError
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logToFile('YT_SCOUT_ERROR', `Fatal error during YouTube search: ${errMsg}`);
    return { playlists: [], neighbors: [], source: 'network', error: errMsg };
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Searches for the track in YouTube mixes/playlists.
 * Returns playlists where the track appears and neighboring tracks.
 *
 * Playlist Memory Effect: when a track is found in a playlist,
 * the ENTIRE playlist is cached. All other tracks from that mix
 * will resolve instantly on subsequent lookups.
 */
export async function getTrackContext(artist: string, title: string): Promise<NetworkScoutResult> {
  if (MOCK_MODE) {
    return getMockContext(artist, title);
  }
  return getRealYouTubeContext(artist, title);
}

/**
 * Formats a NetworkScoutResult into a human-readable string block
 * for injection into the Gemini LLM prompt as supplementary context.
 */
export function formatForPrompt(result: NetworkScoutResult): string {
  if (result.playlists.length === 0) return '';

  const sections: string[] = [];
  sections.push('=== YouTube Playlist Context (use as supplementary vibe signal) ===');

  for (const playlist of result.playlists) {
    sections.push(`Track found in YouTube mix: "${playlist.title}" (${playlist.channelName})`);

    // Collect neighbors that belong to this playlist
    const playlistNeighbors = result.neighbors.filter((n) => {
      const cached = playlistCache.get(playlist.id);
      return cached?.items.some(
        (item) =>
          normalizeKey(item.artist, item.title) === normalizeKey(n.artist, n.title) &&
          item.playlistId === playlist.id
      );
    });

    if (playlistNeighbors.length > 0) {
      const neighborList = playlistNeighbors.map((n) => `${n.artist} - ${n.title}`).join(' | ');
      sections.push(`Neighboring tracks: ${neighborList}`);
    }
  }

  sections.push('=====================================================================');
  return sections.join('\n');
}

/** Returns current playlist cache statistics for TUI display */
export function getCacheStats(): { cachedPlaylists: number; cachedTracks: number } {
  return {
    cachedPlaylists: playlistCache.size,
    cachedTracks: trackIndex.size
  };
}

/** Clears the in-memory playlist cache */
export function clearCache(): void {
  playlistCache.clear();
  trackIndex.clear();
}
