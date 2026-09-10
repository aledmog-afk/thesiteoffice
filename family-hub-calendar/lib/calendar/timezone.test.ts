import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDaysToKey,
  addMonthsToKey,
  dateKey,
  floatingUtcToWallClock,
  fromWallClock,
  isValidTimeZone,
  minutesIntoDay,
  offsetMinutes,
  localMidnight,
  parseInputs,
  startOfMonthKey,
  startOfWeekKey,
  toDateInput,
  toTimeInput,
  toWallClock,
  wallClockToFloatingUtc,
} from './timezone.ts';

const LONDON = 'Europe/London';
const NY = 'America/New_York';
const KATHMANDU = 'Asia/Kathmandu'; // UTC+05:45
const ADELAIDE = 'Australia/Adelaide'; // UTC+09:30 / +10:30

test('reads a wall clock in a zone', () => {
  // 2026-01-15T12:00Z — London on GMT, New York on EST.
  const d = new Date('2026-01-15T12:00:00Z');
  assert.deepEqual(toWallClock(d, LONDON), {
    year: 2026,
    month: 1,
    day: 15,
    hour: 12,
    minute: 0,
  });
  assert.deepEqual(toWallClock(d, NY), { year: 2026, month: 1, day: 15, hour: 7, minute: 0 });
});

test('midnight reads as hour 0, not 24', () => {
  const d = new Date('2026-01-15T00:00:00Z');
  assert.equal(toWallClock(d, LONDON).hour, 0);
  assert.equal(toWallClock(d, 'UTC').hour, 0);
});

test('offsets, including the half- and quarter-hour ones', () => {
  const winter = new Date('2026-01-15T12:00:00Z');
  const summer = new Date('2026-07-15T12:00:00Z');
  assert.equal(offsetMinutes(winter, LONDON), 0);
  assert.equal(offsetMinutes(summer, LONDON), 60);
  assert.equal(offsetMinutes(winter, NY), -300);
  assert.equal(offsetMinutes(summer, NY), -240);
  assert.equal(offsetMinutes(winter, KATHMANDU), 345);
  assert.equal(offsetMinutes(winter, ADELAIDE), 630);
  assert.equal(offsetMinutes(summer, ADELAIDE), 570);
});

test('offset is not thrown off by non-zero seconds', () => {
  assert.equal(offsetMinutes(new Date('2026-01-15T12:00:37Z'), LONDON), 0);
  assert.equal(offsetMinutes(new Date('2026-07-15T12:00:37Z'), LONDON), 60);
});

test('round-trips wall clock to instant and back', () => {
  for (const tz of [LONDON, NY, KATHMANDU, ADELAIDE, 'UTC']) {
    for (const wall of [
      { year: 2026, month: 1, day: 15, hour: 9, minute: 0 },
      { year: 2026, month: 7, day: 15, hour: 9, minute: 0 },
      { year: 2026, month: 12, day: 31, hour: 23, minute: 59 },
      { year: 2026, month: 3, day: 1, hour: 0, minute: 0 },
    ]) {
      const instant = fromWallClock(wall, tz);
      assert.deepEqual(toWallClock(instant, tz), wall, `${tz} ${JSON.stringify(wall)}`);
    }
  }
});

test('9am stays 9am across the London DST boundary', () => {
  // The whole reason this module exists. BST starts 2026-03-29.
  const before = fromWallClock({ year: 2026, month: 3, day: 27, hour: 9, minute: 0 }, LONDON);
  const after = fromWallClock({ year: 2026, month: 3, day: 31, hour: 9, minute: 0 }, LONDON);

  assert.equal(before.toISOString(), '2026-03-27T09:00:00.000Z'); // GMT
  assert.equal(after.toISOString(), '2026-03-31T08:00:00.000Z'); // BST

  // Both read as 9am locally — a naive +7 days would have drifted to 10am.
  assert.equal(toWallClock(before, LONDON).hour, 9);
  assert.equal(toWallClock(after, LONDON).hour, 9);
});

test('a wall clock inside the spring-forward gap resolves past the jump', () => {
  // London 2026-03-29 01:00 → 02:00; 01:30 never happens.
  const instant = fromWallClock({ year: 2026, month: 3, day: 29, hour: 1, minute: 30 }, LONDON);
  const readback = toWallClock(instant, LONDON);
  // Must not throw or land on the previous day; lands at or after the jump.
  assert.equal(readback.day, 29);
  assert.ok(readback.hour >= 1, `unexpected hour ${readback.hour}`);
  assert.ok(instant.getTime() >= Date.parse('2026-03-29T01:00:00Z'));
});

