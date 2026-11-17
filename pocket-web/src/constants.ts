export const FOLDERS = [
  'mountain sunset',
  'magic forest',
  'club party',
  'beach party',
  'nargila vibe',
  'new day vibe',
  'galaxy trip',
  'psy',
  'desert vibe',
  'tropical vibe',
  'epic',
  'iceland',
  'mantra',
  'earth',
  "drum 'n' bass",
  'rock',
  'retro',
  'robotic',
  'india jungle',
  'spain vibe',
  'intro outro'
] as const;

export type FolderName = (typeof FOLDERS)[number];

export interface CrateCategory {
  name: 'Nature' | 'Party/Groove' | 'Cosmic/Deep' | 'Genres/Utility';
  color: string;
  borderColor: string;
  folders: readonly string[];
}

export const CRATE_CATEGORIES: Record<string, CrateCategory> = {
  Nature: {
    name: 'Nature',
    color: '#00FFFF',
    borderColor: '#00FFFF',
    folders: [
      'mountain sunset',
      'magic forest',
      'desert vibe',
      'tropical vibe',
      'iceland',
      'earth',
      'india jungle',
      'spain vibe'
    ]
  },
  Party: {
    name: 'Party/Groove',
    color: '#FFFF00',
    borderColor: '#FFFF00',
    folders: ['club party', 'beach party', 'nargila vibe', 'new day vibe']
  },
  Cosmic: {
    name: 'Cosmic/Deep',
    color: '#FF00FF',
    borderColor: '#FF00FF',
    folders: ['galaxy trip', 'psy', 'epic', 'mantra', 'robotic']
  },
  Genres: {
    name: 'Genres/Utility',
    color: '#777777',
    borderColor: '#555555',
    folders: ["drum 'n' bass", 'rock', 'retro', 'intro outro']
  }
};

export function getFolderCategory(folder: string): CrateCategory {
  for (const cat of Object.values(CRATE_CATEGORIES)) {
    if (cat.folders.includes(folder)) {
      return cat;
    }
  }
  return CRATE_CATEGORIES.Genres;
}
