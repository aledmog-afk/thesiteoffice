/**
 * One forecast hour in the units the method uses. `time` is the UK local wall-clock
 * start of the hour ("YYYY-MM-DDTHH:MM", Europe/London), for display. `epochMs` is
 * the exact instant; all arithmetic uses it (see src/time/london.ts). Data saved
 * before instants were stored has no `epochMs` and is read from the local times.
 * Any value can be null when the source has no data for that hour.
 */
export interface ForecastHour {
  time: string;
  epochMs?: number;
  windSpeed10mMs: number | null;
  windGusts10mMs: number | null;
  windDirectionDeg: number | null;
  windSpeed80mMs: number | null;
  windSpeed120mMs: number | null;
  capeJkg: number | null;
  precipitationProbabilityPct: number | null;
  visibilityM: number | null;
  temperatureC: number | null;
}

export interface SunTimes {
  /** UK local times, for display. */
  sunrise: string;
  sunset: string;
  /** Exact instants (absent on data saved before they were stored). */
  sunriseMs?: number;
  sunsetMs?: number;
}

export interface DaySun extends SunTimes {
  /** "YYYY-MM-DD" */
  date: string;
}

export type Status = 'within' | 'near' | 'over' | 'no-data';

export type FlagCode =
  | 'thunderstorm'
  | 'possible-thunder'
  | 'visibility'
  | 'precipitation'
  | 'frost'
  | 'night'
  | 'missing-data';

export interface Flag {
  code: FlagCode;
  label: string;
}

export interface HourAssessment {
  /** UK local start of the hour, for display. */
  time: string;
  /** Exact start of the hour (ms since 1970, UTC). Absent on records saved before LW-M1.2. */
  startMs?: number;
  gust10mMs: number | null;
  heightFactor: number;
  gustAtHeightMs: number | null;
  permittedMs: number;
  /** gust at height / permitted; null when the gust is missing */
  ratio: number | null;
  percentOfLimit: number | null;
  status: Status;
  windDirectionDeg: number | null;
  daylight: boolean;
  flags: Flag[];
}

/** Wording used everywhere a status is shown. Never "safe", "clear" or "go". */
export const STATUS_LABEL: Readonly<Record<Status, string>> = Object.freeze({
  within: 'Below permitted speed',
  near: 'Near permitted speed',
  over: 'Above permitted speed',
  'no-data': 'No data',
});

export const FLAG_LABEL: Readonly<Record<FlagCode, string>> = Object.freeze({
  thunderstorm: 'Thunderstorm risk',
  'possible-thunder': 'Possible thunder',
  visibility: 'Visibility below 5 km',
  precipitation: 'Rain likely (≥ 70 %)',
  frost: 'Frost / ice risk',
  night: 'Outside daylight',
  'missing-data': 'Data missing',
});
