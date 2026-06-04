import { createHash } from 'crypto';
import { LLMResponse } from '../types.js';
import { DAILY_REQUEST_LIMIT } from '../config.js';
import { getDB, getSetting, setSetting } from './LocalDBService.js';

interface StatsStore {
  lastDate: string;
  dailyRequestsUsed: number;
  totalCacheHits: number;
}

interface CacheStore {
  [key: string]: {
    artist: string;
    title: string;
    response: LLMResponse;
    ts: number;
  };
}

/**
 * CacheService.ts
 *
 * Manages persistent LLM response caching and daily request limits using cratemind.db local SQLite.
 *
 * Key optimization (v4.6):
 * - `_cacheStore` and `_statsStore` are module-level singletons.
 *   All read operations return the in-memory copy — zero disk I/O per track.
 *   Write operations use a write-through pattern: update memory, then flush to SQLite.
 */

// ── In-memory Singletons ────────────────────────────────────────────────────

let _cacheStore: CacheStore | null = null;
let _statsStore: StatsStore | null = null;

function getTodayString(): string {
  return new Date().toISOString().split('T')[0];
}

// ── Stats Store ─────────────────────────────────────────────────────────────

function readStats(): StatsStore {
  if (_statsStore) {
    // Reset counter if day has rolled over
    const today = getTodayString();
    if (_statsStore.lastDate !== today) {
      _statsStore.lastDate = today;
      _statsStore.dailyRequestsUsed = 0;
    }
    return _statsStore;
  }

  const today = getTodayString();
  const db = getDB();
  let dailyRequestsUsed = 0;
  let totalCacheHits = 0;

  try {
    const row = db.prepare('SELECT count FROM api_stats WHERE date = ?').get(today) as
      | { count: number }
      | undefined;
    if (row) {
      dailyRequestsUsed = row.count;
    }
    const hitsVal = getSetting('totalCacheHits');
    if (hitsVal) {
      totalCacheHits = parseInt(hitsVal, 10);
    }
  } catch {
    // Fallback to defaults
  }

  _statsStore = {
    lastDate: today,
    dailyRequestsUsed,
    totalCacheHits
  };
  return _statsStore;
}

function writeStats(stats: StatsStore): void {
  _statsStore = stats;
  const db = getDB();
  try {
    db.prepare('INSERT OR REPLACE INTO api_stats (date, count) VALUES (?, ?)').run(
      stats.lastDate,
      stats.dailyRequestsUsed
    );
    setSetting('totalCacheHits', stats.totalCacheHits.toString());
  } catch {
    // Ignore write errors
  }
}

// ── Cache Store ─────────────────────────────────────────────────────────────

function readCache(): CacheStore {
  if (_cacheStore) return _cacheStore;

  const db = getDB();
  const cache: CacheStore = {};
  try {
    const rows = db
      .prepare(
        'SELECT context_hash, artist, title, folders, reasoning, confidence, ts FROM llm_cache'
      )
      .all() as {
      context_hash: string;
      artist: string;
      title: string;
      folders: string;
      reasoning: string;
      confidence: number;
      ts: number;
    }[];
    for (const r of rows) {
      cache[r.context_hash] = {
        artist: r.artist,
        title: r.title,
        response: {
          folders: JSON.parse(r.folders),
          reasoning: r.reasoning,
          confidence: r.confidence
        },
        ts: r.ts
      };
    }
    _cacheStore = cache;
    return _cacheStore;
  } catch {
    _cacheStore = {};
    return _cacheStore;
  }
}

