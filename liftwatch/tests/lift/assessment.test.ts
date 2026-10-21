import { describe, expect, it } from 'vitest';
import { assessLift, AssessmentError } from '../../src/lift/assessment';
import { validateSetup } from '../../src/lift/setup';
import { gustHeightFactor } from '../../src/wind';
import { cpaSetup, forecast } from './helpers';

describe('validateSetup', () => {
  it('accepts a complete set-up', () => {
    expect(validateSetup(cpaSetup())).toEqual({});
  });
  it('requires the source of the chart limit', () => {
    expect(validateSetup(cpaSetup({ chartLimitSource: '  ' })).chartLimitSource).toBeTruthy();
  });
  it('refuses a mean chart limit with an explanation', () => {
    expect(validateSetup(cpaSetup({ chartLimitType: 'mean' })).chartLimitType).toMatch(/gust limit/);
  });
  it('refuses heights above 150 m', () => {
    expect(validateSetup(cpaSetup({ heightM: 160 })).heightM).toMatch(/Outside method range/);
  });
  it('checks the lift window', () => {
    expect(validateSetup(cpaSetup({ windowStart: '10:00', windowEnd: '09:00' })).windowEnd).toBeTruthy();
  });
});

describe('assessLift', () => {
  it('uses daylight hours of the lift date by default', () => {
    const a = assessLift(cpaSetup(), forecast(() => 3));
    expect(a.windowDefaulted).toBe(true);
    expect(a.windowStart).toBe('2026-10-22T07:40');
    // 07:00 overlaps sunrise, 17:00 overlaps sunset
    expect(a.windowHours.map((h) => h.time.slice(11))).toEqual([
      '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00',
    ]);
    expect(a.liftDayHours).toHaveLength(24);
    expect(a.liftDayForecast).toHaveLength(24);
  });

  it('reports the worst hour in the planned window', () => {
    // gust rises through the day: 0.25 m/s per hour from 1 m/s
    const a = assessLift(cpaSetup({ windowStart: '09:00', windowEnd: '12:00' }), forecast((i) => 1 + (i % 24) * 0.25));
    expect(a.windowHours.map((h) => h.time.slice(11))).toEqual(['09:00', '10:00', '11:00']);
    expect(a.worst?.time).toBe('2026-10-22T11:00');
    const expectedGust = (1 + 11 * 0.25) * gustHeightFactor(30);
    expect(a.worst?.gustAtHeightMs).toBeCloseTo(expectedGust, 9);
    expect(a.worst?.ratio).toBeCloseTo(expectedGust / a.load.permittedMs, 9);
    expect(a.overallStatus).toBe(a.worst?.status);
  });

  it('flags over limit when the gust at height exceeds the permitted speed', () => {
    const a = assessLift(cpaSetup(), forecast(() => 8));
    expect(a.overallStatus).toBe('over');
    expect(a.periods).toEqual([]);
  });

  it('lists daylight periods within limits', () => {
    const a = assessLift(cpaSetup(), forecast(() => 2));
    expect(a.periods).toEqual([{ start: '2026-10-22T08:00', end: '2026-10-22T17:50', hours: 10 }]);
    expect(a.outlook).toHaveLength(2);
  });

  it('refuses a date the forecast does not cover', () => {
    expect(() => assessLift(cpaSetup({ liftDate: '2026-11-30' }), forecast())).toThrow(AssessmentError);
  });

  it('refuses a mean chart limit', () => {
    expect(() => assessLift(cpaSetup({ chartLimitType: 'mean' }), forecast())).toThrow(AssessmentError);
  });
});
