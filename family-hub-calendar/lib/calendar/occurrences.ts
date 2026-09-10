// The .ts extension on the relative import below is deliberate: it lets Node's
// --experimental-strip-types resolve this module directly, so the expansion
// logic can be unit tested without a bundler or test framework.
import * as rruleModule from 'rrule';
// RRule below is a value, so the instance type has to be imported separately.
import type { RRule as RRuleInstance } from 'rrule';

// rrule 2.8 ships no `exports` map, so the two environments disagree: Node ESM
// loads its CJS bundle, where the named exports are undetectable and hang off
// `default`, while bundlers follow `module` to the real ESM build, which has
// named exports and no `default`. Take whichever is present rather than picking
// an import style that works in the browser and breaks under node:test, or the
// reverse.
const RRule =
  (rruleModule as typeof rruleModule & { default?: typeof rruleModule }).default?.RRule ??
  rruleModule.RRule;
import type { CalendarEvent } from '@/types/database';
import {
  floatingUtcToWallClock,
  fromWallClock,
  toWallClock,
  wallClockToFloatingUtc,
} from './timezone.ts';

export type Occurrence = {
  /** Stable per rendered occurrence: the master id plus the original start, so
   *  React keys survive a re-expansion and an exception maps onto its slot. */
  key: string;
  eventId: string;
  /** The recurring master, when this came from one. */
  masterId: string | null;
  /** The slot this occupies in the master's series, unshifted by any edit. */
  originalStart: Date | null;
  title: string;
  location: string | null;
  description: string | null;
  memberId: string | null;
  start: Date;
  end: Date;
  allDay: boolean;
  isRecurring: boolean;
  /** True when a single occurrence was edited away from the series. */
  isException: boolean;
};

/**
 * Expands stored events into occurrences overlapping [windowStart, windowEnd).
 *
 * Occurrences are never materialised in the database (§2.2): a daily standup
 * for five years is not worth 1,825 rows. Only edits to a single occurrence
 * become rows — children carrying `recurrence_parent_id` plus the
 * `recurrence_original_start` slot they replace, or cancel via `is_cancelled`.
 *
 * Recurrence is enumerated in wall-clock space (rrule driven with a floating
 * UTC dtstart) and each result converted back through the event's timezone, so
 * a 9am event stays 9am across a DST change rather than drifting an hour.
 */
export function expandOccurrences(
  events: readonly CalendarEvent[],
  windowStart: Date,
  windowEnd: Date,
  householdTimeZone: string,
): Occurrence[] {
  const masters: CalendarEvent[] = [];
  const standalone: CalendarEvent[] = [];
  // recurrence_parent_id -> original_start ISO -> child row
  const overrides = new Map<string, Map<string, CalendarEvent>>();

  for (const event of events) {
    if (event.recurrence_parent_id && event.recurrence_original_start) {
      const slot = new Date(event.recurrence_original_start).toISOString();
      const forParent = overrides.get(event.recurrence_parent_id) ?? new Map();
      forParent.set(slot, event);
      overrides.set(event.recurrence_parent_id, forParent);
    } else if (event.rrule) {
      masters.push(event);
    } else {
      standalone.push(event);
    }
  }

  const out: Occurrence[] = [];

  for (const event of standalone) {
    if (event.is_cancelled) continue;
    const start = new Date(event.starts_at);
    const end = new Date(event.ends_at);
    if (overlaps(start, end, windowStart, windowEnd)) {
      out.push(toOccurrence(event, start, end, null, false, false));
    }
  }

  for (const master of masters) {
    const zone = master.event_timezone || householdTimeZone;
    const masterStart = new Date(master.starts_at);
    const durationMs = new Date(master.ends_at).getTime() - masterStart.getTime();
    const slots = overrides.get(master.id);

    for (const slotStart of enumerateSlots(master, zone, windowStart, windowEnd, durationMs)) {
      const slotKey = slotStart.toISOString();
      const override = slots?.get(slotKey);

      if (override) {
        // A cancelled occurrence leaves a row behind so the deletion survives
        // re-expansion; it just renders as nothing.
        if (override.is_cancelled) continue;

        const start = new Date(override.starts_at);
        const end = new Date(override.ends_at);
        if (!overlaps(start, end, windowStart, windowEnd)) continue;
        out.push(toOccurrence(override, start, end, slotStart, true, true, master.id));
        continue;
      }

      if (master.is_cancelled) continue;
      const end = new Date(slotStart.getTime() + durationMs);
      if (!overlaps(slotStart, end, windowStart, windowEnd)) continue;
      out.push(toOccurrence(master, slotStart, end, slotStart, true, false, master.id));
    }
  }

  return out.sort(
    (a, b) =>
      a.start.getTime() - b.start.getTime() ||
      // All-day first within a day, then stable by title so a re-expansion
      // never reshuffles equal-start events under the user's finger.
      Number(b.allDay) - Number(a.allDay) ||
      a.title.localeCompare(b.title),
  );
}

function enumerateSlots(
  master: CalendarEvent,
  zone: string,
  windowStart: Date,
  windowEnd: Date,
  durationMs: number,
): Date[] {
  const masterStart = new Date(master.starts_at);
  const dtstart = wallClockToFloatingUtc(toWallClock(masterStart, zone));

  let rule: RRuleInstance;
  try {
    const options = RRule.parseString(master.rrule!);
    // UNTIL in the stored string is a real instant; in floating space it has to
    // be read as a wall clock too, or a series can end an hour early.
    if (options.until) {
      options.until = wallClockToFloatingUtc(toWallClock(options.until, zone));
    }
    rule = new RRule({ ...options, dtstart });
  } catch {
    // A malformed rrule must not blank the whole calendar; treat the master as
    // a single event at its own start.
    return overlaps(masterStart, new Date(masterStart.getTime() + durationMs), windowStart, windowEnd)
      ? [masterStart]
      : [];
  }

  // Widen the query window: an occurrence starting before the window can still
  // end inside it, and rrule works in floating space so the window must be
  // converted the same way.
  const padMs = Math.max(durationMs, 0) + 24 * 60 * 60 * 1000;
  const fromFloating = wallClockToFloatingUtc(
    toWallClock(new Date(windowStart.getTime() - padMs), zone),
  );
  const toFloating = wallClockToFloatingUtc(toWallClock(windowEnd, zone));

  return rule
    .between(fromFloating, toFloating, true)
    .map((floating: Date) => fromWallClock(floatingUtcToWallClock(floating), zone));
}

function overlaps(start: Date, end: Date, windowStart: Date, windowEnd: Date): boolean {
  // Half-open window, and a zero-length event still counts as being in its day.
  return start.getTime() < windowEnd.getTime() && end.getTime() >= windowStart.getTime();
}

function toOccurrence(
  event: CalendarEvent,
  start: Date,
  end: Date,
  originalStart: Date | null,
  isRecurring: boolean,
  isException: boolean,
  masterId: string | null = null,
): Occurrence {
  return {
    key: `${masterId ?? event.id}:${(originalStart ?? start).toISOString()}`,
    eventId: event.id,
    masterId,
    originalStart,
    title: event.title,
    location: event.location,
    description: event.description,
    memberId: event.member_id,
    start,
    end,
    allDay: event.all_day,
    isRecurring,
    isException,
  };
}
