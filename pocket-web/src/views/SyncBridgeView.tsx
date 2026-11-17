import React, { useRef } from 'react';
import type { StorageQuotaInfo } from '../hooks/pocketStore.types.js';
import { exportDecisionsAsJson } from '../engine/indexedDbStore.js';

export interface SyncBridgeViewProps {
  isBridgeConnected: boolean;
  isSyncing: boolean;
  syncError: string | null;
  storageQuota: StorageQuotaInfo;
  cachedAudioSize: number;
  totalTracks: number;
  taggedCount: number;
  skippedCount?: number;
  onPullBatch: () => void;
  onCommitToMac: () => void;
  onImportFiles: (files: File[]) => void;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export const SyncBridgeView: React.FC<SyncBridgeViewProps> = ({
  isBridgeConnected,
  isSyncing,
  syncError,
  storageQuota,
  cachedAudioSize,
  totalTracks,
  taggedCount,
  skippedCount = 0,
  onPullBatch,
  onCommitToMac,
  onImportFiles
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleExportJson = async () => {
    try {
      const jsonStr = await exportDecisionsAsJson();
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cratemind-decisions-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // Export failed
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const filesArray = Array.from(e.target.files);
      onImportFiles(filesArray);
    }
  };

  const usedBytes = cachedAudioSize;
  const quotaBytes = storageQuota.quota || 5 * 1024 * 1024 * 1024;
  const storagePercent =
    usedBytes > 0 ? Math.min(100, Math.round((usedBytes / quotaBytes) * 100)) : 0;
  const actionableCount = taggedCount + skippedCount;

  return (
    <div
      data-view="sync"
      className="flex flex-col flex-1 h-full w-full max-w-[390px] mx-auto bg-black text-neutral-200 select-none overflow-y-auto p-3 space-y-3 font-sans"
    >
      <header className="border-b border-neutral-800 pb-2">
        <h2 className="text-sm font-bold tracking-wider text-white">SYNC &amp; LOCAL STORAGE</h2>
        <p className="text-[11px] text-neutral-400">
          Wi-Fi Daemon Bridge &amp; Offline Persistence
        </p>
      </header>

      {syncError && (
        <div className="p-2.5 rounded bg-red-950/60 border border-red-800/80 text-red-200 text-xs font-mono">
          ⚠ {syncError}
        </div>
      )}

      {/* Card 1: Wi-Fi Bridge */}
      <section className="bg-neutral-900/80 border border-neutral-800 rounded-lg p-3">
        <div className="flex justify-between items-center mb-2">
          <span className="text-xs font-bold text-white">Local Wi-Fi Bridge</span>
          <span
            className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
              isBridgeConnected
                ? 'bg-[#00FF00]/20 text-[#00FF00]'
                : 'bg-neutral-800 text-neutral-400'
            }`}
          >
            {isBridgeConnected ? 'ONLINE' : 'STANDALONE'}
          </span>
        </div>
        <p className="text-xs text-neutral-400 mb-3">
          Fetch incoming unorganized tracks from your Mac local bridge daemon over local network.
        </p>
        <button
          type="button"
          onClick={onPullBatch}
          disabled={isSyncing}
          className="w-full py-2 bg-neutral-800 hover:bg-neutral-700 text-[#00FFFF] border border-[#00FFFF]/40 rounded font-mono text-xs font-bold transition-colors cursor-pointer"
        >
          {isSyncing
            ? 'CONNECTING...'
            : totalTracks > 0
              ? `Add +30 More Tracks (${totalTracks} in queue)`
              : 'Pull 30 Tracks from Mac (Wi-Fi)'}
        </button>
      </section>

      {/* Card 2: Autonomous iPhone Files Import */}
      <section className="bg-neutral-900/80 border border-neutral-800 rounded-lg p-3">
        <span className="text-xs font-bold text-white block mb-1">Autonomous Files Import</span>
        <p className="text-xs text-neutral-400 mb-3">
          Curate music completely offline without Mac. Pick audio files from iPhone Files app.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="audio/*,.mp3,.wav,.flac,.aiff,.m4a,.aac,.ogg"
          className="hidden"
          onChange={handleFileChange}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="w-full py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 rounded font-mono text-xs font-bold transition-colors cursor-pointer"
        >
          Import Audio from iPhone Files
        </button>
      </section>

      {/* Card 3: Storage Meter */}
      <section className="bg-neutral-900/80 border border-neutral-800 rounded-lg p-3">
        <div className="flex justify-between items-center mb-1 text-xs">
          <span className="font-bold text-white">iPhone Offline Storage</span>
          <span className="text-neutral-400 font-mono">
            {formatBytes(usedBytes)} / {formatBytes(quotaBytes)}
          </span>
        </div>
        <div className="w-full bg-neutral-950 rounded-full h-2 my-2 overflow-hidden border border-neutral-800">
          <div
            className="bg-[#00FF00] h-full rounded-full transition-all duration-300"
            style={{ width: `${usedBytes > 0 ? Math.max(2, storagePercent) : 0}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] font-mono text-neutral-400 mt-1">
          <span>Active Tracks: {totalTracks}</span>
          <span>Storage: {storageQuota.persisted ? 'PERSISTED' : 'STANDARD'}</span>
        </div>
      </section>

      {/* Card 4: Commit & Export */}
      <section className="bg-neutral-900/80 border border-neutral-800 rounded-lg p-3 space-y-2">
        <span className="text-xs font-bold text-white block mb-1">Commit Decisions</span>
        <button
          type="button"
          onClick={onCommitToMac}
          disabled={isSyncing || actionableCount === 0}
          className={`w-full py-2.5 rounded font-mono text-xs font-bold transition-all ${
            actionableCount > 0 && !isSyncing
              ? 'bg-[#00FF00] text-black shadow-[0_0_10px_rgba(0,255,0,0.4)] cursor-pointer'
              : 'bg-neutral-800 text-neutral-500 cursor-not-allowed border border-neutral-700'
          }`}
        >
          {isSyncing ? 'SYNCING...' : `Sync ${actionableCount} Sorted Tracks to Mac`}
        </button>

        <button
          type="button"
          onClick={handleExportJson}
          className="w-full py-2 bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-700 rounded font-mono text-xs font-bold transition-colors cursor-pointer"
        >
          Export Decisions as JSON
        </button>
      </section>
    </div>
  );
};