test('an ambiguous autumn-back wall clock resolves to the earlier instant', () => {
  // London 2026-10-25 02:00 → 01:00; 01:30 happens twice.
  const instant = fromWallClock({ year: 2026, month: 10, day: 25, hour: 1, minute: 30 }, LONDON);
  assert.equal(toWallClock(instant, LONDON).hour, 1);
  // The earlier of the two is the BST one at 00:30Z.
  assert.equal(instant.toISOString(), '2026-10-25T00:30:00.000Z');
});

test('floating-UTC helpers are exact inverses', () => {
  const wall = { year: 2026, month: 5, day: 4, hour: 17, minute: 45 };
  assert.deepEqual(floatingUtcToWallClock(wallClockToFloatingUtc(wall)), wall);
});

test('dateKey groups by local day, not UTC day', () => {
  // 23:30 in New York is already the next day in UTC.
  const d = new Date('2026-06-02T03:30:00Z');
  assert.equal(dateKey(d, 'UTC'), '2026-06-02');
  assert.equal(dateKey(d, NY), '2026-06-01');
});

test('minutesIntoDay is local', () => {
  const d = new Date('2026-06-02T03:30:00Z');
  assert.equal(minutesIntoDay(d, 'UTC'), 210);
  assert.equal(minutesIntoDay(d, NY), 23 * 60 + 30);
});

test('rejects a bogus zone without throwing', () => {
  assert.equal(isValidTimeZone(LONDON), true);
  assert.equal(isValidTimeZone('Mars/Olympus_Mons'), false);
});

test('date/time inputs parse into a wall clock, rejecting nonsense', () => {
  assert.deepEqual(parseInputs('2026-06-01', '09:30'), {
    year: 2026,
    month: 6,
    day: 1,
    hour: 9,
    minute: 30,
  });
  assert.deepEqual(parseInputs('2026-06-01', ''), {
    year: 2026,
    month: 6,
    day: 1,
    hour: 0,
    minute: 0,
  });
  assert.equal(parseInputs('01/06/2026', '09:30'), null);
  assert.equal(parseInputs('2026-13-01', '09:30'), null);
  assert.equal(parseInputs('2026-06-01', '25:00'), null);
});

test('instants render back into input values', () => {
  const d = new Date('2026-07-15T08:05:00Z'); // 09:05 BST
  assert.equal(toDateInput(d, LONDON), '2026-07-15');
  assert.equal(toTimeInput(d, LONDON), '09:05');
});

test('a day added across DST is still one day, not 23 or 25 hours', () => {
  assert.equal(addDaysToKey('2026-03-28', 1), '2026-03-29');
  assert.equal(addDaysToKey('2026-03-29', 1), '2026-03-30');
  assert.equal(addDaysToKey('2026-10-24', 1), '2026-10-25');
  assert.equal(addDaysToKey('2026-01-31', 1), '2026-02-01');
  assert.equal(addDaysToKey('2026-03-01', -1), '2026-02-28');
  assert.equal(addDaysToKey('2026-01-01', -1), '2025-12-31');
});

test('local midnight is local, not UTC', () => {
  // BST: midnight London is 23:00Z the previous day.
  assert.equal(localMidnight('2026-07-15', LONDON).toISOString(), '2026-07-14T23:00:00.000Z');
  assert.equal(localMidnight('2026-01-15', LONDON).toISOString(), '2026-01-15T00:00:00.000Z');
});

test('week start honours the household setting', () => {
  // 2026-06-03 is a Wednesday.
  assert.equal(startOfWeekKey('2026-06-03', 1), '2026-06-01'); // Monday
  assert.equal(startOfWeekKey('2026-06-03', 0), '2026-05-31'); // Sunday
  // Already on the boundary stays put.
  assert.equal(startOfWeekKey('2026-06-01', 1), '2026-06-01');
});

test('month arithmetic clamps to the first and does not overflow', () => {
  assert.equal(startOfMonthKey('2026-06-17'), '2026-06-01');
  assert.equal(addMonthsToKey('2026-01-31', 1), '2026-02-01');
  assert.equal(addMonthsToKey('2026-12-15', 1), '2027-01-01');
  assert.equal(addMonthsToKey('2026-01-15', -1), '2025-12-01');
});
