import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueDatesFor, horizonFor } from './schedule.ts';

const base = { rrule: null, starts_on: '2026-06-01', ends_on: null };

test('a one-off chore yields exactly one date', () => {
  assert.deepEqual(dueDatesFor(base, '2026-06-01', '2026-06-30'), ['2026-06-01']);
});

test('a one-off outside the window yields nothing', () => {
  assert.deepEqual(dueDatesFor(base, '2026-07-01', '2026-07-30'), []);
});

test('a weekly chore lands on its weekday only', () => {
  // 2026-06-02 is a Tuesday.
  const out = dueDatesFor(
    { ...base, rrule: 'FREQ=WEEKLY;BYDAY=TU', starts_on: '2026-06-01' },
    '2026-06-01',
    '2026-06-30',
  );
  assert.deepEqual(out, ['2026-06-02', '2026-06-09', '2026-06-16', '2026-06-23', '2026-06-30']);
});

test('a daily chore fills the window', () => {
  const out = dueDatesFor({ ...base, rrule: 'FREQ=DAILY' }, '2026-06-01', '2026-06-05');
  assert.deepEqual(out, [
    '2026-06-01',
    '2026-06-02',
    '2026-06-03',
    '2026-06-04',
    '2026-06-05',
  ]);
});

test('never generates before starts_on, even if the window opens earlier', () => {
  const out = dueDatesFor(
    { ...base, rrule: 'FREQ=DAILY', starts_on: '2026-06-10' },
    '2026-06-01',
    '2026-06-12',
  );
  assert.deepEqual(out, ['2026-06-10', '2026-06-11', '2026-06-12']);
});

test('ends_on clamps the series', () => {
  const out = dueDatesFor(
    { rrule: 'FREQ=DAILY', starts_on: '2026-06-01', ends_on: '2026-06-03' },
    '2026-06-01',
    '2026-06-30',
  );
  assert.deepEqual(out, ['2026-06-01', '2026-06-02', '2026-06-03']);
});

test('COUNT and UNTIL terminate the series', () => {
  assert.equal(
    dueDatesFor({ ...base, rrule: 'FREQ=DAILY;COUNT=3' }, '2026-06-01', '2026-06-30').length,
    3,
  );
  assert.deepEqual(
    dueDatesFor({ ...base, rrule: 'FREQ=DAILY;UNTIL=20260603T000000Z' }, '2026-06-01', '2026-06-30'),
    ['2026-06-01', '2026-06-02', '2026-06-03'],
  );
});

test('a monthly chore repeats on the same day of month', () => {
  const out = dueDatesFor(
    { ...base, rrule: 'FREQ=MONTHLY', starts_on: '2026-01-15' },
    '2026-01-01',
    '2026-04-30',
  );
  assert.deepEqual(out, ['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15']);
});

test('a weekly chore spanning the DST change keeps whole-day spacing', () => {
  // BST starts 2026-03-29. Dates must stay 7 apart with no 23/25-hour drift
  // pulling one onto the wrong day.
  const out = dueDatesFor(
    { ...base, rrule: 'FREQ=WEEKLY;BYDAY=MO', starts_on: '2026-03-23' },
    '2026-03-23',
    '2026-04-13',
  );
  assert.deepEqual(out, ['2026-03-23', '2026-03-30', '2026-04-06', '2026-04-13']);
});

test('a malformed rrule degrades to a one-off instead of generating nothing at all', () => {
  const out = dueDatesFor({ ...base, rrule: 'not a rule' }, '2026-06-01', '2026-06-30');
  assert.deepEqual(out, ['2026-06-01']);
});

test('an inverted or bogus window yields nothing rather than throwing', () => {
  assert.deepEqual(dueDatesFor({ ...base, rrule: 'FREQ=DAILY' }, '2026-06-30', '2026-06-01'), []);
  assert.deepEqual(dueDatesFor({ ...base, rrule: 'FREQ=DAILY' }, 'nonsense', '2026-06-01'), []);
  assert.deepEqual(
    dueDatesFor({ rrule: 'FREQ=DAILY', starts_on: 'nope', ends_on: null }, '2026-06-01', '2026-06-05'),
    [],
  );
});

test('the horizon runs from today forward', () => {
  assert.deepEqual(horizonFor('2026-06-01', 14), { fromKey: '2026-06-01', toKey: '2026-06-15' });
});
