import { useState } from 'react';
import { useInput } from 'ink';
import { seekPlayback } from '../services/AudioService.js';
import { OverrideState } from '../types.js';

export function useOverrideHotkeys(override: OverrideState, folders: string[]) {
  const [cursor, setCursor] = useState(0);
  const [selectedList, setSelectedList] = useState<string[]>(override.suggested || []);

  useInput((input, key) => {
    if (key.upArrow) {
      setCursor((prev) => (prev > 0 ? prev - 1 : folders.length - 1));
    } else if (key.downArrow) {
      setCursor((prev) => (prev < folders.length - 1 ? prev + 1 : 0));
    } else if (input === ' ') {
      const folder = folders[cursor];
      setSelectedList((prev) =>
        prev.includes(folder) ? prev.filter((f) => f !== folder) : [...prev, folder]
      );
    } else if (key.return) {
      override.resolve(selectedList);
    } else if (input.toLowerCase() === 'a' && override.suggested && override.suggested.length > 0) {
      override.resolve(override.suggested);
    } else if (key.leftArrow) {
      seekPlayback(-10);
    } else if (key.rightArrow) {
      seekPlayback(10);
    }
  });

  return { cursor, selectedList };
}
