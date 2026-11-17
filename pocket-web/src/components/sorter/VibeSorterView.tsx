import React from 'react';
import type { PocketTrackItem } from '../../types/pocketWeb.types.js';
import { PlayerCard } from './PlayerCard.js';
import { VibePadGrid } from './VibePadGrid.js';
import { SorterActionBar } from './SorterActionBar.js';
import { useGlobalSwipe } from '../../hooks/useSwipe.js';

export interface VibeSorterViewProps {
  currentTrack: PocketTrackItem;
  trackIndex: number;
  totalTracks: number;
  selectedFolders: string[];
  onToggleFolder: (folder: string) => void;
  onRouteInstant: (folder: string) => void;
  onSkipTrack: () => void;
  onOpenInspector: () => void;
  onRouteNext?: () => void;
  isPlaying?: boolean;
  currentTime?: number;
  duration?: number;
  onTogglePlay?: () => void;
  onSeekBackward?: () => void;
  onSeekForward?: () => void;
  showHeader?: boolean;
  isActive?: boolean;
}

export const VibeSorterView: React.FC<VibeSorterViewProps> = ({
  currentTrack,
  trackIndex,
  totalTracks,
  selectedFolders,
  onToggleFolder,
  onRouteInstant,
  onSkipTrack,
  onOpenInspector,
  onRouteNext,
  isPlaying = false,
  currentTime = 0,
  duration = 220,
  onTogglePlay = () => {},
  onSeekBackward = () => {},
  onSeekForward = () => {},
  showHeader = true,
  isActive = true
}) => {
  // Wire global swipe-left to skip track (40px threshold) when active
  useGlobalSwipe(
    {
      thresholdX: 40,
      onSwipeLeft: onSkipTrack
    },
    isActive
  );

  const handleRouteNext = () => {
    if (onRouteNext) {
      onRouteNext();
    } else if (selectedFolders.length > 0) {
      onRouteInstant(selectedFolders[0]);
    }
  };

  return (
    <div
      data-view="sorter"
      className="flex flex-col flex-1 h-full w-full max-w-[390px] mx-auto bg-black text-neutral-200 select-none overflow-hidden justify-between p-2 font-sans min-h-0"
    >
      {/* Top Header Telemetry */}
      {showHeader && (
        <header className="flex justify-between items-center text-xs border-b border-neutral-800 pb-2">
          <span className="font-bold tracking-wider text-amber-400">★ CRATEMIND POCKET</span>
          <span className="text-neutral-400 font-mono">
            {trackIndex + 1} / {totalTracks} SORTED
          </span>
        </header>
      )}

      {/* Track Player Card */}
      <PlayerCard
        currentTrack={currentTrack}
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        onTogglePlay={onTogglePlay}
        onSeekBackward={onSeekBackward}
        onSeekForward={onSeekForward}
        onOpenInspector={onOpenInspector}
      />

      {/* 21 Pad Grid */}
      <VibePadGrid
        currentTrack={currentTrack}
        selectedFolders={selectedFolders}
        onToggleFolder={onToggleFolder}
        onRouteInstant={onRouteInstant}
      />

      {/* Bottom Action Controls */}
      <SorterActionBar
        selectedCount={selectedFolders.length}
        onSkipTrack={onSkipTrack}
        onRouteNext={handleRouteNext}
      />
    </div>
  );
};
