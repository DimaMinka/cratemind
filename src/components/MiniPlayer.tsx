import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../services/UIService.js';
import { formatTime } from '../services/FSService.js';

/**
 * MiniPlayer.tsx
 *
 * Renders a premium, animated audio progress player bar right above the hotkey banner.
 * Uses a highly precise millisecond clock delta to calculate active playback times.
 */
export function MiniPlayer(): React.JSX.Element | null {
  const playback = useStore((state) => state.playback);
  const override = useStore((state) => state.override);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!playback || !override) {
      return;
    }

    setNow(Date.now());

    const interval = setInterval(() => {
      setNow(Date.now());
    }, 200);

    return () => clearInterval(interval);
  }, [playback, override]);

  if (!playback || !override) {
    return null;
  }

  const elapsed = Math.max(0, Math.round((now - playback.lastStartedAt) / 1000));
  const currentSecs = Math.min(playback.duration, playback.offset + elapsed);
  const percentage = playback.duration > 0 ? currentSecs / playback.duration : 0;

  const totalBlocks = 40;
  const filledCount = Math.round(totalBlocks * percentage);

  let progressBar = '';
  if (filledCount > 0) {
    progressBar = '─'.repeat(filledCount - 1) + '●';
  }
  progressBar += '─'.repeat(Math.max(0, totalBlocks - filledCount));

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="green"
      paddingX={2}
      paddingY={1}
      marginTop={1}
      width="100%"
    >
      {/* Top Meta Row */}
      <Box justifyContent="space-between" marginBottom={1}>
        <Box>
          <Text backgroundColor="green" color="black" bold> PLAYING </Text>
          <Text color="white" bold> {playback.filename}</Text>
        </Box>
        <Box>
          <Text backgroundColor="green" color="black" bold> DURATION </Text>
          <Text color="green" bold> {formatTime(currentSecs)}</Text>
          <Text color="gray"> / {formatTime(playback.duration)}</Text>
        </Box>
      </Box>

      {/* Progress Track Row */}
      <Box justifyContent="space-between" alignItems="center">
        <Box marginRight={2}>
          <Text color="gray">[</Text>
          <Text color="green" bold>{progressBar}</Text>
          <Text color="gray">]</Text>
        </Box>
        <Box>
          <Text color="gray" dimColor italic>
            Use [←]/[→] to seek 10s
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
export default MiniPlayer;