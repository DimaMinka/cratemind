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
 * Generates a SHA-256 hash of a combination of artist, title, and RAG context.
 * Normalizes strings to prevent minor whitespace or case differences from missing the cache.
 */
export function generateContextHash(artist: string, title: string, ragContext: string): string {
  const normalizedArtist = artist.trim().toLowerCase();
  const normalizedTitle = title.trim().toLowerCase();
  const payload = `${normalizedArtist}|${normalizedTitle}|${ragContext}`;
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Reads the stats store from disk or returns the default state if it doesn't exist.
 */
function readStats(): StatsStore {
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
      return stats;
    }
  } catch {
    // Graceful fallback to defaults
  }
  return defaultStats;
}

/**
 * Saves the stats store to disk.
 */
function writeStats(stats: StatsStore): void {
  try {
    fs.writeFileSync(STATS_FILE_PATH, JSON.stringify(stats, null, 2), 'utf-8');
  } catch {
    // Ignore write errors to prevent system crash
  }
}

/**
 * Reads the cache store from disk or returns an empty object if it doesn't exist.
 */
function readCache(): CacheStore {
  try {
    if (fs.existsSync(CACHE_FILE_PATH)) {
      const content = fs.readFileSync(CACHE_FILE_PATH, 'utf-8');
      return JSON.parse(content) as CacheStore;
    }
  } catch {
    // Graceful fallback
  }
  return {};
}

/**
 * Saves the cache store to disk.
 */
function writeCache(cache: CacheStore): void {
  try {
    fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(cache, null, 2), 'utf-8');
  } catch {
    // Ignore write errors
  }
}

/**
 * Checks if a track response is cached under the specific context hash.
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
 * Saves a track response to the local JSON cache.
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
 * Increments the total cache hits count.
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
 * Clears both the cache and stats files (Simulating clean hotkey cold start).
 */
export function clearCacheAndStats(): void {
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
