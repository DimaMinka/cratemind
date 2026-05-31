import { TrackPassport, TrackMeta } from '../types.js';
import { SpotifyAudioFeatures } from './SpotifyService.js';
import { YouTubePlaylist } from '../types.js';

/**
 * TrackPassportService.ts
 *
 * Assembles a standardized semantic passport string from heterogeneous
 * track data sources (Engine DJ, Spotify, YouTube) for consumption by
 * the text-embedding-004 embedding model.
 *
 * Passport schema version 1:
 *   Track: {Artist} - {Title}
 *   Physical Blueprint: BPM: {BPM} | Key: {CamelotKey} | Length: {MM:SS}
 *   Release Context: Year: {Year} | Label: {Label}
 *   Acoustic Genre Tags: {cleaned genre tags}
 *   Cultural Vibe Context: {top YouTube playlist titles}
 */

/** Current passport schema version — bump when format changes to invalidate old vectors. */
export const PASSPORT_VERSION = 1;

// ── Tag Noise Filter ───────────────────────────────────────────────────────

/**
 * Lowercase tokens that are blacklisted from genre/mood tag lists.
 * These add zero musical signal and contaminate the embedding.
 */
const TAG_NOISE_TOKENS = new Set([
  // Country / region markers
  'australian',
  'american',
  'british',
  'german',
  'french',
  'swedish',
  'norwegian',
  'icelandic',
  'dutch',
  'canadian',
  'japanese',
  'korean',
  'polish',
  // Listening habit markers
  'seen live',
  'favorites',
  'favourite',
  'love',
  'cool',
  'awesome',
  'great',
  'best',
  'good',
  'nice',
  // Generic / low-signal
  'music',
  'songs',
  'tracks',
  'albums',
  'all',
  'various',
  'other',
  'misc',
  'stuff',
  'things'
]);

/**
 * Filters and deduplicates raw tag arrays.
 * Returns up to `maxTags` music-relevant genre/mood tags only.
 */
function cleanTags(rawTags: string[], maxTags = 7): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of rawTags) {
    const tag = raw.trim().toLowerCase();

    // Skip empty or purely numeric strings
    if (!tag || /^\d+$/.test(tag)) continue;

    // Skip noise tokens (check whole string and individual words)
    if (TAG_NOISE_TOKENS.has(tag)) continue;
    const words = tag.split(/\s+/);
    if (words.some((w) => TAG_NOISE_TOKENS.has(w))) continue;

    // Deduplication
    if (seen.has(tag)) continue;
    seen.add(tag);

    result.push(tag);
    if (result.length >= maxTags) break;
  }

  return result;
}

// ── Duration Formatting ────────────────────────────────────────────────────

/**
 * Converts track duration in seconds to MM:SS string.
 * Returns undefined if duration is unavailable or zero.
 */
function formatDuration(seconds: number | undefined): string | undefined {
  if (!seconds || seconds <= 0) return undefined;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ── YouTube Playlist Name Cleaner ─────────────────────────────────────────

/**
 * Strips dates, special characters, and channel-specific boilerplate
 * from YouTube playlist names to extract clean vibe context labels.
 * e.g. "Afterlife Podcast #042 | Feb 2023" → "Afterlife Podcast"
 */
function cleanPlaylistTitle(title: string): string {
  return title
    .replace(/#\d+/g, '') // strip episode numbers: #042
    .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b[\s\d,]*/gi, '') // strip month refs
    .replace(/\b(20\d{2}|19\d{2})\b/g, '') // strip years
    .replace(/[|\-–—]/g, ' ') // normalize separators to space
    .replace(/[^a-zA-Z0-9\s']/g, ' ') // strip special chars except apostrophes
    .replace(/\s{2,}/g, ' ') // collapse multiple spaces
    .trim();
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface PassportParams {
  meta: TrackMeta;
  spotify?: SpotifyAudioFeatures | null;
  ytPlaylists?: YouTubePlaylist[];
  /** Optional additional tags from Last.fm or other sources */
  extraTags?: string[];
  /** Override year if known from an external source */
  releaseYear?: number;
}

/**
 * Assembles the standardized semantic passport string for a given track.
 *
 * The passport is a compact, noise-cleaned, structured text optimized
 * for encoding by text-embedding-004. It encodes musical identity,
 * not listening habits or metadata noise.
 *
 * @returns TrackPassport with the full formatted text and parsed fields
 */
export function buildPassport(params: PassportParams): TrackPassport {
  const { meta, spotify, ytPlaylists = [], extraTags = [], releaseYear } = params;

  const artist = meta.artist || 'Unknown Artist';
  const title = meta.title || meta.filename || 'Unknown Title';
  const bpm = meta.bpm;
  const key = meta.key;
  const durationFormatted = formatDuration(meta.duration);
  const label = meta.label?.trim() || undefined;

  // ── Genre Tags ──────────────────────────────────────────────────────────
  // Merge Spotify artist genres + Engine DJ genre field + extra tags
  const rawTags: string[] = [
    ...(spotify?.genres ?? []),
    ...(meta.genre ? [meta.genre] : []),
    ...(meta.comment ? meta.comment.split(/[,;]+/).map((t) => t.trim()) : []),
    ...extraTags
  ];
  const genreTags = cleanTags(rawTags, 7);

  // ── Cultural Vibe Context ────────────────────────────────────────────────
  // Use top 3 YouTube playlist titles as cultural vibe anchors
  const ytVibeContext = ytPlaylists
    .slice(0, 3)
    .map((p) => cleanPlaylistTitle(p.title))
    .filter((t) => t.length > 2); // drop empty/degenerate strings after cleaning

  // ── Assemble Passport ────────────────────────────────────────────────────
  const lines: string[] = [];

  lines.push(`Track: ${artist} - ${title}`);

  // Physical Blueprint line — include only available fields
  const physicalParts: string[] = [];
  if (bpm) physicalParts.push(`BPM: ${bpm}`);
  if (key) physicalParts.push(`Key: ${key}`);
  if (durationFormatted) physicalParts.push(`Length: ${durationFormatted}`);
  if (physicalParts.length > 0) {
    lines.push(`Physical Blueprint: ${physicalParts.join(' | ')}`);
  }

  // Release Context line
  const releaseParts: string[] = [];
  if (releaseYear) releaseParts.push(`Year: ${releaseYear}`);
  if (label) releaseParts.push(`Label: ${label}`);
  if (releaseParts.length > 0) {
    lines.push(`Release Context: ${releaseParts.join(' | ')}`);
  }

  // Acoustic Genre Tags line
  if (genreTags.length > 0) {
    lines.push(`Acoustic Genre Tags: ${genreTags.join(', ')}`);
  }

  // Cultural Vibe Context line
  if (ytVibeContext.length > 0) {
    lines.push(`Cultural Vibe Context: ${ytVibeContext.join(', ')}`);
  }

  const passportText = lines.join('\n');

  return {
    text: passportText,
    version: PASSPORT_VERSION,
    fields: {
      artist,
      title,
      bpm,
      key,
      durationFormatted,
      year: releaseYear,
      label,
      genreTags,
      ytVibeContext
    }
  };
}
