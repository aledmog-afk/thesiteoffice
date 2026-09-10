'use client';

import { useEffect } from 'react';

type WakeLockSentinel = { release: () => Promise<void>; released: boolean };
type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinel> };
};

/**
 * Keeps the wall tablet's screen awake so the frame does not blank.
 *
 * The lock is released automatically whenever the page is hidden, so it has to
 * be re-requested on visibilitychange rather than acquired once at mount —
 * otherwise the display goes to sleep the first time anyone switches tabs.
 */
export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const nav = navigator as WakeLockNavigator;
    if (!nav.wakeLock) return; // unsupported: the device's own timeout applies

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    async function acquire() {
      if (document.visibilityState !== 'visible') return;
      if (sentinel && !sentinel.released) return;
      try {
        const next = await nav.wakeLock!.request('screen');
        if (cancelled) {
          void next.release();
          return;
        }
        sentinel = next;
      } catch {
        // Denied (no user activation yet, battery saver). Retried on the next
        // visibility change; never fatal.
      }
    }

    void acquire();
    const onVisible = () => void acquire();
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (sentinel && !sentinel.released) void sentinel.release();
    };
  }, [enabled]);
}
