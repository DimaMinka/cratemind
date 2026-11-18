export const CRATE_CATEGORIES: Record<string, CrateCategory> = {
  Nature: {
    name: 'Nature',
    color: '#00FFFF',
    borderColor: '#00FFFF',
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
    folders: ['beach party', 'club party', 'epic', 'nargila vibe', 'new day vibe', 'psy']
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
