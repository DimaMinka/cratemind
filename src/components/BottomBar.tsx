import React from 'react';
import { Box, Text } from 'ink';
import { MOCK_MODE } from '../config.js';

/**
 * BottomBar.tsx
 *
 * Renders a fixed hotkey banner at the very base of the terminal viewport.
 * Color-coded keys: [Space] yellowBright, [R] green, [Q] red.
 */
export function BottomBar(): React.JSX.Element {
  return (
    <Box flexDirection="row" justifyContent="center" marginTop={1} paddingX={1}>
      <Text color="yellowBright" bold>
        [Space]
      </Text>
      <Text color="gray"> Pause/Resume</Text>
      <Text color="gray"> | </Text>

      <Text color="cyan" bold>
        [L]
      </Text>
      <Text color="gray"> Reset Limits</Text>
      <Text color="gray"> | </Text>
      <Text color="magenta" bold>
        [V]
      </Text>
      <Text color="gray"> Index DB Vibes</Text>

      {MOCK_MODE ? (
        <>
          <Text color="gray"> | </Text>
          <Text color="cyan" bold>
            [C]
          </Text>
          <Text color="gray"> Simulate Chaos</Text>
        </>
      ) : null}

      <Text color="gray"> | </Text>
      <Text color="blueBright" bold>
        [T]
      </Text>
      <Text color="gray"> Sync Telegram</Text>

      <Text color="gray"> | </Text>
      <Text color="red" bold>
        [Q]
      </Text>
      <Text color="gray"> Exit Sorter</Text>
    </Box>
  );
}
export default BottomBar;
