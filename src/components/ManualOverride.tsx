import React from 'react';
import { Box, Text } from 'ink';
import { OverrideState } from '../types.js';
import { FOLDERS } from '../config.js';
import { useOverrideHotkeys } from '../hooks/useOverrideHotkeys.js';

interface ManualOverrideProps {
  override: OverrideState;
}

/**
 * ManualOverride.tsx
 *
 * Right-side terminal panel rendering the vibe crates checklist.
 * Allows quick manual routing override when LLM confidence falls below threshold.
 */
export function ManualOverride({ override }: ManualOverrideProps): React.JSX.Element {
  // Dynamically sort vibe folders: put suggested ones on top, and sort the rest alphabetically
  const suggested = override.suggested || [];
  const remainingFolders = [...FOLDERS]
    .filter((f) => !suggested.includes(f as string))
    .sort((a, b) => a.localeCompare(b));

  const sortedFolders = [...suggested, ...remainingFolders] as string[];

  const { cursor, selectedList } = useOverrideHotkeys(override, sortedFolders);

  // Take a sliding window of 5 folders around the cursor to prevent tall TUI overflows
  const maxVisible = 10;
  const half = Math.floor(maxVisible / 2);
  let start = Math.max(0, cursor - half);
  let end = Math.min(sortedFolders.length, start + maxVisible);

  if (end - start < maxVisible) {
    start = Math.max(0, end - maxVisible);
  }

  const visibleFolders = sortedFolders.slice(start, end);

  return (
    <Box flexDirection="column" width="100%">
      <Box marginBottom={1}>
        <Text bold color="yellowBright">
          * MANUAL OVERRIDE
        </Text>
      </Box>

      {override.reason ? (
        <Box marginBottom={1} borderStyle="single" borderColor="red" paddingX={1}>
          <Text color="redBright" bold>
            ▲ {override.reason.toUpperCase()}
          </Text>
        </Box>
      ) : null}

      <Box marginBottom={1} flexDirection="column">
        <Text color="white" bold>
          Track:{' '}
          {override.artist && override.title && override.artist !== 'Unknown' ? (
            <>
              <Text color="cyanBright" bold>
                {override.artist}
              </Text>
              <Text color="gray"> – </Text>
              <Text color="greenBright" bold>
                {override.title}
              </Text>
            </>
          ) : (
            <Text color="cyanBright" bold>
              {override.filename}
            </Text>
          )}
          {override.bpm || override.key ? (
            <Text color="gray" dimColor>
              {' '}
              ({override.bpm ? `${override.bpm} BPM` : ''}
              {override.bpm && override.key ? ' | ' : ''}
              {override.key ? `${override.key}` : ''})
            </Text>
          ) : null}
        </Text>

        {override.suggested && override.suggested.length > 0 ? (
          <Box
            flexDirection="column"
            borderStyle="single"
            borderColor="cyan"
            padding={1}
            marginY={1}
          >
            <Text color="cyan" bold>
              🤖 GEMINI RECOMMENDATION:
            </Text>
            <Text color="white" bold>
              {override.suggested.join(' & ')}
            </Text>
            {override.reason ? (
              <Text color="gray" italic>
                "{override.reason}"
              </Text>
            ) : null}
            <Box marginTop={1}>
              <Text color="cyanBright" bold>
                Press [A] to Approve suggestion & route
              </Text>
            </Box>
          </Box>
        ) : null}

        <Text color="gray" dimColor>
          Select vibes to copy (showing {start + 1}-{end} of {sortedFolders.length})
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
              <Text color="yellowBright" bold>
                {folder} (cursor)
              </Text>
            );
          } else if (isChecked) {
            folderText = <Text color="greenBright">{folder}</Text>;
          }

          return (
            <Box key={folder}>
              <Text color={isCurrent ? 'yellowBright' : 'gray'}>
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
        <Text color="greenBright" bold>
          {selectedList.length} crates
        </Text>
      </Box>
    </Box>
  );
}
export default ManualOverride;
