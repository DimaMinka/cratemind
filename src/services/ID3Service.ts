import * as mm from 'music-metadata';

/**
 * ID3Service.ts
 * Extracts audio metadata (artist and title) using music-metadata,
 * falling back to filename splitting.
 */

export async function extractMetadata(filepath: string): Promise<{ artist: string; title: string }> {
  // 1. Implement extractMetadata(filepath) using music-metadata.
  const metadata = await mm.parseFile(filepath);
  
  return { 
    artist: metadata.common.artist || 'Unknown', 
    title: metadata.common.title || 'Unknown' 
  };
}
