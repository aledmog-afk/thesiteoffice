import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandOccurrences } from './occurrences.ts';
import { toWallClock } from './timezone.ts';
import type { CalendarEvent } from '../../types/database.ts';

const LONDON = 'Europe/London';

function event(over: Partial<CalendarEvent> & { id: string }): CalendarEvent {
  return {
    household_id: 'hh',
    calendar_id: null,
    member_id: null,
    title: over.id,
    description: null,
    location: null,
    starts_at: '2026-06-01T09:00:00Z',
    ends_at: '2026-06-01T10:00:00Z',
    all_day: false,
    event_timezone: LONDON,
    rrule: null,
    recurrence_parent_id: null,
    recurrence_original_start: null,
    is_cancelled: false,
    provider_event_id: null,
    provider_etag: null,
    remote_updated_at: null,
    local_updated_at: '2026-06-01T00:00:00Z',
    sync_status: 'local_only',
    created_at: '2026-06-01T00:00:00Z',
    ...over,
  };
}

const win = (a: string, b: string) => [new Date(a), new Date(b)] as const;

test('a one-off event inside the window appears once', () => {
  const [from, to] = win('2026-06-01T00:00:00Z', '2026-06-08T00:00:00Z');
  const out = expandOccurrences([event({ id: 'a' })], from, to, LONDON);
  assert.equal(out.length, 1);
  assert.equal(out[0].isRecurring, false);
  assert.equal(out[0].start.toISOString(), '2026-06-01T09:00:00.000Z');
});

test('an event wholly outside the window is excluded', () => {
  const [from, to] = win('2026-07-01T00:00:00Z', '2026-07-08T00:00:00Z');
  assert.equal(expandOccurrences([event({ id: 'a' })], from, to, LONDON).length, 0);
});

test('an event straddling the window start is included', () => {
  const [from, to] = win('2026-06-01T09:30:00Z', '2026-06-08T00:00:00Z');
  const out = expandOccurrences([event({ id: 'a' })], from, to, LONDON);
  assert.equal(out.length, 1);
});

test('a cancelled one-off is excluded', () => {
  const [from, to] = win('2026-06-01T00:00:00Z', '2026-06-08T00:00:00Z');
  assert.equal(
    expandOccurrences([event({ id: 'a', is_cancelled: true })], from, to, LONDON).length,
    0,
  );
});

test('a weekly series expands across the window', () => {
  const [from, to] = win('2026-06-01T00:00:00Z', '2026-06-29T00:00:00Z');
  const out = expandOccurrences(
    [event({ id: 'w', rrule: 'FREQ=WEEKLY;BYDAY=MO' })],
    from,
    to,
    LONDON,
  );
  assert.deepEqual(
    out.map((o) => o.start.toISOString().slice(0, 10)),
    ['2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22'],
  );
  assert.ok(out.every((o) => o.isRecurring));
});

test('a weekly 9am series stays at 9am local across the DST boundary', () => {
  // The reason expansion runs in wall-clock space. BST starts 2026-03-29.
  const [from, to] = win('2026-03-20T00:00:00Z', '2026-04-10T00:00:00Z');
  const out = expandOccurrences(
    [
      event({
        id: 'school',
        starts_at: '2026-03-23T09:00:00Z', // Monday, GMT
        ends_at: '2026-03-23T09:30:00Z',
        rrule: 'FREQ=WEEKLY;BYDAY=MO',
      }),
    ],
    from,
    to,
    LONDON,
  );

  assert.ok(out.length >= 3);
  for (const occurrence of out) {
    assert.equal(toWallClock(occurrence.start, LONDON).hour, 9, occurrence.start.toISOString());
  }
  // And the underlying instants really do shift, proving it is not a no-op.
  const instants = out.map((o) => o.start.toISOString().slice(11, 16));
  assert.ok(instants.includes('09:00'), 'expected a GMT occurrence');
  assert.ok(instants.includes('08:00'), 'expected a BST occurrence');
});

test('COUNT and UNTIL both terminate a series', () => {
  const [from, to] = win('2026-06-01T00:00:00Z', '2026-07-31T00:00:00Z');
  const counted = expandOccurrences(
    [event({ id: 'c', rrule: 'FREQ=DAILY;COUNT=3' })],
    from,
    to,
    LONDON,
  );
  assert.equal(counted.length, 3);

  const until = expandOccurrences(
    [event({ id: 'u', rrule: 'FREQ=DAILY;UNTIL=20260604T090000Z' })],
    from,
    to,
    LONDON,
  );
  assert.equal(until.length, 4);
});

