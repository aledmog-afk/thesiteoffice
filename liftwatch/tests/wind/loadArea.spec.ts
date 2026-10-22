import { describe, expect, it } from 'vitest';
import { permittedWindSpeed, WindInputError } from '../../src/wind';

// LiftWatch's own example: a typical timber frame wall panel. It is not taken from
// the CPA guide; the guide's own worked examples are tested further down.
const panel = {
  loadLengthM: 3.6,
  loadHeightM: 2.4,
  dragCoefficient: 1.2,
  loadMassKg: 1300,
  riggingMassKg: 0,
  chartLimitMs: 17,
};

describe('permittedWindSpeed: LiftWatch panel example (3.6 × 2.4 m, 1,300 kg, 17 m/s)', () => {
  const result = permittedWindSpeed(panel);

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

  it('permitted ≈ 6.59 m/s', () => {
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

/**
 * Worked examples printed in CPA/TCIG 2507 "Planning and Control of Lifting Operations
 * in Wind" (V1, July 2025). The guide rounds to 1 decimal place, so each result must
 * be within 0.05 m/s of the printed figure. Annex E lists Aw (= Ap × 1.2); the face
 * sizes here give the same Aw.
 */
describe('permittedWindSpeed: CPA guide worked examples', () => {
  const cases: [string, number, number, number, number, number][] = [
    // [example, length m, height m, mass kg, chart limit m/s, CPA's printed answer m/s]
    ['Annex E Fig 15, shutter 2.4 × 6.6 m, 2.392 t, mobile 11 m/s', 2.4, 6.6, 2392, 11, 4.3],
    ['Annex E Fig 15, shutter 4.8 × 6.6 m, 4.803 t, mobile 11 m/s', 4.8, 6.6, 4803, 11, 4.3],
    ['Annex E Fig 15, shutter 6.45 × 6.6 m, 6.786 t, mobile 11 m/s', 6.45, 6.6, 6786, 11, 4.4],
    ['Annex E Fig 15, shutter 7.2 × 6.6 m, 7.215 t, mobile 11 m/s', 7.2, 6.6, 7215, 11, 4.3],
    ['Annex E Fig 15, shutter 0.8 × 3.3 m, 0.4 t, mobile 11 m/s', 0.8, 3.3, 400, 11, 4.3],
    ['Annex E Fig 15, pack of ply 2.4 × 0.7 m, 0.9 t, mobile 11 m/s', 2.4, 0.7, 900, 11, 8.1],
    ['Annex E Fig 15, person basket 1.45 × 1.1 m, 0.64 t, mobile 11 m/s', 1.45, 1.1, 640, 11, 7.0],
    ['Annex E Fig 14, shutter 2.4 × 6.6 m, 2.392 t, tower 17 m/s', 2.4, 6.6, 2392, 17, 6.6],
    ['Annex E Fig 14, shutter 6.45 × 6.6 m, 6.786 t, tower 17 m/s', 6.45, 6.6, 6786, 17, 6.8],
    ['Annex E Fig 14, pack of ply 2.4 × 0.7 m, 0.9 t, tower 17 m/s', 2.4, 0.7, 900, 17, 12.4],
    ['Annex E Fig 14, person basket 1.45 × 1.1 m, 0.64 t, tower 17 m/s', 1.45, 1.1, 640, 17, 10.8],
  ];
  for (const [name, length, height, kg, chart, printed] of cases) {
    it(name, () => {
      const r = permittedWindSpeed({ loadLengthM: length, loadHeightM: height, loadMassKg: kg, chartLimitMs: chart });
      expect(Math.abs(r.permittedMs - printed)).toBeLessThanOrEqual(0.05 + 1e-9);
    });
  }

  it('section 4.3 insulation pack: 2.2 m/s (the guide prints 2.1, a rounding slip)', () => {
    // 1.2 × 2.4 m face, cw 1.2, 113 kg, crane limit 11.1 m/s. The guide shows
    // 11.1 × 0.198 = 2.1, but 11.1 × 0.198 = 2.198. Its "80 % reduction" matches 2.2.
    const r = permittedWindSpeed({ loadLengthM: 1.2, loadHeightM: 2.4, loadMassKg: 113, chartLimitMs: 11.1 });
    expect(r.windAreaM2).toBeCloseTo(3.456, 9);
    expect(r.permittedMs).toBeCloseTo(2.2, 2);
    expect(1 - r.permittedMs / 11.1).toBeCloseTo(0.8, 2);
  });

  it('section 4.3: a 3 t load with cw 1.2 may have up to 3 m² face before any reduction', () => {
    const r = permittedWindSpeed({ loadLengthM: 1.5, loadHeightM: 2, loadMassKg: 3000, chartLimitMs: 12 });
    expect(r.areaToMassRatio).toBeCloseTo(1.2, 9);
    expect(r.permittedMs).toBe(12);
    expect(permittedWindSpeed({ loadLengthM: 1.5, loadHeightM: 2.01, loadMassKg: 3000, chartLimitMs: 12 }).reduced).toBe(true);
  });
});

describe('permittedWindSpeed: compact loads', () => {
  it('returns the chart limit unchanged when r <= 1.2', () => {
    // 1 m × 1 m face, cw 1.2 → Aw 1.2 m², mass 2 t → r = 0.6
    const result = permittedWindSpeed({ ...panel, loadLengthM: 1, loadHeightM: 1, loadMassKg: 2000 });
    expect(result.areaToMassRatio).toBeCloseTo(0.6, 6);
    expect(result.permittedMs).toBe(17);
    expect(result.reduced).toBe(false);
  });

  it('returns the chart limit at exactly r = 1.2', () => {
    // Aw = 1 × 1 × 1.2 = 1.2 m², mass 1 t
    const result = permittedWindSpeed({ ...panel, loadLengthM: 1, loadHeightM: 1, loadMassKg: 1000 });
    expect(result.areaToMassRatio).toBeCloseTo(1.2, 9);
    expect(result.permittedMs).toBe(17);
  });

  it('never returns more than the chart limit', () => {
    for (const mass of [100, 500, 1000, 5000, 50000]) {
      const result = permittedWindSpeed({ ...panel, loadMassKg: mass });
      expect(result.permittedMs).toBeLessThanOrEqual(17);
    }
  });

  it('adds rigging mass to the load mass', () => {
    const result = permittedWindSpeed({ ...panel, loadMassKg: 1200, riggingMassKg: 100 });
    expect(result.totalMassT).toBeCloseTo(1.3, 9);
    expect(result.permittedMs).toBeCloseTo(6.594, 3);
  });

  it('accepts a different reference ratio', () => {
    const result = permittedWindSpeed({ ...panel, referenceRatio: 2.4 });
    expect(result.permittedMs).toBeCloseTo(17 * Math.sqrt(2.4 / 7.975384615), 6);
  });
});

describe('permittedWindSpeed: invalid inputs', () => {
  const cases: [string, Partial<typeof panel>, RegExp][] = [
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
      expect(() => permittedWindSpeed({ ...panel, ...patch })).toThrow(WindInputError);
      expect(() => permittedWindSpeed({ ...panel, ...patch })).toThrow(message);
    });
  }

  it('rejects a zero reference ratio', () => {
    expect(() => permittedWindSpeed({ ...panel, referenceRatio: 0 })).toThrow(WindInputError);
  });
});
