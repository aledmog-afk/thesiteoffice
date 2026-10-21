import { describe, expect, it } from 'vitest';
import {
  assessHour,
  assessHours,
  classifyRatio,
  msToMph,
  weatherFlags,
  WindInputError,
  type ForecastHour,
} from '../../src/wind';

describe('classifyRatio threshold edges', () => {
  it('0.79 is within limits', () => expect(classifyRatio(0.79)).toBe('within'));
  it('0.80 is near limit', () => expect(classifyRatio(0.8)).toBe('near'));
  it('1.00 is near limit', () => expect(classifyRatio(1.0)).toBe('near'));
  it('1.01 is over limit', () => expect(classifyRatio(1.01)).toBe('over'));
  it('0 is within limits', () => expect(classifyRatio(0)).toBe('within'));
  it('rejects a negative or non-numeric ratio', () => {
    expect(() => classifyRatio(-0.1)).toThrow(WindInputError);
    expect(() => classifyRatio(Number.NaN)).toThrow(WindInputError);
  });
});

const baseHour: ForecastHour = {
  time: '2026-10-22T12:00',
  windSpeed10mMs: 5,
  windGusts10mMs: 8,
  windDirectionDeg: 225,
  windSpeed80mMs: 7,
  windSpeed120mMs: 8,
  capeJkg: 0,
  precipitationProbabilityPct: 10,
  visibilityM: 20000,
  temperatureC: 10,
};
const sun = { sunrise: '2026-10-22T07:40', sunset: '2026-10-22T17:50' };

describe('weatherFlags', () => {
  const codes = (patch: Partial<ForecastHour>, s = sun) =>
    weatherFlags({ ...baseHour, ...patch }, s).map((f) => f.code);

  it('no flags in benign daytime weather', () => expect(codes({})).toEqual([]));
  it('CAPE > 500 is thunderstorm risk', () => expect(codes({ capeJkg: 501 })).toEqual(['thunderstorm']));
  it('CAPE 500 is possible thunder', () => expect(codes({ capeJkg: 500 })).toEqual(['possible-thunder']));
  it('CAPE 100 is possible thunder', () => expect(codes({ capeJkg: 100 })).toEqual(['possible-thunder']));
  it('CAPE 99 is not flagged', () => expect(codes({ capeJkg: 99 })).toEqual([]));
  it('visibility below 5 km', () => {
    expect(codes({ visibilityM: 4999 })).toEqual(['visibility']);
    expect(codes({ visibilityM: 5000 })).toEqual([]);
  });
  it('precipitation probability >= 70 %', () => {
    expect(codes({ precipitationProbabilityPct: 70 })).toEqual(['precipitation']);
    expect(codes({ precipitationProbabilityPct: 69 })).toEqual([]);
  });
  it('temperature <= 1 °C is frost / ice risk', () => {
    expect(codes({ temperatureC: 1 })).toEqual(['frost']);
    expect(codes({ temperatureC: 1.1 })).toEqual([]);
  });
  it('outside daylight', () => {
    expect(codes({ time: '2026-10-22T07:00' })).toEqual(['night']);
    expect(codes({ time: '2026-10-22T08:00' })).toEqual([]);
    expect(codes({ time: '2026-10-22T17:00' })).toEqual([]);
    expect(codes({ time: '2026-10-22T18:00' })).toEqual(['night']);
  });
  it('flags missing data rather than passing it', () => {
    expect(codes({ capeJkg: null })).toEqual(['missing-data']);
  });
  it('uses the labels from the brief', () => {
    const labels = weatherFlags({ ...baseHour, capeJkg: 600, temperatureC: 0 }, sun).map((f) => f.label);
    expect(labels).toContain('Thunderstorm risk');
    expect(labels).toContain('Frost / ice risk');
  });
});

describe('assessHour', () => {
  it('corrects the gust to height and compares with the permitted speed', () => {
    const a = assessHour({ ...baseHour, windGusts10mMs: 5 }, { heightM: 50, permittedMs: 6.594 }, sun);
    expect(a.gustAtHeightMs).toBeCloseTo(5 * 1.181, 12);
    expect(a.ratio).toBeCloseTo((5 * 1.181) / 6.594, 12);
    expect(a.status).toBe('near');
    expect(a.percentOfLimit).toBeCloseTo((100 * 5 * 1.181) / 6.594, 9);
  });

  it('gives no status when the gust is missing', () => {
    const a = assessHour({ ...baseHour, windGusts10mMs: null }, { heightM: 30, permittedMs: 10 }, sun);
    expect(a.status).toBe('no-data');
    expect(a.ratio).toBeNull();
  });

  it('keeps flags even when within limits', () => {
    const a = assessHour({ ...baseHour, windGusts10mMs: 1, capeJkg: 800 }, { heightM: 30, permittedMs: 10 }, sun);
    expect(a.status).toBe('within');
    expect(a.flags.map((f) => f.code)).toEqual(['thunderstorm']);
  });

  it('rejects a zero permitted speed', () => {
    expect(() => assessHour(baseHour, { heightM: 30, permittedMs: 0 }, sun)).toThrow(WindInputError);
  });
});

describe('assessHours', () => {
  it('matches each hour to its own day sunrise and sunset', () => {
    const hours = [
      { ...baseHour, time: '2026-10-22T07:00' },
      { ...baseHour, time: '2026-10-23T07:00' },
    ];
    const days = [
      { date: '2026-10-22', sunrise: '2026-10-22T07:40', sunset: '2026-10-22T17:50' },
      { date: '2026-10-23', sunrise: '2026-10-23T06:59', sunset: '2026-10-23T17:48' },
    ];
    const result = assessHours(hours, days, { heightM: 20, permittedMs: 10 });
    expect(result[0].daylight).toBe(false);
    expect(result[1].daylight).toBe(true);
  });
});

describe('msToMph', () => {
  it('converts using 1 mph = 0.44704 m/s', () => {
    expect(msToMph(0.44704)).toBeCloseTo(1, 12);
    expect(msToMph(10)).toBeCloseTo(22.369, 3);
  });
});
