import { DEFAULT_DRAG_COEFFICIENT, REFERENCE_AREA_RATIO } from './constants';
import { requireNonNegative, requirePositive } from './errors';

export interface LoadWindInput {
  /** Length of the face presented to the wind (m). */
  loadLengthM: number;
  /** Height of the face presented to the wind (m). */
  loadHeightM: number;
  /** Drag (shape) coefficient cw. Default 1.2 for flat panels. */
  dragCoefficient?: number;
  /** Load mass (kg). */
  loadMassKg: number;
  /** Rigging mass (kg), added to the load mass. */
  riggingMassKg?: number;
  /** In-service wind limit from the crane load chart, as a 3 s gust (m/s). */
  chartLimitMs: number;
  /** Reference area-to-mass ratio r0 (m²/t). Default 1.2 (BS EN 13000). */
  referenceRatio?: number;
}

export interface WorkingStep {
  label: string;
  formula: string;
  value: number;
  unit: string;
}

export interface LoadWindResult {
  projectedAreaM2: number;
  dragCoefficient: number;
  windAreaM2: number;
  totalMassT: number;
  areaToMassRatio: number;
  referenceRatio: number;
  reduced: boolean;
  chartLimitMs: number;
  permittedMs: number;
  steps: WorkingStep[];
}

/**
 * Permitted wind speed for a load with a large wind area.
 *
 * Method: BS EN 13000 assumption (load charts assume Aw / m = 1.2 m²/t) applied as
 * in BS 7121-1 Annex D, with the CPA/TCIG (July 2025) worked example as a check.
 * See METHOD.md, step 3.
 *
 *   Ap = length × height                     projected area (m²)
 *   Aw = Ap × cw                             effective wind area (m²)
 *   m  = (load mass + rigging mass) / 1000   (t)
 *   r  = Aw / m                              (m²/t)
 *   r ≤ r0 → v_perm = v_chart
 *   r > r0 → v_perm = v_chart × √(r0 / r)
 *
 * The square root comes from wind force ∝ v² × Aw: holding the force at the
 * chart's design value gives v_perm² × Aw = v_chart² × r0 × m.
 * The result is never above the chart limit.
 */
export function permittedWindSpeed(input: LoadWindInput): LoadWindResult {
  const cw = input.dragCoefficient ?? DEFAULT_DRAG_COEFFICIENT;
  const rigging = input.riggingMassKg ?? 0;
  const r0 = input.referenceRatio ?? REFERENCE_AREA_RATIO;

  requirePositive(input.loadLengthM, 'Load length');
  requirePositive(input.loadHeightM, 'Load height');
  requirePositive(cw, 'Drag coefficient');
  requirePositive(input.loadMassKg, 'Load mass');
  requireNonNegative(rigging, 'Rigging mass');
  requirePositive(input.chartLimitMs, 'Crane chart limit');
  requirePositive(r0, 'Reference area-to-mass ratio');

  const projectedAreaM2 = input.loadLengthM * input.loadHeightM;
  const windAreaM2 = projectedAreaM2 * cw;
  const totalMassT = (input.loadMassKg + rigging) / 1000;
  const areaToMassRatio = windAreaM2 / totalMassT;
  const reduced = areaToMassRatio > r0;
  const permittedMs = reduced
    ? Math.min(input.chartLimitMs, input.chartLimitMs * Math.sqrt(r0 / areaToMassRatio))
    : input.chartLimitMs;

  const steps: WorkingStep[] = [
    {
      label: 'Projected area Ap',
      formula: `${fmt(input.loadLengthM)} m × ${fmt(input.loadHeightM)} m`,
      value: projectedAreaM2,
      unit: 'm²',
    },
    { label: 'Effective wind area Aw', formula: `Ap × cw = ${fmt(projectedAreaM2)} × ${fmt(cw)}`, value: windAreaM2, unit: 'm²' },
    {
      label: 'Total mass m',
      formula: `(${fmt(input.loadMassKg)} kg + ${fmt(rigging)} kg rigging) ÷ 1000`,
      value: totalMassT,
      unit: 't',
    },
    { label: 'Ratio r', formula: `Aw ÷ m = ${fmt(windAreaM2)} ÷ ${fmt(totalMassT)}`, value: areaToMassRatio, unit: 'm²/t' },
    reduced
      ? {
          label: 'Permitted wind speed',
          formula: `r > r0 (${fmt(r0)}): ${fmt(input.chartLimitMs)} × √(${fmt(r0)} ÷ ${fmt(areaToMassRatio)})`,
          value: permittedMs,
          unit: 'm/s',
        }
      : {
          label: 'Permitted wind speed',
          formula: `r ≤ r0 (${fmt(r0)}): chart limit unchanged`,
          value: permittedMs,
          unit: 'm/s',
        },
  ];

  return {
    projectedAreaM2,
    dragCoefficient: cw,
    windAreaM2,
    totalMassT,
    areaToMassRatio,
    referenceRatio: r0,
    reduced,
    chartLimitMs: input.chartLimitMs,
    permittedMs,
    steps,
  };
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}
