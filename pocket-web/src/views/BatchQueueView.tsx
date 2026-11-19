import React from 'react';
import type { PocketTrackItem, PocketDecision } from '../types/pocketWeb.types.js';
import type { QueueFilter } from '../hooks/pocketStore.types.js';

export interface BatchQueueViewProps {
  tracks: PocketTrackItem[];
  decisions: Record<string, PocketDecision>;
  activeFilter: QueueFilter;
  activeTrackId?: string;
  onSelectFilter: (filter: QueueFilter) => void;
  onSelectTrack: (trackIndex: number) => void;
  onCommit: () => void;
  isSyncing?: boolean;
}

export const BatchQueueView: React.FC<BatchQueueViewProps> = ({
  tracks,
  decisions,
  activeFilter,
  activeTrackId,
  onSelectFilter,
  onSelectTrack,
  onCommit,
  isSyncing = false
}) => {
  const pendingCount = tracks.filter(
    (t) => (decisions[t.id]?.status || 'pending') === 'pending'
  ).length;
  const taggedCount = tracks.filter((t) => decisions[t.id]?.status === 'tagged').length;
  const skippedCount = tracks.filter((t) => decisions[t.id]?.status === 'skipped').length;
  const actionableCount = taggedCount + skippedCount;

  const filteredTracks = tracks.filter((track) => {
    const decision = decisions[track.id];
    const status = decision?.status || 'pending';

    if (activeFilter === 'pending' && status !== 'pending') return false;
    if (activeFilter === 'tagged' && status !== 'tagged') return false;
    if (activeFilter === 'skipped' && status !== 'skipped') return false;
    return true;
  });

  return (
    <div
      data-view="queue"
      className="flex flex-col flex-1 h-full w-full max-w-[390px] mx-auto bg-black text-neutral-200 select-none overflow-hidden justify-between p-3 font-sans min-h-0"
    >
      {/* Filter Pills */}
      <div className="flex gap-1.5 mb-2 overflow-x-auto pb-1 text-xs font-mono shrink-0">
        {(
          [
            { id: 'all', label: `All (${tracks.length})` },
            { id: 'pending', label: `Pending (${pendingCount})` },
            { id: 'tagged', label: `Tagged (${taggedCount})` },
            { id: 'skipped', label: `Skipped (${skippedCount})` }
          ] as const
        ).map((pill) => (
          <button
            key={pill.id}
            type="button"
            onClick={() => onSelectFilter(pill.id)}
            className={`px-2.5 py-1 rounded-full whitespace-nowrap text-[11px] transition-colors ${
              activeFilter === pill.id
                ? 'bg-neutral-800 text-[#00FFFF] border border-[#00FFFF]/50 font-bold'
                : 'bg-neutral-900/80 text-neutral-400 border border-neutral-800 hover:text-neutral-200'
            }`}
          >
            {pill.label}
          </button>
        ))}
      </div>

      {/* Scrollable Track List */}
      <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 my-1 min-h-0 overscroll-contain">
        {filteredTracks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-neutral-500 text-xs">
            <span>No tracks found</span>
          </div>
        ) : (
          filteredTracks.map((track) => {
            const index = tracks.findIndex((t) => t.id === track.id);
            const decision = decisions[track.id];
            const status = decision?.status || 'pending';
            const isCurrent = track.id === activeTrackId;
            const ragMatch = track.ragSuggestions?.[0]
              ? {
                  folder: track.ragSuggestions[0].folder,
                  pct: Math.round(track.ragSuggestions[0].similarity * 100)
                }
              : track.ragSuggestion?.folder
                ? {
                    folder: track.ragSuggestion.folder,
                    pct: track.ragSuggestion.confidence
                  }
                : null;
            const ytMatchFolder = track.ytScout?.matchedFolder || track.ytScout?.suggestedFolder;

            return (
              <div
                key={track.id}
                onClick={() => onSelectTrack(index)}
                className={`p-2 rounded-lg border transition-all cursor-pointer flex justify-between items-center gap-2 ${
                  isCurrent
                    ? 'bg-neutral-900 border-[#00FFFF]/50 shadow-[0_0_8px_rgba(0,255,255,0.2)]'
                    : 'bg-neutral-900/60 border-neutral-800 hover:border-neutral-700'
                }`}
              >
                <button
                  type="button"
                  aria-label={`Play ${track.title || track.filename}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectTrack(index);
                  }}
                  className="w-6 h-6 shrink-0 rounded bg-neutral-800 hover:bg-neutral-700 text-[#00FF00] border border-neutral-700 flex items-center justify-center text-[10px] font-mono"
                >
                  ▶
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`text-[10px] font-mono px-1 py-0.2 rounded font-bold ${
                        status === 'tagged'
                          ? 'bg-[#00FF00]/20 text-[#00FF00]'
                          : status === 'skipped'
                            ? 'bg-[#FF4444]/20 text-[#FF4444]'
                            : 'bg-neutral-800 text-neutral-400'
                      }`}
                    >
                      {status.toUpperCase()}
                    </span>
                    <span
                      className={`text-xs font-semibold truncate ${
                        status === 'skipped' ? 'line-through text-neutral-500' : 'text-white'
                      }`}
                    >
                      {track.title || track.filename}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 mt-1 text-[10px] text-neutral-400 font-mono">
                    <span className="truncate max-w-[120px]">{track.artist || 'Unknown'}</span>
                    {track.bpm && <span>• {track.bpm} BPM</span>}
                    {track.key && <span className="text-[#FFFF00]">[{track.key}]</span>}
                  </div>

                  {decision?.selectedFolders && decision.selectedFolders.length > 0 ? (
                    <div className="flex gap-1 flex-wrap mt-1">
                      {decision.selectedFolders.map((f) => (
                        <span
                          key={f}
                          className="text-[9px] px-1 py-0.2 bg-neutral-800 text-[#FFFF00] rounded border border-[#FFFF00]/30 font-mono"
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                  ) : (
                    status === 'pending' && (
                      <div className="flex gap-1 flex-wrap mt-1">
                        {ragMatch && (
                          <span className="text-[9px] px-1 py-0.2 bg-[#00FFFF]/10 text-[#00FFFF] rounded border border-[#00FFFF]/30 font-mono">
                            {ragMatch.folder} (RAG {ragMatch.pct}%)
                          </span>
                        )}
                        {ytMatchFolder && (
                          <span className="text-[9px] px-1 py-0.2 bg-[#FF00FF]/10 text-[#FF00FF] rounded border border-[#FF00FF]/30 font-mono">
                            {ytMatchFolder} (YT)
                          </span>
                        )}
                        {!ragMatch && !ytMatchFolder && track.mode === 'raw-manual' && (
                          <span className="text-[9px] px-1 py-0.2 bg-neutral-800 text-neutral-400 rounded border border-neutral-700 font-mono">
                            RAW AUDIO • MANUAL
                          </span>
                        )}
                      </div>
                    )
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Sticky Bottom Commit Bar */}
      <footer className="pt-2 safe-bottom-padding border-t border-neutral-800 shrink-0">
        <button
          type="button"
          onClick={onCommit}
          disabled={isSyncing || actionableCount === 0}
          className={`w-full py-2.5 px-4 rounded-lg font-mono text-xs font-bold transition-all text-center ${
            actionableCount > 0 && !isSyncing
              ? 'bg-[#00FF00] hover:bg-[#00FF00]/90 text-black shadow-[0_0_12px_rgba(0,255,0,0.4)] cursor-pointer'
              : 'bg-neutral-800 text-neutral-500 cursor-not-allowed border border-neutral-700'
          }`}
        >
          {isSyncing ? 'COMMITTING...' : `Commit ${actionableCount} to Mac`}
        </button>
      </footer>
    </div>
  );
};
