'use client';

import { useEffect, useRef, useState } from 'react';
import { dimOpacity, timeToMinutes } from '@/lib/kiosk/dim';
import { applyFullyBrightness, hasFullyBrightness } from '@/lib/kiosk/fully';
import { minutesIntoDay } from '@/lib/calendar/timezone';

const LIFT_SECONDS = 60;

export function DimOverlay({
  timeZone,
  dimStartsAt,
  dimEndsAt,
  maxOpacity,
}: {
  timeZone: string;
  dimStartsAt: string | null;
  dimEndsAt: string | null;
  maxOpacity: number;
}) {
  const [opacity, setOpacity] = useState(0);
  // Someone checking tomorrow's schedule at 11pm should not have to squint.
  const liftUntilRef = useRef<number>(0);
  const [, forceTick] = useState(0);

  useEffect(() => {
    const startMinutes = timeToMinutes(dimStartsAt);
    const endMinutes = timeToMinutes(dimEndsAt);

    function recompute() {
      if (Date.now() < liftUntilRef.current) {
        setOpacity(0);
        return;
      }
      const nowMinutes = minutesIntoDay(new Date(), timeZone);
      const next = dimOpacity(nowMinutes, startMinutes, endMinutes, maxOpacity);
      setOpacity(next);
      // Real backlight where available; the overlay stays as the fallback and
      // is what phones get regardless.
      applyFullyBrightness(next);
    }

    recompute();

    // A minute is fine for a 20-minute ramp, and cheap enough to leave running
    // for weeks on a wall tablet.
    const interval = setInterval(recompute, 60_000);

    // A tablet that slept through the boundary must not wake up bright at 3am,
    // and setInterval is throttled or frozen while hidden.
    const onVisible = () => {
      if (document.visibilityState === 'visible') recompute();
    };
    document.addEventListener('visibilitychange', onVisible);

    const onInteract = () => {
      liftUntilRef.current = Date.now() + LIFT_SECONDS * 1000;
      recompute();
      // Re-arm a recompute for when the lift expires.
      forceTick((n) => n + 1);
    };
    window.addEventListener('pointerdown', onInteract, { passive: true });
    window.addEventListener('keydown', onInteract);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pointerdown', onInteract);
      window.removeEventListener('keydown', onInteract);
    };
  }, [timeZone, dimStartsAt, dimEndsAt, maxOpacity]);

  return (
    <div
      aria-hidden
      // pointer-events-none is load-bearing: the overlay must never eat a tap.
      className="pointer-events-none fixed inset-0 z-50 bg-black transition-opacity duration-[3000ms]"
      style={{ opacity }}
    />
  );
}
