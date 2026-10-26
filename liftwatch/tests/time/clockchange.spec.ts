import { describe, expect, it } from 'vitest';
import { parseForecast } from '../../src/data/openMeteo';
import { assessLift } from '../../src/lift/assessment';
import { londonClock } from '../../src/time/london';
import { hourLabel } from '../../src/ui/format';
import { findWorkablePeriods, type HourAssessment } from '../../src/wind';
import { compareWithForecast } from '../../src/windlog/log';
import { openMeteoUnixResponse } from '../fixtures/openMeteo';
import { panelSetup } from '../lift/helpers';

const envelope = (data: unknown) => ({
  source: 'Open-Meteo',
  endpoint: 'https://api.open-meteo.com/v1/forecast',
  fetchedAt: '2026-10-24T18:00:00.000Z',
  latitude: 51.5,
  longitude: -0.12,
  data,
});

// 25 October 2026: clocks go back at 02:00 BST (01:00 UTC). Local day = 25 hours.
const october = parseForecast(
  envelope(
    openMeteoUnixResponse('2026-10-24T23:00:00Z', 25 + 24, [
      { sunriseUtc: '2026-10-25T06:47:00Z', sunsetUtc: '2026-10-25T16:43:00Z' },
      { sunriseUtc: '2026-10-26T06:49:00Z', sunsetUtc: '2026-10-26T16:41:00Z' },
    ]),
  ),
);

// 29 March 2026: clocks go forward at 01:00 GMT. Local day = 23 hours.
const march = parseForecast(
  envelope(
    openMeteoUnixResponse('2026-03-29T00:00:00Z', 23 + 24, [
      { sunriseUtc: '2026-03-29T05:46:00Z', sunsetUtc: '2026-03-29T18:33:00Z' },
      { sunriseUtc: '2026-03-30T05:44:00Z', sunsetUtc: '2026-03-30T18:35:00Z' },
    ]),
  ),
);

const labels = (hours: { startMs?: number }[]) => hours.map((h) => londonClock(h.startMs!));

describe('25 October 2026 (clocks go back)', () => {
  it('the lift day has 25 hours, with 01:00 twice', () => {
    const day = october.hours.filter((h) => h.time.startsWith('2026-10-25'));
    expect(day).toHaveLength(25);
    expect(day.filter((h) => h.time === '2026-10-25T01:00')).toHaveLength(2);
    expect(october.days[0]).toMatchObject({ date: '2026-10-25', sunrise: '2026-10-25T06:47', sunset: '2026-10-25T16:43' });
  });

  it('a planned window 00:30–02:30 covers 01:00 BST and 01:00 GMT', () => {
    const a = assessLift(panelSetup({ liftDate: '2026-10-25', windowStart: '00:30', windowEnd: '02:30' }), october);
    expect(a.liftDayHours).toHaveLength(25);
    expect(labels(a.windowHours)).toEqual(['00:00', '01:00 BST', '01:00 GMT', '02:00']);
    expect(a.windowEndMs! - a.windowStartMs!).toBe(3 * 3_600_000); // 00:30 BST to 02:30 GMT is 3 hours
  });

  it('the default window runs from sunrise to sunset, compared as instants', () => {
    const a = assessLift(panelSetup({ liftDate: '2026-10-25' }), october);
    expect(a.windowStart).toBe('2026-10-25T06:47');
    expect(a.windowEnd).toBe('2026-10-25T16:43');
    expect(labels(a.windowHours)[0]).toBe('06:00');
    expect(labels(a.windowHours).at(-1)).toBe('16:00');
    // 06:00 starts before sunrise, 07:00 after.
    expect(a.liftDayHours.find((h) => h.time === '2026-10-25T06:00')!.daylight).toBe(false);
    expect(a.liftDayHours.find((h) => h.time === '2026-10-25T07:00')!.daylight).toBe(true);
    expect(a.periods).toMatchObject([{ start: '2026-10-25T07:00', end: '2026-10-25T16:43', hours: 10 }]);
  });

  it('a run of hours across the repeated hour stays one period', () => {
    const hours: HourAssessment[] = october.hours.slice(0, 5).map((h) => ({
      time: h.time,
      startMs: h.epochMs,
      gust10mMs: 2,
      heightFactor: 1,
      gustAtHeightMs: 2,
      permittedMs: 10,
      ratio: 0.2,
      percentOfLimit: 20,
      status: 'within',
      windDirectionDeg: 200,
      daylight: true,
      flags: [],
    }));
    expect(hours.map((h) => h.time.slice(11))).toEqual(['00:00', '01:00', '01:00', '02:00', '03:00']);
    expect(findWorkablePeriods(hours)).toMatchObject([{ start: '2026-10-25T00:00', end: '2026-10-25T04:00', hours: 5 }]);
  });

  it('a wind log reading at 01:30 GMT matches the second 01:00 hour', () => {
    const hours = october.hours.slice(0, 4).map((h, i) => ({ time: h.time, startMs: h.epochMs, gustAtHeightMs: 10 + i }));
    const r = compareWithForecast([{ id: 'a', recordId: 'r', at: '2026-10-25T01:30:00Z', kind: 'reading', gustMs: 12 }], hours);
    expect(r.pairs[0].forecastMs).toBe(12); // hours[2] = 01:00 GMT
  });
});

