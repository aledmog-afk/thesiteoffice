import { describe, expect, it } from 'vitest';
import {
  buildForecastUrl,
  ForecastFormatError,
  HOURLY_VARIABLES,
  parseForecast,
  publicEndpoint,
  roundCoord,
} from '../../src/data/openMeteo';
import { openMeteoResponse } from '../fixtures/openMeteo';

describe('roundCoord', () => {
  it('rounds to 2 decimal places', () => {
    expect(roundCoord(51.50735)).toBe(51.51);
    expect(roundCoord(-0.12776)).toBe(-0.13);
    expect(roundCoord(52.004999)).toBe(52);
  });
});

describe('buildForecastUrl', () => {
  const url = new URL(
    buildForecastUrl({ baseUrl: 'https://api.open-meteo.com/v1/forecast', latitude: 51.50735, longitude: -0.12776 }),
  );

  it('sends the rounded site and the exact variables from the brief', () => {
    expect(url.searchParams.get('latitude')).toBe('51.51');
    expect(url.searchParams.get('longitude')).toBe('-0.13');
    expect(url.searchParams.get('hourly')).toBe(
      'wind_speed_10m,wind_gusts_10m,wind_direction_10m,wind_speed_80m,wind_speed_120m,cape,precipitation_probability,visibility,temperature_2m',
    );
    expect(url.searchParams.get('daily')).toBe('sunrise,sunset');
    expect(url.searchParams.get('wind_speed_unit')).toBe('ms');
    expect(url.searchParams.get('timezone')).toBe('Europe/London');
    expect(url.searchParams.get('forecast_days')).toBe('7');
    expect(url.searchParams.has('apikey')).toBe(false);
    expect(HOURLY_VARIABLES).toHaveLength(9);
  });

  it('adds the API key only when one is configured', () => {
    const withKey = new URL(
      buildForecastUrl({ baseUrl: 'https://customer-api.open-meteo.com/v1/forecast', latitude: 51, longitude: 0, apiKey: 'k' }),
    );
    expect(withKey.searchParams.get('apikey')).toBe('k');
  });

  it('publicEndpoint drops any query string', () => {
    expect(publicEndpoint('https://customer-api.open-meteo.com/v1/forecast?apikey=secret')).toBe(
      'https://customer-api.open-meteo.com/v1/forecast',
    );
  });
});

describe('parseForecast', () => {
  const envelope = {
    source: 'Open-Meteo',
    endpoint: 'https://api.open-meteo.com/v1/forecast',
    fetchedAt: '2026-10-21T19:00:00.000Z',
    latitude: 51.51,
    longitude: -0.13,
    data: openMeteoResponse(),
  };

  it('maps hourly and daily blocks', () => {
    const f = parseForecast(envelope);
    expect(f.hours).toHaveLength(48);
    expect(f.hours[0]).toMatchObject({ time: '2026-10-22T00:00', windGusts10mMs: 4, windDirectionDeg: 225 });
    expect(f.days[1]).toEqual({ date: '2026-10-23', sunrise: '2026-10-23T07:40', sunset: '2026-10-23T17:50' });
    expect(f.fetchedAt).toBe('2026-10-21T19:00:00.000Z');
    expect(f.source).toBe('Open-Meteo');
  });

  it('keeps nulls as missing values', () => {
    const data = openMeteoResponse();
    (data.hourly.cape as (number | null)[])[3] = null;
    expect(parseForecast({ ...envelope, data }).hours[3].capeJkg).toBeNull();
  });

  it('refuses wind speeds that are not in m/s', () => {
    const data = openMeteoResponse();
    data.hourly_units.wind_gusts_10m = 'km/h';
    expect(() => parseForecast({ ...envelope, data })).toThrow(ForecastFormatError);
  });

  it('refuses a response with a missing column', () => {
    const data = openMeteoResponse() as { hourly: Record<string, unknown> };
    delete data.hourly.wind_gusts_10m;
    expect(() => parseForecast({ ...envelope, data })).toThrow(/wind_gusts_10m/);
  });
});
