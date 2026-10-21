/**
 * One forecast hour in the units the method uses. Times are local wall-clock
 * strings ("YYYY-MM-DDTHH:MM", Europe/London) as Open-Meteo returns them.
 * Any value can be null when the source has no data for that hour.
 */
export interface ForecastHour {
  time: string;
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
  sunrise: string;
  sunset: string;
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
  time: string;
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
  within: 'Within limits',
  near: 'Near limit',
  over: 'Over limit',
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
