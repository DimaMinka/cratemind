import React from 'react';
import type { PocketTrackItem } from '../../types/pocketWeb.types.js';
import { WaveformBar } from './WaveformBar.js';

interface PlayerCardProps {
  currentTrack: PocketTrackItem;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  onTogglePlay: () => void;
  onSeekBackward: () => void;
  onSeekForward: () => void;
  onOpenInspector: () => void;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export const PlayerCard: React.FC<PlayerCardProps> = ({
  currentTrack,
  isPlaying,
  currentTime,
  duration,
  onTogglePlay,
  onSeekBackward,
  onSeekForward,
  onOpenInspector
}) => {
  const displayDuration = currentTrack.duration || duration || 220;
  const scout = currentTrack.ytScout as
    | {
        playlistName?: string;
        playlistTitle?: string | null;
        suggestedFolder?: string;
      }
    | undefined;
  const playlistName = scout?.playlistName || scout?.playlistTitle;

  return (
    <section className="bg-neutral-900/90 border border-neutral-800 rounded-lg p-2.5 my-1 shadow-md">
      {/* Track Title & Inspector button */}
      <div className="flex justify-between items-start">
        <div className="overflow-hidden pr-2">
          <h2 className="track-title text-sm font-bold truncate text-white tracking-wide">
            {currentTrack.title || currentTrack.filename}
          </h2>
          <p className="text-xs text-neutral-400 truncate">
            {currentTrack.artist || 'Unknown Artist'}
          </p>
        </div>
        <button
          type="button"
          aria-label="Open Inspector"
          onClick={onOpenInspector}
          className="text-xs font-mono font-bold px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-[#00FFFF] rounded border border-[#00FFFF]/40 transition-colors"
        >
          INFO
        </button>
      </div>

      {/* Badges: BPM, Key, YT Scout */}
      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
        {currentTrack.bpm && (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300 border border-neutral-700">
            {currentTrack.bpm} BPM
          </span>
        )}
        {currentTrack.key && (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-[#FFFF00] border border-[#FFFF00]/40">
            {currentTrack.key}
          </span>
        )}
        {playlistName && (
          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#00FFFF]/10 text-[#00FFFF] border border-[#00FFFF]/30 truncate max-w-[200px]">
            YT SCOUT: {playlistName}
          </span>
        )}
      </div>

      {/* 16-Segment Waveform Bar */}
      <WaveformBar
        energyShape={currentTrack.energyShape}
        currentTime={currentTime}
        duration={displayDuration}
      />

      {/* Playback Controls & Time */}
      <div className="flex justify-between items-center pt-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSeekBackward}
            className="text-[10px] font-mono px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded border border-neutral-700"
          >
            -10s
          </button>
          <button
            type="button"
            onClick={onTogglePlay}
            className={`text-xs font-bold px-3 py-1 rounded transition-colors ${
              isPlaying
                ? 'bg-[#00FF00] text-black font-mono shadow-[0_0_8px_#00FF00]'
                : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700'
            }`}
          >
            {isPlaying ? 'PAUSE' : 'PLAY'}
          </button>
          <button
            type="button"
            onClick={onSeekForward}
            className="text-[10px] font-mono px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded border border-neutral-700"
          >
            +30s
          </button>
        </div>

        <span className="text-[10px] font-mono text-neutral-400">
          {formatTime(currentTime)} / {formatTime(displayDuration)}
        </span>
      </div>
    </section>
  );
};
