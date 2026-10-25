import { describe, expect, it } from 'vitest';
import {
  epochsFromLocalSeries,
  HOUR_MS,
  isRepeatedLocalTime,
  londonClock,
  londonLocal,
  londonLocalToEpoch,
  londonOffsetMinutes,
  londonZone,
} from '../../src/time/london';

const utc = (s: string) => Date.parse(s);

describe('Europe/London conversion', () => {
  it('BST and GMT', () => {
    expect(londonLocal(utc('2026-07-01T11:00:00Z'))).toBe('2026-07-01T12:00');
    expect(londonZone(utc('2026-07-01T11:00:00Z'))).toBe('BST');
    expect(londonLocal(utc('2026-12-01T12:00:00Z'))).toBe('2026-12-01T12:00');
    expect(londonOffsetMinutes(utc('2026-12-01T12:00:00Z'))).toBe(0);
  });

  it('25 October 2026: 01:00–02:00 happens twice', () => {
    const first = utc('2026-10-25T00:00:00Z'); // 01:00 BST
    const second = utc('2026-10-25T01:00:00Z'); // 01:00 GMT
    expect(londonLocal(first)).toBe('2026-10-25T01:00');
    expect(londonLocal(second)).toBe('2026-10-25T01:00');
    expect(londonZone(first)).toBe('BST');
    expect(londonZone(second)).toBe('GMT');
    expect(londonLocalToEpoch('2026-10-25T01:00')).toBe(first);
    expect(londonLocalToEpoch('2026-10-25T01:00', 'later')).toBe(second);
    expect(isRepeatedLocalTime(first)).toBe(true);
    expect(isRepeatedLocalTime(utc('2026-10-25T03:00:00Z'))).toBe(false);
    expect(londonClock(first)).toBe('01:00 BST');
    expect(londonClock(second)).toBe('01:00 GMT');
    expect(londonClock(utc('2026-10-25T09:00:00Z'))).toBe('09:00');
  });

  it('29 March 2026: 01:00–02:00 does not happen', () => {
    expect(londonLocal(utc('2026-03-29T00:00:00Z'))).toBe('2026-03-29T00:00');
    expect(londonLocal(utc('2026-03-29T01:00:00Z'))).toBe('2026-03-29T02:00');
    // A skipped clock time moves forward by the skipped hour.
    expect(londonLocalToEpoch('2026-03-29T01:30')).toBe(utc('2026-03-29T01:30:00Z'));
    expect(londonLocal(londonLocalToEpoch('2026-03-29T01:30'))).toBe('2026-03-29T02:30');
    expect(londonLocalToEpoch('2026-03-29T02:00')).toBe(utc('2026-03-29T01:00:00Z'));
  });

  it('reads an old local-time series across both changes', () => {
    const oct = ['2026-10-25T00:00', '2026-10-25T01:00', '2026-10-25T01:00', '2026-10-25T02:00'];
    const msOct = epochsFromLocalSeries(oct);
    expect(msOct.map((m, i) => (i ? m - msOct[i - 1] : 0))).toEqual([0, HOUR_MS, HOUR_MS, HOUR_MS]);
    const mar = ['2026-03-29T00:00', '2026-03-29T02:00', '2026-03-29T03:00'];
    const msMar = epochsFromLocalSeries(mar);
    expect(msMar.map((m, i) => (i ? m - msMar[i - 1] : 0))).toEqual([0, HOUR_MS, HOUR_MS]);
  });
});
