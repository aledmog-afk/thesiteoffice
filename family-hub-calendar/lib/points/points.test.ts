import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodRange } from './periods.ts';
import { redeemErrorMessage } from './errors.ts';

test('this week runs from the household week start to today', () => {
  // 2026-06-03 is a Wednesday.
  assert.deepEqual(periodRange('week', '2026-06-03', 1), {
    fromKey: '2026-06-01',
    toKey: '2026-06-03',
  });
  assert.deepEqual(periodRange('week', '2026-06-03', 0), {
    fromKey: '2026-05-31',
    toKey: '2026-06-03',
  });
});

test('this month runs from the first', () => {
  assert.deepEqual(periodRange('month', '2026-06-17', 1), {
    fromKey: '2026-06-01',
    toKey: '2026-06-17',
  });
});

test('all time starts before any household could exist', () => {
  const range = periodRange('all', '2026-06-17', 1);
  assert.equal(range.fromKey, '1970-01-01');
  assert.equal(range.toKey, '2026-06-17');
});

test('a shortfall becomes the number of points still needed', () => {
  assert.equal(
    redeemErrorMessage('insufficient_points: have 5, need 8', 'Ada'),
    'Ada needs 3 more points for that.',
  );
});

test('a shortfall of one is singular', () => {
  assert.equal(
    redeemErrorMessage('insufficient_points: have 7, need 8', 'Bo'),
    'Bo needs 1 more point for that.',
  );
});

test('a postgres error prefix does not break the parse', () => {
  // Supabase surfaces the raised message with context around it.
  assert.equal(
    redeemErrorMessage(
      'insufficient_points: have 0, need 20',
      'Sam',
    ),
    'Sam needs 20 more points for that.',
  );
});

test('never promises a zero or negative shortfall', () => {
  // Should not happen, but a clamp beats rendering "needs 0 more points".
  assert.equal(
    redeemErrorMessage('insufficient_points: have 10, need 8', 'Ada'),
    'Ada needs 1 more point for that.',
  );
});

test('an unparsed insufficient_points still reads as a shortfall', () => {
  assert.equal(
    redeemErrorMessage('insufficient_points', 'Ada'),
    'Ada does not have enough points for that yet.',
  );
});

test('an inactive or deleted reward is explained', () => {
  assert.equal(redeemErrorMessage('reward_not_available', 'Ada'), 'That reward is no longer available.');
  assert.equal(redeemErrorMessage('member_not_found', 'Ada'), 'That family member no longer exists.');
});

test('an unrecognised error is passed through rather than hidden', () => {
  assert.equal(redeemErrorMessage('connection terminated', 'Ada'), 'connection terminated');
});
