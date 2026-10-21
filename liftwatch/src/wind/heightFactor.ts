import { GUST_HEIGHT_FACTORS, MAX_METHOD_HEIGHT_M } from './constants';
import { OutsideMethodRangeError, requireNonNegative, requirePositive } from './errors';
import { interpolateLogHeight } from './interpolate';

/**
 * Factor that turns a 10 m gust into the gust at `heightM`.
 *
 * Source: Liebherr gust factors quoted in CPA/TCIG "Planning and Control of
 * Lifting Operations in Wind" (July 2025): 10 m 1.000, 50 m 1.181, 100 m 1.272,
 * 150 m 1.329. Interpolated linearly in log(height) (METHOD.md, step 1).
 *
 * - Below 10 m the factor is 1.0.
 * - Above 150 m the method refuses (OutsideMethodRangeError).
 */
export function gustHeightFactor(heightM: number): number {
  requirePositive(heightM, 'Height');
  if (heightM > MAX_METHOD_HEIGHT_M) {
    throw new OutsideMethodRangeError(
      `${heightM} m is above ${MAX_METHOD_HEIGHT_M} m, the highest height the published gust factors cover.`,
    );
  }
  if (heightM <= GUST_HEIGHT_FACTORS[0].heightM) return GUST_HEIGHT_FACTORS[0].factor;
  return interpolateLogHeight(GUST_HEIGHT_FACTORS, heightM);
}

/** Gust at height: v_gust(h) = v_gust(10 m) × F(h). */
export function gustAtHeight(gust10mMs: number, heightM: number): number {
  requireNonNegative(gust10mMs, '10 m gust');
  return gust10mMs * gustHeightFactor(heightM);
}
