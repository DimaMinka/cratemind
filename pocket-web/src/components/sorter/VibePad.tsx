import React from 'react';
import { getFolderCategory } from '../../constants.js';
import { useLongPress } from '../../hooks/useLongPress.js';

interface VibePadProps {
  folder: string;
  isSelected: boolean;
  ragBadge: string | null;
  isYtMatch: boolean;
  onToggleFolder: (folder: string) => void;
  onRouteInstant: (folder: string) => void;
}

export const VibePad: React.FC<VibePadProps> = ({
  folder,
  isSelected,
  ragBadge,
  isYtMatch,
  onToggleFolder,
  onRouteInstant
}) => {
  const category = getFolderCategory(folder);

  const {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave,
    onPointerCancel,
    onContextMenu,
    onClick
  } = useLongPress(() => onRouteInstant(folder), {
    delay: 450,
    threshold: 10,
    vibrateMs: 50,
    onClick: () => onToggleFolder(folder)
  });

  return (
    <button
      type="button"
      data-folder={folder}
      className={`dj-pad relative flex flex-col justify-between p-1.5 rounded-md text-left text-xs min-h-[54px] min-w-[80px] border transition-all ${
        isSelected
          ? 'glow-yellow-active bg-neutral-900 border-[#FFFF00] text-[#FFFF00] font-bold shadow-[0_0_12px_rgba(255,255,0,0.65)]'
          : 'bg-neutral-900/90 text-neutral-200 border-neutral-800 hover:border-neutral-700'
      }`}
      style={{
        borderLeftWidth: '3px',
        borderLeftColor: isSelected ? '#FFFF00' : category.borderColor
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      onPointerCancel={onPointerCancel}
      onContextMenu={onContextMenu}
      onClick={onClick}
    >
      <span className="truncate leading-tight text-[11px] font-medium">{folder}</span>
      <div className="flex gap-1 flex-wrap mt-0.5">
        {ragBadge && (
          <span className="text-[8px] font-mono px-1 py-0.2 bg-[#00FFFF] text-black font-bold rounded">
            {ragBadge}
          </span>
        )}
        {isYtMatch && (
          <span className="text-[8px] font-mono px-1 py-0.2 bg-[#FF00FF] text-white font-bold rounded">
            YT MATCH
          </span>
        )}
      </div>
    </button>
  );
};
