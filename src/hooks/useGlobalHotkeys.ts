import { useInput, useApp } from 'ink';
import { useStore } from '../services/UIService.js';
import { seekPlayback } from '../services/AudioService.js';
import * as CacheService from '../services/CacheService.js';
import * as EngineDBService from '../services/EngineDBService.js';
import * as TelegramService from '../services/TelegramService.js';
import { indexAllDBVibes } from '../services/VibeIndexerService.js';
import { MOCK_MODE } from '../config.js';
import { normalizeKey } from '../services/KeyboardService.js';

/**
 * useGlobalHotkeys.ts
 *
 * Custom hook to listen to global terminal keystrokes when no modal/dialog overlay is active.
 * Handles pausing/resuming the active listener, exiting, logging RAG memory stats, resetting limits,
 * triggering simulator chaos testing mode, and controlling audio playback seeking.
 */

/**
 * Registers global keyboard input listeners for main app navigation and controls.
 *
 * @param {boolean} isOverlayActive - If true, suspends global hotkey handlers to avoid interfering with overlay screens (like manual override checklist or boot prompts).
 */
export function useGlobalHotkeys(isOverlayActive: boolean): void {
  const { exit } = useApp();
  const status = useStore((state) => state.status);

  const setStatus = useStore((state) => state.setStatus);
  const addLog = useStore((state) => state.addLog);

  useInput((input, key) => {
    if (isOverlayActive) {
      return;
    }

    const normInput = normalizeKey(input);
    const keyLower = normInput.toLowerCase();

    if (normInput === ' ') {
      const nextStatus = status === 'listening' ? 'paused' : 'listening';
      setStatus(nextStatus);
      addLog('SYSTEM', `System ${nextStatus === 'listening' ? 'resumed' : 'paused'}.`);
    } else if (keyLower === 'q') {
      addLog('SYSTEM', 'Shutting down CrateMind in 3 seconds. Goodbye!');
      setTimeout(() => {
        exit();
        process.exit(0);
      }, 3000);
    } else if (keyLower === 'l') {
      CacheService.resetDailyLimits();
      const currentStats = CacheService.getStats();
      useStore.getState().setLimitStats(currentStats);
      addLog('SYSTEM', 'Daily requests counter has been reset to 0.');
    } else if (keyLower === 'c' && MOCK_MODE) {
      addLog('SYSTEM', '[CHAOS] Simulating API cold start: Clearing cache...');
      CacheService.clearCacheAndStats();

      addLog('SYSTEM', '[CHAOS] Simulating API Limit exhaustion: Maximizing daily requests...');
      CacheService.forceLimitExhaustion();

      // Sync store
      const currentStats = CacheService.getStats();
      useStore.getState().setLimitStats(currentStats);

      addLog(
        'SYSTEM',
        '[CHAOS] Chaos Mode initialized! Next discovered track will trigger ManualOverride.'
      );
    } else if (keyLower === 'v') {
      if (EngineDBService.isAvailable()) {
        const setBootPrompt = useStore.getState().setBootPrompt;
        setBootPrompt({
          message: 'Scan m.db for new vibe tracks to index?',
          detail: 'Finds all tracks in mood folders and vector-indexes them',
          resolve: (confirmed) => {
            setBootPrompt(null);
            if (confirmed) {
              indexAllDBVibes();
            }
          }
        });
      } else {
        addLog('ERROR', 'Engine DJ database is not available for vibe indexing.');
      }
    } else if (keyLower === 't') {
      const setBootPrompt = useStore.getState().setBootPrompt;
      setBootPrompt({
        message: 'Start downloading tracks from Telegram?',
        detail: 'Connects to configured channels and downloads audio to Incoming folder.',
        resolve: (confirmed) => {
          setBootPrompt(null);
          if (confirmed) {
            TelegramService.downloadBulk().catch((err) => {
              addLog('ERROR', `Telegram download failed: ${err}`);
            });
          }
        }
      });
    } else if (key.leftArrow) {
      seekPlayback(-10);
    } else if (key.rightArrow) {
      seekPlayback(10);
    }
  });
}
