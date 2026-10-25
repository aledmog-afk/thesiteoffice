import { describe, expect, it } from 'vitest';
import { allUnits, evaluateLog, fromMs, toMs, type LogEntry } from '../../src/windlog/log';

describe('unit conversion', () => {
  it('converts exactly', () => {
    expect(toMs(10, 'mph')).toBeCloseTo(4.4704, 9);
    expect(toMs(36, 'kmh')).toBeCloseTo(10, 9);
    expect(toMs(1, 'kn')).toBeCloseTo(0.514444, 6);
    expect(fromMs(toMs(23.5, 'kn'), 'kn')).toBeCloseTo(23.5, 9);
  });
  it('shows a limit in every unit', () => {
    expect(allUnits(6.6)).toBe('6.6 m/s · 15 mph · 24 km/h · 13 knots');
  });
});

const T = (hm: string) => `2026-10-22T${hm}:00.000Z`; // UTC; fine for elapsed-time tests
let n = 0;
const reading = (hm: string, gustMs: number): LogEntry => ({ id: String(++n), recordId: 'r', at: T(hm), kind: 'reading', gustMs, value: gustMs, unit: 'ms' });
const limit = 10;

describe('evaluateLog (CPA 6.4.3 stop / wait / reset)', () => {
  it('no readings', () => {
    expect(evaluateLog([], limit, 30, new Date(T('08:00'))).state).toBe('no-readings');
  });

  it('within, then near the limit', () => {
    expect(evaluateLog([reading('08:00', 5)], limit, 30, new Date(T('08:01'))).state).toBe('within');
    expect(evaluateLog([reading('08:00', 8)], limit, 30, new Date(T('08:01'))).state).toBe('near');
  });

  it('stops above the limit and waits 30 minutes once below', () => {
    const log = [reading('08:00', 7), reading('09:00', 11), reading('09:10', 8)];
    const at = (hm: string) => evaluateLog(log, limit, 30, new Date(T(hm)));
    expect(evaluateLog(log.slice(0, 2), limit, 30, new Date(T('09:05'))).state).toBe('stopped');
    const w = at('09:25');
    expect(w.state).toBe('waiting');
    expect(Math.round(w.minutesWaited)).toBe(15);
    expect(w.headline).toMatch(/Waiting: below the limit since/);
    expect(at('09:40').state).toBe('waited');
    expect(at('09:40').headline).toBe('Wait period elapsed. The crane operator decides whether to restart');
    expect(at('09:40').detail).toMatch(/below the limit for 30 minutes, since 10:10/) // 09:10 UTC is 10:10 BST;
  });

  it('a reading above the limit resets the wait, and three resets prompt winding off', () => {
    const log = [
      reading('09:00', 11), reading('09:05', 9), // wait starts
      reading('09:15', 12), reading('09:20', 9), // reset 1
      reading('09:30', 12), reading('09:35', 9), // reset 2
      reading('09:45', 12), // reset 3
    ];
    const r = evaluateLog(log, limit, 30, new Date(T('09:46')));
    expect(r.state).toBe('stopped');
    expect(r.resets).toBe(3);
    expect(r.detail).toMatch(/winded off/);
  });

  it('a reading exactly at the limit is not over it', () => {
    expect(evaluateLog([reading('09:00', 11), reading('09:05', 10)], limit, 30, new Date(T('09:06'))).state).toBe('waiting');
  });

  it('a 10-minute wait can be chosen (BS 7121-5 tower cranes)', () => {
    expect(evaluateLog([reading('09:00', 11), reading('09:05', 9)], limit, 10, new Date(T('09:16'))).state).toBe('waited');
  });

  it('wound off for the day stays wound off', () => {
    const log: LogEntry[] = [reading('09:00', 11), { id: 'w', recordId: 'r', at: T('09:10'), kind: 'wind-off' }, reading('10:30', 3)];
    expect(evaluateLog(log, limit, 30, new Date(T('11:00'))).state).toBe('wound-off');
  });

  it('works in time order whatever order entries arrive in', () => {
    const log = [reading('09:10', 8), reading('09:00', 11)];
    expect(evaluateLog(log, limit, 30, new Date(T('09:15'))).state).toBe('waiting');
  });
});

describe('compareWithForecast', () => {
  it('pairs readings with the forecast gust at height for the same UK hour', async () => {
    const { compareWithForecast } = await import('../../src/windlog/log');
    const hours = [
      { time: '2026-10-22T09:00', gustAtHeightMs: 8 },
      { time: '2026-10-22T10:00', gustAtHeightMs: 10 },
    ];
    // 08:30 UTC is 09:30 BST on 22 October 2026.
    const entries: LogEntry[] = [
      { id: 'a', recordId: 'r', at: '2026-10-22T08:30:00Z', kind: 'reading', gustMs: 6 },
      { id: 'b', recordId: 'r', at: '2026-10-22T09:10:00Z', kind: 'reading', gustMs: 12 },
      { id: 'c', recordId: 'r', at: '2026-10-22T15:00:00Z', kind: 'reading', gustMs: 5 },
      { id: 'd', recordId: 'r', at: '2026-10-22T09:20:00Z', kind: 'note', note: 'x' },
    ];
    const r = compareWithForecast(entries, hours);
    expect(r.pairs.map((p) => [p.entry.id, p.forecastMs])).toEqual([['a', 8], ['b', 10]]);
    expect(r.meanRatio).toBeCloseTo((0.75 + 1.2) / 2, 9);
  });
});
