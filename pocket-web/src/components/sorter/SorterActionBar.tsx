import React from 'react';

interface SorterActionBarProps {
  selectedCount: number;
  onSkipTrack: () => void;
  onRouteNext: () => void;
}

export const SorterActionBar: React.FC<SorterActionBarProps> = ({
  selectedCount,
  onSkipTrack,
  onRouteNext
}) => {
  const routeButtonLabel =
    selectedCount > 0 ? `Route & Next (${selectedCount} selected)` : 'Route & Next';

  return (
    <footer className="flex justify-between items-center gap-2 pt-1.5 safe-bottom-padding border-t border-neutral-800 shrink-0">
      <button
        id="btn-skip"
        type="button"
        onClick={onSkipTrack}
        className="px-4 py-2 bg-neutral-900 hover:bg-neutral-800 text-[#FF4444] border border-[#FF4444]/40 rounded font-mono text-xs font-bold transition-colors cursor-pointer"
      >
        SKIP
      </button>

      <span className="text-[10px] text-neutral-500 font-mono hidden sm:inline">
        Hold 450ms: 1-Tap Route
      </span>

      <button
        id="btn-route"
        type="button"
        onClick={onRouteNext}
        disabled={selectedCount === 0}
        className={`flex-1 py-2 px-3 rounded font-mono text-xs font-bold transition-all text-center cursor-pointer ${
          selectedCount > 0
            ? 'bg-[#00FF00] hover:bg-[#00FF00]/90 text-black shadow-[0_0_10px_rgba(0,255,0,0.4)]'
            : 'bg-neutral-800 text-neutral-500 cursor-not-allowed border border-neutral-700'
        }`}
      >
        {routeButtonLabel}
      </button>
    </footer>
  );
};
