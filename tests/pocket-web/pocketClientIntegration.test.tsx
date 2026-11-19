// @vitest-environment jsdom
import './setup.js';
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
  clearBatch,
  getAllDecisions,
  getAudioBlob,
  initIndexedDbStore,
  saveAudioBlob,
  saveBatchManifest,
  saveDecision
} from '../../pocket-web/src/engine/indexedDbStore.js';
import {
  pullBatchFromMacAction,
  commitToMacAction
} from '../../pocket-web/src/hooks/pocketSyncActions.js';
import { usePocketStore } from '../../pocket-web/src/hooks/usePocketStore.js';
import { BatchQueueView } from '../../pocket-web/src/views/BatchQueueView.js';
import { SyncBridgeView } from '../../pocket-web/src/views/SyncBridgeView.js';
import { HeaderTelemetry } from '../../pocket-web/src/components/common/HeaderTelemetry.js';
import { VibePad } from '../../pocket-web/src/components/sorter/VibePad.js';
import { App } from '../../pocket-web/src/App.js';
import type {
  PocketBatchManifest,
  PocketTrackItem
} from '../../pocket-web/src/types/pocketWeb.types.js';

describe('Tier 3: Pocket Client Sync, Views & Lifecycle Remediation', () => {
  beforeEach(async () => {
    await initIndexedDbStore(`cratemind_client_int_${Date.now()}_${Math.random()}`);
    await clearBatch();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await clearBatch();
  });

  it('TC-PI-01: pullBatchFromMacAction clears stale batch, caches audio blobs, and updates cachedAudioSize', async () => {
    await saveBatchManifest({
      batchId: 'old-batch',
      totalTracks: 1,
      tracks: [
        { id: 'stale-track', filename: 'stale.mp3', title: 'Stale', artist: 'Old', duration: 100 }
      ]
    });
    await saveDecision({
      trackId: 'stale-track',
      filename: 'stale.mp3',
      status: 'tagged',
      selectedFolders: ['psy']
    });
    await saveAudioBlob('stale-track', new Blob(['stale-audio'], { type: 'audio/aac' }));

    const audioPayload = new Blob([new Uint8Array(4096)], { type: 'audio/aac' });
    const newManifest: PocketBatchManifest = {
      batchId: 'mac-batch-1',
      totalTracks: 2,
      tracks: [
        {
          id: 'mac-1',
          filename: '01 Track A.mp3',
          title: 'Track A',
          artist: 'Artist A',
          duration: 200,
          previewAudioUrl: '/api/audio/mac-1'
        },
        {
          id: 'mac-2',
          filename: '02 Track B.mp3',
          title: 'Track B',
          artist: 'Artist B',
          duration: 210,
          previewAudioUrl: '/api/audio/mac-2'
        }
      ]
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/batch')) {
        return new Response(JSON.stringify(newManifest), { status: 200 });
      }
      if (url.startsWith('/api/audio/')) {
        return new Response(audioPayload, { status: 200 });
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const setSpy = vi.fn();
    const ok = await pullBatchFromMacAction(setSpy, 30);

    expect(ok).toBe(true);
    expect(await getAudioBlob('stale-track')).toBeNull();
    expect((await getAudioBlob('mac-1'))?.size).toBe(4096);
    expect((await getAudioBlob('mac-2'))?.size).toBe(4096);

    const storedDecisions = await getAllDecisions();
    expect(storedDecisions).toHaveLength(2);
    expect(storedDecisions.every((d) => d.status === 'pending')).toBe(true);

    const finalPatch = setSpy.mock.calls.at(-1)?.[0];
    expect(finalPatch.cachedAudioSize).toBe(8192);
    expect(finalPatch.isBridgeConnected).toBe(true);
  });

  it('TC-PI-02: commitToMacAction removes committed tracks and deletes their cached audio blobs', async () => {
    const track1: PocketTrackItem = {
      id: 't1',
      filename: '01.mp3',
      title: '01',
      artist: 'A',
      duration: 180
    };
    const track2: PocketTrackItem = {
      id: 't2',
      filename: '02.mp3',
      title: '02',
      artist: 'B',
      duration: 180
    };
    await saveAudioBlob('t1', new Blob(['audio-1']));
    await saveAudioBlob('t2', new Blob(['audio-2']));

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: true,
              batchId: 'b1',
              processedCount: 2,
              routedCount: 0,
              skippedCount: 1,
              pendingCount: 1,
              errors: []
            }),
            { status: 200 }
          )
      )
    );

    const state = {
      ...usePocketStore.getState(),
      manifest: { batchId: 'b1', totalTracks: 2, tracks: [track1, track2] },
      tracks: [track1, track2],
      activeTrackIndex: 0,
      decisions: {
        t1: { trackId: 't1', filename: '01.mp3', status: 'skipped' as const, selectedFolders: [] },
        t2: { trackId: 't2', filename: '02.mp3', status: 'pending' as const, selectedFolders: [] }
      }
    };
    const setSpy = vi.fn();
    const ok = await commitToMacAction(setSpy, () => state);

    expect(ok).toBe(true);
    expect(await getAudioBlob('t1')).toBeNull();
    expect(await getAudioBlob('t2')).not.toBeNull();
    const finalPatch = setSpy.mock.calls.at(-1)?.[0];
    expect(finalPatch.tracks).toHaveLength(1);
    expect(finalPatch.tracks[0].id).toBe('t2');
  });

  it('TC-PI-05: BatchQueueView and SyncBridgeView enable Commit when skippedCount > 0 and taggedCount === 0', () => {
    const track: PocketTrackItem = {
      id: 'sk-1',
      filename: '01.mp3',
      title: 'Skip Me',
      artist: 'DJ',
      duration: 180
    };
    render(
      <>
        <BatchQueueView
          tracks={[track]}
          decisions={{
            'sk-1': { trackId: 'sk-1', filename: '01.mp3', status: 'skipped', selectedFolders: [] }
          }}
          activeFilter="all"
          onSelectFilter={vi.fn()}
          onSelectTrack={vi.fn()}
          onCommit={vi.fn()}
        />
        <SyncBridgeView
          isBridgeConnected={true}
          isSyncing={false}
          syncError={null}
          storageQuota={{ usage: 0, quota: 1024 * 1024 * 1024, persisted: true }}
          cachedAudioSize={0}
          totalTracks={1}
          taggedCount={0}
          skippedCount={1}
          onPullBatch={vi.fn()}
          onCommitToMac={vi.fn()}
          onImportFiles={vi.fn()}
          onClearDecisions={vi.fn()}
        />
      </>
    );

    const queueCommitBtn = screen.getByRole('button', { name: 'Commit 1 to Mac' });
    const syncCommitBtn = screen.getByRole('button', { name: 'Sync 1 Sorted Tracks to Mac' });
    expect(queueCommitBtn).not.toBeDisabled();
    expect(syncCommitBtn).not.toBeDisabled();

    const clearDecisionsBtn = screen.getByRole('button', { name: 'Clear Cache & Queue' });
    expect(clearDecisionsBtn).not.toBeDisabled();
    expect(screen.getByText('0 MB / 1.00 GB')).toBeInTheDocument();
  });

  it('TC-PI-06: HeaderTelemetry shows 0 MB cleanly on mobile and VibePad uses dark contrast on selection', () => {
    const { container } = render(
      <>
        <HeaderTelemetry sortedCount={0} totalTracks={30} cachedBytes={0} ragExamplesCount={120} />
        <VibePad
          folder="psy"
          isSelected={true}
          ragBadge={null}
          isYtMatch={false}
          onToggleFolder={vi.fn()}
          onRouteInstant={vi.fn()}
        />
      </>
    );

    const cacheText = screen.getByText('CACHED • 0 MB');
    expect(cacheText.className).not.toContain('hidden');
    const pad = container.querySelector('[data-folder="psy"]') as HTMLElement;
    expect(pad?.className).toContain('bg-neutral-900');
    expect(pad?.className).toContain('pad-active');
    expect(pad?.getAttribute('data-category-color')).toBe('#FFFF00');
    expect(pad?.style.color).toBe('rgb(255, 255, 0)');
    expect(pad?.className).not.toContain('bg-amber-400');
  });

  it('TC-PI-07: App runs initStore once on mount, excludes pending from sortedCount, and shows duration badge', async () => {
    const initSpy = vi.spyOn(usePocketStore.getState(), 'initStore').mockResolvedValue();
    usePocketStore.setState({
      tracks: [
        { id: 'a1', filename: 'a1.mp3', title: 'A1', artist: 'Art', duration: 200 },
        { id: 'a2', filename: 'a2.mp3', title: 'A2', artist: 'Art', duration: 250 }
      ],
      decisions: {
        a1: { trackId: 'a1', filename: 'a1.mp3', status: 'pending', selectedFolders: [] },
        a2: { trackId: 'a2', filename: 'a2.mp3', status: 'pending', selectedFolders: [] }
      },
      activeTrackIndex: 0,
      activeView: 'sorter'
    });

    await act(async () => {
      render(<App />);
    });

    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText('0 / 2 SORTED')).toBeInTheDocument();
    expect(screen.getByText('03:20')).toBeInTheDocument();
    expect(screen.getByLabelText('Play')).toBeInTheDocument();
  });

  it('TC-PI-08: SyncBridgeView renders PocketHelpCard with quick controls and zero AI/LLM terms', () => {
    const { container } = render(
      <SyncBridgeView
        isBridgeConnected={true}
        isSyncing={false}
        syncError={null}
        storageQuota={{ usage: 0, quota: 1024 * 1024 * 1024, persisted: true }}
        cachedAudioSize={0}
        totalTracks={1}
        taggedCount={1}
        skippedCount={0}
        onPullBatch={vi.fn()}
        onCommitToMac={vi.fn()}
      />
    );

    expect(screen.getByText('QUICK CONTROLS & GESTURES')).toBeInTheDocument();
    expect(screen.getByText(/DJ TRANSPORT BUTTON/i)).toBeInTheDocument();
    expect(screen.getByText(/1× Smart Replay/i)).toBeInTheDocument();

    const textContent = container.textContent || '';
    expect(textContent).not.toMatch(/\b(AI|Gemini|LLM)\b/i);
  });

  it('TC-PI-09: routes track, advances activeTrackIndex, and triggers auto-play on next track', async () => {
    vi.spyOn(usePocketStore.getState(), 'initStore').mockResolvedValue();
    usePocketStore.setState({
      tracks: [
        { id: 't1', filename: '01.mp3', title: 'Track 1', artist: 'Artist 1', duration: 180 },
        { id: 't2', filename: '02.mp3', title: 'Track 2', artist: 'Artist 2', duration: 200 }
      ],
      decisions: {},
      selectedFolders: ['desert vibe'],
      activeTrackIndex: 0,
      activeView: 'sorter',
      isPlaying: false
    });

    await act(async () => {
      render(<App />);
    });

    const routeBtn = screen.getByRole('button', { name: /Route & Next/i });
    await act(async () => {
      fireEvent.click(routeBtn);
    });

    expect(usePocketStore.getState().activeTrackIndex).toBe(1);

    await vi.waitFor(() => {
      expect(usePocketStore.getState().isPlaying).toBe(true);
    });
  });

  it('TC-PI-10: 1× auto-replays current track from 00:00 when ended with selected folders, then stops on second end', async () => {
    vi.spyOn(usePocketStore.getState(), 'initStore').mockResolvedValue();
    usePocketStore.setState({
      tracks: [
        { id: 't1', filename: '01.mp3', title: 'Track 1', artist: 'Artist 1', duration: 180 }
      ],
      decisions: {},
      selectedFolders: ['desert vibe'],
      activeTrackIndex: 0,
      activeView: 'sorter',
      isPlaying: true
    });

    const createdAudios: HTMLAudioElement[] = [];
    const origAudio = window.Audio;
    class MockAudio extends origAudio {
      constructor(src?: string) {
        super(src);
        createdAudios.push(this);
      }
    }
    window.Audio = MockAudio as unknown as typeof Audio;

    try {
      await act(async () => {
        render(<App />);
      });

      const audio = createdAudios[0];
      expect(audio).toBeDefined();

      // Simulate track playing to 179s then ending
      audio.currentTime = 179;
      await act(async () => {
        audio.dispatchEvent(new Event('ended'));
      });

      // 1st ended event: rewound to 0 and kept playing
      expect(audio.currentTime).toBe(0);
      expect(usePocketStore.getState().isPlaying).toBe(true);

      // 2nd ended event: stops completely
      await act(async () => {
        audio.dispatchEvent(new Event('ended'));
      });

      expect(usePocketStore.getState().isPlaying).toBe(false);
    } finally {
      window.Audio = origAudio;
    }
  });

  it('TC-PI-11: stops playback immediately on track ended when no vibe folders are selected', async () => {
    vi.spyOn(usePocketStore.getState(), 'initStore').mockResolvedValue();
    usePocketStore.setState({
      tracks: [
        { id: 't1', filename: '01.mp3', title: 'Track 1', artist: 'Artist 1', duration: 180 }
      ],
      decisions: {},
      selectedFolders: [],
      activeTrackIndex: 0,
      activeView: 'sorter',
      isPlaying: true
    });

    const createdAudios: HTMLAudioElement[] = [];
    const origAudio = window.Audio;
    class MockAudio extends origAudio {
      constructor(src?: string) {
        super(src);
        createdAudios.push(this);
      }
    }
    window.Audio = MockAudio as unknown as typeof Audio;

    try {
      await act(async () => {
        render(<App />);
      });

      const audio = createdAudios[0];
      expect(audio).toBeDefined();

      await act(async () => {
        audio.dispatchEvent(new Event('ended'));
      });

      expect(usePocketStore.getState().isPlaying).toBe(false);
    } finally {
      window.Audio = origAudio;
    }
  });
});
