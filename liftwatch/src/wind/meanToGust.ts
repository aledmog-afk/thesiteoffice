import { MAX_METHOD_HEIGHT_M, MEAN_TO_GUST_10M_FACTOR, MEAN_TO_GUST_FACTORS } from './constants';
import { OutsideMethodRangeError, requireNonNegative, requirePositive, WindInputError } from './errors';
import { interpolateLogHeight } from './interpolate';

/**
 * Factor that turns a 10 m, 10-minute MEAN wind speed into a gust at `heightM`.
 * Only for sources that give no gust. The pilot uses Open-Meteo gusts and does
 * not call this.
 *
 * Source: CPA/TCIG "Planning and Control of Lifting Operations in Wind" (July 2025)
 * mean-to-gust factors: 50 m 1.653, 100 m 1.78, 150 m 1.861. Interpolated linearly
 * in log(height) (METHOD.md, step 2).
 *
 * - 50–150 m: from the published table.
 * - 10–50 m: interpolated between `tenMetreFactor` (entered by the AP, or set in
 *   config) and the 50 m value. Without a 10 m factor the method refuses.
 * - At or below 10 m: `tenMetreFactor`.
 * - Above 150 m: refused.
 */
export function meanToGustFactor(
  heightM: number,
  tenMetreFactor: number | undefined = MEAN_TO_GUST_10M_FACTOR,
): number {
  requirePositive(heightM, 'Height');
  if (heightM > MAX_METHOD_HEIGHT_M) {
    throw new OutsideMethodRangeError(
      `${heightM} m is above ${MAX_METHOD_HEIGHT_M} m, the highest height the published mean-to-gust factors cover.`,
    );
  }
  const fifty = MEAN_TO_GUST_FACTORS[0];
  if (heightM >= fifty.heightM) return interpolateLogHeight(MEAN_TO_GUST_FACTORS, heightM);

  if (tenMetreFactor === undefined) {
    throw new WindInputError(
      `Below ${fifty.heightM} m a 10 m mean-to-gust factor must be entered. The published table starts at ${fifty.heightM} m.`,
    );
  }
  requirePositive(tenMetreFactor, '10 m mean-to-gust factor');
  if (heightM <= 10) return tenMetreFactor;
  return interpolateLogHeight([{ heightM: 10, factor: tenMetreFactor }, fifty], heightM);
}

/** Gust at height from a 10 m mean: v_gust(h) = v_mean(10 m) × G(h). */
export function gustAtHeightFromMean(mean10mMs: number, heightM: number, tenMetreFactor?: number): number {
  requireNonNegative(mean10mMs, '10 m mean wind speed');
  return mean10mMs * meanToGustFactor(heightM, tenMetreFactor ?? MEAN_TO_GUST_10M_FACTOR);
}
