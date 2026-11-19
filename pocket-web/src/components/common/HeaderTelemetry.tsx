import React from 'react';

interface HeaderTelemetryProps {
  sortedCount: number;
  totalTracks: number;
  cachedBytes: number;
  ragExamplesCount?: number;
}

export const HeaderTelemetry: React.FC<HeaderTelemetryProps> = ({
  sortedCount,
  totalTracks,
  cachedBytes
}) => {
  const cachedMb = Math.round(cachedBytes / (1024 * 1024));

  return (
    <header className="header-telemetry w-full grid grid-cols-3 items-center gap-1 text-[9px] font-mono text-neutral-400 border-b border-neutral-900 pb-1.5 px-2.5 safe-top-padding whitespace-nowrap">
      <div className="flex items-center min-w-0">
        <span className="text-[#00FF00] font-bold text-[10px] tracking-tight truncate">
          ★ CRATEMIND POCKET
        </span>
      </div>

      <div className="flex items-center justify-center">
        <span className="bg-[#00FF00]/10 text-[#00FF00] border border-[#00FF00]/40 px-1.5 py-0.2 rounded text-[8.5px] font-bold">
          {sortedCount} / {totalTracks} SORTED
        </span>
      </div>

      <div className="flex items-center justify-end shrink-0">
        <span className="text-[8.5px] text-neutral-400">CACHED • {cachedMb} MB</span>
      </div>
    </header>
  );
};
