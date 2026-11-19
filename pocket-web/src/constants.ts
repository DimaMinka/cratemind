import type { CrateCategory } from './types/pocketWeb.types.js';

export const CRATE_CATEGORIES: Record<string, CrateCategory> = {
  Nature: {
    name: 'Nature',
    color: '#00FFFF',
    borderColor: '#00FFFF',
    activeColor: '#00FFFF',
    glowRgba: 'rgba(0, 255, 255, 0.65)',
    folders: [
      'desert vibe',
      'earth',
      'iceland',
      'india jungle',
      'magic forest',
      'mantra',
      'mountain sunset',
      'spain vibe',
      'tropical vibe'
    ]
  },
  Party: {
    name: 'Party/Groove',
    color: '#FFFF00',
    borderColor: '#FFFF00',
    activeColor: '#FFFF00',
    glowRgba: 'rgba(255, 255, 0, 0.65)',
    folders: ['beach party', 'club party', 'epic', 'nargila vibe', 'new day vibe', 'psy']
  },
  Cosmic: {
    name: 'Cosmic/Deep',
    color: '#FF00FF',
    borderColor: '#FF00FF',
    activeColor: '#FF00FF',
    glowRgba: 'rgba(255, 0, 255, 0.65)',
    folders: ['galaxy trip', 'retro', 'robotic']
  },
  Genres: {
    name: 'Genres/Utility',
    color: '#777777',
    borderColor: '#555555',
    activeColor: '#D4D4D4',
    glowRgba: 'rgba(212, 212, 212, 0.55)',
    folders: ["drum 'n' bass", 'intro outro', 'rock']
  }
};

export const FOLDERS = [
  ...CRATE_CATEGORIES.Nature.folders,
  ...CRATE_CATEGORIES.Party.folders,
  ...CRATE_CATEGORIES.Cosmic.folders,
  ...CRATE_CATEGORIES.Genres.folders
] as const;

export function getFolderCategory(folder: string): CrateCategory {
  for (const cat of Object.values(CRATE_CATEGORIES)) {
    if (cat.folders.includes(folder)) {
      return cat;
    }
  }
  return CRATE_CATEGORIES.Genres;
}
