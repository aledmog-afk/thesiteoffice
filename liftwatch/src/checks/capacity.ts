/**
 * Crane capacity check: total hook load against the rated capacity read from the
 * load chart for the crane's configuration at the planned radius.
 *
 * The hook load includes everything the crane lifts: the load, lifting accessories
 * (slings, shackles, spreader beam), and the hook block and hoist rope where the
 * chart does not already deduct them (CPA/TCIG 2507 Annex A; manufacturer's chart
 * notes say which). Reviews of rejected lift plans often find capacity not checked
 * against the actual configuration, or accessories left out.
 */

/**
 * Utilisation bands. These are company / contractor rules, not legal limits: many
 * contractors ask for extra justification above 75 % and treat 90 % as high. Change
 * them here to match your company's lifting procedure.
 */
export const CAPACITY_REVIEW_UTILISATION = 0.75;
export const CAPACITY_HIGH_UTILISATION = 0.9;

export type CapacityBand = 'ok' | 'review' | 'high' | 'over' | 'incomplete';

export interface CapacityInput {
  /** What is being lifted, e.g. "W12 at 24 m". */
  label: string;
  radiusM: number | null;
  /** Rated capacity from the load chart for this configuration and radius (kg). */
  chartCapacityKg: number | null;
  loadKg: number | null;
  accessoriesKg: number | null;
  /** Hook block and hoist rope, if the chart does not deduct them (kg). */
  hookBlockKg: number | null;
}

export interface CapacityResult {
  totalKg: number;
  utilisation: number;
  band: CapacityBand;
  message: string;
}

const n = (v: number | null) => (v === null || !Number.isFinite(v) ? Number.NaN : v);

export function capacityCheck(c: CapacityInput): CapacityResult {
  const cap = n(c.chartCapacityKg);
  const load = n(c.loadKg);
  const acc = c.accessoriesKg === null ? 0 : n(c.accessoriesKg);
  const hook = c.hookBlockKg === null ? 0 : n(c.hookBlockKg);
  if (!(cap > 0) || !(load > 0) || !(acc >= 0) || !(hook >= 0)) {
    return { totalKg: Number.NaN, utilisation: Number.NaN, band: 'incomplete', message: 'Enter the chart capacity and the load.' };
  }
  const totalKg = load + acc + hook;
  const utilisation = totalKg / cap;
  const pct = `${(utilisation * 100).toFixed(0)} %`;
  if (utilisation > 1) {
    return { totalKg, utilisation, band: 'over', message: `${pct} of rated capacity: over the chart. Not permitted.` };
  }
  if (utilisation > CAPACITY_HIGH_UTILISATION) {
    return { totalKg, utilisation, band: 'high', message: `${pct} of rated capacity: high utilisation. Check your company procedure.` };
  }
  if (utilisation > CAPACITY_REVIEW_UTILISATION) {
    return { totalKg, utilisation, band: 'review', message: `${pct} of rated capacity: above ${CAPACITY_REVIEW_UTILISATION * 100} %, justify in the plan.` };
  }
  return { totalKg, utilisation, band: 'ok', message: `${pct} of rated capacity.` };
}
