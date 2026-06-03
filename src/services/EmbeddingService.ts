import { GoogleGenAI } from '@google/genai';
import { VectorNeighbor, TrackMeta } from '../types.js';
import { getDB } from './LocalDBService.js';
import { logToFile } from './LoggerService.js';
import { buildPassport, PASSPORT_VERSION } from './TrackPassportService.js';
import { SpotifyAudioFeatures } from './SpotifyService.js';
import { YouTubePlaylist } from '../types.js';

/**
 * EmbeddingService.ts
 *
 * Provides vector embeddings via Google's text-embedding-004 model and
 * cosine similarity search over the local track_vectors SQLite table.
 *
 * Design decisions:
 * - Embeddings are stored as raw BLOB (Float32Array buffer) in SQLite.
 *   No external vector DB required; full-scan cosine search is fast
 *   enough for libraries up to ~50k tracks on modern hardware.
 * - The Gemini SDK already present in the project is reused — no new dep.
 * - Batch vectorization during bootstrap uses a 5-concurrent / 100ms
 *   inter-batch pause to stay within API rate limits.
 */

/**
 * Gemini Embedding 2 — Google's multimodal embedding model (2026).
 * Produces 3072-dimensional vectors in a unified semantic space for text, images, audio, and video.
 * Usage: do NOT pass task_type; embed task context directly inside the prompt string.
 */
const EMBEDDING_MODEL = 'gemini-embedding-2';

/** Number of top neighbors to return from vector search */
const DEFAULT_TOP_K = 5;

/** Byte size of a single Float32 value for BLOB serialization */
const FLOAT32_BYTES = 4;

/** Expected vector dimensionality for gemini-embedding-2 */
const EMBEDDING_DIMS = 3072;

/** Minimum cosine similarity threshold for qualified vector search matches */
const MIN_SIMILARITY_THRESHOLD = 0.8;

// ── Lazy AI Client ─────────────────────────────────────────────────────────

let _aiClient: GoogleGenAI | null = null;

function getAIClient(): GoogleGenAI | null {
  if (!process.env.GEMINI_API_KEY) return null;
  if (!_aiClient) {
    _aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return _aiClient;
}

// ── Core Embedding Generation ──────────────────────────────────────────────

/**
 * Generates a 768-dimensional embedding vector for the given text string.
 * Returns null if the API key is unavailable or the request fails.
 */
export async function embed(text: string): Promise<number[] | null> {
  const ai = getAIClient();
  if (!ai) return null;

  try {
    // gemini-embedding-2: task context must be embedded directly in the text prompt.
    // The model does not accept a task_type parameter.
    const result = await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: text
    });

    // gemini-embedding-2 returns values on result.embeddings[0].values
    const values = result.embeddings?.[0]?.values;
    if (!values || values.length === 0) {
      logToFile('EMBEDDING_ERROR', `${EMBEDDING_MODEL} returned empty values array`);
      return null;
    }

    return values;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logToFile('EMBEDDING_ERROR', `Embedding API call failed: ${msg}`);
    return null;
  }
}

// ── Cosine Similarity ──────────────────────────────────────────────────────

/**
 * Computes cosine similarity between two same-length vectors.
 * Returns a value in [0.0, 1.0] where 1.0 = identical direction.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── BLOB Serialization ─────────────────────────────────────────────────────

/**
 * Serializes a number[] embedding to a Buffer for SQLite BLOB storage.
 * Uses Float32Array for compact representation (~3KB per 768-dim vector).
 */
function serializeEmbedding(embedding: number[]): Buffer {
  const f32 = new Float32Array(embedding);
  return Buffer.from(f32.buffer);
}

/**
 * Deserializes a SQLite BLOB buffer back to a number[] embedding.
 * gemini-embedding-2 produces 3072 floats = 12,288 bytes per vector.
 */
function deserializeEmbedding(blob: Buffer): number[] {
  // Ensure correct byte alignment by copying into a new ArrayBuffer
  const dimCount = blob.byteLength / FLOAT32_BYTES;
  const f32 = new Float32Array(blob.buffer, blob.byteOffset, dimCount);
  return Array.from(f32);
}

/** Returns the expected embedding dimensionality for diagnostics. */
export function getEmbeddingDims(): number {
  return EMBEDDING_DIMS;
}

// ── Storage ────────────────────────────────────────────────────────────────

/**
 * Generates the track passport, embeds it, and stores the result
 * in the track_vectors table. Safe to call multiple times — the
 * UNIQUE(artist, title) constraint will overwrite stale records.
 *
 * @returns true if stored successfully, false on any failure
 */
