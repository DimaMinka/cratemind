import React from 'react';
import { Box } from 'ink';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../services/UIService.js';
import { ConfirmPrompt } from './ConfirmPrompt.js';
import { Header } from './Header.js';
import { LiveStream } from './LiveStream.js';
import { ManualOverride } from './ManualOverride.js';
import { BottomBar } from './BottomBar.js';
import { MiniPlayer } from './MiniPlayer.js';
import { useGlobalHotkeys } from '../hooks/useGlobalHotkeys.js';
import { useStdoutDimensions } from '../hooks/useStdoutDimensions.js';

/**
 * App.tsx
 *
 * Root Ink component. Orchestrates global layouts, conditional boot dialogs,
 * manual override displays, and main navigation hotkeys. All layouts are centered
 * horizontally and vertically inside the terminal window.
 */
export function App(): React.JSX.Element {
  // Single shallow-equal subscription — prevents 9 separate re-render cycles
  // on every store update (e.g., frequent log writes during track processing).
  const {
    status,
    stats,
    dailyRequestsUsed,
    dailyRequestsLimit,
    totalCacheHits,
    log,
    override,
    bootPrompt,
    ragStatus,
    ragStats,
    isLLMAnalyzing,
    incomingCount,
    globalStats
  } = useStore(
    useShallow((s) => ({
      status: s.status,
      stats: s.stats,
      dailyRequestsUsed: s.dailyRequestsUsed,
      dailyRequestsLimit: s.dailyRequestsLimit,
      totalCacheHits: s.totalCacheHits,
      log: s.log,
      override: s.override,
      bootPrompt: s.bootPrompt,
      ragStatus: s.ragStatus,
      ragStats: s.ragStats,
      isLLMAnalyzing: s.isLLMAnalyzing,
      incomingCount: s.incomingCount,
      globalStats: s.globalStats
    }))
  );

  // Capture global hotkeys
  const isOverlayActive = bootPrompt !== null || override !== null;
  useGlobalHotkeys(isOverlayActive);

  const { columns, rows } = useStdoutDimensions();

  // 1. Boot flow: Show Confirmation overlay if required
  if (bootPrompt !== null) {
    return <ConfirmPrompt prompt={bootPrompt} />;
  }

  // 2. Normal layout centered in viewport
  return (
    <Box
      width={columns}
      height={rows}
      flexDirection="column"
      alignItems="center"
      justifyContent="flex-start"
      overflow="hidden"
    >
      <Box flexDirection="column" paddingX={1} width="100%">
        {/* Top Status Header */}
        <Header
          status={status}
          stats={stats}
          ragStatus={ragStatus}
          ragStats={ragStats}
          dailyRequestsUsed={dailyRequestsUsed}
          dailyRequestsLimit={dailyRequestsLimit}
          totalCacheHits={totalCacheHits}
          isLLMAnalyzing={isLLMAnalyzing}
          incomingCount={incomingCount}
          globalStats={globalStats}
        />

        {/* Main Panel split (Live stream vs Manual Override check boxes) */}
        <Box flexDirection="row" flexGrow={1} minHeight={12} width="100%">
          {/* Left panel: Live Stream Log with its own border */}
          <Box flexGrow={1} borderStyle="single" borderColor="gray" padding={1} overflow="hidden">
            <LiveStream log={log} />
          </Box>

          {/* Right panel: Manual Override outside of the log window */}
          {override !== null ? (
            <Box
              width="40%"
              minWidth={30}
              borderStyle="round"
              borderColor="gray"
              padding={1}
              marginLeft={1}
              overflow="hidden"
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
