/**
 * Method constants. Each one is cited in METHOD.md. Change METHOD_VERSION when
 * any of these change: it is stored in every decision record.
 */

export const METHOD_VERSION = 'LW-M1.3';

/**
 * Interim terrain rule (LW-M1.2). The town and city factors come from the
 * EN 1991-1-4 profile and have not yet been checked against the standard and the
 * UK National Annex by a qualified Appointed Person. Until they are, the factor
 * used is the highest of open country, town and city at that height, whatever
 * terrain is chosen. The chosen terrain is recorded for information only.
 * Set to true only after that review, and change METHOD_VERSION and METHOD.md.
 */
export const APPLY_CHOSEN_TERRAIN = false;

export interface FactorPoint {
  heightM: number;
  factor: number;
}

/**
 * Gust factors: 10 m gust → gust at height.
 * Source: Liebherr Table 2 factors as quoted in CPA/TCIG 2507 "Planning and Control
 * of Lifting Operations in Wind" (V1, July 2025), page 21. The roughness they assume
 * is not stated (see CPA Annex H).
 */
export const GUST_HEIGHT_FACTORS: readonly FactorPoint[] = Object.freeze([
  { heightM: 10, factor: 1.0 },
  { heightM: 50, factor: 1.181 },
  { heightM: 100, factor: 1.272 },
  { heightM: 150, factor: 1.329 },
]);

/**
 * Mean-to-gust factors: 10 m, 10-minute mean → gust at height.
 * Source: CPA/TCIG 2507 "Planning and Control of Lifting Operations in Wind"
 * (V1, July 2025), page 21.
 * The table has no 10 m value. Below 50 m the AP must supply one
 * (see MEAN_TO_GUST_10M_FACTOR).
 */
export const MEAN_TO_GUST_FACTORS: readonly FactorPoint[] = Object.freeze([
  { heightM: 50, factor: 1.653 },
  { heightM: 100, factor: 1.78 },
  { heightM: 150, factor: 1.861 },
]);

/**
 * Configured 10 m mean-to-gust factor. Deliberately unset: with no value the
 * method refuses below 50 m rather than guessing.
 */
export const MEAN_TO_GUST_10M_FACTOR: number | undefined = undefined;

/** Highest height the published factors cover (m). */
export const MAX_METHOD_HEIGHT_M = 150;

/**
 * Reference wind area to mass ratio assumed by mobile crane load charts:
 * 1.2 m² per tonne (1.0 m²/t × cw 1.2). Source: BS EN 13000:2010+A1:2014, as
 * quoted in CPA/TCIG 2507 pages 10–11.
 */
export const REFERENCE_AREA_RATIO = 1.2;

/**
 * Default drag (shape) coefficient for flat panels: 1.2, the value EN 13000 assumes
 * for a rectangular load (CPA page 10). Liebherr Table 1 gives 1.1 to 2.0 for a
 * plate / cube (CPA Annex A), so the AP can change it.
 */
export const DEFAULT_DRAG_COEFFICIENT = 1.2;

/**
 * Status thresholds on ratio = gust at height / permitted speed. The 0.80 band is
 * LiftWatch's own pilot choice, not from CPA or a standard.
 * Below NEAR → within; NEAR to OVER inclusive → near; above OVER → over.
 */
export const NEAR_LIMIT_RATIO = 0.8;
export const OVER_LIMIT_RATIO = 1.0;

/** Weather flag thresholds (see METHOD.md, "Flags"). LiftWatch's own pilot choices. */
export const FLAG_THRESHOLDS = Object.freeze({
  thunderstormCapeJkg: 500, // CAPE above this: thunderstorm risk
  possibleThunderCapeJkg: 100, // CAPE from this to 500 inclusive: possible thunder
  minVisibilityM: 5000, // visibility below this is flagged
  precipitationProbabilityPct: 70, // this or more is flagged
  frostTemperatureC: 1, // this or less is flagged
});

/** Minimum length of a planning period (hours). */
export const MIN_PERIOD_HOURS = 2;
