import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lint, ruleIds } from '../src/index.js';

const fires = (rule: string, text: string) => {
  const found = lint(text).findings;
  assert.ok(
    found.some((f) => f.rule === rule),
    `expected ${rule} on "${text}", got ${found.length ? found.map((f) => `${f.rule}: ${f.message}`).join(' | ') : 'nothing'}`,
  );
  return found.find((f) => f.rule === rule)!;
};
const silent = (text: string) => {
  const found = lint(text).findings;
  assert.equal(found.length, 0, `expected silence on "${text}", got ${found.map((f) => `${f.rule}: ${f.message}`).join(' | ')}`);
};

test('unit-conversion', () => {
  const f = fires('unit-conversion', 'The bridge is 5 miles (8.5 km) long.');
  assert.equal(f.span.text, '8.5 km');
  assert.match(f.message, /8\.047 km/);
  silent('The bridge is 5 miles (8 km) long.');
  silent('The marathon is 26.2 miles (42.2 km) long.');
});

test('percent-of-base', () => {
  fires('percent-of-base', 'Some 45 of the 200 respondents (25%) agreed.');
  silent('Some 45 of the 200 respondents (23%) agreed.');
});

test('percent-change and its direction', () => {
  fires('percent-change', 'Revenue rose from $4.5m to $6.2m, a 33% increase.');
  fires('percent-change', 'Emissions grew from 90 tonnes to 60 tonnes, a 33% increase.');
  silent('Revenue rose from $4.5m to $6.2m, a 38% increase.');
});

test('percentage-point confusion', () => {
  const f = fires('percentage-point-confusion', 'The margin fell from 12% to 9%, a 3% drop.');
  assert.equal(f.severity, 'warning');
  assert.match(f.message, /percentage points/);
  silent('The margin fell from 12% to 9%, a drop of 3 percentage points.');
  silent('The margin fell from 12% to 9%, a 25% drop.');
});

test('sum-of-parts requires an explicit total', () => {
  fires('sum-of-parts', 'Sales were 120 north, 340 south and 90 west, a total of 650 units.');
  silent('Sales were 120 north, 340 south and 90 west, a total of 550 units.');
  silent('Sales were 120 north, 340 south and 90 west.');
});

test('percent-sum only fires above 100', () => {
  fires('percent-sum', 'Support was 41% for A, 38% for B and 26% for C.');
  silent('Support was 41% for A, 33% for B and 27% for C.');
  silent('Respondents could pick more than one: 60% email, 55% phone and 40% post.');
});

test('impossible-percentage (GRIM for shares)', () => {
  const f = fires('impossible-percentage', 'In the trial, 40% of the 7 patients improved.');
  assert.match(f.workings, /multiple of/);
  silent('In the trial, 27% of the 15 patients improved.');
});

test('grim-mean needs the integer-item signal', () => {
  fires('grim-mean', 'Items were scored on a Likert scale. The mean was 3.47 (n = 20).');
  silent('The mean temperature was 3.47 degrees across 20 sites.');
});

test('weekday-date', () => {
  fires('weekday-date', 'It closes on Tuesday, 5 March 2026.');
  fires('weekday-date', 'It closes on Friday, 31 February 2027.');
  silent('It closes on Thursday, 5 March 2026.');
});

test('date-span and age', () => {
  fires('date-span', 'The cohort ran from 1990 to 2015, a 30-year period.');
  silent('The cohort ran from 1990 to 2015, a 25-year period.');
  fires('age-arithmetic', 'Born in 1943, she died in 1999 at the age of 45.');
  silent('Born in 1943, she died in 1999 at the age of 55.');
});

test('per-unit averages and unit prices', () => {
  fires('per-unit', 'The council spent £4.2m across 12 boroughs, an average of £420,000 each.');
  silent('The council spent £4.2m across 12 boroughs, an average of £350,000 each.');
  fires('per-unit', 'It bought 1,200 units at $50 each, for a total of $54,000.');
});

test('scale-slip', () => {
  fires('scale-slip', 'The Halton contract is worth $4.2 billion.\n\nThe $4.2 million contract completes in 2031.');
  silent('Group revenue was 6.5 mln dlrs.\n\nThat compares with 6.5 bln dlrs for the whole sector.');
});

test('table-sum', () => {
  fires('table-sum', '| Region | Units |\n| --- | --- |\n| North | 120 |\n| South | 340 |\n| Total | 500 |');
  silent('| Region | Units |\n| --- | --- |\n| North | 120 |\n| South | 340 |\n| Total | 460 |');
});

test('ratio, part-exceeds-whole, currency-rate', () => {
  fires('ratio-percent', 'One in five households, or 25%, missed a payment.');
  silent('One in five households, or 20%, missed a payment.');
  fires('part-exceeds-whole', 'The trust drew £25m of the £20m allocated.');
  fires('currency-rate', 'The fine was €5m ($6.4m, at $1.08 to the euro).');
  silent('The fine was €5m ($5.4m, at $1.08 to the euro).');
});

test('every rule id is documented', () => {
  const ids = ruleIds();
  assert.ok(ids.includes('percentage-point-confusion'));
  assert.ok(ids.includes('scale-slip'));
  assert.equal(new Set(ids).size, ids.length, 'rule ids are unique');
});
