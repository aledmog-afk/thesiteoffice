import { describe, expect, it } from 'vitest';
import {
  gustAtHeight,
  gustHeightFactor,
  GUST_HEIGHT_FACTORS,
  OutsideMethodRangeError,
  WindInputError,
} from '../../src/wind';

describe('gustHeightFactor (Liebherr factors quoted by CPA)', () => {
  it('returns exactly the published values at 10, 50, 100 and 150 m', () => {
    expect(gustHeightFactor(10)).toBe(1.0);
    expect(gustHeightFactor(50)).toBe(1.181);
    expect(gustHeightFactor(100)).toBe(1.272);
    expect(gustHeightFactor(150)).toBe(1.329);
  });

  it('matches the exported table', () => {
    expect(GUST_HEIGHT_FACTORS).toEqual([
      { heightM: 10, factor: 1.0 },
      { heightM: 50, factor: 1.181 },
      { heightM: 100, factor: 1.272 },
      { heightM: 150, factor: 1.329 },
    ]);
  });

  it('increases monotonically from 10 m to 150 m', () => {
    let previous = gustHeightFactor(10);
    for (let h = 10.5; h <= 150; h += 0.5) {
      const f = gustHeightFactor(h);
      expect(f).toBeGreaterThan(previous);
      previous = f;
    }
  });

  it('interpolates linearly in log(height)', () => {
    // 25 m: t = ln(2.5) / ln(5)
    const t = Math.log(2.5) / Math.log(5);
    expect(gustHeightFactor(25)).toBeCloseTo(1 + t * 0.181, 12);
    // 70 m between 50 and 100
    const t2 = Math.log(70 / 50) / Math.log(2);
    expect(gustHeightFactor(70)).toBeCloseTo(1.181 + t2 * (1.272 - 1.181), 12);
  });

  it('uses 1.0 below 10 m', () => {
    expect(gustHeightFactor(9.99)).toBe(1.0);
    expect(gustHeightFactor(2)).toBe(1.0);
  });

  it('refuses above 150 m with "outside method range"', () => {
    expect(() => gustHeightFactor(150.01)).toThrow(OutsideMethodRangeError);
    expect(() => gustHeightFactor(200)).toThrow(/outside method range/i);
  });

  it('rejects zero, negative or non-numeric heights', () => {
    expect(() => gustHeightFactor(0)).toThrow(WindInputError);
    expect(() => gustHeightFactor(-5)).toThrow(WindInputError);
    expect(() => gustHeightFactor(Number.NaN)).toThrow(WindInputError);
  });
});

describe('gustAtHeight', () => {
  it('scales the 10 m gust by the factor', () => {
    expect(gustAtHeight(10, 50)).toBeCloseTo(11.81, 12);
    expect(gustAtHeight(10, 10)).toBe(10);
  });

  it('rejects a negative gust', () => {
    expect(() => gustAtHeight(-1, 30)).toThrow(WindInputError);
  });
});
