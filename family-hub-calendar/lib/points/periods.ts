// The .ts extension is deliberate — see lib/calendar/occurrences.ts.
import { addDaysToKey, startOfMonthKey, startOfWeekKey } from '../calendar/timezone.ts';

export type PeriodKind = 'week' | 'month' | 'all';

export const PERIODS: { kind: PeriodKind; label: string }[] = [
  { kind: 'week', label: 'This week' },
  { kind: 'month', label: 'This month' },
  { kind: 'all', label: 'All time' },
];

/**
 * Inclusive date bounds to hand to the `leaderboard(p_from, p_to)` function.
 *
 * The SQL side converts these using `households.timezone`, so "this week"
 * means the household's week rather than a UTC one; the keys produced here are
 * already local calendar dates for the same reason.
 */
export function periodRange(
  kind: PeriodKind,
  todayKey: string,
  weekStartsOn: number,
): { fromKey: string; toKey: string } {
  switch (kind) {
    case 'week':
      return { fromKey: startOfWeekKey(todayKey, weekStartsOn), toKey: todayKey };
    case 'month':
      return { fromKey: startOfMonthKey(todayKey), toKey: todayKey };
    case 'all':
      // Far enough back to predate any household, and cheap: the ledger index
      // on (household_id, occurred_at) is only scanned for 'earn' rows.
      return { fromKey: '1970-01-01', toKey: todayKey };
  }
}

/** Bound used when a period should include the rest of today's events too. */
export function endOfTodayKey(todayKey: string): string {
  return addDaysToKey(todayKey, 0);
}
