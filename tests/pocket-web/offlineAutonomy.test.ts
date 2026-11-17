// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { usePocketStore } from '../../pocket-web/src/hooks/usePocketStore.js';
import {
  initIndexedDbStore,
  saveBatchManifest,
  getPendingMutations,
  clearBatch,
  closeIndexedDb
} from '../../pocket-web/src/engine/indexedDbStore.js';
import type { PocketBatchManifest } from '../../pocket-web/src/types/pocketWeb.types.js';

describe('Offline Autonomy & Outbox Queue', () => {
  const mockManifest: PocketBatchManifest = {
    batchId: 'offline-test-batch',
    generatedAt: Date.now(),
    totalTracks: 1,
    tracks: [
      {
        id: 'track-offline-01',
        filename: '01 Underground Minimal.wav',
        title: 'Underground Minimal',
        artist: 'Unknown Artist',
        duration: 240,
        bpm: 126,
        key: '8A'
      }
    ]
  };

  beforeEach(async () => {
    await initIndexedDbStore();
    await clearBatch();
    await saveBatchManifest(mockManifest);
  });

  afterEach(async () => {
    await clearBatch();
    await closeIndexedDb();
    vi.restoreAllMocks();
  });

  it('TC-OA-01: boots offline from IndexedDB when network rejects and logs pending mutation', async () => {
    // Mock network failure / timeout
    global.fetch = vi.fn().mockRejectedValue(new Error('Network unreachable (Offline Simulation)'));

    // Reinitialize store (local-first hydration)
    await usePocketStore.getState().initStore();

    // Verify tracks loaded locally from IndexedDB
    const state = usePocketStore.getState();
    expect(state.tracks.length).toBe(1);
    expect(state.tracks[0].title).toBe('Underground Minimal');
    expect(state.isBridgeConnected).toBe(false);

    // Route track in offline mode
    await usePocketStore.getState().routeTrack(['techno']);

    // Assert decision is reflected in store
    const updatedState = usePocketStore.getState();
    expect(updatedState.decisions['track-offline-01']).toBeDefined();
    expect(updatedState.decisions['track-offline-01'].status).toBe('tagged');
    expect(updatedState.decisions['track-offline-01'].selectedFolders).toEqual(['techno']);

    // Assert decision was enqueued into pending_mutations outbox in IndexedDB
    const pending = await getPendingMutations();
    expect(pending.length).toBeGreaterThanOrEqual(1);
    const lastMut = pending.find((m) => m.trackId === 'track-offline-01');
    expect(lastMut).toBeDefined();
    expect(lastMut?.createdAt).toBeGreaterThan(0);
  });
});
