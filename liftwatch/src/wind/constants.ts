/**
 * Method constants. Each one is cited in METHOD.md. Change METHOD_VERSION when
 * any of these change: it is stored in every decision record.
 */

export const METHOD_VERSION = 'LW-M1.0';

export interface FactorPoint {
  heightM: number;
  factor: number;
}

/**
 * Gust factors: 10 m gust → gust at height.
 * Source: Liebherr factors as quoted in CPA/TCIG "Planning and Control of Lifting
 * Operations in Wind" (July 2025).
 */
export const GUST_HEIGHT_FACTORS: readonly FactorPoint[] = Object.freeze([
  { heightM: 10, factor: 1.0 },
  { heightM: 50, factor: 1.181 },
  { heightM: 100, factor: 1.272 },
  { heightM: 150, factor: 1.329 },
]);

/**
 * Mean-to-gust factors: 10 m, 10-minute mean → gust at height.
 * Source: CPA/TCIG "Planning and Control of Lifting Operations in Wind" (July 2025).
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
 * 1.2 m² per tonne. Source: BS EN 13000.
 */
export const REFERENCE_AREA_RATIO = 1.2;

/** Default drag (shape) coefficient for flat panels: 1.2. Source: BS EN 13000 / CPA. */
export const DEFAULT_DRAG_COEFFICIENT = 1.2;

/**
 * Status thresholds on ratio = gust at height / permitted speed.
 * Below NEAR → within; NEAR to OVER inclusive → near; above OVER → over.
 */
export const NEAR_LIMIT_RATIO = 0.8;
export const OVER_LIMIT_RATIO = 1.0;

/** Weather flag thresholds (see METHOD.md, "Flags"). */
export const FLAG_THRESHOLDS = Object.freeze({
  thunderstormCapeJkg: 500, // CAPE above this: thunderstorm risk
  possibleThunderCapeJkg: 100, // CAPE from this to 500 inclusive: possible thunder
  minVisibilityM: 5000, // visibility below this is flagged
  precipitationProbabilityPct: 70, // this or more is flagged
  frostTemperatureC: 1, // this or less is flagged
});

/** Minimum length of a planning period (hours). */
export const MIN_PERIOD_HOURS = 2;
