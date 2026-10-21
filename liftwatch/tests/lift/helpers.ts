import { parseForecast, type Forecast } from '../../src/data/openMeteo';
import { emptySetup, type LiftSetup } from '../../src/lift/setup';
import { openMeteoResponse } from '../fixtures/openMeteo';

export function cpaSetup(patch: Partial<LiftSetup> = {}): LiftSetup {
  return {
    ...emptySetup('2026-10-22'),
    site: { postcode: 'SW1A 1AA', label: 'SW1A 1AA, Westminster', latitude: 51.501, longitude: -0.1416 },
    craneDescription: 'LTM 1090-4.2',
    chartLimitMs: 17,
    chartLimitSource: 'Lift plan LP-014 / LTM 1090 load chart',
    chartLimitType: 'gust',
    heightM: 30,
    loadDescription: 'Wall panel W12',
    loadLengthM: 3.6,
    loadHeightM: 2.4,
    loadMassKg: 1300,
    riggingMassKg: 0,
    dragCoefficient: 1.2,
    ...patch,
  };
}

export function forecast(gust?: (i: number) => number): Forecast {
  return parseForecast({
    source: 'Open-Meteo',
    endpoint: 'https://api.open-meteo.com/v1/forecast',
    fetchedAt: '2026-10-21T19:00:00.000Z',
    latitude: 51.5,
    longitude: -0.14,
    data: openMeteoResponse(2, gust),
  });
}
