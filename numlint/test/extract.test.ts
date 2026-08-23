import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractQuantities } from '../src/extract/quantity.js';

const q = (text: string) => extractQuantities(text).quantities;
const one = (text: string) => {
  const qs = q(text);
  assert.equal(qs.length, 1, `expected exactly one quantity in "${text}", got ${qs.map((x) => x.span.text).join(' | ')}`);
  return qs[0]!;
};

test('digit forms', () => {
  assert.equal(one('It cost 1,234,567 dollars.').value, 1234567);
  assert.equal(one('It weighs 0.5 kg.').value, 0.5);
  assert.equal(one('Around .75 of the sample.').value, 0.75);
  assert.equal(one('The rate is 3-1/2 pct.').value, 3.5);
  assert.equal(one('It is 1½ times longer.').value, 1.5);
});

test('scale words', () => {
  assert.equal(one('Revenue was $4.2 billion.').value, 4.2e9);
  assert.equal(one('Revenue was $4.2bn.').value, 4.2e9);
  assert.equal(one('It reached 300k downloads.').value, 300000);
  assert.equal(one('Profit was 6.5 mln dlrs.').value, 6.5e6);
  assert.equal(one('The city has 12 lakh residents.').value, 1.2e6);
});

test('spelled numbers', () => {
  assert.equal(one('Twenty-seven people attended.').value, 27);
  assert.equal(one('Two thirds of voters agreed.').value, 2 / 3);
  assert.equal(one('A million users signed up.').value, 1e6);
  assert.equal(q('Millions of users signed up.').length, 0, '"millions of" is not a number');
  assert.equal(q('No one attended.').length, 0, '"one" as a pronoun is not a number');
});

test('units and dimensions', () => {
  assert.equal(one('It is 8 km long.').unit?.def.id, 'kilometre');
  assert.equal(one('It is 8km long.').unit?.def.id, 'kilometre');
  assert.equal(one('It hit 72F yesterday.').unit?.def.id, 'fahrenheit');
  assert.equal(one('Speeds of 155 mph were recorded.').unit?.def.id, 'mile-per-hour');
  assert.equal(q('The 5G network launched.').length, 1, '5G is not 5 grams');
  assert.equal(q('The 5G network launched.')[0]!.unit, undefined);
});

test('currency', () => {
  assert.equal(one('It cost $5m.').currency, 'USD');
  assert.equal(one('It cost £5m.').currency, 'GBP');
  assert.equal(one('It cost C$5m.').currency, 'CAD');
  assert.equal(one('It cost 5 million euros.').currency, 'EUR');
  assert.equal(one('It cost $5m.').span.text, '$5m', 'the symbol belongs to the span');
});

test('hedges set the tolerance', () => {
  assert.equal(one('About 500 people came.').hedge, 'about');
  assert.equal(one('More than 500 people came.').hedge, 'over');
  assert.equal(one('Fewer than 500 people came.').hedge, 'under');
  assert.equal(one('Nearly 500 people came.').hedge, 'nearly');
  assert.equal(one('Over the past 500 years.').hedge, 'exact', '"over the past" is not a bound');
});

test('ranges and compounds', () => {
  const r = one('Between 5 and 10 million users were affected.');
  assert.equal(r.hedge, 'range');
  assert.equal(r.value, 5e6);
  assert.equal(r.valueHigh, 1e7);
  assert.equal(one('He is 6 ft 2 in tall.').value, 6 + 2 / 12);
  assert.equal(one('It took 2 hours 30 minutes.').value, 2.5);
});

test('years, dates and identifiers are not counts', () => {
  assert.equal(q('It happened in 1999.')[0]!.kind, 'year');
  assert.equal(q('Released on 2026-03-05 at 14:30.').length, 0);
  assert.equal(q('See version 2.1.3 for details.').length, 0);
  assert.equal(q('The month ended January 31 was strong.').length, 0);
  assert.equal(q('Output hit 129% of the 1947-49 average.').length, 1);
});

test('precision drives the rounding interval', () => {
  assert.equal(one('It is 8 km.').quantum, 0.5);
  assert.equal(one('It is 8.5 km.').quantum, 0.05);
  assert.equal(one('It is 1.2 million.').quantum, 50000);
});

test('ratios', () => {
  const r = q('One in five households reported a problem.')[0]!;
  assert.deepEqual(r.ratio, { num: 1, den: 5 });
});
