import { useStore } from './UIService.js';
import { previewAudio, stopAudio } from './AudioService.js';
import { FOLDERS } from '../config.js';

/**
 * UserInteractionService.ts
 *
 * Manages the manual override user interaction flow:
 * - Starts audio preview for human review
 * - Presents the ManualOverride checklist UI via Zustand state
 * - Blocks the processing pipeline until the user makes a selection
 * - Stops audio playback after the user confirms
 *
 * Extracted from FSService to isolate UI-layer concerns
 * from the business processing pipeline.
 */

export interface OverrideRequest {
  filename: string;
  filepath: string;
  suggested: string[];
  reason?: string;
  duration: number;
  bpm?: number;
  key?: string;
  artist?: string;
  title?: string;
}

/**
 * Launches audio preview, shows ManualOverride UI,
 * blocks the pipeline until user selection, then stops audio.
 * Returns an array of selected folder names (empty = skip).
 */
export async function requestOverride(request: OverrideRequest): Promise<string[]> {
  const setOverride = useStore.getState().setOverride;

  // Play audio so the user can listen while reviewing
  previewAudio(request.filepath, 0, request.duration, request.bpm, request.key);

  const selectedFolders = await new Promise<string[]>((resolve) => {
    setOverride({
      filename: request.filename,
      filepath: request.filepath,
      folders: [...FOLDERS],
      suggested: request.suggested,
      selected: [],
      reason: request.reason,
      artist: request.artist,
      title: request.title,
      bpm: request.bpm,
      key: request.key,
      resolve: (folders) => {
        setOverride(null);
        resolve(folders);
      }
    });
  });

  // Stop audio after user has made their selection
  stopAudio();

  return selectedFolders;
}
