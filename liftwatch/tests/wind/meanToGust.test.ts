import { describe, expect, it } from 'vitest';
import {
  gustAtHeightFromMean,
  meanToGustFactor,
  MEAN_TO_GUST_FACTORS,
  OutsideMethodRangeError,
  WindInputError,
} from '../../src/wind';

describe('meanToGustFactor (CPA mean-to-gust factors)', () => {
  it('returns exactly the published values at 50, 100 and 150 m', () => {
    expect(meanToGustFactor(50)).toBe(1.653);
    expect(meanToGustFactor(100)).toBe(1.78);
    expect(meanToGustFactor(150)).toBe(1.861);
  });

  it('matches the exported table', () => {
    expect(MEAN_TO_GUST_FACTORS).toEqual([
      { heightM: 50, factor: 1.653 },
      { heightM: 100, factor: 1.78 },
      { heightM: 150, factor: 1.861 },
    ]);
  });

  it('increases monotonically from 50 m to 150 m', () => {
    let previous = meanToGustFactor(50);
    for (let h = 51; h <= 150; h += 1) {
      const f = meanToGustFactor(h);
      expect(f).toBeGreaterThan(previous);
      previous = f;
    }
  });

  it('refuses below 50 m when no 10 m factor is set', () => {
    expect(() => meanToGustFactor(30)).toThrow(WindInputError);
    expect(() => meanToGustFactor(30)).toThrow(/10 m mean-to-gust factor/i);
    expect(() => meanToGustFactor(10)).toThrow(WindInputError);
  });

  it('interpolates between an entered 10 m factor and the 50 m value', () => {
    expect(meanToGustFactor(10, 1.5)).toBe(1.5);
    const t = Math.log(25 / 10) / Math.log(5);
    expect(meanToGustFactor(25, 1.5)).toBeCloseTo(1.5 + t * (1.653 - 1.5), 12);
    expect(meanToGustFactor(50, 1.5)).toBe(1.653);
  });

  it('uses the 10 m factor below 10 m', () => {
    expect(meanToGustFactor(5, 1.5)).toBe(1.5);
  });

  it('rejects an invalid 10 m factor', () => {
    expect(() => meanToGustFactor(30, 0)).toThrow(WindInputError);
    expect(() => meanToGustFactor(30, -1)).toThrow(WindInputError);
  });

  it('refuses above 150 m', () => {
    expect(() => meanToGustFactor(151)).toThrow(OutsideMethodRangeError);
  });
});

describe('gustAtHeightFromMean', () => {
  it('multiplies the 10 m mean by the factor', () => {
    expect(gustAtHeightFromMean(10, 100)).toBeCloseTo(17.8, 12);
    expect(gustAtHeightFromMean(10, 30, 1.5)).toBeCloseTo(10 * meanToGustFactor(30, 1.5), 12);
  });
});
