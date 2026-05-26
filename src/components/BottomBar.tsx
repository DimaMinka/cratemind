import React from 'react';
import { Box, Text } from 'ink';

/**
 * BottomBar.tsx
 *
 * Renders a fixed hotkey banner at the very base of the terminal viewport.
 * Color-coded keys: [Space] yellowBright, [R] green, [Q] red.
 */
export function BottomBar(): React.JSX.Element {
  return (
    <Box
      flexDirection="row"
      justifyContent="center"
      marginTop={1}
      paddingX={1}
    >
      <Text color="yellowBright" bold>
        [Space]
      </Text>
      <Text color="gray"> Pause/Resume</Text>
      <Text color="gray">   |   </Text>
      <Text color="greenBright" bold>
        [R]
      </Text>
      <Text color="gray"> Log RAG Stats</Text>
      <Text color="gray">   |   </Text>
      <Text color="cyan" bold>
        [C]
      </Text>
      <Text color="gray"> Simulate Chaos</Text>
      <Text color="gray">   |   </Text>
      <Text color="red" bold>
        [Q]
      </Text>
      <Text color="gray"> Exit Sorter</Text>
    </Box>
  );
}
export default BottomBar;
