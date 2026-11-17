import React, { useEffect, useRef } from 'react';
import { usePocketStore } from './hooks/usePocketStore.js';
import { IosAudioEngine } from './engine/iosAudioEngine.js';
import { getAudioBlob } from './engine/indexedDbStore.js';
import { HeaderTelemetry } from './components/common/HeaderTelemetry.js';
import { SegmentedNav } from './components/common/SegmentedNav.js';
import { ScanlineOverlay } from './components/common/ScanlineOverlay.js';
import { VibeSorterView } from './components/sorter/VibeSorterView.js';
import { BatchQueueView } from './views/BatchQueueView.js';
import { SyncBridgeView } from './views/SyncBridgeView.js';
import { InspectorBottomSheet } from './views/InspectorBottomSheet.js';

export const App: React.FC = () => {
  const {
    manifest,
    tracks,
    activeTrackIndex,
    decisions,
    selectedFolders,
    activeView,
    isInspectorOpen,
    queueFilter,
    queueSearchQuery,
    isPlaying,
    currentTime,
    duration,
    cachedAudioSize,
    isBridgeConnected,
    isSyncing,
    syncError,
    storageQuota,
    setActiveView,
    setInspectorOpen,
    setQueueFilter,
    setQueueSearchQuery,
    toggleFolder,
    routeTrack,
    skipTrack,
    selectTrackIndex,
    applyRagAndYtMatches,
    setIsPlaying,
    setPlaybackTime,
    checkBridgeHealth,
    initStore,
    pullBatchFromMac,
    commitToMac,
    importLocalFiles
  } = usePocketStore();

  const audioEngineRef = useRef<IosAudioEngine | null>(null);
  if (!audioEngineRef.current) {
    audioEngineRef.current = new IosAudioEngine();
  }

  const currentTrack = tracks[activeTrackIndex] || null;
  const currentDurationRef = useRef<number>(220);
  currentDurationRef.current = currentTrack?.duration || 220;

  const taggedCount = tracks.filter((t) => decisions[t.id]?.status === 'tagged').length;
  const skippedCount = tracks.filter((t) => decisions[t.id]?.status === 'skipped').length;
  const sortedCount = Object.values(decisions).filter(
    (d) => d.status === 'tagged' || d.status === 'skipped'
  ).length;

  // Initialize store strictly once on mount
  useEffect(() => {
    void initStore();
  }, [initStore]);

  // Refresh Mac bridge health when opening Sync view
  useEffect(() => {
    if (activeView === 'sync') {
      void checkBridgeHealth();
    }
  }, [activeView, checkBridgeHealth]);

  // Attach single persistent audio engine callbacks and timeupdate listener
  useEffect(() => {
    const engine = audioEngineRef.current;
    if (!engine) return;

    engine.onTrackEnded(() => {
      setIsPlaying(false);
    });
    engine.onNext(() => {
      void usePocketStore.getState().routeTrack();
    });
    engine.onPrev(() => {
      usePocketStore.getState().prevTrack();
    });

    const audio = engine.getAudioElement();
    const handleTimeUpdate = () => {
      const targetDuration =
        Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.duration
          : currentDurationRef.current;
      setPlaybackTime(audio.currentTime, targetDuration);
    };
    audio.addEventListener('timeupdate', handleTimeUpdate);
    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, [setIsPlaying, setPlaybackTime]);

  // Load track when active track changes (preferring offline IndexedDB blob)
  useEffect(() => {
    let cancelled = false;
    const engine = audioEngineRef.current;
    if (!currentTrack || !engine) return;

    setIsPlaying(false);
    setPlaybackTime(0, currentTrack.duration || 220);

    void getAudioBlob(currentTrack.id)
      .catch(() => null)
      .then((blob) => {
        if (!cancelled) {
          void engine.loadTrack(currentTrack, blob ?? undefined);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [currentTrack, setIsPlaying, setPlaybackTime]);

  const handleTogglePlay = () => {
    const engine = audioEngineRef.current;
    if (!engine) return;

    if (isPlaying) {
      engine.pause();
      setIsPlaying(false);
    } else {
      void engine.unlock();
      void engine
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
    }
  };

  const handleSeekBackward = () => {
    const engine = audioEngineRef.current;
    if (engine) {
      const audio = engine.getAudioElement();
      const targetDuration =
        Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.duration
          : currentTrack?.duration || 220;
      audio.currentTime = Math.max(0, audio.currentTime - 10);
      setPlaybackTime(audio.currentTime, targetDuration);
      engine.updatePositionState();
    }
  };

  const handleSeekForward = () => {
    const engine = audioEngineRef.current;
    if (engine) {
      const audio = engine.getAudioElement();
      const targetDuration =
        Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.duration
          : currentTrack?.duration || 220;
      audio.currentTime = Math.min(targetDuration, audio.currentTime + 30);
      setPlaybackTime(audio.currentTime, targetDuration);
      engine.updatePositionState();
    }
  };

  return (
    <div
      id="app"
      className="flex flex-col min-h-dvh w-full max-w-[390px] mx-auto bg-black text-neutral-200 select-none overflow-x-hidden overflow-y-auto relative justify-between font-sans border-x border-neutral-900"
    >
      <ScanlineOverlay />

      {/* Header Telemetry */}
      <HeaderTelemetry
        sortedCount={sortedCount}
        totalTracks={tracks.length}
        cachedBytes={cachedAudioSize}
        ragExamplesCount={manifest?.ragExamplesCount ?? 574}
      />

      {/* Segmented Tab Navigation */}
      <SegmentedNav
        activeView={activeView}
        queueCount={tracks.length}
        onSelectView={setActiveView}
      />

      {/* View Containers (toggled via display for E2E DOM compliance) */}
      <div
        id="view-sorter"
        style={{ display: activeView === 'sorter' ? 'flex' : 'none' }}
        className="flex-1 flex-col justify-between overflow-hidden"
      >
        {currentTrack ? (
          <VibeSorterView
            showHeader={false}
            isActive={activeView === 'sorter' && !isInspectorOpen}
            currentTrack={currentTrack}
            trackIndex={activeTrackIndex}
            totalTracks={tracks.length}
            selectedFolders={selectedFolders}
            onToggleFolder={toggleFolder}
            onRouteInstant={(f) => void routeTrack(f)}
            onRouteNext={() => void routeTrack()}
            onSkipTrack={() => void skipTrack()}
            onOpenInspector={() => setInspectorOpen(true)}
            isPlaying={isPlaying}
            currentTime={currentTime}
            duration={duration}
            onTogglePlay={handleTogglePlay}
            onSeekBackward={handleSeekBackward}
            onSeekForward={handleSeekForward}
          />
        ) : (
          <div className="flex flex-col flex-1 items-center justify-center p-6 text-center space-y-3">
            <span className="text-xs font-mono text-[#00FF00] font-bold">
              BATCH COMPLETE • INCOMING CLEAR
            </span>
            <p className="text-xs text-neutral-400">
              All tracks in this batch have been committed. Pull a new batch from Sync.
            </p>
            <button
              type="button"
              onClick={() => setActiveView('sync')}
              className="px-4 py-2 bg-neutral-900 border border-[#00FFFF]/40 text-[#00FFFF] rounded font-mono text-xs font-bold cursor-pointer"
            >
              Open Sync Bridge
            </button>
          </div>
        )}
      </div>

      <div
        id="view-queue"
        style={{ display: activeView === 'queue' ? 'flex' : 'none' }}
        className="flex-1 flex-col justify-between overflow-hidden min-h-0"
      >
        <BatchQueueView
          tracks={tracks}
          decisions={decisions}
          activeFilter={queueFilter}
          searchQuery={queueSearchQuery}
          activeTrackId={currentTrack?.id}
          onSelectFilter={setQueueFilter}
          onSearchChange={setQueueSearchQuery}
          onSelectTrack={selectTrackIndex}
          onOpenInspector={(t) => {
            selectTrackIndex(tracks.findIndex((x) => x.id === t.id));
            setInspectorOpen(true);
          }}
          onCommit={() => void commitToMac()}
          isSyncing={isSyncing}
        />
      </div>

      <div
        id="view-sync"
        style={{ display: activeView === 'sync' ? 'flex' : 'none' }}
        className="flex-1 flex-col justify-between overflow-hidden"
      >
        <SyncBridgeView
          isBridgeConnected={isBridgeConnected}
          isSyncing={isSyncing}
          syncError={syncError}
          storageQuota={storageQuota}
          cachedAudioSize={cachedAudioSize}
          totalTracks={tracks.length}
          taggedCount={taggedCount}
          skippedCount={skippedCount}
          onPullBatch={() => void pullBatchFromMac()}
          onCommitToMac={() => void commitToMac()}
          onImportFiles={(files) => void importLocalFiles(files)}
        />
      </div>

      {/* Inspector Bottom Sheet Modal */}
      <InspectorBottomSheet
        isOpen={isInspectorOpen}
        track={currentTrack}
        onClose={() => setInspectorOpen(false)}
        onApplyMatches={() => void applyRagAndYtMatches()}
      />
    </div>
  );
};

export default App;
