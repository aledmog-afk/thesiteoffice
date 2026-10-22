import { FLAG_THRESHOLDS, NEAR_LIMIT_RATIO, OVER_LIMIT_RATIO } from './constants';
import { requirePositive, WindInputError } from './errors';
import { terrainHeightFactor, type Terrain } from './terrain';
import { FLAG_LABEL, type DaySun, type Flag, type FlagCode, type ForecastHour, type HourAssessment, type Status, type SunTimes } from './types';

/**
 * Status for ratio = gust at height / permitted wind speed (METHOD.md, step 4):
 *   ratio < 0.80          → within
 *   0.80 ≤ ratio ≤ 1.00   → near
 *   ratio > 1.00          → over
 */
export function classifyRatio(ratio: number): Status {
  if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio < 0) {
    throw new WindInputError(`Ratio must be a number of zero or more (got ${String(ratio)}).`);
  }
  if (ratio < NEAR_LIMIT_RATIO) return 'within';
  if (ratio <= OVER_LIMIT_RATIO) return 'near';
  return 'over';
}

/** True when the hour starts at or after sunrise and before sunset. */
export function isDaylight(time: string, sun: SunTimes): boolean {
  // Same "YYYY-MM-DDTHH:MM" local format on both sides, so a string compare is exact.
  return time >= sun.sunrise && time < sun.sunset;
}

/**
 * Weather flags for an hour (METHOD.md, "Flags"). A flag never counts as a pass.
 *   CAPE > 500 J/kg            thunderstorm risk
 *   100 ≤ CAPE ≤ 500 J/kg      possible thunder
 *   visibility < 5,000 m
 *   precipitation prob ≥ 70 %
 *   temperature ≤ 1 °C         frost / ice risk
 *   outside sunrise–sunset
 *   any of these values missing → "Data missing"
 */
export function weatherFlags(hour: ForecastHour, sun: SunTimes | undefined): Flag[] {
  const t = FLAG_THRESHOLDS;
  const codes: FlagCode[] = [];
  let missing = false;

  if (hour.capeJkg === null) missing = true;
  else if (hour.capeJkg > t.thunderstormCapeJkg) codes.push('thunderstorm');
  else if (hour.capeJkg >= t.possibleThunderCapeJkg) codes.push('possible-thunder');

  if (hour.visibilityM === null) missing = true;
  else if (hour.visibilityM < t.minVisibilityM) codes.push('visibility');

  if (hour.precipitationProbabilityPct === null) missing = true;
  else if (hour.precipitationProbabilityPct >= t.precipitationProbabilityPct) codes.push('precipitation');

  if (hour.temperatureC === null) missing = true;
  else if (hour.temperatureC <= t.frostTemperatureC) codes.push('frost');

  if (!sun) missing = true;
  if (!sun || !isDaylight(hour.time, sun)) codes.push('night');

  if (missing) codes.push('missing-data');
  return codes.map((code) => ({ code, label: FLAG_LABEL[code] }));
}

export interface AssessOptions {
  /** Height used for the gust correction (m). */
  heightM: number;
  /** Permitted wind speed for the load (m/s), from permittedWindSpeed(). */
  permittedMs: number;
  /** Upwind terrain; changes the height factor (METHOD.md, step 1). Default open country. */
  terrain?: Terrain;
}

/** Assess one hour: gust corrected to height, ratio to the permitted speed, status and flags. */
export function assessHour(hour: ForecastHour, options: AssessOptions, sun: SunTimes | undefined): HourAssessment {
  requirePositive(options.permittedMs, 'Permitted wind speed');
  const heightFactor = terrainHeightFactor(options.heightM, options.terrain ?? 'open');
  const gust = hour.windGusts10mMs;
  const gustAtHeightMs = gust === null ? null : gust * heightFactor;
  const ratio = gustAtHeightMs === null ? null : gustAtHeightMs / options.permittedMs;

  return {
    time: hour.time,
    gust10mMs: gust,
    heightFactor,
    gustAtHeightMs,
    permittedMs: options.permittedMs,
    ratio,
    percentOfLimit: ratio === null ? null : ratio * 100,
    status: ratio === null ? 'no-data' : classifyRatio(ratio),
    windDirectionDeg: hour.windDirectionDeg,
    daylight: sun ? isDaylight(hour.time, sun) : false,
    flags: weatherFlags(hour, sun),
  };
}

/** Assess every hour, using the sunrise and sunset of the hour's own date. */
export function assessHours(hours: ForecastHour[], days: DaySun[], options: AssessOptions): HourAssessment[] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  return hours.map((h) => assessHour(h, options, byDate.get(h.time.slice(0, 10))));
}
