import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickAdd } from './quickAdd.ts';

test('leaves a plain item alone', () => {
  assert.deepEqual(parseQuickAdd('milk'), { title: 'milk', quantityText: null });
  assert.deepEqual(parseQuickAdd('sourdough bread'), {
    title: 'sourdough bread',
    quantityText: null,
  });
});

test('pulls a trailing multiplier', () => {
  assert.deepEqual(parseQuickAdd('milk x2'), { title: 'milk', quantityText: 'x2' });
  assert.deepEqual(parseQuickAdd('milk x 2'), { title: 'milk', quantityText: 'x2' });
  assert.deepEqual(parseQuickAdd('milk X2'), { title: 'milk', quantityText: 'x2' });
  assert.deepEqual(parseQuickAdd('milk ×2'), { title: 'milk', quantityText: 'x2' });
});

test('pulls a trailing bare number', () => {
  assert.deepEqual(parseQuickAdd('eggs 6'), { title: 'eggs', quantityText: '6' });
});

test('pulls a leading count, keeping any unit in the title', () => {
  assert.deepEqual(parseQuickAdd('2 tins beans'), { title: 'tins beans', quantityText: '2' });
  assert.deepEqual(parseQuickAdd('3 milk'), { title: 'milk', quantityText: '3' });
});

test('trailing wins over leading when both could match', () => {
  // "2 milk 6" reads as two-of-something rather than six, but the trailing
  // form is the one people type deliberately, so it takes precedence.
  assert.deepEqual(parseQuickAdd('2 milk 6'), { title: '2 milk', quantityText: '6' });
});

test('a number alone stays a title rather than becoming a bodiless quantity', () => {
  // Both trailing and leading patterns need a non-empty remainder, so "6"
  // cannot produce { title: '', quantityText: '6' } and vanish from the list.
  assert.deepEqual(parseQuickAdd('6'), { title: '6', quantityText: null });
  assert.deepEqual(parseQuickAdd('x2'), { title: 'x2', quantityText: null });
});

test('normalises whitespace', () => {
  assert.deepEqual(parseQuickAdd('  loo   roll  '), { title: 'loo roll', quantityText: null });
  assert.deepEqual(parseQuickAdd(''), { title: '', quantityText: null });
  assert.deepEqual(parseQuickAdd('   '), { title: '', quantityText: null });
});

test('does not mangle items that legitimately contain digits', () => {
  assert.deepEqual(parseQuickAdd('semi-skimmed 2%'), {
    title: 'semi-skimmed 2%',
    quantityText: null,
  });
  assert.deepEqual(parseQuickAdd('WD-40'), { title: 'WD-40', quantityText: null });
});
