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
  YT_SCOUT_NEIGHBOR_RADIUS
} from '../config.js';
import { MOCK_YOUTUBE_PLAYLISTS, MOCK_YOUTUBE_PLAYLIST_ITEMS } from '../mocks/mockData.js';

/**
 * NetworkScoutService.ts
 *
 * Searches for musical context by finding the track in YouTube mixes/playlists.
 * Returns playlists where the track appears and neighboring tracks within those mixes.
 *
 * Core concept — Playlist Memory Effect:
 * When a track is found in a playlist, the ENTIRE playlist is cached in memory.
 * All other tracks from that mix will resolve instantly on subsequent lookups,
 * eliminating redundant network requests. This is critical for surviving within
 * YouTube Data API v3 free tier quota (10,000 units/day, ~100 searches/day).
 *
 * Architecture:
 * - MOCK_MODE: searches against MOCK_YOUTUBE_PLAYLISTS with simulated network delay
 * - Real mode: stub for future YouTube Data API v3 integration
 */

// ── In-memory Playlist Cache ────────────────────────────────────────────────

/** Stores full playlist data keyed by playlist ID */
const playlistCache = new Map<string, CachedPlaylist>();

/** Reverse index: normalized "artist|title" → Set of playlist IDs for instant lookups */
const trackIndex = new Map<string, Set<string>>();

function normalizeKey(artist: string, title: string): string {
  return `${artist.trim().toLowerCase()}|${title.trim().toLowerCase()}`;
}

// ── Cache Operations ────────────────────────────────────────────────────────

/**
 * Warms the cache with an entire playlist and indexes all its tracks.
 * This is the core of the Playlist Memory Effect — one network hit
 * pre-populates lookups for every track in the playlist.
 */
function cachePlaylist(playlist: YouTubePlaylist, items: YouTubePlaylistItem[]): void {
  if (playlistCache.has(playlist.id)) return;

  playlistCache.set(playlist.id, {
    playlist,
    items,
    cachedAt: Date.now()
  });

  // Index every track in this playlist for instant reverse lookups
  for (const item of items) {
    const key = normalizeKey(item.artist, item.title);
    if (!trackIndex.has(key)) {
      trackIndex.set(key, new Set());
    }
    trackIndex.get(key)!.add(playlist.id);
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

// ── Mock Implementation ─────────────────────────────────────────────────────

async function getMockContext(artist: string, title: string): Promise<NetworkScoutResult> {
  const trackKey = normalizeKey(artist, title);

  // 1. Check if we already have this track cached (instant, no network)
  const cachedPlaylistIds = trackIndex.get(trackKey);
  if (cachedPlaylistIds && cachedPlaylistIds.size > 0) {
    return buildResultFromCache(cachedPlaylistIds, trackKey);
  }

  // 2. Simulate network delay (YouTube API call)
  await new Promise((resolve) => setTimeout(resolve, YT_SCOUT_NETWORK_DELAY_MS));

  // 3. Search through mock playlists
  const matchingItems = MOCK_YOUTUBE_PLAYLIST_ITEMS.filter(
    (item) => normalizeKey(item.artist, item.title) === trackKey
  );

  if (matchingItems.length === 0) {
    return { playlists: [], neighbors: [], source: 'network' };
  }

  // 4. Playlist Memory Effect: cache the ENTIRE playlist for each match
  const resultPlaylists: YouTubePlaylist[] = [];
  const allNeighbors: YouTubePlaylistItem[] = [];

  for (const matchedItem of matchingItems) {
    const playlist = MOCK_YOUTUBE_PLAYLISTS.find((p) => p.id === matchedItem.playlistId);
    if (!playlist) continue;

    // Get all items for this playlist
    const playlistItems = MOCK_YOUTUBE_PLAYLIST_ITEMS.filter(
      (item) => item.playlistId === playlist.id
    ).sort((a, b) => a.index - b.index);

    // Cache the entire playlist (warms all tracks in it)
    cachePlaylist(playlist, playlistItems);

    resultPlaylists.push(playlist);

    // Extract neighbors around the matched track
    const neighbors = extractNeighbors(playlistItems, matchedItem.index, YT_SCOUT_NEIGHBOR_RADIUS);
    allNeighbors.push(...neighbors);
  }

  // Limit playlists returned
  const limitedPlaylists = resultPlaylists.slice(0, YT_SCOUT_MAX_PLAYLISTS);

  // Deduplicate neighbors by artist|title
  const seen = new Set<string>();
  seen.add(trackKey); // exclude the track itself
  const uniqueNeighbors = allNeighbors.filter((n) => {
    const key = normalizeKey(n.artist, n.title);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    playlists: limitedPlaylists,
    neighbors: uniqueNeighbors,
    source: 'network'
  };
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

// ── Real YouTube API (Future) ───────────────────────────────────────────────

async function getRealYouTubeContext(_artist: string, _title: string): Promise<NetworkScoutResult> {
  // TODO: Implement YouTube Data API v3 search
  // 1. Search: GET /youtube/v3/search?q={artist}+{title}+mix&type=video (100 units)
  // 2. Parse video descriptions for tracklists
  // 3. Cache entire playlist via cachePlaylist()
  return { playlists: [], neighbors: [], source: 'network' };
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
