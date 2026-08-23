import type { Quantity } from './types.js';

/**
 * Every number in a document is really a claim about an interval: "8.5 km" asserts
 * a true value in [8.45, 8.55). Numlint only reports an inconsistency when the interval
 * a number states is disjoint from the interval the surrounding numbers imply — so
 * ordinary rounding never produces a finding.
 */
export interface Interval {
  lo: number;
  hi: number;
}

export const iv = (lo: number, hi: number): Interval => ({ lo: Math.min(lo, hi), hi: Math.max(lo, hi) });
export const point = (v: number): Interval => ({ lo: v, hi: v });

/** Relative slack applied to hedged numbers ("about 5 million"). */
const HEDGE_SLACK = 0.05;

export function toInterval(q: Quantity, slack = 1): Interval {
  const q0 = q.quantum * slack;
  const v = q.value;
  switch (q.hedge) {
    case 'exact':
      return iv(v - q0, v + q0);
    case 'about': {
      const s = Math.max(q0, Math.abs(v) * HEDGE_SLACK * slack);
      return iv(v - s, v + s);
    }
    case 'nearly': {
      const s = Math.max(q0, Math.abs(v) * HEDGE_SLACK * slack);
      return iv(v - s, v + q0);
    }
    case 'over':
      return iv(v - q0, Number.POSITIVE_INFINITY);
    case 'under':
      return iv(Number.NEGATIVE_INFINITY, v + q0);
    case 'range':
      return iv(v - q0, (q.valueHigh ?? v) + q0);
  }
}

export const add = (a: Interval, b: Interval): Interval => iv(a.lo + b.lo, a.hi + b.hi);
export const sub = (a: Interval, b: Interval): Interval => iv(a.lo - b.hi, a.hi - b.lo);

export function mul(a: Interval, b: Interval): Interval {
  const c = [a.lo * b.lo, a.lo * b.hi, a.hi * b.lo, a.hi * b.hi].filter((x) => !Number.isNaN(x));
  return iv(Math.min(...c), Math.max(...c));
}

export function div(a: Interval, b: Interval): Interval | undefined {
  if (b.lo <= 0 && b.hi >= 0) return undefined; // spans zero
  const c = [a.lo / b.lo, a.lo / b.hi, a.hi / b.lo, a.hi / b.hi];
  return iv(Math.min(...c), Math.max(...c));
}

export const scale = (a: Interval, k: number): Interval => iv(a.lo * k, a.hi * k);

export function overlaps(a: Interval, b: Interval): boolean {
  return a.lo <= b.hi && b.lo <= a.hi;
}

/**
 * How badly two intervals miss each other, as a fraction of the expected magnitude.
 * 0 when they touch. Used for severity and confidence.
 */
export function relativeGap(stated: Interval, expected: Interval): number {
  if (overlaps(stated, expected)) return 0;
  const gap = stated.lo > expected.hi ? stated.lo - expected.hi : expected.lo - stated.hi;
  const mag = Math.max(
    Math.abs(finiteOr(expected.lo, expected.hi)),
    Math.abs(finiteOr(expected.hi, expected.lo)),
    1e-12,
  );
  return gap / mag;
}

function finiteOr(a: number, b: number): number {
  return Number.isFinite(a) ? a : Number.isFinite(b) ? b : 0;
}

export function midpoint(a: Interval): number {
  if (Number.isFinite(a.lo) && Number.isFinite(a.hi)) return (a.lo + a.hi) / 2;
  return Number.isFinite(a.lo) ? a.lo : a.hi;
}

export function fmtInterval(a: Interval, fmt: (n: number) => string): string {
  if (!Number.isFinite(a.lo)) return `at most ${fmt(a.hi)}`;
  if (!Number.isFinite(a.hi)) return `at least ${fmt(a.lo)}`;
  const m = midpoint(a);
  if (a.hi - a.lo < Math.abs(m) * 1e-9) return fmt(m);
  return `${fmt(a.lo)}–${fmt(a.hi)}`;
}
