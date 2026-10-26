/**
 * Europe/London time handling. Open-Meteo is asked for UNIX timestamps
 * (timeformat=unixtime), so every forecast hour is an exact instant. All arithmetic
 * (hour ends, lift windows, daylight, joining hours into periods) uses instants in
 * milliseconds. Local "YYYY-MM-DDTHH:MM" strings are only for display and for
 * reading older saved data.
 *
 * On the last Sunday in October 01:00–02:00 happens twice (BST, then GMT); on the
 * last Sunday in March 01:00–02:00 does not happen. Local strings alone cannot
 * describe those days, which is why instants are used.
 */

export const HOUR_MS = 3_600_000;
export const LONDON = 'Europe/London';

const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: LONDON,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Instant → UK local wall-clock time, "YYYY-MM-DDTHH:MM". */
export function londonLocal(ms: number): string {
  const p = Object.fromEntries(partsFmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Offset of UK local time from UTC at an instant, in minutes (0 for GMT, 60 for BST). */
export function londonOffsetMinutes(ms: number): number {
  const local = londonLocal(ms);
  return Math.round((Date.parse(`${local}:00Z`) - Math.floor(ms / 60000) * 60000) / 60000);
}

export function londonZone(ms: number): 'GMT' | 'BST' {
  return londonOffsetMinutes(ms) === 0 ? 'GMT' : 'BST';
}

/**
 * UK local "YYYY-MM-DDTHH:MM" → instant.
 * - A time that happens twice (October) gives the earlier instant, or the later one
 *   with `prefer: 'later'`.
 * - A time that does not happen (March) moves forward by the hour that was skipped:
 *   01:30 on 29 March 2026 is read as 02:30 BST.
 */
export function londonLocalToEpoch(local: string, prefer: 'earlier' | 'later' = 'earlier'): number {
  const asUtc = Date.parse(`${local.slice(0, 16)}:00Z`);
  if (!Number.isFinite(asUtc)) throw new Error(`Not a local time: ${local}`);
  const candidates = [asUtc - HOUR_MS, asUtc].filter((ms) => londonLocal(ms) === local.slice(0, 16));
  if (candidates.length === 0) return asUtc; // skipped hour: GMT reading = an hour later on the clock
  return prefer === 'later' ? candidates[candidates.length - 1] : candidates[0];
}

/**
 * Instants for a run of local hourly times in order, as an older forecast or record
 * holds them. A repeated label (October) is read as the later instant.
 */
export function epochsFromLocalSeries(times: string[]): number[] {
  const out: number[] = [];
  for (const t of times) {
    let ms = londonLocalToEpoch(t, 'earlier');
    const prev = out[out.length - 1];
    if (prev !== undefined && ms <= prev) ms = londonLocalToEpoch(t, 'later');
    out.push(ms);
  }
  return out;
}

/** True when this local clock time also occurs an hour earlier or later (the October repeat). */
export function isRepeatedLocalTime(ms: number): boolean {
  const here = londonLocal(ms);
  return londonLocal(ms - HOUR_MS) === here || londonLocal(ms + HOUR_MS) === here;
}

/** "HH:MM", with "BST"/"GMT" added when the clock time happens twice that day. */
export function londonClock(ms: number): string {
  const hhmm = londonLocal(ms).slice(11, 16);
  return isRepeatedLocalTime(ms) ? `${hhmm} ${londonZone(ms)}` : hhmm;
}
