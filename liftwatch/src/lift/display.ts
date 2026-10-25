import { APPLY_CHOSEN_TERRAIN, NEAR_LIMIT_RATIO, OVER_LIMIT_RATIO, STATUS_LABEL, TERRAIN, TERRAIN_NOT_APPLIED, type Status, type Terrain } from '../wind';

const NEAR_PCT = NEAR_LIMIT_RATIO * 100;
const OVER_PCT = OVER_LIMIT_RATIO * 100;

/**
 * "% of limit" text that never contradicts the status next to it. Whole numbers
 * normally. Near a threshold, one decimal place. If even that would round onto
 * the threshold (79.96 → "80.0" while below the permitted speed), "< 80 %" or "> 100 %".
 */
export function percentLabel(percent: number | null | undefined, status: Status): string {
  if (percent === null || percent === undefined || !Number.isFinite(percent)) return '–';
  const whole = Math.round(percent);
  if (status === 'within' && whole >= NEAR_PCT) {
    return Number(percent.toFixed(1)) < NEAR_PCT ? `${percent.toFixed(1)} %` : `< ${NEAR_PCT} %`;
  }
  if (status === 'over' && whole <= OVER_PCT) {
    return Number(percent.toFixed(1)) > OVER_PCT ? `${percent.toFixed(1)} %` : `> ${OVER_PCT} %`;
  }
  return `${whole} %`;
}

/**
 * Status with its percentage, as shown on the banner:
 * "Below permitted speed (62 % of limit)", "Near permitted speed (85 %)",
 * "Above permitted speed (112 %)".
 */
export function statusText(status: Status, percent?: number | null): string {
  if (status === 'no-data' || percent === null || percent === undefined || !Number.isFinite(percent)) return STATUS_LABEL[status];
  const p = percentLabel(percent, status);
  return status === 'within' ? `${STATUS_LABEL[status]} (${p} of limit)` : `${STATUS_LABEL[status]} (${p})`;
}

/**
 * True when the record's terrain choice set the height factor. LW-M1.1 applied it;
 * LW-M1.2 (interim rule) did not; anything else follows `APPLY_CHOSEN_TERRAIN`,
 * which is only switched on together with a new METHOD_VERSION. No method version
 * means a live assessment.
 */
export function terrainWasApplied(methodVersion?: string): boolean {
  if (methodVersion === 'LW-M1.1') return true;
  if (methodVersion === 'LW-M1.2') return false;
  return APPLY_CHOSEN_TERRAIN;
}

/**
 * The chosen terrain as text. Under the interim rule (LW-M1.2) it is
 * "Town: for information, not yet applied (pending AP review)".
 * Records saved before method LW-M1.1 have no terrain: they used the open-country factors.
 */
export function terrainText(terrain: Terrain | undefined, methodVersion?: string): string {
  const t = TERRAIN[terrain ?? 'open'];
  if (!terrainWasApplied(methodVersion) && terrain) return `${t.label}: ${TERRAIN_NOT_APPLIED}`;
  return terrain === 'open' || !terrain ? `${t.label} (published Liebherr factors)` : `${t.label} (EN 1991-1-4 category ${t.category})`;
}

/** Where the height factor came from, e.g. "highest of open country, town and city (interim rule, city factor)". */
export function heightFactorSource(terrain: Terrain | undefined, factorFrom: Terrain, methodVersion?: string): string {
  if (terrainWasApplied(methodVersion) || !terrain) return terrainText(terrain, methodVersion).toLowerCase();
  return `highest of open country, town and city (interim rule, ${TERRAIN[factorFrom].label.toLowerCase()} factor)`;
}
