import React from 'react';
import { Box, Text } from 'ink';
import { RagStatus, RagStats } from '../types.js';

interface HeaderProps {
  status: 'listening' | 'paused';
  stats: {
    processed: number;
    overrides: number;
    errors: number;
  };
  ragStatus: RagStatus;
  ragStats: RagStats;
}

/**
 * Header.tsx
 *
 * Renders the premium top status bar of CrateMind.
 *
 * Visual Layout:
 * ◉ LISTENING ./Incoming  |  Processed: 12 Overrides: 2 Errors: 0  |  [RAG Status Badge]
 */
export function Header({ status, stats, ragStatus, ragStats }: HeaderProps): React.JSX.Element {
  // Render RAG memory state badge with distinct colors
  let ragBadge = <Text color="yellow">◆ FIRST RUN (No Memory)</Text>;
  if (ragStatus === 'scanning') {
    ragBadge = <Text color="gray">◌ SCANNING COLLECTION...</Text>;
  } else if (ragStatus === 'ready') {
    ragBadge = (
      <Text color="green" bold>
        ◉ MEMORY: {ragStats.total} tracks ({ragStats.folders}/21 vibes)
      </Text>
    );
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box justifyContent="space-between" paddingBottom={1} borderStyle="single" borderColor="cyan">
        {/* Status Indicator */}
        <Box>
          <Text color={status === 'listening' ? 'green' : 'yellow'} bold>
            {status === 'listening' ? '◉ ACTIVE LISTENER' : '⏸  SYSTEM PAUSED'}
          </Text>
          <Text color="gray"> | Listening ./Incoming</Text>
        </Box>

        {/* RAG Memory Info */}
        <Box>{ragBadge}</Box>
      </Box>

      {/* Numerical Stats */}
      <Box justifyContent="flex-start" paddingLeft={1}>
        <Text color="white" bold>
          Processed:{' '}
        </Text>
        <Box marginRight={2}>
          <Text color="cyan">{stats.processed}</Text>
        </Box>

        <Text color="white" bold>
          Manual Overrides:{' '}
        </Text>
        <Box marginRight={2}>
          <Text color="yellow">{stats.overrides}</Text>
        </Box>

        <Text color="white" bold>
          Errors:{' '}
        </Text>
        <Text color="red">{stats.errors}</Text>
      </Box>
    </Box>
  );
}
export default Header;
