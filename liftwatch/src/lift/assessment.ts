import type { Forecast } from '../data/openMeteo';
import {
  assessHours,
  dailyOutlook,
  findWorkablePeriods,
  gustHeightFactor,
  permittedWindSpeed,
  worstHour,
  type DayOutlook,
  type DaySun,
  type ForecastHour,
  type HourAssessment,
  type LoadWindResult,
  type Period,
  type Status,
} from '../wind';
import type { LiftSetup } from './setup';

export interface LiftAssessment {
  load: LoadWindResult;
  heightM: number;
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
  const load = loadResult(s);
  const heightM = s.heightM ?? Number.NaN;
  const heightFactor = gustHeightFactor(heightM);
  const options = { heightM, permittedMs: load.permittedMs };

  const all = assessHours(forecast.hours, forecast.days, options);
  const liftDayHours = all.filter((h) => h.time.startsWith(s.liftDate));
  if (liftDayHours.length === 0) {
    throw new AssessmentError(`The forecast does not cover ${s.liftDate}. It runs 7 days from today.`);
  }
  const liftDaySun = forecast.days.find((d) => d.date === s.liftDate) ?? null;

  const windowDefaulted = !s.windowStart || !s.windowEnd;
  const windowStart = windowDefaulted ? (liftDaySun?.sunrise ?? `${s.liftDate}T00:00`) : `${s.liftDate}T${s.windowStart}`;
  const windowEnd = windowDefaulted ? (liftDaySun?.sunset ?? `${s.liftDate}T23:59`) : `${s.liftDate}T${s.windowEnd}`;
  // An hour counts if any part of it is in the window: it ends after the start and starts before the end.
  const windowHours = liftDayHours.filter((h) => endOfHour(h.time) > windowStart && h.time < windowEnd);
  const worst = worstHour(windowHours);

  return {
    load,
    heightM,
    heightFactor,
    liftDate: s.liftDate,
    liftDaySun,
    windowStart,
    windowEnd,
    windowDefaulted,
    liftDayForecast: forecast.hours.filter((h) => h.time.startsWith(s.liftDate)),
    liftDayHours,
    windowHours,
    worst,
    overallStatus: worst ? worst.status : 'no-data',
    // The last hour of a period can start before sunset and end after it. Show the period ending at sunset.
    periods: findWorkablePeriods(liftDayHours).map((p) =>
      liftDaySun && p.end > liftDaySun.sunset ? { ...p, end: liftDaySun.sunset } : p,
    ),
    outlook: dailyOutlook(all),
  };
}

function endOfHour(time: string): string {
  return new Date(Date.parse(`${time}:00Z`) + 3_600_000).toISOString().slice(0, 16);
}
