import { describe, expect, it } from 'vitest';
import { parseForecast } from '../../src/data/openMeteo';
import { assessLift } from '../../src/lift/assessment';
import { londonClock } from '../../src/time/london';
import { appliedHeightFactor, assessHours, hourGusts, METHOD_VERSION, type ForecastHour } from '../../src/wind';
import { compareWithForecast, type LogEntry } from '../../src/windlog/log';
import { openMeteoUnixResponse } from '../fixtures/openMeteo';
import { forecast, panelSetup } from '../lift/helpers';

const envelope = (data: unknown) => ({
  source: 'Open-Meteo',
  endpoint: 'https://api.open-meteo.com/v1/forecast',
  fetchedAt: '2026-10-24T18:00:00.000Z',
  latitude: 51.5,
  longitude: -0.12,
  data,
});
const F30 = appliedHeightFactor(30);

describe('gust timing rule (LW-M1.3)', () => {
  it('is in the method version', () => {
    expect(METHOD_VERSION).toBe('LW-M1.3');
  });

  it('assesses each hour on the higher of the values stamped at its start and its end', () => {
    const hours = forecast((i) => [3, 5, 4, 2][i % 4]).hours.slice(0, 5);
    expect(hourGusts(hours).map((g) => g.assessedMs)).toEqual([5, 5, 4, 3, null]); // no stamp after the slice
    expect(hourGusts(hours)[0]).toEqual({ stampedMs: 3, nextMs: 5, assessedMs: 5 });
  });

  it('gives no data when either value is missing, including after the last forecast hour', () => {
    const hours = forecast(() => 3).hours.slice(0, 3);
    const gapped: ForecastHour[] = hours.map((h, i) => (i === 1 ? { ...h, windGusts10mMs: null } : h));
    expect(hourGusts(gapped).map((g) => g.assessedMs)).toEqual([null, null, null]);
    expect(hourGusts(hours).map((g) => g.assessedMs)).toEqual([3, 3, null]);
  });

  it('a rising wind is shown in the hour it happens, not an hour late', () => {
    // Stamps rise 1 m/s per hour from 09:00; the value stamped 12:00 (max over 11:00-12:00) is the first above.
    const gust = (i: number) => (i % 24 < 9 ? 2 : 2 + (i % 24 - 9));
    const f = forecast(gust);
    const a = assessLift(panelSetup({ windowStart: '09:00', windowEnd: '15:00' }), f);
    const permitted = a.load.permittedMs;
    const firstAboveStamp = f.hours.find((h) => h.time.startsWith('2026-10-22') && h.windGusts10mMs! * F30 > permitted)!;
    const firstAboveHour = a.liftDayHours.find((h) => h.status === 'over')!;
    // The hour before the stamp is the hour that stamp covers.
    expect(firstAboveHour.startMs).toBe(firstAboveStamp.epochMs! - 3_600_000);
    expect(firstAboveHour.gust10mMs).toBe(firstAboveHour.gustNext10mMs);
    expect(firstAboveHour.gustNext10mMs!).toBeGreaterThan(firstAboveHour.gustStamped10mMs!);
    // Same rule for the planning periods, per-load times and the wind log comparison.
    const lastBelow = a.liftDayHours.filter((h) => h.daylight && h.status === 'within').at(-1)!;
    expect(lastBelow.startMs).toBeLessThan(firstAboveHour.startMs!);
    for (const l of a.loads) expect(l.statuses).toEqual(assessHours(a.liftDayForecast, f.days, { heightM: 30, permittedMs: l.result.permittedMs }).slice(0, 24).map((h) => h.status));
  });

  it('a falling wind keeps the higher value stamped at the start of the hour', () => {
    const a = assessLift(panelSetup({ windowStart: '09:00', windowEnd: '12:00' }), forecast((i) => 12 - (i % 24) * 0.25));
    const h = a.windowHours[0];
    expect(h.gust10mMs).toBe(h.gustStamped10mMs);
    expect(h.gustAtHeightMs).toBeCloseTo((12 - 9 * 0.25) * F30, 9);
  });

  it('wind log readings are compared with the assessed gust for their hour', () => {
    const a = assessLift(panelSetup(), forecast((i) => [3, 5, 4, 2][i % 4]));
    const tenAm = a.liftDayHours.find((h) => h.time === '2026-10-22T10:00')!;
    const reading: LogEntry = { id: 'r', recordId: 'x', at: new Date(tenAm.startMs! + 20 * 60_000).toISOString(), kind: 'reading', gustMs: 6 };
    const cmp = compareWithForecast([reading], a.liftDayHours);
    expect(cmp.pairs[0].forecastMs).toBe(tenAm.gustAtHeightMs);
    expect(tenAm.gust10mMs).toBe(Math.max(tenAm.gustStamped10mMs!, tenAm.gustNext10mMs!));
  });
});

describe('gust timing across the clock changes', () => {
  it('25 Oct 2026: the repeated hour pairs by instant (01:00 BST with 01:00 GMT, 01:00 GMT with 02:00)', () => {
    // Index i is UTC hour 23:00Z + i. A spike is stamped at 01:00 GMT (01:00Z, i = 2).
    const october = parseForecast(
      envelope(
        openMeteoUnixResponse('2026-10-24T23:00:00Z', 49, [{ sunriseUtc: '2026-10-25T06:47:00Z', sunsetUtc: '2026-10-25T16:43:00Z' }], (i) => (i === 2 ? 9 : 2)),
      ),
    );
    const a = assessLift(panelSetup({ liftDate: '2026-10-25', windowStart: '00:00', windowEnd: '03:00' }), october);
    const byLabel = Object.fromEntries(a.windowHours.map((h) => [londonClock(h.startMs!), h.gust10mMs]));
    expect(byLabel).toEqual({ '00:00': 2, '01:00 BST': 9, '01:00 GMT': 9, '02:00': 2 });
    expect(a.liftDayHours).toHaveLength(25);
  });

  it('29 Mar 2026: the hour before the gap pairs with 02:00 BST, the next instant', () => {
    // Index i is UTC hour 00:00Z + i: 00:00 GMT, then 02:00 BST (i = 1). Spike stamped 02:00 BST.
    const march = parseForecast(
      envelope(
        openMeteoUnixResponse('2026-03-29T00:00:00Z', 47, [{ sunriseUtc: '2026-03-29T05:46:00Z', sunsetUtc: '2026-03-29T18:33:00Z' }], (i) => (i === 1 ? 9 : 2)),
      ),
    );
    const a = assessLift(panelSetup({ liftDate: '2026-03-29', windowStart: '00:00', windowEnd: '04:00' }), march);
    const byLabel = Object.fromEntries(a.windowHours.map((h) => [londonClock(h.startMs!), h.gust10mMs]));
    expect(byLabel).toEqual({ '00:00': 9, '02:00': 9, '03:00': 2 });
    expect(a.liftDayHours).toHaveLength(23);
  });

  it('the last hour of the lift day uses the next day’s first stamp', () => {
    const october = parseForecast(
      envelope(openMeteoUnixResponse('2026-10-24T23:00:00Z', 49, [{ sunriseUtc: '2026-10-25T06:47:00Z', sunsetUtc: '2026-10-25T16:43:00Z' }], (i) => (i === 25 ? 8 : 2))),
    );
    const a = assessLift(panelSetup({ liftDate: '2026-10-25' }), october);
    const last = a.liftDayHours.at(-1)!;
    expect(londonClock(last.startMs!)).toBe('23:00');
    expect(last.gust10mMs).toBe(8);
    expect(a.liftDayForecast).toHaveLength(26);
  });
});
