import type { Forecast } from '../data/openMeteo';
import {
  assessHours,
  dailyOutlook,
  findWorkablePeriods,
  terrainHeightFactor,
  permittedWindSpeed,
  worstHour,
  type DayOutlook,
  type DaySun,
  type ForecastHour,
  type HourAssessment,
  type LoadWindResult,
  type Period,
  type Status,
  type Terrain,
} from '../wind';
import type { LiftSetup } from './setup';

/** How one load in the lift plan fares against the forecast. */
export interface LoadOutcome {
  ref: string;
  isMain: boolean;
  result: LoadWindResult;
  /** Status for each lift-day hour, in the same order as LiftAssessment.liftDayHours. */
  statuses: Status[];
  /** Worst status in the lift window, and its % of this load's limit. */
  windowStatus: Status;
  windowWorstPercent: number | null;
  /** Daylight runs of 1 hour or more within limits for this load. */
  periods: Period[];
}

export interface LiftAssessment {
  /** The governing load: the most wind-sensitive (lowest permitted speed) in the plan. */
  load: LoadWindResult;
  /** Reference of the governing load. */
  governingRef: string;
  /** Every load in the plan, main load first. Absent on records saved before load schedules. */
  loads: LoadOutcome[];
  heightM: number;
  terrain: Terrain;
  heightFactor: number;
  liftDate: string;
  liftDaySun: DaySun | null;
  /** The lift window actually used, "YYYY-MM-DDTHH:MM". */
  windowStart: string;
  windowEnd: string;
  windowDefaulted: boolean;
  /** Raw forecast values for the lift date (stored in the record). */
  liftDayForecast: ForecastHour[];
  liftDayHours: HourAssessment[];
  windowHours: HourAssessment[];
  worst: HourAssessment | null;
  overallStatus: Status;
  periods: Period[];
  outlook: DayOutlook[];
}

export class AssessmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssessmentError';
  }
}

/** Load reduction only: the live "working" on the set-up screen. Throws on invalid input. */
export function loadResult(s: LiftSetup): LoadWindResult {
  return permittedWindSpeed({
    loadLengthM: s.loadLengthM ?? Number.NaN,
    loadHeightM: s.loadHeightM ?? Number.NaN,
    dragCoefficient: s.dragCoefficient ?? Number.NaN,
    loadMassKg: s.loadMassKg ?? Number.NaN,
    riggingMassKg: s.riggingMassKg ?? Number.NaN,
    chartLimitMs: s.chartLimitMs ?? Number.NaN,
  });
}

/** Runs the whole method for a lift date against a forecast. */
export function assessLift(s: LiftSetup, forecast: Forecast): LiftAssessment {
  if (s.chartLimitType !== 'gust') {
    throw new AssessmentError('The chart limit must be a gust limit for this method.');
  }
  const mainRef = s.loadDescription.trim() || 'Main load';
  const candidates = [
    { ref: mainRef, isMain: true, result: loadResult(s) },
    ...(s.extraLoads ?? []).map((l) => ({
      ref: l.ref,
      isMain: false,
      result: permittedWindSpeed({
        loadLengthM: l.lengthM,
        loadHeightM: l.heightM,
        dragCoefficient: l.dragCoefficient,
        loadMassKg: l.massKg,
        riggingMassKg: l.riggingMassKg,
        chartLimitMs: s.chartLimitMs ?? Number.NaN,
      }),
    })),
  ];
  // Every load sees the same gust, so the load with the lowest permitted speed is
  // the worst in every hour. It drives the banner. Ties keep the main load.
  const governing = candidates.reduce((g, c) => (c.result.permittedMs < g.result.permittedMs ? c : g));
  const load = governing.result;
  const heightM = s.heightM ?? Number.NaN;
  const terrain = s.terrain ?? 'open';
  const heightFactor = terrainHeightFactor(heightM, terrain);
  const options = { heightM, permittedMs: load.permittedMs, terrain };

  const all = assessHours(forecast.hours, forecast.days, options);
  const liftDayHours = all.filter((h) => h.time.startsWith(s.liftDate));
  if (liftDayHours.length === 0) {
    throw new AssessmentError(`The forecast does not cover ${s.liftDate}. It runs 7 days from today.`);
  }
  const liftDaySun = forecast.days.find((d) => d.date === s.liftDate) ?? null;
  const clip = (p: Period) => (liftDaySun && p.end > liftDaySun.sunset ? { ...p, end: liftDaySun.sunset } : p);
  const liftDayForecast = forecast.hours.filter((h) => h.time.startsWith(s.liftDate));

  const windowDefaulted = !s.windowStart || !s.windowEnd;
  const windowStart = windowDefaulted ? (liftDaySun?.sunrise ?? `${s.liftDate}T00:00`) : `${s.liftDate}T${s.windowStart}`;
  const windowEnd = windowDefaulted ? (liftDaySun?.sunset ?? `${s.liftDate}T23:59`) : `${s.liftDate}T${s.windowEnd}`;
  // An hour counts if any part of it is in the window: it ends after the start and starts before the end.
  const windowHours = liftDayHours.filter((h) => endOfHour(h.time) > windowStart && h.time < windowEnd);
  const worst = worstHour(windowHours);
  const inWindow = (time: string) => endOfHour(time) > windowStart && time < windowEnd;

  const loads: LoadOutcome[] = candidates.map((c) => {
    const hours = assessHours(liftDayForecast, forecast.days, { heightM, permittedMs: c.result.permittedMs, terrain });
    const w = worstHour(hours.filter((h) => inWindow(h.time)));
    return {
      ref: c.ref,
      isMain: c.isMain,
      result: c.result,
      statuses: hours.map((h) => h.status),
      windowStatus: w ? w.status : 'no-data',
      windowWorstPercent: w ? w.percentOfLimit : null,
      periods: findWorkablePeriods(hours, 1).map(clip),
    };
  });

  return {
    load,
    governingRef: governing.ref,
    loads,
    heightM,
    terrain,
    heightFactor,
    liftDate: s.liftDate,
    liftDaySun,
    windowStart,
    windowEnd,
    windowDefaulted,
    liftDayForecast,
    liftDayHours,
    windowHours,
    worst,
    overallStatus: worst ? worst.status : 'no-data',
    // The last hour of a period can start before sunset and end after it. Show the period ending at sunset.
    periods: findWorkablePeriods(liftDayHours).map(clip),
    outlook: dailyOutlook(all),
  };
}

function endOfHour(time: string): string {
  return new Date(Date.parse(`${time}:00Z`) + 3_600_000).toISOString().slice(0, 16);
}
