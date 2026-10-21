import { WindInputError } from './errors';
import type { FactorPoint } from './constants';

/**
 * Linear interpolation in log(height) between tabulated points:
 *
 *   t = ln(h / h_lo) / ln(h_hi / h_lo)
 *   F(h) = F_lo + t × (F_hi − F_lo)
 *
 * This is the interpolation the LiftWatch method uses for both the gust and the
 * mean-to-gust tables (METHOD.md, steps 1 and 2). At a tabulated height it returns
 * the published value exactly. The caller deals with heights outside the table.
 */
export function interpolateLogHeight(points: readonly FactorPoint[], heightM: number): number {
  const first = points[0];
  const last = points[points.length - 1];
  if (heightM < first.heightM || heightM > last.heightM) {
    throw new WindInputError(`Height ${heightM} m is outside the table (${first.heightM}–${last.heightM} m).`);
  }
  for (let i = 0; i < points.length; i++) {
    if (points[i].heightM === heightM) return points[i].factor;
  }
  for (let i = 0; i < points.length - 1; i++) {
    const lo = points[i];
    const hi = points[i + 1];
    if (heightM > lo.heightM && heightM < hi.heightM) {
      const t = Math.log(heightM / lo.heightM) / Math.log(hi.heightM / lo.heightM);
      return lo.factor + t * (hi.factor - lo.factor);
    }
  }
  /* c8 ignore next */
  throw new WindInputError(`Could not interpolate at ${heightM} m.`);
}
