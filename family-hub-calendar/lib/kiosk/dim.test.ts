import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dimOpacity, timeToMinutes } from './dim.ts';

const MAX = 0.75;
const at = (h: number, m = 0) => h * 60 + m;

test('parses Postgres time values', () => {
  assert.equal(timeToMinutes('21:00:00'), 1260);
  assert.equal(timeToMinutes('07:30'), 450);
  assert.equal(timeToMinutes('00:00'), 0);
  assert.equal(timeToMinutes(null), null);
  assert.equal(timeToMinutes('nope'), null);
  assert.equal(timeToMinutes('25:00'), null);
});

test('an unset window never dims — dimming is opt-in', () => {
  assert.equal(dimOpacity(at(2), null, at(7), MAX), 0);
  assert.equal(dimOpacity(at(2), at(21), null, MAX), 0);
  assert.equal(dimOpacity(at(2), null, null, MAX), 0);
});

test('outside the window is fully clear', () => {
  // 21:00 -> 07:00
  assert.equal(dimOpacity(at(12), at(21), at(7), MAX), 0);
  assert.equal(dimOpacity(at(20, 59), at(21), at(7), MAX), 0);
  assert.equal(dimOpacity(at(7), at(21), at(7), MAX), 0); // end is exclusive
});

test('the middle of the night sits at full dim', () => {
  assert.equal(dimOpacity(at(2), at(21), at(7), MAX), MAX);
  assert.equal(dimOpacity(at(23), at(21), at(7), MAX), MAX);
});

test('a midnight-wrapping window is handled, not treated as inverted', () => {
  // The whole point: 21:00 -> 07:00 spans the date boundary.
  assert.ok(dimOpacity(at(1), at(21), at(7), MAX) > 0, '01:00 should be dim');
  assert.ok(dimOpacity(at(22), at(21), at(7), MAX) > 0, '22:00 should be dim');
  assert.equal(dimOpacity(at(9), at(21), at(7), MAX), 0, '09:00 should be clear');
});

test('a same-day window works too', () => {
  // 13:00 -> 15:00
  assert.equal(dimOpacity(at(14), at(13), at(15), MAX), MAX);
  assert.equal(dimOpacity(at(12), at(13), at(15), MAX), 0);
  assert.equal(dimOpacity(at(16), at(13), at(15), MAX), 0);
});

test('ramps in over 20 minutes rather than stepping', () => {
  const start = at(21);
  assert.equal(dimOpacity(start, start, at(7), MAX), 0);
  assert.equal(dimOpacity(start + 10, start, at(7), MAX), round(MAX / 2));
  assert.equal(dimOpacity(start + 20, start, at(7), MAX), MAX);
});

test('ramps out symmetrically before the end', () => {
  assert.equal(dimOpacity(at(6, 50), at(21), at(7), MAX), round(MAX / 2));
  assert.equal(dimOpacity(at(6, 40), at(21), at(7), MAX), MAX);
});

test('a window shorter than two ramps still peaks in the middle', () => {
  // 30-minute window: ramp clamps to 15 so it reaches max exactly at the mid.
  const s = at(1);
  const e = at(1, 30);
  assert.equal(dimOpacity(s, s, e, MAX), 0);
  assert.equal(dimOpacity(at(1, 15), s, e, MAX), MAX);
  assert.equal(dimOpacity(at(1, 30), s, e, MAX), 0);
});

test('a zero-length window never dims', () => {
  assert.equal(dimOpacity(at(21), at(21), at(21), MAX), 0);
});

test('max opacity is respected and never exceeded', () => {
  for (let m = 0; m < 1440; m += 7) {
    const o = dimOpacity(m, at(21), at(7), 0.5);
    assert.ok(o >= 0 && o <= 0.5, `opacity ${o} out of range at ${m}`);
  }
  assert.equal(dimOpacity(at(2), at(21), at(7), 0), 0);
});

test('minutes outside 0..1439 wrap instead of breaking', () => {
  assert.equal(dimOpacity(at(2) + 1440, at(21), at(7), MAX), MAX);
  assert.equal(dimOpacity(-60, at(21), at(7), MAX), MAX); // 23:00
});

function round(n: number) {
  return Math.round(n * 100) / 100;
}
