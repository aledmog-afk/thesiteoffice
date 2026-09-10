import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyChange, normalizeChange } from './reconcile.ts';
import type { ListItem } from '../../types/database.ts';

const LIST = 'list-1';

function item(id: string, overrides: Partial<ListItem> = {}): ListItem {
  return {
    id,
    household_id: 'hh-1',
    list_id: LIST,
    title: id,
    quantity_text: null,
    aisle: null,
    is_done: false,
    done_at: null,
    done_by_member_id: null,
    assigned_member_id: null,
    source_meal_plan_entry_id: null,
    position: 1000,
    created_at: '2026-09-10T00:00:00Z',
    ...overrides,
  };
}

test('DELETE reads `old`, because `new` is an empty object not a nullish one', () => {
  // The regression this module exists to prevent: `payload.new ?? payload.old`
  // returns {} for a delete and drops it.
  const change = normalizeChange({
    eventType: 'DELETE',
    new: {},
    old: item('a'),
  });
  assert.deepEqual(change, { type: 'REMOVE', id: 'a' });
});

test('INSERT and UPDATE read `new`', () => {
  const row = item('a', { title: 'milk' });
  assert.deepEqual(normalizeChange({ eventType: 'INSERT', new: row, old: {} }), {
    type: 'UPSERT',
    row,
  });
  assert.deepEqual(normalizeChange({ eventType: 'UPDATE', new: row, old: item('a') }), {
    type: 'UPSERT',
    row,
  });
});

test('a delete with no id in `old` is ignored rather than clearing the list', () => {
  assert.equal(normalizeChange({ eventType: 'DELETE', new: {}, old: {} }), null);
});

test('inserts land in position order, not arrival order', () => {
  const items = [item('a', { position: 1000 }), item('c', { position: 3000 })];
  const next = applyChange(
    items,
    { type: 'UPSERT', row: item('b', { position: 2000 }) },
    LIST,
  );
  assert.deepEqual(next.map((i) => i.id), ['a', 'b', 'c']);
});

test('the echo of an optimistic write replaces rather than duplicates', () => {
  // The client generates the id, so the echo collides on the same key.
  const optimistic = item('a', { position: Number.MAX_SAFE_INTEGER });
  const confirmed = item('a', { position: 2000 });
  const next = applyChange([optimistic], { type: 'UPSERT', row: confirmed }, LIST);
  assert.equal(next.length, 1);
  assert.equal(next[0].position, 2000);
});

test('an update applies in place', () => {
  const next = applyChange(
    [item('a'), item('b')],
    { type: 'UPSERT', row: item('a', { is_done: true }) },
    LIST,
  );
  assert.equal(next.find((i) => i.id === 'a')?.is_done, true);
  assert.equal(next.length, 2);
});

test('a row moved to another list leaves this one', () => {
  const next = applyChange(
    [item('a'), item('b')],
    { type: 'UPSERT', row: item('a', { list_id: 'list-2' }) },
    LIST,
  );
  assert.deepEqual(next.map((i) => i.id), ['b']);
});

test('an insert belonging to another list is not adopted', () => {
  const next = applyChange(
    [item('a')],
    { type: 'UPSERT', row: item('z', { list_id: 'list-2' }) },
    LIST,
  );
  assert.deepEqual(next.map((i) => i.id), ['a']);
});

test('an in-flight update cannot resurrect a row deleted locally', () => {
  const next = applyChange(
    [item('a')],
    { type: 'UPSERT', row: item('gone', { is_done: true }) },
    LIST,
    new Set(['gone']),
  );
  assert.deepEqual(next.map((i) => i.id), ['a']);
});

test('removing an unknown id is a no-op', () => {
  const next = applyChange([item('a')], { type: 'REMOVE', id: 'nope' }, LIST);
  assert.deepEqual(next.map((i) => i.id), ['a']);
});

test('does not mutate the input', () => {
  const items = [item('a')];
  const frozen = Object.freeze([...items]);
  applyChange(frozen, { type: 'UPSERT', row: item('b', { position: 500 }) }, LIST);
  assert.equal(items.length, 1);
});
