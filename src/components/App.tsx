import React from 'react';
import { Box, useInput, useApp } from 'ink';
import { useStore } from '../services/UIService.js';
import { ConfirmPrompt } from './ConfirmPrompt.js';
import { Header } from './Header.js';
import { LiveStream } from './LiveStream.js';
import { ManualOverride } from './ManualOverride.js';
import { BottomBar } from './BottomBar.js';

/**
 * App.tsx
 *
 * Root Ink component. Orchestrates global layouts, conditional boot dialogs,
 * manual override displays, and main navigation hotkeys. All layouts are centered
 * horizontally and vertically inside the terminal window.
 */
export function App(): React.JSX.Element {
  const { exit } = useApp();

  // Connect to global Zustand store
  const status = useStore((state) => state.status);
  const stats = useStore((state) => state.stats);
  const log = useStore((state) => state.log);
  const override = useStore((state) => state.override);
  const bootPrompt = useStore((state) => state.bootPrompt);
  const ragStatus = useStore((state) => state.ragStatus);
  const ragStats = useStore((state) => state.ragStats);

  const setStatus = useStore((state) => state.setStatus);
  const addLog = useStore((state) => state.addLog);

  // Capture global hotkeys (only when no boot or override overlays are active)
  const isOverlayActive = bootPrompt !== null || override !== null;

  useInput((input, _key) => {
    if (isOverlayActive) {
      return;
    }

    const keyLower = input.toLowerCase();

    if (input === ' ') {
      const nextStatus = status === 'listening' ? 'paused' : 'listening';
      setStatus(nextStatus);
      addLog('RAG', `System ${nextStatus === 'listening' ? 'resumed' : 'paused'}.`);
    } else if (keyLower === 'q') {
      addLog('RAG', 'Shutting down CrateMind in 3 seconds. Goodbye!');
      setTimeout(() => {
        exit();
        process.exit(0);
      }, 3000);
    } else if (keyLower === 'r') {
      addLog(
        'RAG',
        `Memory Status: [${ragStatus}] - Total Tracks: ${ragStats.total} across ${ragStats.folders} directories.`
      );
    }
  });

  // 1. Boot flow: Show Confirmation overlay if required
  if (bootPrompt !== null) {
    return <ConfirmPrompt prompt={bootPrompt} />;
  }

  // 2. Normal layout centered in viewport
  return (
    <Box
      width="100%"
      height="100%"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
    >
      <Box flexDirection="column" padding={1} width={80}>
        {/* Top Status Header */}
        <Header status={status} stats={stats} ragStatus={ragStatus} ragStats={ragStats} />

        {/* Main Panel split (Live stream vs Manual Override check boxes) */}
        <Box
          flexDirection="row"
          flexGrow={1}
          minHeight={12}
          borderStyle="single"
          borderColor="gray"
          padding={1}
        >
          <Box flexGrow={1} marginRight={1}>
            <LiveStream log={log} />
          </Box>

          {override !== null ? (
            <Box width={35} borderStyle="round" borderColor="yellow" padding={1}>
              <ManualOverride override={override} />
            </Box>
          ) : null}
        </Box>

        {/* Fixed hotkey footer */}
        <BottomBar />
      </Box>
    </Box>
  );
}
export default App;
