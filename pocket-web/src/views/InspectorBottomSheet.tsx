import React from 'react';
import type { PocketTrackItem } from '../types/pocketWeb.types.js';

export interface InspectorBottomSheetProps {
  isOpen: boolean;
  track: PocketTrackItem | null;
  onClose: () => void;
  onApplyMatches: () => void;
}

export const InspectorBottomSheet: React.FC<InspectorBottomSheetProps> = ({
  isOpen,
  track,
  onClose,
  onApplyMatches
}) => {
  if (!isOpen || !track) return null;

  const scout = track.ytScout;
  const playlistTitle = scout?.playlistTitle || scout?.playlistName;
  const ytFolder = scout?.matchedFolder || scout?.suggestedFolder;
  const ytNeighbors = scout?.neighbors ?? [];

  const ragFolder =
    track.ragSuggestions && track.ragSuggestions.length > 0
      ? track.ragSuggestions[0].folder
      : track.ragSuggestion?.folder;
  const ragConfidence =
    track.ragSuggestions && track.ragSuggestions.length > 0
      ? Math.round(track.ragSuggestions[0].similarity * 100)
      : track.ragSuggestion?.confidence;
  const ragNeighbors = track.ragSuggestion?.neighbors ?? [];

  const collectedSuggestions: string[] = [];
  if (ragFolder && !collectedSuggestions.includes(ragFolder)) collectedSuggestions.push(ragFolder);
  if (ytFolder && !collectedSuggestions.includes(ytFolder)) collectedSuggestions.push(ytFolder);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-[390px] max-w-[390px] max-h-[750px] bg-neutral-950 border-t border-x border-neutral-800 rounded-t-2xl p-4 flex flex-col justify-between overflow-y-auto select-none font-sans"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Grabber handle & Header */}
        <div>
          <div className="w-12 h-1 bg-neutral-700 rounded-full mx-auto mb-3" />
          <div className="flex justify-between items-start border-b border-neutral-800 pb-2">
            <div className="overflow-hidden pr-2">
              <span className="text-[10px] font-mono text-[#00FFFF] tracking-wider uppercase">
                Acoustic &amp; Vector Inspector
              </span>
              <h3 className="text-sm font-bold text-white truncate mt-0.5">
                {track.title || track.filename}
              </h3>
              <p className="text-xs text-neutral-400 truncate">
                {track.artist || 'Unknown Artist'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-neutral-400 hover:text-white text-xs font-mono px-2 py-1 bg-neutral-900 border border-neutral-800 rounded"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content Cards */}
        <div className="space-y-2.5 my-3">
          {/* YouTube Scout Card */}
          <div className="bg-neutral-900/90 border border-neutral-800 rounded-lg p-2.5">
            <div className="flex justify-between items-center mb-1">
              <span className="text-[10px] font-mono text-[#00FFFF] font-bold">
                YOUTUBE NETWORK SCOUT
              </span>
              {ytFolder && (
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#FF00FF]/20 text-[#FF00FF] border border-[#FF00FF]/30 font-bold">
                  {ytFolder}
                </span>
              )}
            </div>
            {playlistTitle ? (
              <div className="space-y-1">
                <p className="text-xs text-neutral-300">
                  Matched Set: <span className="text-white font-medium">{playlistTitle}</span>
                </p>
                {ytNeighbors.length > 0 && (
                  <div className="pl-2 border-l border-[#00FFFF]/30 space-y-0.5 font-mono text-[11px] text-neutral-400">
                    {ytNeighbors.map((neighbor) => (
                      <div
                        key={`${neighbor.index}-${neighbor.artist}-${neighbor.title}`}
                        className="truncate"
                      >
                        #{neighbor.index} {neighbor.artist}
                        {neighbor.folder ? ` -> ${neighbor.folder}` : ''}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-neutral-500">No YouTube set match identified</p>
            )}
          </div>

          {/* Few-Shot RAG Card */}
          <div className="bg-neutral-900/90 border border-neutral-800 rounded-lg p-2.5">
            <div className="flex justify-between items-center mb-1">
              <span className="text-[10px] font-mono text-[#00FF00] font-bold">
                FEW-SHOT RAG (VECTOR DB)
              </span>
              {ragFolder && (
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#00FF00]/20 text-[#00FF00] border border-[#00FF00]/30 font-bold">
                  {ragFolder} ({ragConfidence}%)
                </span>
              )}
            </div>
            {ragNeighbors.length > 0 ? (
              <div className="space-y-1.5 mt-1.5 font-mono">
                {ragNeighbors.map((neighbor, idx) => (
                  <div
                    key={`${idx}-${neighbor.artist}-${neighbor.title}`}
                    className="bg-neutral-950 p-1.5 rounded border border-neutral-800 flex flex-col gap-0.5"
                  >
                    <span className="text-xs text-white font-medium truncate">
                      {neighbor.artist} - {neighbor.title}
                    </span>
                    <span className="text-[11px] text-neutral-400">
                      Cosine {neighbor.similarity.toFixed(2)} -&gt; {neighbor.folder}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-neutral-400">
                {ragFolder
                  ? 'Similarity derived from 512-dim CLAP audio embeddings in local database.'
                  : 'No local vector neighbors found for this track.'}
              </p>
            )}
          </div>
        </div>

        {/* 1-Tap Apply Action */}
        <div className="pt-2 border-t border-neutral-800">
          <button
            type="button"
            onClick={onApplyMatches}
            disabled={collectedSuggestions.length === 0}
            className={`w-full py-2.5 px-4 rounded-lg font-mono text-xs font-bold transition-all text-center ${
              collectedSuggestions.length > 0
                ? 'bg-[#00FFFF] hover:bg-[#00FFFF]/90 text-black shadow-[0_0_12px_rgba(0,255,255,0.4)] cursor-pointer'
                : 'bg-neutral-800 text-neutral-500 cursor-not-allowed border border-neutral-700'
            }`}
          >
            {collectedSuggestions.length > 0
              ? `Apply RAG + YT Matches (${collectedSuggestions.join(', ')})`
              : 'No Suggestions Available'}
          </button>
        </div>
      </div>
    </div>
  );
};
