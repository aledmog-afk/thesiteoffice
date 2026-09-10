// Wall-clock ↔ instant conversion, using only Intl — no date library.
//
// Why this exists: a weekly 9am school run must stay at 9am through a DST
// change. If recurrence is expanded by adding 7×24h to a UTC instant, the
// occurrence silently becomes 8am or 10am for half the year, which is exactly
// the bug a family calendar cannot have. So recurrence is enumerated in
// wall-clock space and each occurrence is converted back to a real instant
// here, against the event's own timezone.

export type WallClock = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
};

const cache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = cache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    cache.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock reading a person in `timeZone` sees at instant `date`. */
export function toWallClock(date: Date, timeZone: string): WallClock {
  const parts = formatterFor(timeZone).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');

  // en-US with hour12:false renders midnight as hour 24 in some ICU versions.
  const hour = get('hour') % 24;

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour,
    minute: get('minute'),
  };
}

/** Offset in minutes east of UTC that `timeZone` is at instant `date`. */
export function offsetMinutes(date: Date, timeZone: string): number {
  const wall = toWallClock(date, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  // Seconds are dropped by asUtc, so compare against a seconds-truncated
  // instant or a non-zero-second date reports an offset a minute out.
  const truncated = Math.floor(date.getTime() / 60000) * 60000;
  return (asUtc - truncated) / 60000;
}

/**
 * The instant at which `timeZone` reads `wall`.
 *
 * Inverting a timezone is not a lookup: the offset depends on the instant,
 * which is what we are solving for. So try both offsets in force around that
 * day, keep the candidates that read back as the requested wall clock, and
 * take the earliest.
 *
 * Two wall-clock times do not exist uniquely:
 *  - Autumn-back overlap (01:30 happening twice): both candidates are valid and
 *    the earlier — the pre-transition, still-DST one — wins, which is the
 *    RFC 5545 reading.
 *  - Spring-forward gap (01:30 where the clock jumps 01:00 → 02:00): no
 *    candidate reads back, so the time is shifted forward by the gap, matching
 *    how calendars handle a nonexistent local time.
 */
export function fromWallClock(wall: WallClock, timeZone: string): Date {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  const DAY = 86_400_000;

  // A day either side brackets any DST transition, so these are the only two
  // offsets that can apply to this wall clock.
  const offsetBefore = offsetMinutes(new Date(naive - DAY), timeZone);
  const offsetAfter = offsetMinutes(new Date(naive + DAY), timeZone);

  const readsBack = (candidate: Date) => {
    const r = toWallClock(candidate, timeZone);
    return (
      r.year === wall.year &&
      r.month === wall.month &&
      r.day === wall.day &&
      r.hour === wall.hour &&
      r.minute === wall.minute
    );
  };

  const valid = [...new Set([offsetBefore, offsetAfter])]
    .map((offset) => new Date(naive - offset * 60_000))
    .filter(readsBack)
    .sort((a, b) => a.getTime() - b.getTime());

  if (valid.length > 0) return valid[0];

  // Spring-forward gap: applying the pre-transition offset lands past the jump.
  return new Date(naive - offsetBefore * 60_000);
}

/** Same wall-clock reading, but as a Date whose UTC fields carry it. Used to
 *  drive rrule in "floating" mode so expansion is DST-independent. */
export function wallClockToFloatingUtc(wall: WallClock): Date {
  return new Date(Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute));
}

/** Read UTC fields back out as a wall clock. Inverse of the above. */
export function floatingUtcToWallClock(date: Date): WallClock {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  };
}

/** Local calendar date key (YYYY-MM-DD) for grouping occurrences by day. */
export function dateKey(date: Date, timeZone: string): string {
  const w = toWallClock(date, timeZone);
  return `${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`;
}

/** Minutes since local midnight — drives vertical position in the week grid. */
export function minutesIntoDay(date: Date, timeZone: string): number {
  const w = toWallClock(date, timeZone);
  return w.hour * 60 + w.minute;
}

/** `<input type="date">` value for an instant, in the given zone. */
export function toDateInput(date: Date, timeZone: string): string {
  return dateKey(date, timeZone);
}

/** `<input type="time">` value for an instant, in the given zone. */
export function toTimeInput(date: Date, timeZone: string): string {
  const w = toWallClock(date, timeZone);
  return `${String(w.hour).padStart(2, '0')}:${String(w.minute).padStart(2, '0')}`;
}

/**
 * Reads a date + time pair straight from form inputs into a wall clock.
 *
 * Native date/time inputs are used rather than a picker library: on Android
 * they open the platform's own wheel, which is the right control on a wall
 * tablet and costs no bundle.
 */
export function parseInputs(dateValue: string, timeValue: string): WallClock | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  if (!d) return null;
  const t = /^(\d{2}):(\d{2})/.exec(timeValue || '00:00');
  if (!t) return null;

  const wall = {
    year: Number(d[1]),
    month: Number(d[2]),
    day: Number(d[3]),
    hour: Number(t[1]),
    minute: Number(t[2]),
  };

  if (wall.month < 1 || wall.month > 12 || wall.day < 1 || wall.day > 31) return null;
  if (wall.hour > 23 || wall.minute > 59) return null;
  return wall;
}

/** Local midnight for a calendar date, as an instant. Window bounds are built
 *  from this so a "week" is the household's week, not a UTC one. */
export function localMidnight(dateValue: string, timeZone: string): Date {
  const wall = parseInputs(dateValue, '00:00');
  if (!wall) throw new Error(`bad date: ${dateValue}`);
  return fromWallClock(wall, timeZone);
}

/** Shift a calendar date key by whole days, staying in wall-clock space so a
 *  DST day is still one day. */
export function addDaysToKey(dateValue: string, days: number): string {
  const wall = parseInputs(dateValue, '00:00');
  if (!wall) throw new Error(`bad date: ${dateValue}`);
  const d = new Date(Date.UTC(wall.year, wall.month - 1, wall.day));
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

/** Monday-or-Sunday start of the week containing `dateValue`. */
export function startOfWeekKey(dateValue: string, weekStartsOn: number): string {
  const wall = parseInputs(dateValue, '00:00');
  if (!wall) throw new Error(`bad date: ${dateValue}`);
  const d = new Date(Date.UTC(wall.year, wall.month - 1, wall.day));
  const diff = (d.getUTCDay() - weekStartsOn + 7) % 7;
  return addDaysToKey(dateValue, -diff);
}

/** First day of the month containing `dateValue`. */
export function startOfMonthKey(dateValue: string): string {
  const wall = parseInputs(dateValue, '00:00');
  if (!wall) throw new Error(`bad date: ${dateValue}`);
  return `${wall.year}-${String(wall.month).padStart(2, '0')}-01`;
}

export function addMonthsToKey(dateValue: string, months: number): string {
  const wall = parseInputs(dateValue, '00:00');
  if (!wall) throw new Error(`bad date: ${dateValue}`);
  const d = new Date(Date.UTC(wall.year, wall.month - 1 + months, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}
