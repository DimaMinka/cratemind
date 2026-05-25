import React from 'react';
import { Box, Text } from 'ink';
import { LogEntry } from '../types.js';

interface LiveStreamProps {
  log: LogEntry[];
}

/**
 * LiveStream.tsx
 *
 * Renders the scrollable left log panel displaying current audio file discoveries,
 * ID3 details, RAG status notes, LLM reasoning, and final routing paths.
 */
export function LiveStream({ log }: LiveStreamProps): React.JSX.Element {
  // Take last 8 entries to avoid vertical terminal overflows
  const visibleLogs = log.slice(-8);

  return (
    <Box flexDirection="column" width="100%">
      <Box marginBottom={1}>
        <Text bold underline color="white">
          * LIVE STREAM log
        </Text>
      </Box>

      {visibleLogs.length === 0 ? (
        <Box padding={1}>
          <Text color="gray" italic>
            Awaiting new audio track drops in ./Incoming...
          </Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {visibleLogs.map((entry) => {
            let prefixColor = 'gray';
            let messageColor = 'gray';
            let isBold = false;

            switch (entry.type) {
              case 'DETECTED':
                prefixColor = 'cyan';
                messageColor = 'white';
                break;
              case 'ID3':
                prefixColor = 'blue';
                break;
              case 'RAG':
                prefixColor = 'magenta';
                messageColor = 'cyan';
                break;
              case 'LLM_REASONING':
                prefixColor = 'green';
                messageColor = 'white';
                isBold = true;
                break;
              case 'ROUTED':
                prefixColor = 'green';
                break;
              case 'NEEDS_MANUAL':
                prefixColor = 'yellow';
                messageColor = 'yellow';
                isBold = true;
                break;
              case 'ERROR':
                prefixColor = 'red';
                messageColor = 'red';
                isBold = true;
                break;
            }

            return (
              <Box key={`${entry.ts}-${entry.message.substring(0, 10)}`} marginBottom={0}>
                <Text color={prefixColor} bold>
                  [{entry.type}]
                </Text>
                <Text color={messageColor} bold={isBold}>
                  {' '}
                  {entry.message}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
export default LiveStream;
