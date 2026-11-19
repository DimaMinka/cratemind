import React from 'react';

interface HeaderTelemetryProps {
  sortedCount: number;
  totalTracks: number;
  cachedBytes: number;
  ragExamplesCount?: number;
  hasUpdate?: boolean;
  isUpdating?: boolean;
  onUpdateClick?: () => void;
}

export const HeaderTelemetry: React.FC<HeaderTelemetryProps> = ({
  sortedCount,
  totalTracks,
  cachedBytes,
  hasUpdate = false,
  isUpdating = false,
  onUpdateClick
}) => {
  const cachedMb = Math.round(cachedBytes / (1024 * 1024));

  if (hasUpdate) {
    return (
      <header className="header-telemetry w-full safe-top-padding pb-1.5 px-2.5 bg-[#FFFF00] border-b border-[#FFFF00] shadow-[0_0_12px_rgba(255,255,0,0.45)]">
        <button
          type="button"
          onClick={onUpdateClick}
          disabled={isUpdating}
          className="w-full flex items-center justify-center gap-1.5 text-[10px] font-mono font-bold tracking-wider text-black cursor-pointer whitespace-nowrap"
        >
          <span>{isUpdating ? '↻ UPDATING SHELL...' : '★ UPDATE AVAILABLE • TAP TO RELOAD'}</span>
        </button>
      </header>
    );
  }

  return (
    <header className="header-telemetry w-full grid grid-cols-3 items-center gap-1 text-[9px] font-mono text-neutral-400 border-b border-neutral-900 pb-1.5 px-2.5 safe-top-padding whitespace-nowrap">
      <div className="flex items-center min-w-0">
        <span className="text-[8.5px] text-neutral-400">
          {sortedCount} / {totalTracks} SORTED
        </span>
      </div>

      <div className="flex items-center justify-center">
        <span className="text-[#00FF00] font-bold text-[10px] tracking-tight">
          CRATEMIND POCKET
        </span>
      </div>

      <div className="flex items-center justify-end shrink-0">
        <span className="text-[8.5px] text-neutral-400">CACHED • {cachedMb} MB</span>
      </div>
    </header>
  );
};