function writeCacheItem(
  contextHash: string,
  artist: string,
  title: string,
  response: LLMResponse
): void {
  const db = getDB();
  try {
    db.prepare(
      `
      INSERT OR REPLACE INTO llm_cache (context_hash, artist, title, folders, reasoning, confidence, ts)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      contextHash,
      artist,
      title,
      JSON.stringify(response.folders),
      response.reasoning,
      response.confidence,
      Date.now()
    );
  } catch {
    // Ignore write errors
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Generates a SHA-256 hash of a combination of artist and title.
 * Normalizes strings to prevent minor whitespace or case differences from missing the cache.
 */
export function generateContextHash(
  artist: string,
  title: string,
  ragContext: string,
  personalHints: string,
  networkContext = '',
  physicalContext = '',
  spotifyContext = '',
  vectorContext = ''
): string {
  const normalizedArtist = artist.trim().toLowerCase();
  const normalizedTitle = title.trim().toLowerCase();
  const ragHash = createHash('sha256').update(ragContext).digest('hex');
  const hintsHash = createHash('sha256').update(personalHints).digest('hex');
  const networkHash = createHash('sha256').update(networkContext).digest('hex');
  const physicalHash = createHash('sha256').update(physicalContext).digest('hex');
  const spotifyHash = createHash('sha256').update(spotifyContext).digest('hex');
  const vectorHash = createHash('sha256').update(vectorContext).digest('hex');
  const payload = `${normalizedArtist}|${normalizedTitle}|${ragHash}|${hintsHash}|${networkHash}|${physicalHash}|${spotifyHash}|${vectorHash}`;
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Checks if a track response is cached under the specific context hash.
 * Returns the cached LLMResponse or null. Cache lookup is O(1) in-memory.
 */
export function getTrackCache(
  artist: string,
  title: string,
  contextHash: string
): LLMResponse | null {
  const cache = readCache();

  // 1. First attempt: Exact match by context hash
  if (cache[contextHash]) {
    incrementCacheHits();
    return cache[contextHash].response;
  }

  // 2. Second attempt: Fallback match by artist & title within the last 24 hours (session approach)
  const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
  const normalizedArtist = artist.trim().toLowerCase();
  const normalizedTitle = title.trim().toLowerCase();

  const entries = Object.entries(cache);
  const matches = entries
    .filter(([_, entry]) => {
      return (
        entry.artist.trim().toLowerCase() === normalizedArtist &&
        entry.title.trim().toLowerCase() === normalizedTitle &&
        entry.ts >= twentyFourHoursAgo
      );
    })
    .sort((a, b) => b[1].ts - a[1].ts);

  if (matches.length > 0) {
    const bestEntry = matches[0][1];

    // Warm up the cache for this exact context hash in memory
    cache[contextHash] = {
      artist: bestEntry.artist,
      title: bestEntry.title,
      response: bestEntry.response,
      ts: Date.now()
    };

    // Write-through to SQLite DB
    writeCacheItem(contextHash, bestEntry.artist, bestEntry.title, bestEntry.response);

    incrementCacheHits();
    return bestEntry.response;
  }

  return null;
}

/**
 * Quick lookup by artist & title to avoid any network/analysis queries.
 */
export function getCacheByArtistTitle(artist: string, title: string): LLMResponse | null {
  const cache = readCache();
  const normalizedArtist = artist.trim().toLowerCase();
  const normalizedTitle = title.trim().toLowerCase();

  const entries = Object.values(cache);
  const matches = entries
    .filter((entry) => {
      return (
        entry.artist.trim().toLowerCase() === normalizedArtist &&
        entry.title.trim().toLowerCase() === normalizedTitle
      );
    })
    .sort((a, b) => b.ts - a.ts);

  if (matches.length > 0) {
    return matches[0].response;
  }
  return null;
}

/**
 * Saves a track response to the cratemind.db local SQLite cache (in-memory + DB).
 */
export function saveTrackCache(
  artist: string,
  title: string,
  contextHash: string,
  response: LLMResponse
): void {
  const cache = readCache();
  cache[contextHash] = {
    artist,
    title,
    response,
    ts: Date.now()
  };
  writeCacheItem(contextHash, artist, title, response);
}

/**
 * Checks the daily request limit.
 * If new day -> resets.
 * If limit not exceeded -> increments and returns success: true.
 * Else -> returns success: false.
 */
export function checkAndIncrementLimits(): {
  success: boolean;
  stats: { used: number; limit: number };
} {
  const stats = readStats();
  if (stats.dailyRequestsUsed >= DAILY_REQUEST_LIMIT) {
    return {
      success: false,
      stats: { used: stats.dailyRequestsUsed, limit: DAILY_REQUEST_LIMIT }
    };
  }
  stats.dailyRequestsUsed++;
  writeStats(stats);
  return {
    success: true,
    stats: { used: stats.dailyRequestsUsed, limit: DAILY_REQUEST_LIMIT }
  };
}

/**
 * Increments the total cache hits count (in-memory + DB).
 */
export function incrementCacheHits(): void {
  const stats = readStats();
  stats.totalCacheHits++;
  writeStats(stats);
}

/**
 * Retrieves the current statistics (used for syncing UI on boot or processing completion).
 */
export function getStats(): {
  dailyRequestsUsed: number;
  dailyRequestsLimit: number;
  totalCacheHits: number;
} {
  const stats = readStats();
  return {
    dailyRequestsUsed: stats.dailyRequestsUsed,
    dailyRequestsLimit: DAILY_REQUEST_LIMIT,
    totalCacheHits: stats.totalCacheHits
  };
}

/**
 * Clears both the cache and stats tables in cratemind.db, and resets in-memory singletons.
 */
export function clearCacheAndStats(): void {
  _cacheStore = null;
  _statsStore = null;
  const db = getDB();
  try {
    db.prepare('DELETE FROM llm_cache').run();
    db.prepare('DELETE FROM api_stats').run();
    db.prepare("DELETE FROM settings WHERE key = 'totalCacheHits'").run();
  } catch {
    // Ignore errors
  }
}

/**
 * Forces the daily request count to maximum for simulating override triggers.
 */
export function forceLimitExhaustion(): void {
  const stats = readStats();
  stats.dailyRequestsUsed = DAILY_REQUEST_LIMIT;
  writeStats(stats);
}

/**
 * Resets the daily request count for today to 0.
 */
export function resetDailyLimits(): void {
  _statsStore = null;
  const db = getDB();
  try {
    const today = new Date().toISOString().split('T')[0];
    db.prepare('INSERT OR REPLACE INTO api_stats (date, count) VALUES (?, 0)').run(today);
  } catch {
    // Ignore errors
  }
}
