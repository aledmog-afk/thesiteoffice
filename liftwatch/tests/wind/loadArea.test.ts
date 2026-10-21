import { describe, expect, it } from 'vitest';
import { permittedWindSpeed, WindInputError } from '../../src/wind';

const cpaPanel = {
  loadLengthM: 3.6,
  loadHeightM: 2.4,
  dragCoefficient: 1.2,
  loadMassKg: 1300,
  riggingMassKg: 0,
  chartLimitMs: 17,
};

describe('permittedWindSpeed: CPA worked example', () => {
  const result = permittedWindSpeed(cpaPanel);

  it('projected area Ap = 3.6 × 2.4 = 8.64 m²', () => {
    expect(result.projectedAreaM2).toBeCloseTo(8.64, 6);
  });

  it('effective wind area Aw ≈ 10.37 m²', () => {
    expect(result.windAreaM2).toBeCloseTo(10.368, 3);
    expect(result.windAreaM2).toBeCloseTo(10.37, 2);
  });

  it('ratio r ≈ 7.98 m²/t', () => {
    expect(result.areaToMassRatio).toBeCloseTo(7.975, 3);
    expect(result.areaToMassRatio).toBeCloseTo(7.98, 2);
  });

  it('permitted ≈ 6.59 m/s (CPA quotes about 6.5)', () => {
    expect(result.permittedMs).toBeCloseTo(6.594, 3);
    expect(result.permittedMs).toBeGreaterThan(6.5);
    expect(result.permittedMs).toBeLessThan(6.6);
    expect(result.reduced).toBe(true);
  });

  it('records the reference ratio used', () => {
    expect(result.referenceRatio).toBe(1.2);
  });

  it('lists the working step by step', () => {
    expect(result.steps.length).toBeGreaterThanOrEqual(5);
    expect(result.steps.map((s) => s.label).join(' ')).toMatch(/Ap/);
  });
});

describe('permittedWindSpeed: compact loads', () => {
  it('returns the chart limit unchanged when r <= 1.2', () => {
    // 1 m × 1 m face, cw 1.2 → Aw 1.2 m², mass 2 t → r = 0.6
    const result = permittedWindSpeed({ ...cpaPanel, loadLengthM: 1, loadHeightM: 1, loadMassKg: 2000 });
    expect(result.areaToMassRatio).toBeCloseTo(0.6, 6);
    expect(result.permittedMs).toBe(17);
    expect(result.reduced).toBe(false);
  });

  it('returns the chart limit at exactly r = 1.2', () => {
    // Aw = 1 × 1 × 1.2 = 1.2 m², mass 1 t
    const result = permittedWindSpeed({ ...cpaPanel, loadLengthM: 1, loadHeightM: 1, loadMassKg: 1000 });
    expect(result.areaToMassRatio).toBeCloseTo(1.2, 9);
    expect(result.permittedMs).toBe(17);
  });

  it('never returns more than the chart limit', () => {
    for (const mass of [100, 500, 1000, 5000, 50000]) {
      const result = permittedWindSpeed({ ...cpaPanel, loadMassKg: mass });
      expect(result.permittedMs).toBeLessThanOrEqual(17);
    }
  });

  it('adds rigging mass to the load mass', () => {
    const result = permittedWindSpeed({ ...cpaPanel, loadMassKg: 1200, riggingMassKg: 100 });
    expect(result.totalMassT).toBeCloseTo(1.3, 9);
    expect(result.permittedMs).toBeCloseTo(6.594, 3);
  });

  it('accepts a different reference ratio', () => {
    const result = permittedWindSpeed({ ...cpaPanel, referenceRatio: 2.4 });
    expect(result.permittedMs).toBeCloseTo(17 * Math.sqrt(2.4 / 7.975384615), 6);
  });
});

describe('permittedWindSpeed: invalid inputs', () => {
  const cases: [string, Partial<typeof cpaPanel>, RegExp][] = [
    ['zero mass', { loadMassKg: 0 }, /mass/i],
    ['negative mass', { loadMassKg: -10 }, /mass/i],
    ['negative rigging mass', { riggingMassKg: -1 }, /rigging/i],
    ['zero length', { loadLengthM: 0 }, /length/i],
    ['negative height', { loadHeightM: -2.4 }, /height/i],
    ['zero drag coefficient', { dragCoefficient: 0 }, /drag/i],
    ['zero chart limit', { chartLimitMs: 0 }, /chart limit/i],
    ['negative chart limit', { chartLimitMs: -17 }, /chart limit/i],
    ['NaN mass', { loadMassKg: Number.NaN }, /mass/i],
    ['infinite limit', { chartLimitMs: Number.POSITIVE_INFINITY }, /chart limit/i],
  ];

  for (const [name, patch, message] of cases) {
    it(`throws a clear error for ${name}`, () => {
      expect(() => permittedWindSpeed({ ...cpaPanel, ...patch })).toThrow(WindInputError);
      expect(() => permittedWindSpeed({ ...cpaPanel, ...patch })).toThrow(message);
    });
  }

  it('rejects a zero reference ratio', () => {
    expect(() => permittedWindSpeed({ ...cpaPanel, referenceRatio: 0 })).toThrow(WindInputError);
  });
});
