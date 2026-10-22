/**
 * Multi-leg sling check by the uniform load method used for chain, wire rope and
 * textile slings (BS EN 818-4, BS EN 13414-1, BS EN 1492-1; LEEA Code of Practice
 * for the Safe Use of Lifting Equipment, "Rating for various modes of use").
 *
 * The WLL of a multi-leg sling = WLL of one leg × mode factor M:
 *
 *   legs     β ≤ 45°    45° < β ≤ 60°    β > 60°
 *   1        1.0        –                –
 *   2        1.4        1.0              not permitted
 *   3 or 4   2.1        1.5              not permitted
 *
 * β is the angle of each leg to the vertical. With the hook centred over the load,
 * sin β = horizontal distance from below the hook to the lifting point ÷ leg length.
 */

export type SlingLegs = 1 | 2 | 3 | 4;

export interface SlingInput {
  legs: SlingLegs;
  /** Leg length, hook to lifting point (m). */
  legLengthM: number | null;
  /**
   * Horizontal distance between lifting points (m): for 2 legs the spacing; for
   * 4 legs at the corners of a rectangle, the diagonal; for 3 legs, the spacing of
   * an equilateral triangle.
   */
  spreadM: number | null;
  /** Total load on the hook below the master link (kg): load + spreader etc. */
  loadKg: number | null;
  /** WLL of a single leg in a straight pull, as marked or certified (kg). Optional. */
  singleLegWllKg: number | null;
}

export interface SlingResult {
  ok: boolean;
  incomplete: boolean;
  angleDeg: number;
  modeFactor: number;
  /** Minimum single-leg WLL needed for this load (kg). */
  requiredSingleLegWllKg: number;
  /** Tension in each leg if the legs share the load equally (kg-force). For information. */
  equalShareLegLoadKg: number;
  message: string;
}

const pos = (v: number | null): v is number => v !== null && Number.isFinite(v) && v > 0;

/** Horizontal distance from below the hook to each lifting point. */
export function hookToPointDistance(legs: SlingLegs, spreadM: number): number {
  if (legs === 1) return 0;
  if (legs === 3) return spreadM / Math.sqrt(3); // circumradius of an equilateral triangle
  return spreadM / 2; // 2 legs: half the spacing; 4 legs: half the diagonal
}

export function modeFactor(legs: SlingLegs, angleDeg: number): number | null {
  if (legs === 1) return 1;
  if (angleDeg > 60 + 1e-9) return null;
  const steep = angleDeg <= 45 + 1e-9;
  if (legs === 2) return steep ? 1.4 : 1.0;
  return steep ? 2.1 : 1.5;
}

export function slingCheck(s: SlingInput): SlingResult {
  const blank: SlingResult = {
    ok: false,
    incomplete: true,
    angleDeg: Number.NaN,
    modeFactor: Number.NaN,
    requiredSingleLegWllKg: Number.NaN,
    equalShareLegLoadKg: Number.NaN,
    message: 'Enter the legs, leg length, spread and load.',
  };
  if (!pos(s.loadKg) || !pos(s.legLengthM) || (s.legs !== 1 && !pos(s.spreadM))) return blank;
  const d = s.legs === 1 ? 0 : hookToPointDistance(s.legs, s.spreadM as number);
  if (d >= s.legLengthM) {
    return { ...blank, incomplete: false, message: 'The legs are too short to reach the lifting points from one hook.' };
  }
  const angleDeg = (Math.asin(d / s.legLengthM) * 180) / Math.PI;
  const m = modeFactor(s.legs, angleDeg);
  const equalShareLegLoadKg = s.loadKg / (s.legs * Math.cos((angleDeg * Math.PI) / 180));
  if (m === null) {
    return {
      ...blank,
      incomplete: false,
      angleDeg,
      equalShareLegLoadKg,
      message: `Leg angle ${angleDeg.toFixed(0)}° to the vertical is over 60° (more than 120° between legs). Not permitted: use longer legs or a spreader beam.`,
    };
  }
  const required = s.loadKg / m;
  const band = s.legs === 1 ? 'straight pull' : angleDeg <= 45 ? '0–45° band' : '45–60° band';
  if (pos(s.singleLegWllKg) && s.singleLegWllKg < required - 1e-9) {
    return {
      ok: false,
      incomplete: false,
      angleDeg,
      modeFactor: m,
      requiredSingleLegWllKg: required,
      equalShareLegLoadKg,
      message: `Sling too small: each leg needs a WLL of at least ${Math.ceil(required)} kg (${band}, factor ${m}); marked ${s.singleLegWllKg} kg.`,
    };
  }
  return {
    ok: true,
    incomplete: false,
    angleDeg,
    modeFactor: m,
    requiredSingleLegWllKg: required,
    equalShareLegLoadKg,
    message: `Leg angle ${angleDeg.toFixed(0)}° (${band}), mode factor ${m}: each leg needs a WLL of at least ${Math.ceil(required)} kg${pos(s.singleLegWllKg) ? ` (marked ${s.singleLegWllKg} kg)` : ''}.`,
  };
}
