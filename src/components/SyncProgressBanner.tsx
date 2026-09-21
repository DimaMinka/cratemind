import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../services/UIService.js';

/**
 * SyncProgressBanner.tsx
 *
 * Renders real-time telemetry and a dynamic ASCII progress bar
 * during drive-to-drive mirror synchronization.
 */
export function SyncProgressBanner(): React.JSX.Element | null {
  const driveSyncProgress = useStore((state) => state.driveSyncProgress);

  if (!driveSyncProgress || !driveSyncProgress.isActive) {
    return null;
  }

  const { stageLabel, currentFile, currentFileIndex, totalFiles, percent, archivedCount } =
    driveSyncProgress;

  const totalBlocks = 30;
  const clampedPercent = Math.max(0, Math.min(100, percent));
  const filledBlocks = Math.round((clampedPercent / 100) * totalBlocks);
  const emptyBlocks = Math.max(0, totalBlocks - filledBlocks);
  const progressBar = '█'.repeat(filledBlocks) + '░'.repeat(emptyBlocks);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={2}
      paddingY={0}
      marginY={1}
      width="100%"
    >
      {/* Top Header Row */}
      <Box justifyContent="space-between" width="100%">
        <Box>
          <Text color="cyan" bold>
            [DRIVE MIRROR]
          </Text>
          <Text color="white" bold>
            {' '}
            {stageLabel}
          </Text>
        </Box>
        <Box>
          <Text color="cyan" bold>
            {clampedPercent}%
          </Text>
          {totalFiles > 0 ? (
            <Text color="gray">
              {' '}
              ({currentFileIndex}/{totalFiles})
            </Text>
          ) : null}
        </Box>
      </Box>

      {/* Progress Bar Row */}
      <Box marginY={0} width="100%">
        <Text color="cyan">[{progressBar}]</Text>
        {totalFiles > 0 ? (
          <Text color="white">
            {' '}
            {currentFileIndex} of {totalFiles} tracks
          </Text>
        ) : null}
        {archivedCount && archivedCount > 0 ? (
          <Text color="yellow"> | Archived: {archivedCount}</Text>
        ) : null}
      </Box>

      {/* Active File Row */}
      {currentFile ? (
        <Box width="100%">
          <Text color="gray">Current: </Text>
          <Text color="green" bold wrap="truncate-end">
            {currentFile}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

export default SyncProgressBanner;
