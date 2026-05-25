import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { OverrideState } from '../types.js';
import { FOLDERS } from '../config.js';

interface ManualOverrideProps {
  override: OverrideState;
}

/**
 * ManualOverride.tsx
 *
 * Right-side terminal panel rendering the vibe crates checklist.
 * Allows quick manual routing override when LLM confidence falls below threshold.
 *
 * Interactive Controls (captured locally via useInput):
 * - Up / Down arrows: Navigate folder checklist
 * - Space: Toggle active selection
 * - Enter: Confirm & Route audio file
 */
export function ManualOverride({ override }: ManualOverrideProps): React.JSX.Element {
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
    }
  });

  // Take a sliding window of 5 folders around the cursor to prevent tall TUI overflows
  const maxVisible = 10;
  const half = Math.floor(maxVisible / 2);
  let start = Math.max(0, cursor - half);
  let end = Math.min(FOLDERS.length, start + maxVisible);

  if (end - start < maxVisible) {
    start = Math.max(0, end - maxVisible);
  }

  const visibleFolders = FOLDERS.slice(start, end);

  return (
    <Box flexDirection="column" width="100%">
      <Box marginBottom={1}>
        <Text bold underline color="yellow">
          * MANUAL OVERRIDE
        </Text>
      </Box>

      <Box marginBottom={1} flexDirection="column">
        <Text color="white" bold>
          Track: {override.filename} <Text color="green" bold>[PLAYING]</Text>
        </Text>
        <Text color="gray" dimColor>
          Select vibes to copy (showing {start + 1}-{end} of {FOLDERS.length})
        </Text>
      </Box>

      {/* Checklist Window */}
      <Box flexDirection="column" paddingLeft={1} marginBottom={1}>
        {visibleFolders.map((folder, index) => {
          const actualIndex = start + index;
          const isCurrent = actualIndex === cursor;
          const isChecked = selectedList.includes(folder);
          const isSuggested = (override.suggested || []).includes(folder);

          let folderText = <Text color="white">{folder}</Text>;
          if (isCurrent) {
            folderText = (
              <Text color="yellow" bold>
                {folder} (cursor)
              </Text>
            );
          } else if (isChecked) {
            folderText = <Text color="green">{folder}</Text>;
          }

          return (
            <Box key={folder}>
              <Text color={isCurrent ? 'yellow' : 'gray'}>
                {isCurrent ? '> ' : '  '}
                {isChecked ? '[x] ' : '[ ] '}
              </Text>
              {folderText}
              {isSuggested ? (
                <Text color="gray" dimColor>
                  {' '}
                  (suggested)
                </Text>
              ) : null}
            </Box>
          );
        })}
      </Box>

      <Box paddingLeft={1} marginTop={1}>
        <Text color="white">Selected: </Text>
        <Text color="green" bold>
          {selectedList.length} crates
        </Text>
      </Box>
    </Box>
  );
}
export default ManualOverride;
