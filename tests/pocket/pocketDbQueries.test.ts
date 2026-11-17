import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { getDB, resetDBForTests } from '../../src/services/LocalDBService.js';
import * as EmbeddingService from '../../src/services/EmbeddingService.js';
import * as LLMService from '../../src/services/LLMService.js';
import {
  cleanMetadataString,
  bufferToFloat32Array,
  cosineSimilarity,
  getRagTotalExamples,
  findLocalRagMatch,
  findYouTubeScoutMatch
} from '../../src/services/pocket/pocketDbQueries.js';

describe('Tier 1 Unit: pocketDbQueries', () => {
  let tempDir: string;
  let testDbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cratemind-pocket-db-test-'));
    testDbPath = path.join(tempDir, 'test-cratemind.db');
    process.env.CRATEMIND_DB_PATH = testDbPath;
    resetDBForTests();
  });

  afterEach(() => {
    resetDBForTests();
    delete process.env.CRATEMIND_DB_PATH;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error on temp dir
    }
    vi.restoreAllMocks();
  });

  it('TC-DB-01: Exact RAG Match returns correct folder and high confidence', () => {
    const db = getDB();
    db.prepare(
      `
      INSERT INTO rag_examples (artist, title, folders, reasoning, source, ts)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    ).run(
      'Recondite',
      'Shun',
      JSON.stringify(['galaxy trip']),
      'Deep atmospheric techno',
      'manual',
      Date.now()
    );

    const result = findLocalRagMatch('Recondite', 'Shun');

    expect(result.folder).toBe('galaxy trip');
    expect(result.matchType).toBe('exact');
    expect(result.confidence).toBeGreaterThanOrEqual(95);
    expect(result.referenceTrack).toContain('Recondite');
    expect(result.neighbors).toHaveLength(1);
    expect(result.neighbors[0].similarity).toBe(1.0);
  });

  it('TC-DB-02: Artist-Only RAG Match returns historical folder with reduced confidence', () => {
    const db = getDB();
    db.prepare(
      `
      INSERT INTO rag_examples (artist, title, folders, reasoning, source, ts)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    ).run(
      'Recondite',
      'Levo',
      JSON.stringify(['galaxy trip']),
      'Melodic atmospheric vibe',
      'manual',
      Date.now()
    );

    const result = findLocalRagMatch('Recondite', 'Unknown Unreleased Track');

    expect(result.folder).toBe('galaxy trip');
    expect(result.matchType).toBe('artist');
    expect(result.confidence).toBe(85);
    expect(result.referenceTrack).toBe('Recondite - Levo');
  });

  it('TC-DB-03: CLAP Cosine Similarity correctly computes 1.0 for identical vectors', () => {
    const vecA = new Float32Array(512).fill(0.5);
    const vecB = new Float32Array(512).fill(0.5);

    const sim = cosineSimilarity(vecA, vecB);
    expect(sim).toBeCloseTo(1.0, 4);
  });

  it('TC-DB-04: CLAP Cosine Similarity correctly computes 0.0 for orthogonal vectors', () => {
    const vecA = new Float32Array(512);
    vecA[0] = 1.0;
    const vecB = new Float32Array(512);
    vecB[1] = 1.0;

    const sim = cosineSimilarity(vecA, vecB);
    expect(sim).toBeCloseTo(0.0, 4);
  });

  it('TC-DB-05: CLAP Cosine Similarity correctly computes -1.0 for opposite vectors', () => {
    const vecA = new Float32Array(512);
    vecA[0] = 1.0;
    const vecB = new Float32Array(512);
    vecB[0] = -1.0;

    const sim = cosineSimilarity(vecA, vecB);
    expect(sim).toBeCloseTo(-1.0, 4);
  });

  it('TC-DB-06: CLAP Nearest Neighbor Ranking selects the most similar crate embedding', () => {
    const db = getDB();
    const queryVec = new Float32Array(512);
    queryVec[0] = 1.0;
    queryVec[1] = 0.5;

    // High similarity vector (club party)
    const highSimVec = new Float32Array(512);
    highSimVec[0] = 0.99;
    highSimVec[1] = 0.51;
    const highBuf = Buffer.from(highSimVec.buffer);

    // Low similarity vector (mountain sunset)
    const lowSimVec = new Float32Array(512);
    lowSimVec[20] = 1.0;
    const lowBuf = Buffer.from(lowSimVec.buffer);

    db.prepare(
      `
      INSERT INTO track_intelligence (artist, title, filepath, folder, clap_embedding, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    ).run('Artist A', 'High Match', '/music/a.mp3', 'club party', highBuf, Date.now());

    db.prepare(
      `
      INSERT INTO track_intelligence (artist, title, filepath, folder, clap_embedding, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    ).run('Artist B', 'Low Match', '/music/b.mp3', 'mountain sunset', lowBuf, Date.now());

    const queryBuf = Buffer.from(queryVec.buffer);
    const result = findLocalRagMatch('New Artist', 'New Track', queryBuf);

    expect(result.matchType).toBe('clap_embedding');
    expect(result.folder).toBe('club party');
    expect(result.confidence).toBeGreaterThanOrEqual(90);
    expect(result.neighbors[0].artist).toBe('Artist A');
  });

  it('TC-DB-07: YT Scout Neighbor Resolution links track to playlist and known crates', () => {
    const db = getDB();
    const playlistId = 'PL_cercle_colombia';
    db.prepare(
      `
      INSERT INTO yt_playlists (id, title, description, channel_name, cached_at)
      VALUES (?, ?, ?, ?, ?)
    `
    ).run(playlistId, 'Cercle Live at Guatapé', 'Melodic Techno Live Set', 'Cercle', Date.now());

    db.prepare(
      `
      INSERT INTO yt_playlist_items (playlist_id, track_index, artist, title)
      VALUES (?, ?, ?, ?)
    `
    ).run(playlistId, 1, 'Innellea', 'Vigilance');

    db.prepare(
      `
      INSERT INTO yt_playlist_items (playlist_id, track_index, artist, title)
      VALUES (?, ?, ?, ?)
    `
    ).run(playlistId, 2, 'Colyn', 'Resolve');

    // Add neighbor to rag_examples
    db.prepare(
      `
      INSERT INTO rag_examples (artist, title, folders, reasoning, source, ts)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    ).run(
      'Colyn',
      'Resolve',
      JSON.stringify(['magic forest']),
      'Melodic deep track',
      'manual',
      Date.now()
    );

    const scout = findYouTubeScoutMatch('Innellea', 'Vigilance');

    expect(scout.hasMatch).toBe(true);
    expect(scout.playlistId).toBe(playlistId);
    expect(scout.playlistTitle).toBe('Cercle Live at Guatapé');
    expect(scout.neighbors.length).toBeGreaterThan(0);
    expect(scout.neighbors[0].title).toBe('Resolve');
    expect(scout.neighbors[0].folder).toBe('magic forest');
  });

  it('TC-DB-08: YT Scout No Playlist Hit returns empty result without throwing', () => {
    const scout = findYouTubeScoutMatch('Completely Unknown Artist', 'Obscure Track Title');

    expect(scout.hasMatch).toBe(false);
    expect(scout.playlistId).toBeNull();
    expect(scout.neighbors).toHaveLength(0);
  });

  it('TC-DB-09: YT Scout Unclassified Neighbors leaves folder as null when neighbor is unsorted', () => {
    const db = getDB();
    const playlistId = 'PL_unsorted_set';
    db.prepare(
      `
      INSERT INTO yt_playlists (id, title, description, channel_name, cached_at)
      VALUES (?, ?, ?, ?, ?)
    `
    ).run(playlistId, 'Unsorted Set', 'Test', 'Channel', Date.now());

    db.prepare(
      `
      INSERT INTO yt_playlist_items (playlist_id, track_index, artist, title)
      VALUES (?, ?, ?, ?)
    `
    ).run(playlistId, 1, 'Artist X', 'Track 1');

    db.prepare(
      `
      INSERT INTO yt_playlist_items (playlist_id, track_index, artist, title)
      VALUES (?, ?, ?, ?)
    `
    ).run(playlistId, 2, 'Artist Y', 'Track 2');

    const scout = findYouTubeScoutMatch('Artist X', 'Track 1');

    expect(scout.hasMatch).toBe(true);
    expect(scout.neighbors.length).toBe(1);
    expect(scout.neighbors[0].folder).toBeNull();
  });

  it('TC-DB-10: Empty Database Fallback returns safe empty defaults without crashing', () => {
    expect(getRagTotalExamples()).toBe(0);

    const rag = findLocalRagMatch('Any Artist', 'Any Title');
    expect(rag.folder).toBeNull();
    expect(rag.confidence).toBe(0);
    expect(rag.matchType).toBe('none');
    expect(rag.neighbors).toEqual([]);

    const scout = findYouTubeScoutMatch('Any Artist', 'Any Title');
    expect(scout.hasMatch).toBe(false);
    expect(scout.neighbors).toEqual([]);
  });

  it('TC-DB-11: Corrupt CLAP BLOB Handling safely ignores invalid buffer lengths', () => {
    const corruptBuffer = Buffer.alloc(100); // 100 bytes is not 2048 bytes
    const array = bufferToFloat32Array(corruptBuffer);
    expect(array).toBeNull();

    const emptyArray = bufferToFloat32Array(null);
    expect(emptyArray).toBeNull();

    const rag = findLocalRagMatch('Artist', 'Title', corruptBuffer);
    expect(rag.matchType).not.toBe('clap_embedding');
  });

  it('TC-DB-12: Zero AI Network Guarantee confirms EmbeddingService and LLMService are untouched', () => {
    const embedSpy = vi.spyOn(EmbeddingService, 'embed');
    const findNeighborsSpy = vi.spyOn(EmbeddingService, 'findNeighbors');
    const classifySpy = vi.spyOn(LLMService, 'classifyTrack');

    // Run all query entrypoints
    cleanMetadataString('Artist (Original Mix) [Cercle Edition]');
    getRagTotalExamples();
    findLocalRagMatch('Test Artist', 'Test Title');
    findYouTubeScoutMatch('Test Artist', 'Test Title');

    expect(embedSpy).not.toHaveBeenCalled();
    expect(findNeighborsSpy).not.toHaveBeenCalled();
    expect(classifySpy).not.toHaveBeenCalled();
  });

  it('TC-DB-13: Unaligned CLAP embedding buffer safely aligns without RangeError', () => {
    const raw = Buffer.alloc(3000);
    const unaligned = raw.subarray(1, 2049 + 1);
    expect(unaligned.byteOffset % 4).not.toBe(0);

    const f32 = bufferToFloat32Array(unaligned);
    expect(f32).not.toBeNull();
    expect(f32?.length).toBe(512);

    const match = findLocalRagMatch('Artist', 'Title', unaligned);
    expect(match).toBeDefined();
    expect(match.confidence).toBeGreaterThanOrEqual(0);
  });

  it('TC-DB-14: Corrupted or unreadable SQLite database returns safe defaults', () => {
    const corruptDbPath = path.join(tempDir, 'corrupt.db');
    fs.writeFileSync(corruptDbPath, 'NOT_A_VALID_SQLITE_DATABASE');
    process.env.CRATEMIND_DB_PATH = corruptDbPath;
    resetDBForTests();

    expect(getRagTotalExamples()).toBe(0);
    const rag = findLocalRagMatch('Artist', 'Title');
    expect(rag.folder).toBeNull();
    expect(rag.matchType).toBe('none');
  });
});
