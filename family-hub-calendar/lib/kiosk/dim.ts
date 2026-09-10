export const DEFAULT_RAMP_MINUTES = 20;

/** "HH:MM" or "HH:MM:SS" (Postgres `time`) to minutes into the day. */
export function timeToMinutes(value: string | null): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Overlay opacity for a given local time.
 *
 * Ramped rather than switched, over ~20 minutes at each edge, so the wall
 * display never steps visibly. The window may wrap midnight — 21:00 → 07:00 is
 * the normal case — so "inside" cannot be a simple `start <= t < end`.
 *
 * Returns 0 when either bound is unset: dimming is opt-in, and a half-configured
 * schedule must not darken the screen.
 */
export function dimOpacity(
  minutesIntoDay: number,
  startMinutes: number | null,
  endMinutes: number | null,
  maxOpacity: number,
  rampMinutes: number = DEFAULT_RAMP_MINUTES,
): number {
  if (startMinutes === null || endMinutes === null) return 0;
  if (maxOpacity <= 0) return 0;
  if (startMinutes === endMinutes) return 0; // zero-length window

  const DAY = 1440;
  const t = ((minutesIntoDay % DAY) + DAY) % DAY;

  // Distance travelled into the window, going forwards from the start.
  const windowLength = (endMinutes - startMinutes + DAY) % DAY;
  const sinceStart = (t - startMinutes + DAY) % DAY;
  if (sinceStart >= windowLength) return 0; // outside

  const untilEnd = windowLength - sinceStart;

  // A short window must still reach its edges symmetrically, so the ramp can
  // never exceed half the window.
  const ramp = Math.max(0, Math.min(rampMinutes, windowLength / 2));
  if (ramp === 0) return maxOpacity;

  const edgeDistance = Math.min(sinceStart, untilEnd);
  const fraction = Math.min(1, edgeDistance / ramp);
  return round2(maxOpacity * fraction);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
