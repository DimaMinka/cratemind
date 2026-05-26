import React from 'react';
import { Box, Text } from 'ink';
import { RagStatus, RagStats } from '../types.js';
import { MOCK_MODE } from '../config.js';

interface HeaderProps {
  status: 'listening' | 'paused';
  stats: {
    processed: number;
    overrides: number;
    errors: number;
  };
  ragStatus: RagStatus;
  ragStats: RagStats;
  dailyRequestsUsed: number;
  dailyRequestsLimit: number;
  totalCacheHits: number;
  isLLMAnalyzing: boolean;
}

/**
 * Header.tsx
 *
 * Renders the premium top status bar of CrateMind.
 *
 * Visual Layout:
 * * LISTENING ./Incoming  |  Processed: 12 Overrides: 2 Errors: 0  |  [RAG Status Badge]
 */
export function Header({
  status,
  stats,
  ragStatus,
  ragStats,
  dailyRequestsUsed,
  dailyRequestsLimit,
  totalCacheHits,
  isLLMAnalyzing
}: HeaderProps): React.JSX.Element {
  // Render RAG memory state badge with distinct colors
  let ragBadge = <Text color="yellow">* FIRST RUN (No Memory)</Text>;
  if (ragStatus === 'scanning') {
    ragBadge = <Text color="gray">~ SCANNING COLLECTION...</Text>;
  } else if (ragStatus === 'ready') {
    ragBadge = (
      <Text color="green" bold>
        * MEMORY: {ragStats.total} tracks ({ragStats.folders}/21 vibes)
      </Text>
    );
  }

  const engineStateText = MOCK_MODE ? ' [SIMULATOR]' : ' [LIVE API]';
  const engineStateColor = MOCK_MODE ? 'cyan' : 'greenBright';

  return (
    <Box flexDirection="column" marginBottom={0}>
      <Box justifyContent="space-between" paddingBottom={0} borderStyle="single" borderColor="gray">
        {/* Status Indicator */}
        <Box>
          <Text color={status === 'listening' ? 'yellowBright' : 'yellow'} bold>
            {status === 'listening' ? '* ACTIVE LISTENER' : '[PAUSED] SYSTEM PAUSED'}
          </Text>
          <Text color="gray"> | Listening ./Incoming</Text>
          <Text color={engineStateColor} bold>
            {engineStateText}
          </Text>
          {isLLMAnalyzing && (
            <Text color="magentaBright" bold>
              {' '}
              [🤖 GEMINI ANALYZING...]
            </Text>
          )}
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
        <Box marginRight={2}>
          <Text color="red">{stats.errors}</Text>
        </Box>

        <Text color="gray"> | </Text>

        <Text color="white" bold>
          API Today:{' '}
        </Text>
        <Box marginRight={2}>
          <Text color={dailyRequestsUsed >= dailyRequestsLimit ? 'redBright' : 'cyan'}>
            {dailyRequestsUsed}/{dailyRequestsLimit}
          </Text>
        </Box>

        <Text color="white" bold>
          Cache Saved:{' '}
        </Text>
        <Text color="greenBright">{totalCacheHits}</Text>
      </Box>
    </Box>
  );
}
export default Header;
