import React from 'react';
import type { PocketTrackItem, PocketDecision } from '../../types/pocketWeb.types.js';
import { useLongPress } from '../../hooks/useLongPress.js';

export interface QueueTrackRowProps {
  track: PocketTrackItem;
  index: number;
  decision?: PocketDecision;
  isCurrent: boolean;
  onSelectTrack: (trackIndex: number) => void;
  onPlayTrack?: (trackIndex: number) => void;
  onUndoDecision?: (trackId: string) => void;
}

export const QueueTrackRow: React.FC<QueueTrackRowProps> = ({
  track,
  index,
  decision,
  isCurrent,
  onSelectTrack,
  onPlayTrack,
  onUndoDecision
}) => {
  const status = decision?.status || 'pending';
  const isResettable = (status === 'tagged' || status === 'skipped') && Boolean(onUndoDecision);

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

  const longPressHandlers = useLongPress(
    () => {
      if (isResettable && onUndoDecision) {
        onUndoDecision(track.id);
      }
    },
    {
      delay: 450,
      threshold: 10,
      vibrateMs: 50,
      onClick: () => onSelectTrack(index)
    }
  );

  const rowInteractionProps = isResettable
    ? longPressHandlers
    : { onClick: () => onSelectTrack(index) };

  return (
    <div
      data-track-id={track.id}
      data-status={status}
      {...rowInteractionProps}
      className={`p-2 rounded-lg border transition-all cursor-pointer flex justify-between items-center gap-2 ${
        isCurrent
          ? 'bg-neutral-900 border-[#00FFFF]/50 shadow-[0_0_8px_rgba(0,255,255,0.2)]'
          : 'bg-neutral-900/60 border-neutral-800 hover:border-neutral-700'
      }`}
    >
      <button
        type="button"
        aria-label={`Play ${track.title || track.filename}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (onPlayTrack) {
            onPlayTrack(index);
          } else {
            onSelectTrack(index);
          }
        }}
        className="w-6 h-6 shrink-0 rounded bg-neutral-800 hover:bg-neutral-700 text-[#00FF00] border border-neutral-700 flex items-center justify-center text-[10px] font-mono cursor-pointer"
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
};
