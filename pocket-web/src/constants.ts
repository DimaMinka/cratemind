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
      'spain vibe',
      'mantra'
    ]
  },
  Party: {
    name: 'Party/Groove',
    color: '#FFFF00',
    borderColor: '#FFFF00',
    folders: ['club party', 'beach party', 'nargila vibe', 'new day vibe', 'epic', 'psy']
  },
  Cosmic: {
    name: 'Cosmic/Deep',
    color: '#FF00FF',
    borderColor: '#FF00FF',
    folders: ['galaxy trip', 'retro', 'robotic']
  },
  Genres: {
    name: 'Genres/Utility',
    color: '#777777',
    borderColor: '#555555',
    folders: ["drum 'n' bass", 'rock', 'intro outro']
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
