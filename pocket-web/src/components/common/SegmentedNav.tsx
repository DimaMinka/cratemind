import React from 'react';
import type { PocketView } from '../../hooks/pocketStore.types.js';

interface SegmentedNavProps {
  activeView: PocketView;
  queueCount: number;
  onSelectView: (view: PocketView) => void;
}

export const SegmentedNav: React.FC<SegmentedNavProps> = ({
  activeView,
  queueCount,
  onSelectView
}) => {
  return (
    <nav className="grid grid-cols-3 gap-1 bg-[#141414] p-1 rounded-lg mx-3 my-1 border border-neutral-800">
      <button
        id="tab-sorter"
        type="button"
        onClick={() => onSelectView('sorter')}
        className={`py-1.5 text-xs font-mono rounded-md transition-all cursor-pointer ${
          activeView === 'sorter'
            ? 'active bg-[#1F1F1F] text-[#00FF00] font-bold border border-[#00FF00]/50 shadow-[0_0_8px_rgba(0,255,0,0.25)]'
            : 'text-neutral-400 hover:text-white'
        }`}
      >
        Sorter
      </button>

      <button
        id="tab-queue"
        type="button"
        onClick={() => onSelectView('queue')}
        className={`py-1.5 text-xs font-mono rounded-md transition-all cursor-pointer ${
          activeView === 'queue'
            ? 'active bg-[#1F1F1F] text-[#00FF00] font-bold border border-[#00FF00]/50 shadow-[0_0_8px_rgba(0,255,0,0.25)]'
            : 'text-neutral-400 hover:text-white'
        }`}
      >
        Queue ({queueCount})
      </button>

      <button
        id="tab-sync"
        type="button"
        onClick={() => onSelectView('sync')}
        className={`py-1.5 text-xs font-mono rounded-md transition-all cursor-pointer ${
          activeView === 'sync'
            ? 'active bg-[#1F1F1F] text-[#00FF00] font-bold border border-[#00FF00]/50 shadow-[0_0_8px_rgba(0,255,0,0.25)]'
            : 'text-neutral-400 hover:text-white'
        }`}
      >
        Sync
      </button>
    </nav>
  );
};
