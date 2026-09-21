import { useInput, useApp } from 'ink';
import { useStore } from '../services/UIService.js';
import { seekPlayback } from '../services/AudioService.js';
import * as CacheService from '../services/CacheService.js';
import * as EngineDBService from '../services/EngineDBService.js';
import * as TelegramService from '../services/TelegramService.js';
import { indexAllDBVibes } from '../services/VibeIndexerService.js';
import { MOCK_MODE, SD_CARD_SYNC_PATH } from '../config.js';
import { normalizeKey } from '../services/KeyboardService.js';
import * as SyncService from '../services/SyncService.js';

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
  const driveSyncProgress = useStore((state) => state.driveSyncProgress);
  const isSyncActive = driveSyncProgress?.isActive ?? false;
  const isLLMAnalyzing = useStore((state) => state.isLLMAnalyzing);
  const isTelegramDownloading = useStore((state) => state.isTelegramDownloading);
  const isIndexingVibes = useStore((state) => state.isIndexingVibes);

  const setStatus = useStore((state) => state.setStatus);
  const addLog = useStore((state) => state.addLog);

  useInput((input, key) => {
    if (isOverlayActive) {
      return;
    }

    const normInput = normalizeKey(input);
    const keyLower = normInput.toLowerCase();

    // Always permit audio playback seeking
    if (key.leftArrow) {
      seekPlayback(-10);
      return;
    } else if (key.rightArrow) {
      seekPlayback(10);
      return;
    }

    // Always permit quit [Q]
    if (keyLower === 'q') {
      addLog('SYSTEM', 'Shutting down CrateMind in 3 seconds. Goodbye!');
      setTimeout(() => {
        exit();
        process.exit(0);
      }, 3000);
      return;
    }

    // Guard 1: When Drive Mirror / Sync is active, block all conflicting operations
    if (isSyncActive) {
      if (normInput === ' ' || ['s', 't', 'v', 'l', 'c'].includes(keyLower)) {
        addLog(
          'SYSTEM',
          'Action blocked: Drive synchronization is currently running. Please wait for completion.'
        );
      }
      return;
    }

    // Guard 2: When Vibe DB Indexing is active, block all conflicting operations
    if (isIndexingVibes) {
      if (normInput === ' ' || ['s', 't', 'v', 'l', 'c'].includes(keyLower)) {
        addLog(
          'SYSTEM',
          'Action blocked: Vibe DB indexing is currently running. Please wait for completion.'
        );
      }
      return;
    }

    // Guard 3: When Telegram download is active, block all conflicting operations
    if (isTelegramDownloading) {
      if (normInput === ' ' || ['s', 'v', 'l', 'c'].includes(keyLower)) {
        addLog(
          'SYSTEM',
          'Action blocked: Telegram download is currently running. Please wait for completion.'
        );
        return;
      } else if (keyLower === 't') {
        addLog('SYSTEM', 'Action blocked: Telegram download is already in progress.');
        return;
      }
      return;
    }

    // Guard 4: When track analysis queue is active, block sync, vibe indexing, and telegram download
    if (status === 'listening' || isLLMAnalyzing) {
      if (keyLower === 's') {
        addLog(
          'SYSTEM',
          'Action blocked: Track analysis is active. Press [Space] to pause analysis before starting sync.'
        );
        return;
      } else if (keyLower === 'v') {
        addLog(
          'SYSTEM',
          'Action blocked: Track analysis is active. Press [Space] to pause analysis before indexing vibes.'
        );
        return;
      } else if (keyLower === 't') {
        addLog(
          'SYSTEM',
          'Action blocked: Track analysis is active. Press [Space] to pause analysis before starting Telegram download.'
        );
        return;
      }
    }

    if (normInput === ' ') {
      const nextStatus = status === 'listening' ? 'paused' : 'listening';
      setStatus(nextStatus);
      addLog('SYSTEM', `System ${nextStatus === 'listening' ? 'resumed' : 'paused'}.`);
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
        detail: 'Choose whether to download & analyze, or download only.',
        yesLabel: 'Download & Analyze',
        noLabel: 'Cancel',
        thirdLabel: 'Download Only',
        thirdKey: 'd',
        resolve: (result) => {
          setBootPrompt(null);
          if (result === true) {
            useStore.getState().setTelegramDownloadOnly(false);
            TelegramService.downloadBulk().catch((err) => {
              addLog('ERROR', `Telegram download failed: ${err}`);
            });
          } else if (result === 'download-only') {
            useStore.getState().setTelegramDownloadOnly(true);
            TelegramService.downloadBulk().catch((err) => {
              addLog('ERROR', `Telegram download failed: ${err}`);
            });
          }
        }
      });
    } else if (keyLower === 's') {
      const setBootPrompt = useStore.getState().setBootPrompt;
      const drivesConnected = SyncService.areDrivesConnected();

      if (drivesConnected) {
        setBootPrompt({
          message: 'Choose synchronization mode:',
          detail: `[Y] Sorted -> SD Card | [D] Mirror SD -> EngineDJ Drive`,
          yesLabel: 'Sorted -> SD',
          thirdLabel: 'SD -> EngineDJ Drive',
          thirdKey: 'd',
          thirdResult: 'drive-sync',
          noLabel: 'Cancel',
          resolve: (result) => {
            setBootPrompt(null);
            if (result === true) {
              SyncService.sync().catch((err) => {
                addLog('ERROR', `Sync invocation failed: ${err}`);
              });
            } else if (result === 'drive-sync') {
              SyncService.syncDrives().catch((err) => {
                addLog('ERROR', `Drive mirror failed: ${err}`);
              });
            }
          }
        });
      } else {
        setBootPrompt({
          message: 'Sync Sorted to external collection?',
          detail: `Destination: ${SD_CARD_SYNC_PATH}`,
          resolve: (confirmed) => {
            setBootPrompt(null);
            if (confirmed) {
              SyncService.sync().catch((err) => {
                addLog('ERROR', `Sync invocation failed: ${err}`);
              });
            }
          }
        });
      }
    }
  });
}
