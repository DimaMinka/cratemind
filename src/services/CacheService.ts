import * as fs from 'fs';
import { createHash } from 'crypto';
import { LLMResponse } from '../types.js';
import { CACHE_FILE_PATH, STATS_FILE_PATH, DAILY_REQUEST_LIMIT } from '../config.js';

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
  };
}

/**
 * CacheService.ts
 *
 * Manages persistent LLM response caching and daily request limits.
 *
 * Key optimization (v4.6):
 * - `_cacheStore` and `_statsStore` are module-level singletons.
 *   All read operations return the in-memory copy — zero disk I/O per track.
 *   Write operations use a write-through pattern: update memory, then flush to disk.
 * - `clearCacheAndStats()` also resets both singletons.
 */

// ── In-memory Singletons ────────────────────────────────────────────────────

let _cacheStore: CacheStore | null = null;
let _statsStore: StatsStore | null = null;

// ── Stats Store ─────────────────────────────────────────────────────────────

function readStats(): StatsStore {
  if (_statsStore) {
    // Reset counter if day has rolled over (check without disk read)
    const today = new Date().toISOString().split('T')[0];
    if (_statsStore.lastDate !== today) {
      _statsStore.lastDate = today;
      _statsStore.dailyRequestsUsed = 0;
    }
    return _statsStore;
  }

  const today = new Date().toISOString().split('T')[0];
  const defaultStats: StatsStore = {
    lastDate: today,
    dailyRequestsUsed: 0,
    totalCacheHits: 0
  };

  try {
    if (fs.existsSync(STATS_FILE_PATH)) {
      const content = fs.readFileSync(STATS_FILE_PATH, 'utf-8');
      const stats = JSON.parse(content) as StatsStore;

      // Reset if the date has changed
      if (stats.lastDate !== today) {
        stats.lastDate = today;
        stats.dailyRequestsUsed = 0;
      }

      _statsStore = stats;
      return _statsStore;
    }
  } catch {
    // Graceful fallback to defaults
  }

  _statsStore = defaultStats;
  return _statsStore;
}

/**
 * Write-through: update in-memory singleton, then flush to disk.
 */
function writeStats(stats: StatsStore): void {
  _statsStore = stats;
  try {
    fs.writeFileSync(STATS_FILE_PATH, JSON.stringify(stats, null, 2), 'utf-8');
  } catch {
    // Ignore write errors to prevent system crash
  }
}

// ── Cache Store ─────────────────────────────────────────────────────────────

function readCache(): CacheStore {
  if (_cacheStore) return _cacheStore;

  try {
    if (fs.existsSync(CACHE_FILE_PATH)) {
      const content = fs.readFileSync(CACHE_FILE_PATH, 'utf-8');
      _cacheStore = JSON.parse(content) as CacheStore;
      return _cacheStore;
    }
  } catch {
    // Graceful fallback
  }

  _cacheStore = {};
  return _cacheStore;
}

/**
 * Write-through: update in-memory singleton, then flush to disk.
 */
function writeCache(cache: CacheStore): void {
  _cacheStore = cache;
  try {
    fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(cache, null, 2), 'utf-8');
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
  personalHints: string
): string {
  const normalizedArtist = artist.trim().toLowerCase();
  const normalizedTitle = title.trim().toLowerCase();
  const ragHash = createHash('sha256').update(ragContext).digest('hex');
  const hintsHash = createHash('sha256').update(personalHints).digest('hex');
  const payload = `${normalizedArtist}|${normalizedTitle}|${ragHash}|${hintsHash}`;
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
  if (cache[contextHash]) {
    incrementCacheHits();
    return cache[contextHash].response;
  }
  return null;
}

/**
 * Saves a track response to the local JSON cache (in-memory + disk).
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
    response
  };
  writeCache(cache);
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
 * Increments the total cache hits count (in-memory + disk).
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
 * Clears both the cache and stats files, and resets in-memory singletons.
 */
export function clearCacheAndStats(): void {
  _cacheStore = null;
  _statsStore = null;
  try {
    if (fs.existsSync(CACHE_FILE_PATH)) {
      fs.unlinkSync(CACHE_FILE_PATH);
    }
    if (fs.existsSync(STATS_FILE_PATH)) {
      fs.unlinkSync(STATS_FILE_PATH);
    }
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