export async function storeTrackVector(
  artist: string,
  title: string,
  folder: string,
  meta: TrackMeta,
  spotify?: SpotifyAudioFeatures | null,
  ytPlaylists?: YouTubePlaylist[],
  releaseYear?: number
): Promise<boolean> {
  const passport = buildPassport({ meta, spotify, ytPlaylists, releaseYear });

  // Check if we already have a current-version vector for this track
  const db = getDB();
  try {
    const existing = db
      .prepare(
        'SELECT passport_version FROM track_vectors WHERE LOWER(artist) = ? AND LOWER(title) = ?'
      )
      .get(artist.toLowerCase(), title.toLowerCase()) as { passport_version: number } | undefined;

    if (existing && existing.passport_version === PASSPORT_VERSION) {
      // Already vectorized at current schema version — skip API call
      return true;
    }
  } catch {
    // Table may not exist yet on first run — will be created by getDB()
  }

  const embedding = await embed(passport.text);
  if (!embedding) {
    logToFile('EMBEDDING', `Failed to generate vector for [${artist} - ${title}]`);
    return false;
  }

  try {
    const blob = serializeEmbedding(embedding);
    db.prepare(
      `INSERT OR REPLACE INTO track_vectors
         (artist, title, folder, passport, embedding, passport_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(artist, title, folder, passport.text, blob, PASSPORT_VERSION, Date.now());

    logToFile('EMBEDDING', `Vector stored for [${artist} - ${title}] → /${folder}`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logToFile('EMBEDDING_ERROR', `Failed to store vector: ${msg}`);
    return false;
  }
}

// ── Vector Search ──────────────────────────────────────────────────────────

/**
 * Finds the TOP-K most musically similar tracks from the sorted library
 * using cosine similarity over all stored track vectors.
 *
 * Strategy: full-scan in JS (no SQL cosine extension needed).
 * For 5000 tracks × 768 dims this runs in ~3-5ms.
 *
 * @param queryPassport - The passport text of the incoming track
 * @param topK - How many neighbors to return (default: DEFAULT_TOP_K)
 * @param excludeKey - "artist|title" key to exclude from results (prevents self-match)
 * @returns Sorted array of VectorNeighbor (highest similarity first)
 */
export async function findNeighbors(
  queryPassport: string,
  topK = DEFAULT_TOP_K,
  excludeKey?: string
): Promise<VectorNeighbor[]> {
  const queryEmbedding = await embed(queryPassport);
  if (!queryEmbedding) {
    logToFile('EMBEDDING', 'Skipping vector search: query embedding failed');
    return [];
  }

  const db = getDB();
  let rows: {
    artist: string;
    title: string;
    folder: string;
    passport: string;
    embedding: Buffer;
  }[];

  try {
    rows = db
      .prepare('SELECT artist, title, folder, passport, embedding FROM track_vectors')
      .all() as typeof rows;
  } catch {
    return [];
  }

  if (rows.length === 0) return [];

  const results: VectorNeighbor[] = [];

  for (const row of rows) {
    // Skip the track we are currently classifying
    const rowKey = `${row.artist.toLowerCase()}|${row.title.toLowerCase()}`;
    if (excludeKey && rowKey === excludeKey) continue;

    let storedEmbedding: number[];
    try {
      storedEmbedding = deserializeEmbedding(row.embedding);
    } catch {
      continue; // Corrupted BLOB — skip silently
    }

    const similarity = cosineSimilarity(queryEmbedding, storedEmbedding);

    results.push({
      artist: row.artist,
      title: row.title,
      folder: row.folder,
      similarity: Math.round(similarity * 1000) / 1000, // 3 decimal places
      passport: row.passport
    });
  }

  // Filter out neighbor results below our similarity threshold to avoid low-quality noise
  const qualified = results.filter((r) => r.similarity >= MIN_SIMILARITY_THRESHOLD);

  // Sort by similarity descending and return top K
  qualified.sort((a, b) => b.similarity - a.similarity);
  return qualified.slice(0, topK);
}

// ── Batch Bootstrap Vectorizer ─────────────────────────────────────────────

interface BatchVectorizationTarget {
  artist: string;
  title: string;
  folder: string;
  meta: TrackMeta;
  spotify?: SpotifyAudioFeatures | null;
  ytPlaylists?: YouTubePlaylist[];
}

/**
 * Vectorizes a batch of library tracks for RAG bootstrap.
 * Processes in groups of 5 with a 100ms pause between groups
 * to stay within API rate limits.
 *
 * Skips tracks that already have a current-version vector in the DB.
 *
 * @returns count of newly vectorized tracks
 */
export async function batchVectorize(
  targets: BatchVectorizationTarget[],
  onProgress?: (done: number, total: number) => void
): Promise<number> {
  const BATCH_SIZE = 5;
  const BATCH_PAUSE_MS = 100;
  let stored = 0;

  // Pre-filter: skip already vectorized tracks
  const db = getDB();
  let existingKeys: Set<string>;
  try {
    const rows = db.prepare('SELECT artist, title, passport_version FROM track_vectors').all() as {
      artist: string;
      title: string;
      passport_version: number;
    }[];
    existingKeys = new Set(
      rows
        .filter((r) => r.passport_version === PASSPORT_VERSION)
        .map((r) => `${r.artist.toLowerCase()}|${r.title.toLowerCase()}`)
    );
  } catch {
    existingKeys = new Set();
  }

  const pending = targets.filter(
    (t) => !existingKeys.has(`${t.artist.toLowerCase()}|${t.title.toLowerCase()}`)
  );

  if (pending.length === 0) {
    logToFile('EMBEDDING', 'Batch vectorize: all tracks already indexed — skipping');
    return 0;
  }

  logToFile('EMBEDDING', `Batch vectorize: ${pending.length} tracks need vectorization`);

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (target) => {
        const ok = await storeTrackVector(
          target.artist,
          target.title,
          target.folder,
          target.meta,
          target.spotify,
          target.ytPlaylists
        );
        if (ok) stored++;
      })
    );

    onProgress?.(Math.min(i + BATCH_SIZE, pending.length), pending.length);

    // Pause between batches to avoid rate limiting
    if (i + BATCH_SIZE < pending.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_PAUSE_MS));
    }
  }

  logToFile('EMBEDDING', `Batch vectorize complete: ${stored}/${pending.length} tracks stored`);
  return stored;
}

/**
 * Returns the total count of vectors stored in the local database.
 */
export function getVectorCount(): number {
  const db = getDB();
  try {
    const row = db.prepare('SELECT COUNT(*) as cnt FROM track_vectors').get() as { cnt: number };
    return row.cnt;
  } catch {
    return 0;
  }
}
