import React from 'react';

interface WaveformBarProps {
  energyShape?: number[] | null;
  currentTime?: number;
  duration?: number;
}

const DEFAULT_ENERGY = [
  0.15, 0.3, 0.45, 0.6, 0.85, 1.0, 0.95, 0.9, 0.8, 0.5, 0.35, 0.45, 0.75, 0.85, 0.5, 0.2
];

export const WaveformBar: React.FC<WaveformBarProps> = ({
  energyShape,
  currentTime = 0,
  duration = 220
}) => {
  const energy = energyShape && energyShape.length >= 16 ? energyShape : DEFAULT_ENERGY;
  const progressRatio = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;
  const currentSegment = Math.floor(progressRatio * 16);

  const getPhaseColor = (index: number, isActive: boolean) => {
    if (index < 4) {
      // INTR (1-4)
      return isActive ? 'bg-[#00FF00] shadow-[0_0_6px_#00FF00]' : 'bg-[#00FF00]/40';
    }
    if (index < 9) {
      // DRP (5-9)
      return isActive ? 'bg-[#00FFFF] shadow-[0_0_6px_#00FFFF]' : 'bg-[#00FFFF]/40';
    }
    if (index < 13) {
      // BRK (10-13)
      return isActive ? 'bg-[#FFFF00] shadow-[0_0_6px_#FFFF00]' : 'bg-[#FFFF00]/40';
    }
    // OUT (14-16)
    return isActive ? 'bg-[#00FF99] shadow-[0_0_6px_#00FF99]' : 'bg-[#00FF99]/40';
  };

  return (
    <div className="w-full bg-black/60 rounded p-1.5 border border-neutral-800/80">
      <div className="flex justify-between items-center text-[8px] font-mono text-neutral-400 mb-1 px-0.5">
        <span className="text-[#00FF00]">INTR</span>
        <span className="text-[#00FFFF]">DRP</span>
        <span className="text-[#FFFF00]">BRK</span>
        <span className="text-[#00FF99]">OUT</span>
      </div>
      <div className="flex items-end justify-between h-8 gap-1 px-0.5">
        {energy.slice(0, 16).map((val, idx) => {
          const scaled = val <= 1 ? val * 100 : val;
          const heightPercent = Math.max(15, Math.min(100, Math.round(scaled)));
          const isPlayed = idx <= currentSegment;
          return (
            <div
              key={idx}
              className={`flex-1 rounded-sm transition-all duration-100 ${getPhaseColor(
                idx,
                isPlayed
              )}`}
              style={{ height: `${heightPercent}%` }}
            />
          );
        })}
      </div>
    </div>
  );
};
