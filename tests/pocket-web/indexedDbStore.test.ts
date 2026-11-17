// @vitest-environment jsdom
import './setup.js';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  initIndexedDbStore,
  saveBatchManifest,
  getBatchManifest,
  saveAudioBlob,
  getAudioBlob,
  saveDecision,
  getDecision,
  getAllDecisions,
  getFilteredTracks,
  exportDecisionsAsJson,
  clearBatch,
  requestPersistentStorage,
  getTotalCachedAudioSize
} from '../../pocket-web/src/storage/indexedDbStore.js';
import type {
  PocketBatchManifest,
  PocketDecision
} from '../../pocket-web/src/types/pocketWeb.types.js';

describe('Tier 3: indexedDbStore (Offline Storage & Persistence)', () => {
  const sampleManifest: PocketBatchManifest = {
    batchId: 'batch-test-001',
    generatedAt: Date.now(),
    totalTracks: 2,
    totalSizeMb: 14.2,
    ragExamplesCount: 574,
    mode: 'pre-analyzed',
    tracks: [
      {
        id: 'track-1',
        filename: '01 Desert Mirage.mp3',
        title: 'Desert Mirage',
        artist: 'Bedouin Sound',
        duration: 215,
        bpm: 122,
        key: '8A',
        ragSuggestions: [{ folder: 'desert vibe', similarity: 0.94, matchSource: 'clap' }]
      },
      {
        id: 'track-2',
        filename: '02 Forest Echoes.mp3',
        title: 'Forest Echoes',
        artist: 'Greenwood',
        duration: 180,
        bpm: 126,
        key: '11B',
        ragSuggestions: [{ folder: 'magic forest', similarity: 0.88, matchSource: 'token' }]
      }
    ]
  };

  beforeEach(async () => {
    await initIndexedDbStore(`cratemind_test_db_${Date.now()}_${Math.random()}`);
  });

  afterEach(async () => {
    await clearBatch();
  });

  describe('Manifest Operations', () => {
    it('TC-IDB-01: saves and retrieves a complete batch manifest with track metadata', async () => {
      await saveBatchManifest(sampleManifest);
      const retrieved = await getBatchManifest();
      expect(retrieved).not.toBeNull();
      expect(retrieved?.batchId).toBe('batch-test-001');
      expect(retrieved?.tracks).toHaveLength(2);
      expect(retrieved?.tracks[0].title).toBe('Desert Mirage');
      expect(retrieved?.tracks[0].ragSuggestions?.[0].similarity).toBe(0.94);
    });

    it('TC-IDB-02: returns null when retrieving manifest from an empty store', async () => {
      const retrieved = await getBatchManifest();
      expect(retrieved).toBeNull();
    });

    it('TC-IDB-03: overwrites previous manifest when a new batch is imported', async () => {
      await saveBatchManifest(sampleManifest);
      const newManifest: PocketBatchManifest = {
        ...sampleManifest,
        batchId: 'batch-test-002',
        tracks: [sampleManifest.tracks[0]]
      };
      await saveBatchManifest(newManifest);
      const retrieved = await getBatchManifest();
      expect(retrieved?.batchId).toBe('batch-test-002');
      expect(retrieved?.tracks).toHaveLength(1);
    });
  });

  describe('Audio Blob Caching', () => {
    it('TC-IDB-04: caches and retrieves binary audio blobs by trackId', async () => {
      const mockBlob = new Blob(['mock audio stream data'], { type: 'audio/aac' });
      await saveAudioBlob('track-1', mockBlob);

      const cached = await getAudioBlob('track-1');
      expect(cached).not.toBeNull();
      expect(cached?.size).toBe(mockBlob.size);
      expect(cached?.type).toBe('audio/aac');
    });

    it('TC-IDB-05: returns null when requesting non-existent audio blob', async () => {
      const cached = await getAudioBlob('non-existent-track');
      expect(cached).toBeNull();
    });

    it('TC-IDB-06: calculates total cached audio size across stored blobs', async () => {
      const blob1 = new Blob([new Uint8Array(1024 * 100)], { type: 'audio/aac' });
      const blob2 = new Blob([new Uint8Array(1024 * 200)], { type: 'audio/aac' });
      await saveAudioBlob('track-1', blob1);
      await saveAudioBlob('track-2', blob2);

      const totalBytes = await getTotalCachedAudioSize();
      expect(totalBytes).toBe(1024 * 300);
    });
  });

  describe('Decisions State Transitions & Queue Filtering', () => {
    it('TC-IDB-07: persists tagged and skipped decisions correctly', async () => {
      const tagDecision: PocketDecision = {
        trackId: 'track-1',
        filename: '01 Desert Mirage.mp3',
        status: 'tagged',
        selectedFolders: ['desert vibe', 'nargila vibe'],
        decisionTimestamp: Date.now()
      };
      await saveDecision(tagDecision);

      const retrieved = await getDecision('track-1');
      expect(retrieved).toEqual(tagDecision);
    });

    it('TC-IDB-08: filters tracks by "all", "pending", "tagged", and "skipped" status', async () => {
      await saveBatchManifest(sampleManifest);
      await saveDecision({
        trackId: 'track-1',
        filename: '01 Desert Mirage.mp3',
        status: 'tagged',
        selectedFolders: ['desert vibe'],
        decisionTimestamp: Date.now()
      });

      const all = await getFilteredTracks('all');
      const pending = await getFilteredTracks('pending');
      const tagged = await getFilteredTracks('tagged');
      const skipped = await getFilteredTracks('skipped');

      expect(all).toHaveLength(2);
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe('track-2');
      expect(tagged).toHaveLength(1);
      expect(tagged[0].id).toBe('track-1');
      expect(skipped).toHaveLength(0);
    });

    it('TC-IDB-09: transitions track to skipped with empty folders list', async () => {
      await saveBatchManifest(sampleManifest);
      await saveDecision({
        trackId: 'track-2',
        filename: '02 Forest Echoes.mp3',
        status: 'skipped',
        selectedFolders: [],
        decisionTimestamp: Date.now()
      });

      const skipped = await getFilteredTracks('skipped');
      expect(skipped).toHaveLength(1);
      expect(skipped[0].id).toBe('track-2');
    });
  });

  describe('Storage Persistence & JSON Export', () => {
    it('TC-IDB-10: requests persistent storage and returns persistence status and quota', async () => {
      const result = await requestPersistentStorage();
      expect(navigator.storage.persist).toHaveBeenCalled();
      expect(result.persisted).toBe(true);
      expect(result.quota).toBeGreaterThan(0);
    });

    it('TC-IDB-11: exports all decisions as structured JSON string', async () => {
      await saveBatchManifest(sampleManifest);
      await saveDecision({
        trackId: 'track-1',
        filename: '01 Desert Mirage.mp3',
        status: 'tagged',
        selectedFolders: ['desert vibe'],
        decisionTimestamp: 1700000000000
      });

      const jsonStr = await exportDecisionsAsJson();
      const parsed = JSON.parse(jsonStr);
      expect(parsed.batchId).toBe('batch-test-001');
      expect(parsed.decisions).toHaveLength(2);
      const tagged = parsed.decisions.find((d: PocketDecision) => d.trackId === 'track-1');
      expect(tagged.selectedFolders).toEqual(['desert vibe']);
    });

    it('TC-IDB-12: clears all stores on clearBatch leaving store pristine', async () => {
      await saveBatchManifest(sampleManifest);
      await saveAudioBlob('track-1', new Blob(['test']));
      await clearBatch();

      expect(await getBatchManifest()).toBeNull();
      expect(await getAudioBlob('track-1')).toBeNull();
      expect(await getAllDecisions()).toHaveLength(0);
    });

    it('TC-IDB-13: saveBatchManifest aborts atomically on error without partial commit', async () => {
      await saveBatchManifest(sampleManifest);

      const badManifest = {
        batchId: 'batch-corrupt',
        generatedAt: Date.now(),
        totalTracks: 2,
        tracks: [
          sampleManifest.tracks[0],
          { ...sampleManifest.tracks[1], id: undefined as unknown as string }
        ]
      } as PocketBatchManifest;

      await expect(saveBatchManifest(badManifest)).rejects.toThrow();
      const retrieved = await getBatchManifest();
      expect(retrieved?.batchId).toBe('batch-test-001');
    });

    it('TC-IDB-14: replacing batch prunes stale decisions from prior batch in exportDecisionsAsJson', async () => {
      await saveBatchManifest(sampleManifest);
      await saveDecision({
        trackId: 'track-2',
        filename: '02 Forest Echoes.mp3',
        status: 'skipped',
        selectedFolders: [],
        decisionTimestamp: Date.now()
      });

      const nextManifest: PocketBatchManifest = {
        batchId: 'batch-test-003',
        generatedAt: Date.now(),
        totalTracks: 1,
        tracks: [sampleManifest.tracks[0]]
      };
      await saveBatchManifest(nextManifest);

      const exported = JSON.parse(await exportDecisionsAsJson());
      expect(exported.batchId).toBe('batch-test-003');
      expect(exported.decisions).toHaveLength(1);
      expect(exported.decisions[0].trackId).toBe('track-1');
    });

    it('TC-IDB-15: exportDecisionsAsJson preserves totalTracks=0 when manifest is empty', async () => {
      await saveBatchManifest({
        batchId: 'empty-batch',
        generatedAt: Date.now(),
        totalTracks: 0,
        tracks: []
      });

      const exported = JSON.parse(await exportDecisionsAsJson());
      expect(exported.totalTracks).toBe(0);
      expect(exported.decisions).toHaveLength(0);
    });
  });
});
