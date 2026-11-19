// @vitest-environment jsdom
import './setup.js';
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
  clearBatch,
  enqueueMutation,
  getAllDecisions,
  getAudioBlob,
  getPendingMutations,
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
import { clearShellCachesAndReload } from '../../pocket-web/src/hooks/usePwaUpdate.js';
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

  it('TC-PI-08: SyncBridgeView renders PocketHelpCard as collapsible accordion with zero AI/LLM terms', () => {
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

    // 1. Collapsed by default
    const toggleBtn = screen.getByRole('button', { name: /QUICK CONTROLS & GESTURES/i });
    expect(toggleBtn).toBeInTheDocument();
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('[+] HELP')).toBeInTheDocument();
    expect(screen.queryByText(/DJ TRANSPORT BUTTON/i)).not.toBeInTheDocument();

    // 2. Click to expand
    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('[−] HIDE')).toBeInTheDocument();
    expect(screen.getByText(/DJ TRANSPORT BUTTON/i)).toBeInTheDocument();
    expect(screen.getByText(/1× Smart Replay/i)).toBeInTheDocument();
    expect(screen.getByText('RAG XX%')).toBeInTheDocument();
    expect(screen.getByText('YT MATCH')).toBeInTheDocument();
    expect(screen.getByText(/QUEUE & RE-TAGGING/i)).toBeInTheDocument();
    expect(screen.getByText(/SYNC & OFFLINE STORAGE/i)).toBeInTheDocument();
    expect(screen.getByText(/HOW POCKET WORKS/i)).toBeInTheDocument();
    expect(screen.getByText(/256kbps AAC/i)).toBeInTheDocument();
    expect(screen.getByText(/\.pocket-cache\/previews\//i)).toBeInTheDocument();

    // 3. Strict zero AI / LLM copy policy across expanded content
    const textContent = container.textContent || '';
    expect(textContent).not.toMatch(/\b(AI|Gemini|LLM)\b/i);

    // 4. Click again to collapse
    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/DJ TRANSPORT BUTTON/i)).not.toBeInTheDocument();
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

  it('TC-PI-12: HeaderTelemetry swaps to high-contrast update banner when hasUpdate is true while keeping .header-telemetry', () => {
    const onUpdateClick = vi.fn();
    const { container } = render(
      <HeaderTelemetry
        sortedCount={3}
        totalTracks={30}
        cachedBytes={1024 * 1024 * 10}
        hasUpdate={true}
        onUpdateClick={onUpdateClick}
      />
    );

    const header = container.querySelector('.header-telemetry');
    expect(header).not.toBeNull();
    expect(screen.queryByText('3 / 30 SORTED')).not.toBeInTheDocument();

    const updateBtn = screen.getByRole('button', { name: /UPDATE AVAILABLE • TAP TO RELOAD/i });
    expect(updateBtn).toBeInTheDocument();
    fireEvent.click(updateBtn);
    expect(onUpdateClick).toHaveBeenCalledTimes(1);
  });

  it('TC-PI-13: SyncBridgeView shows versionLabel and guards Force Reload Shell behind Wi-Fi bridge status', () => {
    const onForceReloadShell = vi.fn();
    const { rerender } = render(
      <SyncBridgeView
        isBridgeConnected={false}
        isSyncing={false}
        syncError={null}
        storageQuota={{ usage: 0, quota: 1024 * 1024 * 1024, persisted: true }}
        cachedAudioSize={0}
        totalTracks={1}
        taggedCount={0}
        onPullBatch={vi.fn()}
        onCommitToMac={vi.fn()}
        versionLabel="v0.1.0 • #abc1234"
        hasUpdate={false}
        onForceReloadShell={onForceReloadShell}
      />
    );

    expect(screen.getByText('v0.1.0 • #abc1234')).toBeInTheDocument();
    const offlineBtn = screen.getByRole('button', {
      name: /Force Reload Shell \(Requires Wi-Fi\)/i
    });
    expect(offlineBtn).toBeDisabled();

    rerender(
      <SyncBridgeView
        isBridgeConnected={true}
        isSyncing={false}
        syncError={null}
        storageQuota={{ usage: 0, quota: 1024 * 1024 * 1024, persisted: true }}
        cachedAudioSize={0}
        totalTracks={1}
        taggedCount={0}
        onPullBatch={vi.fn()}
        onCommitToMac={vi.fn()}
        versionLabel="v0.1.0 • #abc1234"
        hasUpdate={true}
        onForceReloadShell={onForceReloadShell}
      />
    );

    expect(screen.getByText('UPDATE READY')).toBeInTheDocument();
    const onlineBtn = screen.getByRole('button', { name: /Update Ready — Reload Shell/i });
    expect(onlineBtn).not.toBeDisabled();
    fireEvent.click(onlineBtn);
    expect(onForceReloadShell).toHaveBeenCalledTimes(1);
  });

  it('TC-PI-14: clearShellCachesAndReload purges CacheStorage and SW without touching IndexedDB audio blobs', async () => {
    await saveAudioBlob('keep-me', new Blob(['offline-audio'], { type: 'audio/mp4' }));

    const deleteCacheSpy = vi.fn().mockResolvedValue(true);
    const unregisterSpy = vi.fn().mockResolvedValue(true);
    const reloadSpy = vi.fn();

    Object.defineProperty(window, 'caches', {
      value: {
        keys: vi.fn().mockResolvedValue(['workbox-precache-v2']),
        delete: deleteCacheSpy
      },
      configurable: true
    });
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        getRegistrations: vi.fn().mockResolvedValue([{ unregister: unregisterSpy }])
      },
      configurable: true
    });

    await clearShellCachesAndReload(reloadSpy);

    expect(unregisterSpy).toHaveBeenCalledTimes(1);
    expect(deleteCacheSpy).toHaveBeenCalledWith('workbox-precache-v2');
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    // IndexedDB audio blob must remain untouched
    expect(await getAudioBlob('keep-me')).not.toBeNull();
  });

  it('TC-PI-15: App automatically swaps HeaderTelemetry to update banner when a waiting Service Worker is detected', async () => {
    vi.spyOn(usePocketStore.getState(), 'initStore').mockResolvedValue();
    usePocketStore.setState({
      tracks: [{ id: 'a1', filename: 'a1.mp3', title: 'A1', artist: 'Art', duration: 200 }],
      decisions: {},
      activeTrackIndex: 0,
      activeView: 'sorter'
    });

    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        getRegistrations: vi.fn().mockResolvedValue([
          {
            waiting: { postMessage: vi.fn() },
            update: vi.fn().mockResolvedValue(undefined)
          }
        ])
      },
      configurable: true
    });

    await act(async () => {
      render(<App />);
    });

    await vi.waitFor(() => {
      expect(
        screen.getByRole('button', { name: /UPDATE AVAILABLE • TAP TO RELOAD/i })
      ).toBeInTheDocument();
    });
  });

  it('TC-PI-16: BatchQueueView supports 450ms long-press reset on tagged/skipped rows, scroll cancel, and Play button autoplay trigger', () => {
    vi.useFakeTimers();
    try {
      const tracks: PocketTrackItem[] = [
        { id: 'q1', filename: '01.mp3', title: 'Tagged Track', artist: 'A', duration: 180 },
        { id: 'q2', filename: '02.mp3', title: 'Skipped Track', artist: 'B', duration: 180 },
        { id: 'q3', filename: '03.mp3', title: 'Pending Track', artist: 'C', duration: 180 }
      ];
      const onSelectTrack = vi.fn();
      const onPlayTrack = vi.fn();
      const onUndoDecision = vi.fn();

      const { container } = render(
        <BatchQueueView
          tracks={tracks}
          decisions={{
            q1: { trackId: 'q1', filename: '01.mp3', status: 'tagged', selectedFolders: ['psy'] },
            q2: { trackId: 'q2', filename: '02.mp3', status: 'skipped', selectedFolders: [] },
            q3: { trackId: 'q3', filename: '03.mp3', status: 'pending', selectedFolders: [] }
          }}
          activeFilter="all"
          onSelectFilter={vi.fn()}
          onSelectTrack={onSelectTrack}
          onPlayTrack={onPlayTrack}
          onUndoDecision={onUndoDecision}
          onCommit={vi.fn()}
        />
      );

      const taggedRow = container.querySelector('[data-track-id="q1"]') as HTMLElement;
      const skippedRow = container.querySelector('[data-track-id="q2"]') as HTMLElement;
      const pendingRow = container.querySelector('[data-track-id="q3"]') as HTMLElement;

      // 1. 450ms long-press on tagged row -> resets to pending, suppresses release click
      act(() => {
        fireEvent.pointerDown(taggedRow, { clientX: 100, clientY: 100 });
        vi.advanceTimersByTime(450);
        fireEvent.pointerUp(taggedRow);
        fireEvent.click(taggedRow);
      });
      expect(onUndoDecision).toHaveBeenCalledWith('q1');
      expect(onSelectTrack).not.toHaveBeenCalled();

      // 2. Scroll (>10px move) on skipped row cancels long-press
      act(() => {
        fireEvent.pointerDown(skippedRow, { clientX: 100, clientY: 100 });
        vi.advanceTimersByTime(200);
        fireEvent.pointerMove(skippedRow, { clientX: 100, clientY: 130 });
        vi.advanceTimersByTime(300);
        fireEvent.pointerUp(skippedRow);
      });
      expect(onUndoDecision).toHaveBeenCalledTimes(1);

      // 3. 450ms long-press on skipped row -> resets to pending
      act(() => {
        fireEvent.pointerDown(skippedRow, { clientX: 100, clientY: 100 });
        vi.advanceTimersByTime(450);
        fireEvent.pointerUp(skippedRow);
      });
      expect(onUndoDecision).toHaveBeenCalledWith('q2');

      // 4. Short tap on pending row opens Sorter without triggering undo
      fireEvent.click(pendingRow);
      expect(onSelectTrack).toHaveBeenCalledWith(2);

      // 5. Clicking mini-Play button triggers onPlayTrack (jump to Sorter & play immediately)
      const playBtn = screen.getByLabelText('Play Tagged Track');
      fireEvent.pointerDown(playBtn, { clientX: 10, clientY: 10 });
      fireEvent.click(playBtn);
      expect(onPlayTrack).toHaveBeenCalledWith(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('TC-PI-17: undoDecision resets track to pending, clears active selectedFolders, and prunes stale pending_mutations', async () => {
    const decision = {
      trackId: 'u1',
      filename: 'u1.mp3',
      status: 'tagged' as const,
      selectedFolders: ['desert vibe']
    };
    await enqueueMutation({
      id: 'mut_u1_1',
      trackId: 'u1',
      decision,
      createdAt: Date.now()
    });

    usePocketStore.setState({
      tracks: [{ id: 'u1', filename: 'u1.mp3', title: 'U1', artist: 'Art', duration: 180 }],
      activeTrackIndex: 0,
      selectedFolders: ['desert vibe'],
      decisions: { u1: decision }
    });

    await usePocketStore.getState().undoDecision('u1');

    expect(usePocketStore.getState().decisions['u1'].status).toBe('pending');
    expect(usePocketStore.getState().decisions['u1'].selectedFolders).toEqual([]);
    expect(usePocketStore.getState().selectedFolders).toEqual([]);
    const remainingMutations = await getPendingMutations();
    expect(remainingMutations.some((m) => m.trackId === 'u1')).toBe(false);
  });

  it('TC-PI-18: App renders LandscapeGuardOverlay with ROTATE TO PORTRAIT and Play/Pause button', async () => {
    vi.spyOn(usePocketStore.getState(), 'initStore').mockResolvedValue();
    usePocketStore.setState({
      tracks: [{ id: 'lg1', filename: 'lg1.mp3', title: 'LG1', artist: 'Art', duration: 180 }],
      decisions: {},
      activeTrackIndex: 0,
      activeView: 'sorter',
      isPlaying: false
    });

    await act(async () => {
      render(<App />);
    });

    const guard = screen.getByTestId('landscape-guard');
    expect(guard).toBeInTheDocument();
    expect(guard.className).toContain('landscape-guard-overlay');
    expect(screen.getByText('ROTATE TO PORTRAIT')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Play playback/i })).toBeInTheDocument();
  });
});
