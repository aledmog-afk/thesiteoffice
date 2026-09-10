'use client';

import { useEffect, useState } from 'react';

/**
 * The frame stays useful at a glance (§2.6): a wall tablet showing only photos
 * is a worse wall tablet. Time, date, and what is next.
 */
export function ClockOverlay({
  timeZone,
  nextEvent,
}: {
  timeZone: string;
  nextEvent: { title: string; when: string; color: string } | null;
}) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    // Set on mount rather than during render: rendering the current time on
    // the server produces a hydration mismatch, and the first paint would be
    // a stale clock anyway.
    setNow(new Date());
    // Tick on the minute boundary rather than every second — nothing here
    // shows seconds, and a wall tablet runs this for weeks.
    let timer: ReturnType<typeof setTimeout>;
    function scheduleNextTick() {
      const ms = 60_000 - (Date.now() % 60_000);
      timer = setTimeout(() => {
        setNow(new Date());
        scheduleNextTick();
      }, ms + 50);
    }
    scheduleNextTick();
    return () => clearTimeout(timer);
  }, []);

  const time = now
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(now)
    : '--:--';

  const date = now
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone,
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }).format(now)
    : '';

  return (
    <div className="pointer-events-none flex h-full flex-col items-center justify-center gap-2 text-white">
      <span className="text-[18vw] leading-none font-light tabular-nums sm:text-[14vw]">
        {time}
      </span>
      <span className="text-2xl font-light text-white/80">{date}</span>

      {nextEvent && (
        <span className="mt-6 flex items-center gap-3 rounded-full bg-white/10 px-5 py-3 backdrop-blur">
          <span
            className="h-3 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: nextEvent.color }}
            aria-hidden
          />
          <span className="text-xl font-medium">{nextEvent.when}</span>
          <span className="text-xl text-white/80">{nextEvent.title}</span>
        </span>
      )}
    </div>
  );
}
