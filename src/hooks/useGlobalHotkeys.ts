import { useInput, useApp } from 'ink';
import { useStore } from '../services/UIService.js';
import { seekPlayback } from '../services/AudioService.js';

export function useGlobalHotkeys(isOverlayActive: boolean): void {
  const { exit } = useApp();
  const status = useStore((state) => state.status);
  const ragStatus = useStore((state) => state.ragStatus);
  const ragStats = useStore((state) => state.ragStats);
  const setStatus = useStore((state) => state.setStatus);
  const addLog = useStore((state) => state.addLog);

  useInput((input, key) => {
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
    } else if (key.leftArrow) {
      seekPlayback(-10);
    } else if (key.rightArrow) {
      seekPlayback(10);
    }
  });
}
