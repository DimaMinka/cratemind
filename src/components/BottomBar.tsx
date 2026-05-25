import React from 'react';
import { Box, Text } from 'ink';

/**
 * BottomBar.tsx
 *
 * Renders a fixed hotkey banner at the very base of the terminal viewport.
 */
export function BottomBar(): React.JSX.Element {
  return (
    <Box
      flexDirection="row"
      justifyContent="center"
      marginTop={1}
      paddingX={1}
    >
      <Text color="cyan" bold>
        [Space] Pause/Resume
      </Text>
      <Text color="gray">   |   </Text>
      <Text color="magenta" bold>
        [R] Log RAG Stats
      </Text>
      <Text color="gray">   |   </Text>
      <Text color="red" bold>
        [Q] Exit Sorter
      </Text>
    </Box>
  );
}
export default BottomBar;