test('an edited occurrence replaces its slot and keeps the slot key', () => {
  const [from, to] = win('2026-06-01T00:00:00Z', '2026-06-15T00:00:00Z');
  const out = expandOccurrences(
    [
      event({ id: 'm', rrule: 'FREQ=WEEKLY;BYDAY=MO' }),
      event({
        id: 'child',
        title: 'moved',
        recurrence_parent_id: 'm',
        recurrence_original_start: '2026-06-08T09:00:00Z',
        starts_at: '2026-06-09T14:00:00Z',
        ends_at: '2026-06-09T15:00:00Z',
      }),
    ],
    from,
    to,
    LONDON,
  );

  assert.deepEqual(out.map((o) => o.title), ['m', 'moved']);
  const moved = out.find((o) => o.title === 'moved')!;
  assert.equal(moved.isException, true);
  assert.equal(moved.eventId, 'child');
  assert.equal(moved.masterId, 'm');
  // Keyed on the slot it replaces, not on where it moved to.
  assert.equal(moved.key, 'm:2026-06-08T09:00:00.000Z');
  // The original slot is not also rendered.
  assert.equal(out.filter((o) => o.start.toISOString() === '2026-06-08T09:00:00.000Z').length, 0);
});

test('a cancelled occurrence removes just that one from the series', () => {
  const [from, to] = win('2026-06-01T00:00:00Z', '2026-06-29T00:00:00Z');
  const out = expandOccurrences(
    [
      event({ id: 'm', rrule: 'FREQ=WEEKLY;BYDAY=MO' }),
      event({
        id: 'skip',
        recurrence_parent_id: 'm',
        recurrence_original_start: '2026-06-15T09:00:00Z',
        is_cancelled: true,
      }),
    ],
    from,
    to,
    LONDON,
  );
  assert.deepEqual(
    out.map((o) => o.start.toISOString().slice(0, 10)),
    ['2026-06-01', '2026-06-08', '2026-06-22'],
  );
});

test('a malformed rrule degrades to a single event instead of blanking the calendar', () => {
  const [from, to] = win('2026-06-01T00:00:00Z', '2026-06-08T00:00:00Z');
  const out = expandOccurrences(
    [event({ id: 'bad', rrule: 'this is not an rrule' }), event({ id: 'good' })],
    from,
    to,
    LONDON,
  );
  assert.equal(out.length, 2, 'the valid event must still render');
});

test('occurrences are sorted by start, all-day first, then title', () => {
  const [from, to] = win('2026-06-01T00:00:00Z', '2026-06-02T00:00:00Z');
  const out = expandOccurrences(
    [
      event({ id: 'z', title: 'zebra', starts_at: '2026-06-01T09:00:00Z', ends_at: '2026-06-01T10:00:00Z' }),
      event({ id: 'a', title: 'apple', starts_at: '2026-06-01T09:00:00Z', ends_at: '2026-06-01T10:00:00Z' }),
      event({ id: 'd', title: 'allday', all_day: true, starts_at: '2026-06-01T09:00:00Z', ends_at: '2026-06-01T10:00:00Z' }),
      event({ id: 'e', title: 'early', starts_at: '2026-06-01T08:00:00Z', ends_at: '2026-06-01T08:30:00Z' }),
    ],
    from,
    to,
    LONDON,
  );
  assert.deepEqual(out.map((o) => o.title), ['early', 'allday', 'apple', 'zebra']);
});

test('keys are unique across a series so React does not collapse rows', () => {
  const [from, to] = win('2026-06-01T00:00:00Z', '2026-06-29T00:00:00Z');
  const out = expandOccurrences(
    [event({ id: 'm', rrule: 'FREQ=DAILY' })],
    from,
    to,
    LONDON,
  );
  assert.equal(new Set(out.map((o) => o.key)).size, out.length);
});

test('the event timezone overrides the household one', () => {
  const [from, to] = win('2026-03-20T00:00:00Z', '2026-04-10T00:00:00Z');
  const out = expandOccurrences(
    [
      event({
        id: 'ny',
        event_timezone: 'America/New_York',
        starts_at: '2026-03-23T13:00:00Z', // 09:00 EDT
        ends_at: '2026-03-23T14:00:00Z',
        rrule: 'FREQ=WEEKLY;BYDAY=MO',
      }),
    ],
    from,
    to,
    LONDON,
  );
  for (const o of out) {
    assert.equal(toWallClock(o.start, 'America/New_York').hour, 9);
  }
});