describe('29 March 2026 (clocks go forward)', () => {
  it('the lift day has 23 hours and no 01:00', () => {
    const day = march.hours.filter((h) => h.time.startsWith('2026-03-29'));
    expect(day).toHaveLength(23);
    expect(day.some((h) => h.time === '2026-03-29T01:00')).toBe(false);
  });

  it('a planned window 00:30–03:30 is 2 hours long and covers 00:00, 02:00 and 03:00', () => {
    const a = assessLift(panelSetup({ liftDate: '2026-03-29', windowStart: '00:30', windowEnd: '03:30' }), march);
    expect(a.liftDayHours).toHaveLength(23);
    expect(labels(a.windowHours)).toEqual(['00:00', '02:00', '03:00']);
    expect(a.windowEndMs! - a.windowStartMs!).toBe(2 * 3_600_000);
  });

  it('a planned start in the skipped hour moves forward by the hour', () => {
    const a = assessLift(panelSetup({ liftDate: '2026-03-29', windowStart: '01:30', windowEnd: '04:00' }), march);
    expect(a.windowStart).toBe('2026-03-29T02:30');
    expect(labels(a.windowHours)).toEqual(['02:00', '03:00']);
  });

  it('hours either side of the gap join into one period', () => {
    const hours: HourAssessment[] = march.hours.slice(0, 3).map((h) => ({
      time: h.time,
      startMs: h.epochMs,
      gust10mMs: 2,
      heightFactor: 1,
      gustAtHeightMs: 2,
      permittedMs: 10,
      ratio: 0.2,
      percentOfLimit: 20,
      status: 'within',
      windDirectionDeg: 200,
      daylight: true,
      flags: [],
    }));
    expect(hours.map((h) => h.time.slice(11))).toEqual(['00:00', '02:00', '03:00']);
    expect(findWorkablePeriods(hours)).toMatchObject([{ start: '2026-03-29T00:00', end: '2026-03-29T04:00', hours: 3 }]);
  });

  it('daylight uses the BST sunrise and sunset', () => {
    const a = assessLift(panelSetup({ liftDate: '2026-03-29' }), march);
    expect(a.windowStart).toBe('2026-03-29T06:46');
    expect(a.windowEnd).toBe('2026-03-29T19:33');
    expect(a.liftDayHours.find((h) => h.time === '2026-03-29T06:00')!.daylight).toBe(false);
    expect(a.liftDayHours.find((h) => h.time === '2026-03-29T07:00')!.daylight).toBe(true);
  });
});

describe('older saved forecasts (local times, no instants)', () => {
  it('are read across the October repeat', () => {
    const local = parseForecast(
      envelope({
        ...openMeteoUnixResponse('2026-10-24T23:00:00Z', 4, [{ sunriseUtc: '2026-10-25T06:47:00Z', sunsetUtc: '2026-10-25T16:43:00Z' }]),
        hourly: {
          ...openMeteoUnixResponse('2026-10-24T23:00:00Z', 4, []).hourly,
          time: ['2026-10-25T00:00', '2026-10-25T01:00', '2026-10-25T01:00', '2026-10-25T02:00'],
        },
        daily: { time: ['2026-10-25'], sunrise: ['2026-10-25T06:47'], sunset: ['2026-10-25T16:43'] },
      }),
    );
    expect(labels(local.hours.map((h) => ({ startMs: h.epochMs })))).toEqual(['00:00', '01:00 BST', '01:00 GMT', '02:00']);
    expect(local.days[0].sunriseMs).toBe(Date.parse('2026-10-25T06:47:00Z'));
  });
});

describe('hour labels on screen and in the PDF', () => {
  it('name the repeated October hour by zone and fall back to the local string', () => {
    expect(hourLabel({ time: '2026-10-25T01:00', startMs: Date.parse('2026-10-25T00:00:00Z') })).toBe('01:00 BST');
    expect(hourLabel({ time: '2026-10-25T01:00', startMs: Date.parse('2026-10-25T01:00:00Z') })).toBe('01:00 GMT');
    expect(hourLabel({ time: '2026-10-25T09:00', epochMs: Date.parse('2026-10-25T09:00:00Z') })).toBe('09:00');
    expect(hourLabel({ time: '2026-10-25T01:00' })).toBe('01:00');
  });
});
