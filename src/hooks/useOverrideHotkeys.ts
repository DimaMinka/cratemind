import { useState } from 'react';
import { useInput } from 'ink';
import { seekPlayback, togglePausePreview } from '../services/AudioService.js';
import { OverrideState } from '../types.js';
import { normalizeKey } from '../services/KeyboardService.js';

/**
 * useOverrideHotkeys.ts
 *
 * Custom hook to capture and handle navigation keys within the Manual Override interactive folder checklist.
 * Manages list cursor navigation (Up/Down), selection toggling (Space), resolution (Return/A), and audio seeking (Left/Right, with Shift modifier).
 */

/**
 * Hook to manage hotkeys and state for the manual folder routing checklist overlay.
 *
 * @param {OverrideState} override - The active override prompt state object including the suggestion and resolve callback.
 * @param {string[]} folders - The full array of atmospheric vibe folder names to display in the list.
 * @returns {object} An object containing the current `cursor` position index and the list of `selectedList` folder strings.
 */
export function useOverrideHotkeys(override: OverrideState, folders: string[]) {
  const [cursor, setCursor] = useState(0);
  const [selectedList, setSelectedList] = useState<string[]>(override.suggested || []);

  useInput((input, key) => {
    const normInput = normalizeKey(input);
    if (key.upArrow) {
      setCursor((prev) => (prev > 0 ? prev - 1 : folders.length - 1));
    } else if (key.downArrow) {
      setCursor((prev) => (prev < folders.length - 1 ? prev + 1 : 0));
    } else if (normInput === ' ') {
      const folder = folders[cursor];
      setSelectedList((prev) =>
        prev.includes(folder) ? prev.filter((f) => f !== folder) : [...prev, folder]
      );
    } else if (key.return) {
      override.resolve(selectedList);
    } else if (normInput.toLowerCase() === 'a' && override.suggested && override.suggested.length > 0) {
      override.resolve(override.suggested);
    } else if (normInput.toLowerCase() === 'p') {
      togglePausePreview();
    } else if (key.leftArrow) {
      if (key.shift) {
        seekPlayback(-30);
      } else {
        seekPlayback(-10);
      }
    } else if (key.rightArrow) {
      if (key.shift) {
        seekPlayback(30);
      } else {
        seekPlayback(10);
      }
    }
  });

  return { cursor, selectedList };
}
