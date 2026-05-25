import React from 'react';
import { Box, Text, useInput } from 'ink';
import { BootPromptState } from '../types.js';

interface ConfirmPromptProps {
  prompt: BootPromptState;
}

/**
 * ConfirmPrompt.tsx
 *
 * Fullscreen yes/no confirmation dialog. Shown before any bootstrap
 * or memory-clear operations that require user consent.
 *
 * Visual Layout:
 * ┌────────────────────────────────────────────────────────┐
 * │  CrateMind — Confirmation Required                     │
 * │                                                        │
 * │  [Prompt Message Text...]                              │
 * │  [Prompt Detail Text...]                               │
 * │                                                        │
 * │  ► [Y] Yes, proceed    [N] Skip / No                   │
 * └────────────────────────────────────────────────────────┘
 */
export function ConfirmPrompt({ prompt }: ConfirmPromptProps): React.JSX.Element {
  // Capture local keyboard inputs and block global hotkeys
  useInput((input, key) => {
    const keyLower = input.toLowerCase();
    if (keyLower === 'y' || key.return) {
      prompt.resolve(true);
    } else if (keyLower === 'n' || key.escape) {
      prompt.resolve(false);
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="yellow"
      padding={1}
      width={70}
      margin={1}
    >
      <Box justifyContent="center" marginBottom={1}>
        <Text bold color="yellow">
          ⚠️ CrateMind — Confirmation Required
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1} paddingLeft={2}>
        <Text color="white">{prompt.message}</Text>
        {prompt.detail ? (
          <Text color="gray" italic>
            ({prompt.detail})
          </Text>
        ) : null}
      </Box>

      <Box justifyContent="space-around" borderStyle="single" borderColor="gray" padding={1}>
        <Text color="green" bold>
          [Y] Yes, scan & load memory
        </Text>
        <Text color="red" bold>
          [N] Skip, start clean
        </Text>
      </Box>
    </Box>
  );
}
