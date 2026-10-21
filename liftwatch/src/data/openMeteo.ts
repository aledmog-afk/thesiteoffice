/**
 * Open-Meteo request and response handling. Shared by the browser and the
 * Cloudflare Worker, so it must not touch the DOM or config that reads
 * import.meta.env.
 */
import type { DaySun, ForecastHour } from '../wind';

export const HOURLY_VARIABLES = [
  'wind_speed_10m',
  'wind_gusts_10m',
  'wind_direction_10m',
  'wind_speed_80m',
  'wind_speed_120m',
  'cape',
  'precipitation_probability',
  'visibility',
  'temperature_2m',
] as const;

export const DAILY_VARIABLES = ['sunrise', 'sunset'] as const;

export const FORECAST_DAYS = 7;
export const FORECAST_TIMEZONE = 'Europe/London';

/** Cache lifetime for one site's forecast (seconds). */
export const FORECAST_CACHE_SECONDS = 60 * 60;

/** Round a coordinate to 2 decimal places (about 1 km), so nearby users share one call. */
export function roundCoord(value: number): number {
  return Math.round(value * 100) / 100;
}

/** UK and Ireland, generously. The pilot is for UK sites only. */
export function isInPilotArea(lat: number, lon: number): boolean {
  return lat >= 49 && lat <= 61.5 && lon >= -11 && lon <= 2.5;
}

export interface ForecastRequest {
  baseUrl: string;
  latitude: number;
  longitude: number;
  apiKey?: string;
}

/** Builds the Open-Meteo URL for a site. Coordinates are rounded to 2 dp here. */
export function buildForecastUrl({ baseUrl, latitude, longitude, apiKey }: ForecastRequest): string {
  const url = new URL(baseUrl);
  url.searchParams.set('latitude', roundCoord(latitude).toFixed(2));
  url.searchParams.set('longitude', roundCoord(longitude).toFixed(2));
  url.searchParams.set('hourly', HOURLY_VARIABLES.join(','));
  url.searchParams.set('daily', DAILY_VARIABLES.join(','));
  url.searchParams.set('wind_speed_unit', 'ms');
  url.searchParams.set('timezone', FORECAST_TIMEZONE);
  url.searchParams.set('forecast_days', String(FORECAST_DAYS));
  if (apiKey) url.searchParams.set('apikey', apiKey);
  return url.toString();
}

/** The endpoint without any API key, safe to show and store. */
export function publicEndpoint(baseUrl: string): string {
  const url = new URL(baseUrl);
  return `${url.origin}${url.pathname}`;
}

/** What the Worker returns, and what the direct path builds to match it. */
export interface ForecastEnvelope {
  source: string;
  endpoint: string;
  /** When LiftWatch (the Worker, or the browser in direct mode) fetched it from Open-Meteo. ISO 8601 UTC. */
  fetchedAt: string;
  latitude: number;
  longitude: number;
  data: unknown;
}

export interface Forecast {
  source: string;
  endpoint: string;
  fetchedAt: string;
  /** Grid point Open-Meteo used. */
  latitude: number;
  longitude: number;
  elevationM: number | null;
  timezone: string;
  model: string;
  hours: ForecastHour[];
  days: DaySun[];
}

export class ForecastFormatError extends Error {
  constructor(message: string) {
    super(`Forecast data not usable: ${message}`);
    this.name = 'ForecastFormatError';
  }
}

type Json = Record<string, unknown>;

function column(block: Json, name: string, length: number): (number | null)[] {
  const values = block[name];
  if (!Array.isArray(values) || values.length !== length) throw new ForecastFormatError(`missing "${name}"`);
  return values.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null));
}

function strings(block: Json, name: string): string[] {
  const values = block[name];
  if (!Array.isArray(values) || !values.every((v) => typeof v === 'string')) {
    throw new ForecastFormatError(`missing "${name}"`);
  }
  return values as string[];
}

/** Turns an envelope into hours and days, checking units so a config slip cannot mix km/h into m/s. */
export function parseForecast(envelope: ForecastEnvelope): Forecast {
  const data = envelope.data as Json | null;
  if (!data || typeof data !== 'object') throw new ForecastFormatError('empty response');
  const hourly = data.hourly as Json | undefined;
  const daily = data.daily as Json | undefined;
  const units = (data.hourly_units ?? {}) as Json;
  if (!hourly || !daily) throw new ForecastFormatError('no hourly or daily block');

  for (const v of ['wind_speed_10m', 'wind_gusts_10m', 'wind_speed_80m', 'wind_speed_120m']) {
    if (units[v] !== 'm/s') throw new ForecastFormatError(`${v} is in "${String(units[v])}", expected m/s`);
  }

  const times = strings(hourly, 'time');
  const n = times.length;
  const col = (name: string) => column(hourly, name, n);
  const speed10 = col('wind_speed_10m');
  const gust10 = col('wind_gusts_10m');
  const dir = col('wind_direction_10m');
  const speed80 = col('wind_speed_80m');
  const speed120 = col('wind_speed_120m');
  const cape = col('cape');
  const precip = col('precipitation_probability');
  const vis = col('visibility');
  const temp = col('temperature_2m');

  const hours: ForecastHour[] = times.map((time, i) => ({
    time,
    windSpeed10mMs: speed10[i],
    windGusts10mMs: gust10[i],
    windDirectionDeg: dir[i],
    windSpeed80mMs: speed80[i],
    windSpeed120mMs: speed120[i],
    capeJkg: cape[i],
    precipitationProbabilityPct: precip[i],
    visibilityM: vis[i],
    temperatureC: temp[i],
  }));

  const dates = strings(daily, 'time');
  const sunrise = strings(daily, 'sunrise');
  const sunset = strings(daily, 'sunset');
  const days: DaySun[] = dates.map((date, i) => ({ date, sunrise: sunrise[i], sunset: sunset[i] }));

  return {
    source: envelope.source,
    endpoint: envelope.endpoint,
    fetchedAt: envelope.fetchedAt,
    latitude: typeof data.latitude === 'number' ? data.latitude : envelope.latitude,
    longitude: typeof data.longitude === 'number' ? data.longitude : envelope.longitude,
    elevationM: typeof data.elevation === 'number' ? data.elevation : null,
    timezone: typeof data.timezone === 'string' ? data.timezone : FORECAST_TIMEZONE,
    model: 'Open-Meteo best match (model blend chosen by Open-Meteo for the location)',
    hours,
    days,
  };
}
