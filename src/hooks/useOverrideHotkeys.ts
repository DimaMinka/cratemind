import { useState } from 'react';
import { useInput } from 'ink';
import { FOLDERS } from '../config.js';
import { seekPlayback } from '../services/AudioService.js';
import { OverrideState } from '../types.js';

export function useOverrideHotkeys(override: OverrideState) {
  const [cursor, setCursor] = useState(0);
  const [selectedList, setSelectedList] = useState<string[]>(override.suggested || []);

  useInput((input, key) => {
    if (key.upArrow) {
      setCursor((prev) => (prev > 0 ? prev - 1 : FOLDERS.length - 1));
    } else if (key.downArrow) {
      setCursor((prev) => (prev < FOLDERS.length - 1 ? prev + 1 : 0));
    } else if (input === ' ') {
      const folder = FOLDERS[cursor];
      setSelectedList((prev) =>
        prev.includes(folder) ? prev.filter((f) => f !== folder) : [...prev, folder]
      );
    } else if (key.return) {
      override.resolve(selectedList);
    } else if (key.leftArrow) {
      seekPlayback(-10);
    } else if (key.rightArrow) {
      seekPlayback(10);
    }
  });

  return { cursor, selectedList };
}
