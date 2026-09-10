'use client';

import { DimOverlay } from './DimOverlay';
import { IdleWatcher } from './IdleWatcher';
import { useWakeLock } from './useWakeLock';
import { useBuildWatcher } from './useBuildWatcher';
import type { HouseholdSettings } from '@/types/database';

/**
 * Everything the wall display needs and a phone does not: idle handoff to the
 * frame, scheduled dimming, screen wake lock, and a check for having gone
 * stale against a newer deploy.
 *
 * Mounted for every signed-in route rather than only /display, because the
 * tablet can be left on any page and must still dim and idle from there.
 */
export function KioskFrame({
  settings,
  timeZone,
}: {
  settings: HouseholdSettings;
  // Lives on `households`, not on settings — the whole household shares one
  // zone (§5, Defaulted).
  timeZone: string;
}) {
  useWakeLock(true);
  useBuildWatcher();

  return (
    <>
      <IdleWatcher idleSeconds={settings.idle_timeout_seconds} />
      <DimOverlay
        timeZone={timeZone}
        dimStartsAt={settings.dim_starts_at}
        dimEndsAt={settings.dim_ends_at}
        maxOpacity={settings.dim_max_opacity}
      />
    </>
  );
}
