import React from 'react';
import type { PocketTrackItem, PocketDecision } from '../types/pocketWeb.types.js';
import type { QueueFilter } from '../hooks/pocketStore.types.js';
import { QueueTrackRow } from '../components/queue/QueueTrackRow.js';

export interface BatchQueueViewProps {
  tracks: PocketTrackItem[];
  decisions: Record<string, PocketDecision>;
  activeFilter: QueueFilter;
  activeTrackId?: string;
  onSelectFilter: (filter: QueueFilter) => void;
  onSelectTrack: (trackIndex: number) => void;
  onPlayTrack?: (trackIndex: number) => void;
  onUndoDecision?: (trackId: string) => void;
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
  onPlayTrack,
  onUndoDecision,
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
            return (
              <QueueTrackRow
                key={track.id}
                track={track}
                index={index}
                decision={decisions[track.id]}
                isCurrent={track.id === activeTrackId}
                onSelectTrack={onSelectTrack}
                onPlayTrack={onPlayTrack}
                onUndoDecision={onUndoDecision}
              />
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
