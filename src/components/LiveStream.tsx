import React from 'react';
import { Box, Text } from 'ink';
import { LogEntry } from '../types.js';

interface LiveStreamProps {
  log: LogEntry[];
}

function formatReasoning(text: string): React.JSX.Element[] {
  const parts: React.JSX.Element[] = [];
  const regex = /'([^']+)'/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const matchIndex = match.index;
    const matchText = match[0];
    if (matchIndex > lastIndex) {
      parts.push(
        <Text key={`text-${lastIndex}`} color="yellow">
          {text.substring(lastIndex, matchIndex)}
        </Text>
      );
    }
    parts.push(
      <Text key={`vibe-${matchIndex}`} color="greenBright" bold>
        {matchText}
      </Text>
    );
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(
      <Text key={`text-${lastIndex}`} color="yellow">
        {text.substring(lastIndex)}
      </Text>
    );
  }

  return parts;
}

/**
 * LiveStream.tsx
 *
 * Renders the scrollable left log panel displaying current audio file discoveries,
 * ID3 details, RAG status notes, LLM reasoning, and final routing paths.
 */
export function LiveStream({ log }: LiveStreamProps): React.JSX.Element {
  // Take last 6 entries to avoid vertical terminal overflows
  const visibleLogs = log.slice(-10);

  return (
    <Box flexDirection="column" width="100%">
      <Box marginBottom={1}>
        <Text bold color="yellowBright">
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

            let prefixLabel: string = entry.type;
            switch (entry.type) {
              case 'DETECTED':
                prefixLabel = 'NEW';
                prefixColor = 'gray';
                messageColor = 'white';
                break;
              case 'ID3':
                prefixLabel = 'TAGS';
                prefixColor = '#cc88ff';
                messageColor = '#cc88ff';
                break;
              case 'RAG':
                prefixLabel = 'RAG';
                prefixColor = '#5599ff';
                messageColor = '#5599ff';
                break;
              case 'SYSTEM':
                prefixLabel = 'SYS';
                prefixColor = 'cyan';
                messageColor = 'cyan';
                break;
              case 'LLM_REASONING':
                prefixLabel = 'AI';
                prefixColor = 'yellow';
                messageColor = 'yellow';
                isBold = true;
                break;
              case 'ROUTED':
                prefixLabel = 'ROUTE';
                prefixColor = '#86efac';
                messageColor = '#86efac';
                break;
              case 'NEEDS_MANUAL':
                prefixLabel = 'MANUAL';
                prefixColor = 'yellow';
                messageColor = 'yellow';
                isBold = true;
                break;
              case 'YT_SEARCH':
                prefixLabel = 'YT';
                prefixColor = '#ff6b6b';
                messageColor = '#ff8787';
                break;
              case 'YT_HIT':
                prefixLabel = 'YT MIX';
                prefixColor = '#a855f7';
                messageColor = '#c084fc';
                isBold = true;
                break;
              case 'YT_CACHE_HIT':
                prefixLabel = 'YT CACHE';
                prefixColor = '#3b82f6';
                messageColor = '#60a5fa';
                isBold = true;
                break;
              case 'ERROR':
                prefixLabel = 'ERROR';
                prefixColor = 'red';
                messageColor = 'red';
                isBold = true;
                break;
            }

            if (entry.type === 'LLM_REASONING') {
              const arrowIndex = entry.message.indexOf(' ➔ ');
              if (arrowIndex !== -1) {
                const filename = entry.message.substring(0, arrowIndex);
                const reasoning = entry.message.substring(arrowIndex + 3);
                return (
                  <Box key={`${entry.ts}-${entry.message.substring(0, 10)}`} marginBottom={0}>
                    <Text color={prefixColor} bold>
                      {`[${prefixLabel}]`.padEnd(12)}
                    </Text>
                    <Text color="cyanBright">{filename}</Text>
                    <Text color="gray"> ➔ </Text>
                    {formatReasoning(reasoning)}
                  </Box>
                );
              }
            }

            return (
              <Box key={`${entry.ts}-${entry.message.substring(0, 10)}`} marginBottom={0}>
                <Text color={prefixColor} bold>
                  {`[${prefixLabel}]`.padEnd(12)}
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
