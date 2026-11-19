import React from 'react';

interface LandscapeGuardOverlayProps {
  isPlaying: boolean;
  hasTrack: boolean;
  onTogglePlay: () => void;
}

export const LandscapeGuardOverlay: React.FC<LandscapeGuardOverlayProps> = ({
  isPlaying,
  hasTrack,
  onTogglePlay
}) => {
  return (
    <div
      data-testid="landscape-guard"
      className="landscape-guard-overlay fixed inset-0 z-50 bg-black text-neutral-200 flex-col items-center justify-center p-6 text-center select-none"
    >
      <div className="flex flex-col items-center gap-3 max-w-xs">
        <div className="w-12 h-12 rounded-xl bg-neutral-900 border-2 border-[#00FF00] flex items-center justify-center shadow-[0_0_16px_rgba(0,255,0,0.35)]">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#00FF00"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="7" y="2" width="10" height="20" rx="2" />
            <path d="M12 18h.01" />
          </svg>
        </div>

        <h2 className="text-sm font-mono font-bold tracking-widest text-[#00FF00]">
          ROTATE TO PORTRAIT
        </h2>
        <p className="text-xs text-neutral-400">
          CrateMind Pocket is designed for vertical DJ mode.
        </p>

        {hasTrack && (
          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={isPlaying ? 'Pause playback' : 'Play playback'}
            className={`mt-2 min-h-[44px] px-5 py-2 rounded-lg border-2 font-mono text-xs font-bold tracking-wider transition-all cursor-pointer ${
              isPlaying
                ? 'bg-[#00FF00] border-[#00FF00] text-black shadow-[0_0_12px_rgba(0,255,0,0.5)]'
                : 'bg-neutral-900 border-[#00FF00]/60 text-[#00FF00]'
            }`}
          >
            {isPlaying ? '❚❚ PAUSE' : '▶ PLAY'}
          </button>
        )}
      </div>
    </div>
  );
};
