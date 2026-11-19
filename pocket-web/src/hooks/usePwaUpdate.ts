import { useCallback, useEffect, useState } from 'react';

export interface PwaUpdateState {
  appVersion: string;
  buildHash: string;
  versionLabel: string;
  hasUpdate: boolean;
  isUpdating: boolean;
  checkForUpdate: () => Promise<boolean>;
  forceReloadShell: () => Promise<void>;
}

const LOCAL_APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.1.0';
const LOCAL_BUILD_HASH = typeof __BUILD_HASH__ !== 'undefined' ? __BUILD_HASH__ : 'dev';

export async function clearShellCachesAndReload(
  reloadFn: () => void = () => window.location.reload()
): Promise<void> {
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const reg of registrations) {
        if (reg.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
        await reg.unregister().catch(() => {});
      }
    }
    if (typeof window !== 'undefined' && 'caches' in window && window.caches) {
      const keys = await window.caches.keys();
      for (const key of keys) {
        await window.caches.delete(key).catch(() => {});
      }
    }
  } catch {
    // Proceed to reload even if partial cache cleanup fails
  }
  reloadFn();
}

export function usePwaUpdate(
  localVersion: string = LOCAL_APP_VERSION,
  localHash: string = LOCAL_BUILD_HASH
): PwaUpdateState {
  const [hasUpdate, setHasUpdate] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  const checkForUpdate = useCallback(async (): Promise<boolean> => {
    let updateDetected = false;

    // 1. Check Service Worker registrations for a waiting worker
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const reg of registrations) {
          if (reg.waiting) {
            updateDetected = true;
          }
          await reg.update().catch(() => {});
          if (reg.waiting) {
            updateDetected = true;
          }
        }
      } catch {
        // Ignore SW lookup failures in standalone/test environments
      }
    }

    // 2. Compare server buildHash from /api/health against compiled client buildHash
    if (!updateDetected && typeof fetch === 'function') {
      try {
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = ctrl ? setTimeout(() => ctrl.abort(), 2000) : null;
        try {
          const res = await fetch('/api/health', {
            cache: 'no-store',
            signal: ctrl?.signal
          });
          if (res.ok) {
            const data = (await res.json()) as { buildHash?: string };
            if (data.buildHash && localHash !== 'dev' && data.buildHash !== localHash) {
              updateDetected = true;
            }
          }
        } finally {
          if (timer) clearTimeout(timer);
        }
      } catch {
        // Offline or bridge unreachable
      }
    }

    if (updateDetected) {
      setHasUpdate(true);
    }
    return updateDetected;
  }, [localHash]);

  const forceReloadShell = useCallback(async (): Promise<void> => {
    setIsUpdating(true);
    await clearShellCachesAndReload();
  }, []);

  useEffect(() => {
    void checkForUpdate();

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void checkForUpdate();
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [checkForUpdate]);

  return {
    appVersion: localVersion,
    buildHash: localHash,
    versionLabel: `v${localVersion} • #${localHash}`,
    hasUpdate,
    isUpdating,
    checkForUpdate,
    forceReloadShell
  };
}
