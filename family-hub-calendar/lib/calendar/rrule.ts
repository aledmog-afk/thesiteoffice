export type RepeatFreq = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

/**
 * Builds the small set of rules the UI can create. Reading is far broader —
 * expansion goes through rrule and handles anything RFC 5545, which matters
 * once provider sync starts importing rules this builder would never produce.
 */
export function buildRRule(freq: RepeatFreq, weekdayIndex: number): string | null {
  switch (freq) {
    case 'none':
      return null;
    case 'daily':
      return 'FREQ=DAILY';
    case 'weekly':
      return `FREQ=WEEKLY;BYDAY=${WEEKDAYS[weekdayIndex] ?? 'MO'}`;
    case 'monthly':
      return 'FREQ=MONTHLY';
    case 'yearly':
      return 'FREQ=YEARLY';
  }
}

/** Best-effort label for an existing rule, including ones we cannot rebuild. */
export function describeRRule(rrule: string | null): string {
  if (!rrule) return 'Does not repeat';
  const upper = rrule.toUpperCase();
  if (upper.includes('FREQ=DAILY')) return 'Every day';
  if (upper.includes('FREQ=WEEKLY')) return 'Every week';
  if (upper.includes('FREQ=MONTHLY')) return 'Every month';
  if (upper.includes('FREQ=YEARLY')) return 'Every year';
  return 'Repeats';
}

export function freqFromRRule(rrule: string | null): RepeatFreq {
  if (!rrule) return 'none';
  const upper = rrule.toUpperCase();
  if (upper.includes('FREQ=DAILY')) return 'daily';
  if (upper.includes('FREQ=WEEKLY')) return 'weekly';
  if (upper.includes('FREQ=MONTHLY')) return 'monthly';
  if (upper.includes('FREQ=YEARLY')) return 'yearly';
  return 'none';
}
