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
  cachedBytes,
  ragExamplesCount = 574
}) => {
  const cachedMb = Math.round(cachedBytes / (1024 * 1024));

  return (
    <header className="header-telemetry w-full flex justify-between items-center gap-1 text-[9px] font-mono text-neutral-400 border-b border-neutral-900 pb-1.5 px-2.5 pt-2 safe-top-padding whitespace-nowrap">
      <div className="flex items-center gap-1 min-w-0">
        <span className="text-[#00FF00] font-bold text-[10px] tracking-tight">
          ★ CRATEMIND POCKET
        </span>
        <span className="bg-[#00FF00]/10 text-[#00FF00] border border-[#00FF00]/40 px-1 py-0.2 rounded text-[8.5px] font-bold">
          {sortedCount} / {totalTracks} SORTED
        </span>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <span className="text-[8.5px] text-neutral-400">OFFLINE CACHED • {cachedMb} MB</span>
        <span className="bg-[#00FFFF]/10 text-[#00FFFF] border border-[#00FFFF]/30 px-1 py-0.2 rounded text-[8.5px] font-bold">
          RAG: {ragExamplesCount}
        </span>
      </div>
    </header>
  );
};
