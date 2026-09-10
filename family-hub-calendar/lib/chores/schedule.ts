// The .ts extension is deliberate — see lib/calendar/occurrences.ts.
import * as rruleModule from 'rrule';
import { addDaysToKey } from '../calendar/timezone.ts';

// Same dual-environment shim as the calendar: rrule ships no `exports` map.
const RRule =
  (rruleModule as typeof rruleModule & { default?: typeof rruleModule }).default?.RRule ??
  rruleModule.RRule;

export type ChoreSchedule = {
  rrule: string | null;
  starts_on: string; // YYYY-MM-DD
  ends_on: string | null;
};

/**
 * The due dates a chore should have between `fromKey` and `toKey` inclusive.
 *
 * Chore instances ARE materialised, unlike calendar occurrences (§2.3): each
 * one carries state — who ticked it, when, for how many points — so it has to
 * be a row. This produces the dates that generation then upserts.
 *
 * Dates only, no times, so there is no DST hazard here: enumeration happens in
 * floating UTC and only Y-M-D is read back out.
 */
export function dueDatesFor(chore: ChoreSchedule, fromKey: string, toKey: string): string[] {
  const from = keyToUtc(fromKey);
  const to = keyToUtc(toKey);
  if (!from || !to || to < from) return [];

  const start = keyToUtc(chore.starts_on);
  if (!start) return [];

  // A chore never has an instance before it starts or after it ends, whatever
  // the rule says.
  const end = chore.ends_on ? keyToUtc(chore.ends_on) : null;
  const lower = start > from ? start : from;
  const upper = end && end < to ? end : to;
  if (upper < lower) return [];

  if (!chore.rrule) {
    // One-off: exactly one instance, on its start date.
    return start >= lower && start <= upper ? [utcToKey(start)] : [];
  }

  let rule: InstanceType<typeof RRule>;
  try {
    const options = RRule.parseString(chore.rrule);
    if (options.until) options.until = stripToUtcDate(options.until);
    rule = new RRule({ ...options, dtstart: start });
  } catch {
    // A malformed rule must not stop the rest of the board generating; fall
    // back to treating it as a one-off on its start date.
    return start >= lower && start <= upper ? [utcToKey(start)] : [];
  }

  return rule
    .between(lower, upper, true)
    .map((d: Date) => utcToKey(d))
    // COUNT is evaluated from dtstart, so rrule can legitimately return a date
    // before the window when the window starts mid-series; clamp anyway.
    .filter((key) => key >= utcToKey(lower) && key <= utcToKey(upper));
}

/** The generation horizon: today through `days` ahead. */
export function horizonFor(todayKey: string, days: number): { fromKey: string; toKey: string } {
  return { fromKey: todayKey, toKey: addDaysToKey(todayKey, days) };
}

function keyToUtc(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

function utcToKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

function stripToUtcDate(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
