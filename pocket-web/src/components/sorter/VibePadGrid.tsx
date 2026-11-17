import React from 'react';
import { FOLDERS } from '../../constants.js';
import type { PocketTrackItem } from '../../types/pocketWeb.types.js';
import { VibePad } from './VibePad.js';

interface VibePadGridProps {
  currentTrack: PocketTrackItem;
  selectedFolders: string[];
  onToggleFolder: (folder: string) => void;
  onRouteInstant: (folder: string) => void;
}

export const VibePadGrid: React.FC<VibePadGridProps> = ({
  currentTrack,
  selectedFolders,
  onToggleFolder,
  onRouteInstant
}) => {
  const getRagBadge = (folder: string): string | null => {
    if (currentTrack.ragSuggestions) {
      const match = currentTrack.ragSuggestions.find((s) => s.folder === folder);
      if (match) {
        return `RAG ${Math.round(match.similarity * 100)}%`;
      }
    }
    if (currentTrack.ragSuggestion && currentTrack.ragSuggestion.folder === folder) {
      return `RAG ${currentTrack.ragSuggestion.confidence}%`;
    }
    return null;
  };

  const isYtMatch = (folder: string): boolean => {
    if (!currentTrack.ytScout) return false;
    const scout = currentTrack.ytScout as {
      suggestedFolder?: string;
      matchedFolder?: string | null;
    };
    return scout.suggestedFolder === folder || scout.matchedFolder === folder;
  };

  return (
    <main className="grid grid-cols-3 gap-1.5 flex-1 max-h-[500px]">
      {FOLDERS.map((folder) => {
        const isSelected = selectedFolders.includes(folder);
        const ragBadge = getRagBadge(folder);
        const ytMatch = isYtMatch(folder);

        return (
          <VibePad
            key={folder}
            folder={folder}
            isSelected={isSelected}
            ragBadge={ragBadge}
            isYtMatch={ytMatch}
            onToggleFolder={onToggleFolder}
            onRouteInstant={onRouteInstant}
          />
        );
      })}
    </main>
  );
};
