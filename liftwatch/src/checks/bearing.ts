/**
 * Outrigger mat bearing pressure: the simple check of the pressure under a mat
 * against the allowable bearing pressure from the ground assessment.
 *
 *   pressure = (outrigger load + mat weight) ÷ mat area
 *
 * This assumes the mat spreads the load evenly over its whole area, which needs a
 * mat stiff enough for the outrigger float. Flexible or timber mats may not, and
 * the allowable pressure must come from a ground assessment or temporary works
 * design (CPA, "Ground conditions for construction plant", 2014). The maximum
 * outrigger load must come from the crane manufacturer's planning software or
 * tables for the configuration, slew and radius.
 */

export const GRAVITY = 9.81; // m/s², tonnes-force to kN

export interface BearingInput {
  /** Maximum outrigger load for the lift. */
  outriggerLoad: number | null;
  outriggerUnit: 't' | 'kN';
  matLengthM: number | null;
  matWidthM: number | null;
  /** Mat mass (kg). Optional. */
  matMassKg: number | null;
  /** Allowable bearing pressure from the ground assessment (kN/m²). */
  allowableKpa: number | null;
}

export interface BearingResult {
  ok: boolean;
  incomplete: boolean;
  pressureKpa: number;
  utilisation: number;
  /** Smallest mat area that keeps within the allowable pressure, ignoring mat weight (m²). */
  minAreaM2: number;
  message: string;
}

const pos = (v: number | null): v is number => v !== null && Number.isFinite(v) && v > 0;

export function bearingCheck(b: BearingInput): BearingResult {
  if (!pos(b.outriggerLoad) || !pos(b.matLengthM) || !pos(b.matWidthM) || !pos(b.allowableKpa)) {
    return {
      ok: false,
      incomplete: true,
      pressureKpa: Number.NaN,
      utilisation: Number.NaN,
      minAreaM2: Number.NaN,
      message: 'Enter the outrigger load, mat size and allowable bearing pressure.',
    };
  }
  const forceKn = b.outriggerUnit === 't' ? b.outriggerLoad * GRAVITY : b.outriggerLoad;
  const matKn = pos(b.matMassKg) ? (b.matMassKg / 1000) * GRAVITY : 0;
  const area = b.matLengthM * b.matWidthM;
  const pressureKpa = (forceKn + matKn) / area;
  const utilisation = pressureKpa / b.allowableKpa;
  const minAreaM2 = forceKn / b.allowableKpa;
  const ok = utilisation <= 1;
  return {
    ok,
    incomplete: false,
    pressureKpa,
    utilisation,
    minAreaM2,
    message: ok
      ? `${pressureKpa.toFixed(0)} kN/m² under the mat, ${(utilisation * 100).toFixed(0)} % of the allowable ${b.allowableKpa} kN/m².`
      : `${pressureKpa.toFixed(0)} kN/m² under the mat is over the allowable ${b.allowableKpa} kN/m². A mat of at least ${minAreaM2.toFixed(2)} m² is needed, or improve the ground.`,
  };
}
