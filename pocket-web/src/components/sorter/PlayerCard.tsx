import React, { useEffect, useRef, useState } from 'react';
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
}

const HOLD_DELAY_MS = 350;
const HOLD_REPEAT_MS = 350;
const DOUBLE_TAP_WINDOW_MS = 280;

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
  onSeekForward
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

  const [isSeekingForward, setIsSeekingForward] = useState(false);

  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHoldingRef = useRef(false);
  const isPointerDownRef = useRef(false);
  const lastTapTimeRef = useRef(0);

  const clearHoldTimers = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (holdIntervalRef.current) {
      clearInterval(holdIntervalRef.current);
      holdIntervalRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      clearHoldTimers();
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
    };
  }, []);

  const triggerHaptic = (ms: number) => {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(ms);
    }
  };

  const handlePlayPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    isPointerDownRef.current = true;
    isHoldingRef.current = false;
    clearHoldTimers();

    holdTimerRef.current = setTimeout(() => {
      isHoldingRef.current = true;
      setIsSeekingForward(true);
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      lastTapTimeRef.current = 0;
      triggerHaptic(15);
      onSeekForward();

      holdIntervalRef.current = setInterval(() => {
        triggerHaptic(10);
        onSeekForward();
      }, HOLD_REPEAT_MS);
    }, HOLD_DELAY_MS);
  };

  const handlePlayPointerUp = () => {
    if (!isPointerDownRef.current) return;
    isPointerDownRef.current = false;
    clearHoldTimers();

    if (isHoldingRef.current) {
      isHoldingRef.current = false;
      setIsSeekingForward(false);
      return;
    }

    const now = Date.now();
    if (now - lastTapTimeRef.current <= DOUBLE_TAP_WINDOW_MS) {
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      lastTapTimeRef.current = 0;
      triggerHaptic(20);
      onSeekBackward();
    } else {
      lastTapTimeRef.current = now;
      singleTapTimerRef.current = setTimeout(() => {
        singleTapTimerRef.current = null;
        lastTapTimeRef.current = 0;
        onTogglePlay();
      }, DOUBLE_TAP_WINDOW_MS);
    }
  };

  const handlePlayPointerCancel = () => {
    isPointerDownRef.current = false;
    isHoldingRef.current = false;
    setIsSeekingForward(false);
    clearHoldTimers();
  };

  return (
    <section className="bg-neutral-900/90 border border-neutral-800 rounded-lg p-2.5 my-1 shadow-md">
      {/* Track Info & DJ Controller Play/Pause Button */}
      <div className="flex justify-between items-center gap-2 mb-2.5">
        <div className="min-w-0 flex-1">
          <h2 className="track-title text-sm font-bold truncate text-white tracking-wide">
            {currentTrack.title || currentTrack.filename}
          </h2>
          <p className="text-xs text-neutral-400 truncate">
            {currentTrack.artist || 'Unknown Artist'}
          </p>

          {/* Badges: Duration, BPM, Key, YT Scout */}
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/40">
              {formatTime(displayDuration)}
            </span>
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
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#00FFFF]/10 text-[#00FFFF] border border-[#00FFFF]/30 truncate max-w-[160px]">
                YT SCOUT: {playlistName}
              </span>
            )}
          </div>
        </div>

        {/* Square DJ Controller Play/Pause Button */}
        <button
          type="button"
          aria-label={isPlaying ? 'Pause' : 'Play'}
          onPointerDown={handlePlayPointerDown}
          onPointerUp={handlePlayPointerUp}
          onPointerLeave={handlePlayPointerCancel}
          onPointerCancel={handlePlayPointerCancel}
          onContextMenu={(e) => e.preventDefault()}
          className={`dj-play-btn w-12 h-12 min-w-[48px] min-h-[48px] shrink-0 rounded-lg border-2 flex flex-col items-center justify-center font-mono select-none touch-none transition-all cursor-pointer ${
            isSeekingForward
              ? 'bg-[#00FFFF]/20 border-[#00FFFF] text-[#00FFFF] shadow-[0_0_12px_rgba(0,255,255,0.5)]'
              : isPlaying
                ? 'bg-[#00FF00] border-[#00FF00] text-black shadow-[0_0_12px_rgba(0,255,0,0.6)]'
                : 'bg-neutral-900 hover:bg-neutral-800 border-[#00FF00]/60 text-[#00FF00] shadow-[inset_0_0_8px_rgba(0,255,0,0.12)]'
          }`}
        >
          <span className="text-base leading-none font-bold">
            {isSeekingForward ? '»' : isPlaying ? '❚❚' : '▶'}
          </span>
          <span className="text-[8px] font-bold tracking-wider mt-0.5 leading-none">
            {isSeekingForward ? '+10s' : isPlaying ? 'PAUSE' : 'PLAY'}
          </span>
        </button>
      </div>

      {/* 16-Segment Waveform Bar */}
      <WaveformBar
        energyShape={currentTrack.energyShape}
        currentTime={currentTime}
        duration={displayDuration}
      />
    </section>
  );
};
