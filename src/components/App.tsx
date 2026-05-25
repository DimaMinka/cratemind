import React from 'react';
import { Box } from 'ink';
import { useStore } from '../services/UIService.js';
import { ConfirmPrompt } from './ConfirmPrompt.js';
import { Header } from './Header.js';
import { LiveStream } from './LiveStream.js';
import { ManualOverride } from './ManualOverride.js';
import { BottomBar } from './BottomBar.js';
import { MiniPlayer } from './MiniPlayer.js';
import { useGlobalHotkeys } from '../hooks/useGlobalHotkeys.js';

/**
 * App.tsx
 *
 * Root Ink component. Orchestrates global layouts, conditional boot dialogs,
 * manual override displays, and main navigation hotkeys. All layouts are centered
 * horizontally and vertically inside the terminal window.
 */
export function App(): React.JSX.Element {
  // Connect to global Zustand store
  const status = useStore((state) => state.status);
  const stats = useStore((state) => state.stats);
  const log = useStore((state) => state.log);
  const override = useStore((state) => state.override);
  const bootPrompt = useStore((state) => state.bootPrompt);
  const ragStatus = useStore((state) => state.ragStatus);
  const ragStats = useStore((state) => state.ragStats);

  // Capture global hotkeys
  const isOverlayActive = bootPrompt !== null || override !== null;
  useGlobalHotkeys(isOverlayActive);

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
      <Box flexDirection="column" paddingX={1} width={150}>
        {/* Top Status Header */}
        <Header status={status} stats={stats} ragStatus={ragStatus} ragStats={ragStats} />

        {/* Main Panel split (Live stream vs Manual Override check boxes) */}
        <Box
          flexDirection="row"
          flexGrow={1}
          minHeight={12}
          width="100%"
        >
          {/* Left panel: Live Stream Log with its own border */}
          <Box
            width={override !== null ? 95 : 150}
            borderStyle="single"
            borderColor="gray"
            padding={1}
          >
            <LiveStream log={log} />
          </Box>

          {/* Right panel: Manual Override outside of the log window */}
          {override !== null ? (
            <Box
              width={55}
              borderStyle="round"
              borderColor="gray"
              padding={1}
              marginLeft={1}
            >
              <ManualOverride override={override} />
            </Box>
          ) : null}
        </Box>

        {/* Premium animated progress player */}
        <MiniPlayer />

        {/* Fixed hotkey footer */}
        <BottomBar />
      </Box>
    </Box>
  );
}
export default App;
