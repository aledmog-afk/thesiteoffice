'use client';

import { useEffect } from 'react';

const CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * A wall tablet can sit on one page for weeks and end up running JS from three
 * deploys ago against a migrated schema. This polls the deployed build id and
 * reloads when it no longer matches the one this bundle was built with.
 *
 * Only reloads while the page is hidden or the user is idle-ish — reloading
 * under someone's finger mid-edit is worse than being a version behind.
 */
export function useBuildWatcher() {
  useEffect(() => {
    const own = process.env.NEXT_PUBLIC_BUILD_ID;
    if (!own) return;

    let lastInteraction = Date.now();
    const bump = () => {
      lastInteraction = Date.now();
    };
    window.addEventListener('pointerdown', bump, { passive: true });
    window.addEventListener('keydown', bump);

    async function check() {
      try {
        const response = await fetch('/api/build-id', { cache: 'no-store' });
        if (!response.ok) return;
        const { buildId } = (await response.json()) as { buildId?: string };
        if (!buildId || buildId === own) return;

        const idleFor = Date.now() - lastInteraction;
        if (document.visibilityState === 'hidden' || idleFor > 2 * 60 * 1000) {
          window.location.reload();
        }
      } catch {
        // Offline or the route is unavailable; try again next interval.
      }
    }

    const interval = setInterval(check, CHECK_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      window.removeEventListener('pointerdown', bump);
      window.removeEventListener('keydown', bump);
    };
  }, []);
}
