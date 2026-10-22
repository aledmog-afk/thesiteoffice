import { describe, expect, it } from 'vitest';
import { assessLift, AssessmentError } from '../../src/lift/assessment';
import { validateSetup } from '../../src/lift/setup';
import { gustHeightFactor } from '../../src/wind';
import { panelSetup, forecast } from './helpers';

describe('validateSetup', () => {
  it('accepts a complete set-up', () => {
    expect(validateSetup(panelSetup())).toEqual({});
  });
  it('requires the source of the chart limit', () => {
    expect(validateSetup(panelSetup({ chartLimitSource: '  ' })).chartLimitSource).toBeTruthy();
  });
  it('refuses a mean chart limit with an explanation', () => {
    expect(validateSetup(panelSetup({ chartLimitType: 'mean' })).chartLimitType).toMatch(/gust limit/);
  });
  it('refuses heights above 150 m', () => {
    expect(validateSetup(panelSetup({ heightM: 160 })).heightM).toMatch(/Outside method range/);
  });
  it('checks the lift window', () => {
    expect(validateSetup(panelSetup({ windowStart: '10:00', windowEnd: '09:00' })).windowEnd).toBeTruthy();
  });
});

describe('assessLift', () => {
  it('uses daylight hours of the lift date by default', () => {
    const a = assessLift(panelSetup(), forecast(() => 3));
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
    const a = assessLift(panelSetup({ windowStart: '09:00', windowEnd: '12:00' }), forecast((i) => 1 + (i % 24) * 0.25));
    expect(a.windowHours.map((h) => h.time.slice(11))).toEqual(['09:00', '10:00', '11:00']);
    expect(a.worst?.time).toBe('2026-10-22T11:00');
    const expectedGust = (1 + 11 * 0.25) * gustHeightFactor(30);
    expect(a.worst?.gustAtHeightMs).toBeCloseTo(expectedGust, 9);
    expect(a.worst?.ratio).toBeCloseTo(expectedGust / a.load.permittedMs, 9);
    expect(a.overallStatus).toBe(a.worst?.status);
  });

  it('flags over limit when the gust at height exceeds the permitted speed', () => {
    const a = assessLift(panelSetup(), forecast(() => 8));
    expect(a.overallStatus).toBe('over');
    expect(a.periods).toEqual([]);
  });

  it('lists daylight periods within limits', () => {
    const a = assessLift(panelSetup(), forecast(() => 2));
    expect(a.periods).toEqual([{ start: '2026-10-22T08:00', end: '2026-10-22T17:50', hours: 10 }]);
    expect(a.outlook).toHaveLength(2);
  });

  it('uses the terrain for the height factor', () => {
    const open = assessLift(panelSetup({ terrain: 'open' }), forecast(() => 3));
    const city = assessLift(panelSetup({ terrain: 'city' }), forecast(() => 3));
    expect(open.heightFactor).toBeCloseTo(gustHeightFactor(30), 12);
    expect(city.heightFactor).toBeCloseTo(1.285, 3);
    expect(city.worst!.gustAtHeightMs!).toBeGreaterThan(open.worst!.gustAtHeightMs!);
    expect(city.terrain).toBe('city');
  });

  it('the most wind-sensitive load in the schedule governs the banner', () => {
    const heavy = { id: 'h', ref: 'C1 cassette', lengthM: 2, heightM: 1, massKg: 3000, riggingMassKg: 0, dragCoefficient: 1.2 };
    const light = { id: 'l', ref: 'W9 gable', lengthM: 6, heightM: 3, massKg: 900, riggingMassKg: 0, dragCoefficient: 1.2 };
    const a = assessLift(panelSetup({ extraLoads: [heavy, light] }), forecast(() => 3));
    expect(a.loads.map((l) => l.ref)).toEqual(['Wall panel W12', 'C1 cassette', 'W9 gable']);
    expect(a.governingRef).toBe('W9 gable');
    expect(a.load.permittedMs).toBeCloseTo(17 * Math.sqrt(1.2 / ((6 * 3 * 1.2) / 0.9)), 9);
    expect(a.loads[1].result.permittedMs).toBe(17); // compact: chart limit
    expect(a.loads[1].windowStatus).toBe('within');
    expect(a.loads[0].statuses).toHaveLength(24);
  });

  it('with no other loads, the main load governs as before', () => {
    const a = assessLift(panelSetup(), forecast(() => 3));
    expect(a.governingRef).toBe('Wall panel W12');
    expect(a.loads).toHaveLength(1);
    expect(a.loads[0].periods.length).toBeGreaterThan(0);
  });

  it('refuses a date the forecast does not cover', () => {
    expect(() => assessLift(panelSetup({ liftDate: '2026-11-30' }), forecast())).toThrow(AssessmentError);
  });

  it('refuses a mean chart limit', () => {
    expect(() => assessLift(panelSetup({ chartLimitType: 'mean' }), forecast())).toThrow(AssessmentError);
  });
});
