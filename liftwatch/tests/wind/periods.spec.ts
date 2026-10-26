import { describe, expect, it } from 'vitest';
import { dailyOutlook, findWorkablePeriods, worstHour, type HourAssessment, type Status } from '../../src/wind';

function hour(time: string, status: Status, daylight = true, ratio = 0.5): HourAssessment {
  return {
    time,
    gust10mMs: 5,
    gustAtHeightMs: 5,
    heightFactor: 1,
    permittedMs: 10,
    ratio: status === 'no-data' ? null : ratio,
    percentOfLimit: status === 'no-data' ? null : ratio * 100,
    status,
    windDirectionDeg: 200,
    daylight,
    flags: daylight ? [] : [{ code: 'night', label: 'Outside daylight' }],
  };
}

describe('findWorkablePeriods', () => {
  it('finds runs of 2+ daylight hours within limits', () => {
    const hours = [
      hour('2026-10-22T07:00', 'within', false),
      hour('2026-10-22T08:00', 'within'),
      hour('2026-10-22T09:00', 'within'),
      hour('2026-10-22T10:00', 'near', true, 0.9),
      hour('2026-10-22T11:00', 'within'),
      hour('2026-10-22T12:00', 'over', true, 1.2),
      hour('2026-10-22T13:00', 'within'),
      hour('2026-10-22T14:00', 'within'),
      hour('2026-10-22T15:00', 'within'),
    ];
    expect(findWorkablePeriods(hours)).toMatchObject([
      { start: '2026-10-22T08:00', end: '2026-10-22T10:00', hours: 2 },
      { start: '2026-10-22T13:00', end: '2026-10-22T16:00', hours: 3 },
    ]);
  });

  it('breaks a run on a gap in the hourly data', () => {
    const hours = [hour('2026-10-22T08:00', 'within'), hour('2026-10-22T10:00', 'within')];
    expect(findWorkablePeriods(hours)).toMatchObject([]);
  });
});

describe('worstHour', () => {
  it('ranks over > no data > near > within, then by ratio', () => {
    const hours = [
      hour('2026-10-22T08:00', 'within', true, 0.7),
      hour('2026-10-22T09:00', 'near', true, 0.85),
      hour('2026-10-22T10:00', 'near', true, 0.95),
    ];
    expect(worstHour(hours)?.time).toBe('2026-10-22T10:00');
    expect(worstHour([...hours, hour('2026-10-22T11:00', 'no-data')])?.status).toBe('no-data');
    expect(worstHour([...hours, hour('2026-10-22T12:00', 'over', true, 1.1)])?.status).toBe('over');
    expect(worstHour([])).toBeNull();
  });
});

describe('dailyOutlook', () => {
  it('summarises daylight hours per day', () => {
    const hours = [
      hour('2026-10-22T03:00', 'over', false, 1.5),
      hour('2026-10-22T09:00', 'within', true, 0.5),
      hour('2026-10-22T10:00', 'near', true, 0.9),
      hour('2026-10-23T09:00', 'within', true, 0.3),
    ];
    const outlook = dailyOutlook(hours);
    expect(outlook).toHaveLength(2);
    expect(outlook[0]).toMatchObject({ date: '2026-10-22', worstStatus: 'near', daylightHoursWithin: 1 });
    expect(outlook[1]).toMatchObject({ date: '2026-10-23', worstStatus: 'within', daylightHoursWithin: 1 });
  });
});
