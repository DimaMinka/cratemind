import React from 'react';
import { Box, Text, useInput } from 'ink';
import { BootPromptState } from '../types.js';
import { useStdoutDimensions } from '../hooks/useStdoutDimensions.js';
import { normalizeKey } from '../services/KeyboardService.js';

interface ConfirmPromptProps {
  prompt: BootPromptState;
}

/**
 * ConfirmPrompt.tsx
 *
 * Fullscreen yes/no confirmation dialog. Centered horizontally and vertically
 * inside the terminal Alternate Buffer.
 */
export function ConfirmPrompt({ prompt }: ConfirmPromptProps): React.JSX.Element {
  const { columns, rows } = useStdoutDimensions();

  // Capture local keyboard inputs and block global hotkeys
  useInput((input, key) => {
    const normInput = normalizeKey(input);
    const keyLower = normInput.toLowerCase();
    if (keyLower === 'y' || key.return) {
      prompt.resolve(true);
    } else if (keyLower === 'n' || key.escape) {
      prompt.resolve(false);
    } else if (prompt.thirdKey && keyLower === prompt.thirdKey.toLowerCase()) {
      prompt.resolve('download-only');
    }
  });

  return (
    <Box
      width={columns}
      height={rows}
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      overflow="hidden"
    >
      <Box flexDirection="column" borderStyle="round" borderColor="yellow" padding={1} width="80%">
        <Box justifyContent="center" marginBottom={1}>
          <Text bold color="yellow">
            [!] CrateMind — Confirmation Required
          </Text>
        </Box>

        <Box flexDirection="column" marginBottom={1} paddingLeft={2} paddingRight={2}>
          <Text color="white">{prompt.message}</Text>
          {prompt.detail ? (
            <Text color="gray" italic>
              ({prompt.detail})
            </Text>
          ) : null}
        </Box>

        <Box justifyContent="space-around" borderStyle="single" borderColor="gray" padding={1}>
          {prompt.message.startsWith('Gemini suggests') ? (
            <>
              <Text color="green" bold>
                [Y] Approve Suggestion
              </Text>
              <Text color="red" bold>
                [N] Manual checklist
              </Text>
            </>
          ) : (
            <>
              <Text color="green" bold>
                [Y] {prompt.yesLabel || 'Yes'}
              </Text>
              {prompt.thirdLabel && prompt.thirdKey ? (
                <Text color="cyan" bold>
                  [{prompt.thirdKey.toUpperCase()}] {prompt.thirdLabel}
                </Text>
              ) : null}
              <Text color="red" bold>
                [N] {prompt.noLabel || 'No'}
              </Text>
            </>
          )}
        </Box>
      </Box>
    </Box>
  );
}
export default ConfirmPrompt;
