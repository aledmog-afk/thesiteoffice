import { HOUR_MS, londonLocal } from '../time/london';
import { MIN_PERIOD_HOURS } from './constants';
import { hourStartMs } from './instants';
import type { HourAssessment, Status } from './types';

export interface Period {
  /** Start of the first hour, UK local "YYYY-MM-DDTHH:MM". */
  start: string;
  /** End of the last hour (start of the hour after it), UK local. */
  end: string;
  /** The same two moments as instants. Absent on records saved before LW-M1.2. */
  startMs?: number;
  endMs?: number;
  hours: number;
}

/**
 * Planning guidance only: runs of at least `minHours` consecutive hours that are
 * within limits AND in daylight. A gap in the hourly data ends a run.
 */
export function findWorkablePeriods(hours: HourAssessment[], minHours = MIN_PERIOD_HOURS): Period[] {
  const periods: Period[] = [];
  let runStart: number | null = null;
  let runEnd = 0;
  let count = 0;

  const close = () => {
    if (runStart !== null && count >= minHours) {
      periods.push({ start: londonLocal(runStart), end: londonLocal(runEnd), startMs: runStart, endMs: runEnd, hours: count });
    }
    runStart = null;
    count = 0;
  };

  // Hours join a run only when they follow each other exactly in time, so the
  // repeated and skipped hours at the clock changes are counted correctly.
  for (const h of hours) {
    const ok = h.status === 'within' && h.daylight;
    const start = hourStartMs(h);
    if (ok && runStart !== null && start !== runEnd) close();
    if (ok) {
      if (runStart === null) runStart = start;
      runEnd = start + HOUR_MS;
      count++;
    } else {
      close();
    }
  }
  close();
  return periods;
}

const SEVERITY: Record<Status, number> = { within: 0, near: 1, 'no-data': 2, over: 3 };

/** Ranks status, worst first: over, no data, near, within. */
export function compareSeverity(a: Status, b: Status): number {
  return SEVERITY[a] - SEVERITY[b];
}

/** The worst hour: highest status, then highest ratio. Null for an empty list. */
export function worstHour(hours: HourAssessment[]): HourAssessment | null {
  let worst: HourAssessment | null = null;
  for (const h of hours) {
    if (!worst) {
      worst = h;
      continue;
    }
    const c = compareSeverity(h.status, worst.status);
    if (c > 0 || (c === 0 && (h.ratio ?? 0) > (worst.ratio ?? 0))) worst = h;
  }
  return worst;
}

export interface DayOutlook {
  date: string;
  /** Worst status in daylight hours; null when the day has no daylight hours in the data. */
  worstStatus: Status | null;
  maxGustAtHeightMs: number | null;
  maxPercentOfLimit: number | null;
  daylightHoursWithin: number;
  daylightHours: number;
}

/** Outlook — planning guidance only. One entry per date, from daylight hours. */
export function dailyOutlook(hours: HourAssessment[]): DayOutlook[] {
  const byDate = new Map<string, HourAssessment[]>();
  for (const h of hours) {
    const date = h.time.slice(0, 10);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(h);
  }
  return [...byDate.entries()].map(([date, all]) => {
    const day = all.filter((h) => h.daylight);
    const worst = worstHour(day);
    const gusts = day.map((h) => h.gustAtHeightMs).filter((g): g is number => g !== null);
    const pcts = day.map((h) => h.percentOfLimit).filter((p): p is number => p !== null);
    return {
      date,
      worstStatus: worst ? worst.status : null,
      maxGustAtHeightMs: gusts.length ? Math.max(...gusts) : null,
      maxPercentOfLimit: pcts.length ? Math.max(...pcts) : null,
      daylightHoursWithin: day.filter((h) => h.status === 'within').length,
      daylightHours: day.length,
    };
  });
}
