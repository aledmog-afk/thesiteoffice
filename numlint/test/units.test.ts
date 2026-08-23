import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convert, lookupUnit, sameDimension, reciprocalDimension, UNITS } from '../src/units.js';

const c = (v: number, from: string, to: string) => {
  const f = lookupUnit(from)!;
  const t = lookupUnit(to)!;
  assert.ok(f && t, `${from} -> ${to}`);
  return convert(v, f, t)!;
};
const close = (a: number, b: number, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≈ ${b}`);

test('length, mass, volume', () => {
  close(c(1, 'miles', 'km'), 1.609344);
  close(c(1, 'inches', 'cm'), 2.54);
  close(c(1, 'pounds', 'kg'), 0.45359237);
  close(c(1, 'gallons', 'litres'), 3.785411784);
  close(c(1, 'acres', 'hectares'), 0.40468564224);
});

test('temperature uses offsets', () => {
  close(c(0, '°C', '°F'), 32);
  close(c(100, '°C', '°F'), 212);
  close(c(-40, '°F', '°C'), -40);
  close(c(0, '°C', 'K'), 273.15);
});

test('fuel economy is reciprocal, not proportional', () => {
  const mpg = lookupUnit('mpg')!;
  const l100 = lookupUnit('L/100km')!;
  assert.ok(reciprocalDimension(mpg.dim, l100.dim));
  close(c(30, 'mpg', 'L/100km'), 7.8404, 1e-3);
  close(c(7.84, 'L/100km', 'mpg'), 30.0, 1e-2);
});

test('incommensurable units do not convert', () => {
  assert.equal(convert(1, lookupUnit('kg')!, lookupUnit('km')!), undefined);
  assert.ok(!sameDimension(lookupUnit('kg')!.dim, lookupUnit('km')!.dim));
});

test('every unit definition is well formed', () => {
  for (const u of UNITS) {
    assert.ok(u.factor > 0, `${u.id} has a positive factor`);
    assert.ok(u.forms.length > 0, `${u.id} has surface forms`);
    assert.ok(Object.keys(u.dim).length > 0, `${u.id} has a dimension`);
  }
});
