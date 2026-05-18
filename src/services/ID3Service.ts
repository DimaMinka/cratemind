/**
 * ID3Service.ts
 * Extracts audio metadata (artist and title) using music-metadata,
 * falling back to filename splitting.
 */

export async function extractMetadata(filepath: string): Promise<{ artist: string; title: string }> {
  // TODO: Implement music-metadata parsing with filename fallbacks
  return { artist: 'Unknown', title: 'Unknown' };
}
