import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { resetDBForTests, getDB } from '../../src/services/LocalDBService.js';
import * as EmbeddingService from '../../src/services/EmbeddingService.js';
import * as LLMService from '../../src/services/LLMService.js';
import * as ID3Service from '../../src/services/ID3Service.js';
import { buildBatchManifest } from '../../src/services/pocket/pocketManifestBuilder.js';

describe('Tier 1 Unit: pocketManifestBuilder', () => {
  let tempDir: string;
  let incomingDir: string;
  let sortedDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cratemind-mb-test-'));
    incomingDir = path.join(tempDir, 'Incoming');
    sortedDir = path.join(tempDir, 'Sorted');
    fs.mkdirSync(incomingDir, { recursive: true });
    fs.mkdirSync(sortedDir, { recursive: true });
    process.env.CRATEMIND_DB_PATH = path.join(tempDir, 'test.db');
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

  it('TC-MB-01: Batch Limit Enforced (30 Tracks) when more files exist', async () => {
    for (let i = 0; i < 40; i++) {
      const filename = `Track_${String(i).padStart(2, '0')}.mp3`;
      fs.writeFileSync(path.join(incomingDir, filename), 'AUDIO_DATA');
    }

    const manifest = await buildBatchManifest({ incomingDir, sortedDir, limit: 30 });
    expect(manifest.tracks.length).toBe(30);
    expect(manifest.totalTracks).toBe(30);
  });

  it('TC-MB-02: Batch Below Limit returns exact count of files present', async () => {
    for (let i = 0; i < 7; i++) {
      fs.writeFileSync(path.join(incomingDir, `Song_${i}.wav`), 'WAV_DATA');
    }

    const manifest = await buildBatchManifest({ incomingDir, sortedDir, limit: 30 });
    expect(manifest.tracks.length).toBe(7);
    expect(manifest.totalTracks).toBe(7);
  });

  it('TC-MB-03: Audio Extension Whitelist ignores non-audio files', async () => {
    fs.writeFileSync(path.join(incomingDir, 'song1.mp3'), 'AUDIO');
    fs.writeFileSync(path.join(incomingDir, 'song2.flac'), 'AUDIO');
    fs.writeFileSync(path.join(incomingDir, 'song3.wav'), 'AUDIO');
    fs.writeFileSync(path.join(incomingDir, 'song4.aiff'), 'AUDIO');
    fs.writeFileSync(path.join(incomingDir, 'song5.m4a'), 'AUDIO');

    // Non-audio files
    fs.writeFileSync(path.join(incomingDir, 'notes.txt'), 'TEXT');
    fs.writeFileSync(path.join(incomingDir, '.DS_Store'), 'METADATA');
    fs.writeFileSync(path.join(incomingDir, 'cover.jpg'), 'IMAGE');
    fs.writeFileSync(path.join(incomingDir, 'temp.tmp'), 'TEMP');

    const manifest = await buildBatchManifest({ incomingDir, sortedDir });
    expect(manifest.tracks.length).toBe(5);
    const filenames = manifest.tracks.map((t) => t.filename);
    expect(filenames).not.toContain('notes.txt');
    expect(filenames).not.toContain('.DS_Store');
    expect(filenames).not.toContain('cover.jpg');
    expect(filenames).not.toContain('temp.tmp');
  });

  it('TC-MB-04: Case-Insensitive Extensions correctly includes uppercase extensions', async () => {
    fs.writeFileSync(path.join(incomingDir, 'TRACK1.MP3'), 'AUDIO');
    fs.writeFileSync(path.join(incomingDir, 'TRACK2.WAV'), 'AUDIO');
    fs.writeFileSync(path.join(incomingDir, 'TRACK3.Flac'), 'AUDIO');

    const manifest = await buildBatchManifest({ incomingDir, sortedDir });
    expect(manifest.tracks.length).toBe(3);
    const names = manifest.tracks.map((t) => t.filename);
    expect(names).toContain('TRACK1.MP3');
    expect(names).toContain('TRACK2.WAV');
    expect(names).toContain('TRACK3.Flac');
  });

  it('TC-MB-05: ID3 Metadata Enrichment populates metadata and formatted duration', async () => {
    const filename = 'TaggedTrack.mp3';
    fs.writeFileSync(path.join(incomingDir, filename), 'AUDIO_MOCK');

    vi.spyOn(ID3Service, 'extractMetadata').mockResolvedValueOnce({
      artist: 'Stephan Bodzin',
      title: 'Singularity',
      duration: 425,
      bpm: 124,
      key: '8A'
    });

    const manifest = await buildBatchManifest({ incomingDir, sortedDir });
    expect(manifest.tracks.length).toBe(1);
    const track = manifest.tracks[0];
    expect(track.artist).toBe('Stephan Bodzin');
    expect(track.title).toBe('Singularity');
    expect(track.duration).toBe(425);
    expect(track.durationFormatted).toBe('7:05');
    expect(track.bpm).toBe(124);
    expect(track.key).toBe('8A');
  });

  it('TC-MB-06: Filename Splitting Fallback extracts artist and title from hyphenated name', async () => {
    const filename = 'Bicep - Glue.mp3';
    fs.writeFileSync(path.join(incomingDir, filename), 'AUDIO_MOCK');

    vi.spyOn(ID3Service, 'extractMetadata').mockRejectedValueOnce(new Error('ID3 parse error'));

    const manifest = await buildBatchManifest({ incomingDir, sortedDir });
    expect(manifest.tracks.length).toBe(1);
    const track = manifest.tracks[0];
    expect(track.artist).toBe('Bicep');
    expect(track.title).toBe('Glue');
  });

  it('TC-MB-07: Unhyphenated Filename Fallback extracts Unknown Artist and full title', async () => {
    const filename = 'JustOneTitle.wav';
    fs.writeFileSync(path.join(incomingDir, filename), 'AUDIO_MOCK');

    vi.spyOn(ID3Service, 'extractMetadata').mockRejectedValueOnce(new Error('No ID3'));

    const manifest = await buildBatchManifest({ incomingDir, sortedDir });
    expect(manifest.tracks.length).toBe(1);
    const track = manifest.tracks[0];
    expect(track.artist).toBe('Unknown Artist');
    expect(track.title).toBe('JustOneTitle');
  });

  it('TC-MB-08: Pre-Analyzed Mode Selection triggers when intelligence or RAG hints match', async () => {
    const db = getDB();
    db.prepare(
      `
      INSERT INTO rag_examples (artist, title, folders, reasoning, source, ts)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    ).run(
      'Tale Of Us',
      'Astral',
      JSON.stringify(['galaxy trip']),
      'Melodic techno',
      'manual',
      Date.now()
    );

    fs.writeFileSync(path.join(incomingDir, 'Tale Of Us - Astral.mp3'), 'AUDIO');

    const manifest = await buildBatchManifest({ incomingDir, sortedDir });
    expect(manifest.tracks.length).toBe(1);
    expect(manifest.mode).toBe('pre-analyzed');
    expect(manifest.tracks[0].mode).toBe('pre-analyzed');
    expect(manifest.tracks[0].ragSuggestion.folder).toBe('galaxy trip');
  });

  it('TC-MB-09: Raw-Manual Mode Selection triggers when database has no records for the files', async () => {
    fs.writeFileSync(path.join(incomingDir, 'Unknown - Unheard.mp3'), 'AUDIO');

    const manifest = await buildBatchManifest({ incomingDir, sortedDir });
    expect(manifest.tracks.length).toBe(1);
    expect(manifest.mode).toBe('raw-manual');
    expect(manifest.tracks[0].mode).toBe('raw-manual');
  });

  it('TC-MB-10: Total Size MB Calculation computes total size accurately', async () => {
    const dataSize = 1024 * 1024 * 5; // 5 MB
    const buf = Buffer.alloc(dataSize);
    fs.writeFileSync(path.join(incomingDir, 'BigFile1.mp3'), buf);
    fs.writeFileSync(path.join(incomingDir, 'BigFile2.mp3'), buf);

    const manifest = await buildBatchManifest({ incomingDir, sortedDir });
    expect(manifest.totalSizeMb).toBeCloseTo(10.0, 1);
  });

  it('TC-MB-11: Zero AI Network Guarantee confirms EmbeddingService and LLMService are untouched', async () => {
    const embedSpy = vi.spyOn(EmbeddingService, 'embed');
    const classifySpy = vi.spyOn(LLMService, 'classifyTrack');

    fs.writeFileSync(path.join(incomingDir, 'Track.mp3'), 'AUDIO');
    await buildBatchManifest({ incomingDir, sortedDir });

    expect(embedSpy).not.toHaveBeenCalled();
    expect(classifySpy).not.toHaveBeenCalled();
  });

  it('TC-MB-12: Empty Directory Handling returns empty manifest gracefully', async () => {
    const manifest = await buildBatchManifest({ incomingDir, sortedDir });

    expect(manifest.totalTracks).toBe(0);
    expect(manifest.tracks).toHaveLength(0);
    expect(manifest.totalSizeMb).toBe(0);
    expect(manifest.mode).toBe('raw-manual');
  });
});
