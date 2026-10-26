import { epochsFromLocalSeries, londonLocalToEpoch } from '../time/london';
import type { ForecastHour, SunTimes } from './types';

/** Exact start of an hour: stored instant, or read from its UK local time. */
export function hourStartMs(h: { time: string; epochMs?: number; startMs?: number }): number {
  return h.startMs ?? h.epochMs ?? londonLocalToEpoch(h.time);
}

/** Instants for a run of hours, reading older local-only data across a clock change. */
export function hourStarts(hours: ForecastHour[]): number[] {
  if (hours.every((h) => typeof h.epochMs === 'number')) return hours.map((h) => h.epochMs as number);
  return epochsFromLocalSeries(hours.map((h) => h.time));
}

export function sunriseMs(s: SunTimes): number {
  return s.sunriseMs ?? londonLocalToEpoch(s.sunrise);
}

export function sunsetMs(s: SunTimes): number {
  return s.sunsetMs ?? londonLocalToEpoch(s.sunset);
}
