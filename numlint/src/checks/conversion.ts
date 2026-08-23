import type { Rule, RuleContext } from '../rule.js';
import { severityFor, confidenceFor } from '../rule.js';
import type { Quantity } from '../types.js';
import { convert, sameDimension, reciprocalDimension, dimensionName } from '../units.js';
import { toInterval, overlaps, iv, midpoint, type Interval } from '../interval.js';
import { fmt } from '../format.js';
import { spanOf } from '../text.js';

const CONNECTOR =
  /^[\s ]*(?:\(|\[|—|–|-|=|≈|,?[\s ]*or[\s ]*(?:about|roughly|approximately|around|some)?|,|i\.e\.,?|that is,?|equivalent to|equal to|which is|about|roughly|approximately)[\s ]*$/i;

export function convertInterval(
  i: Interval,
  from: Quantity['unit'],
  to: Quantity['unit'],
): Interval | undefined {
  if (!from || !to) return undefined;
  const a = convert(i.lo, from.def, to.def);
  const b = convert(i.hi, from.def, to.def);
  if (a === undefined || b === undefined || Number.isNaN(a) || Number.isNaN(b)) return undefined;
  return iv(Math.min(a, b), Math.max(a, b));
}

/**
 * "5 miles (8 km)" — a value restated in another unit. Roughly one in eight
 * parenthetical conversions in the wild is wrong; they are never checked by anyone.
 */
export const unitConversion: Rule = {
  id: 'unit-conversion',
  description: 'A value restated in a second unit does not match the conversion.',
  run(ctx: RuleContext) {
    const qs = ctx.quantities;
    for (let i = 0; i < qs.length - 1; i++) {
      const a = qs[i]!;
      const b = qs[i + 1]!;
      if (a.kind !== 'measure' || b.kind !== 'measure' || !a.unit || !b.unit) continue;
      if (a.sentence !== b.sentence) continue;
      if (a.unit.def.id === b.unit.def.id) continue;
      const between = ctx.text.slice(a.span.end, b.span.start);
      if (between.length > 24 || !CONNECTOR.test(between)) continue;
      const parenthetical = /[([]/.test(between);
      // "(14 meters is slightly less than 46 feet)" is a sentence, not a conversion:
      // a real parenthetical conversion closes right after the value
      if (parenthetical && !/^[^)\]]{0,12}[)\]]/.test(ctx.text.slice(b.span.end))) continue;
      const same = sameDimension(a.unit.def.dim, b.unit.def.dim);
      const recip = reciprocalDimension(a.unit.def.dim, b.unit.def.dim);
      if (!same && !recip) continue;
      // a bare comma is too weak a signal unless the two units are from different systems
      if (!parenthetical && /^[\s ]*,[\s ]*$/.test(between) && a.unit.def.system === b.unit.def.system) continue;

      // A parenthetical conversion converts the number as written, so it is judged
      // against that number — but the source's own rounding still buys some slack,
      // discounted because the author was converting the printed figure.
      if (a.hedge === 'over' || a.hedge === 'under' || b.hedge === 'over' || b.hedge === 'under') continue;
      if (a.hedge === 'range' || b.hedge === 'range') continue;
      const point = convert(a.value, a.unit.def, b.unit.def);
      if (point === undefined || !Number.isFinite(point)) continue;
      const sourceSlop = Math.abs(
        (convert(a.value + a.quantum, a.unit.def, b.unit.def) ?? point) - point,
      ) * 0.25;
      const hedged = a.hedge === 'about' || b.hedge === 'about' || a.hedge === 'nearly' || b.hedge === 'nearly';
      const tol = (b.quantum + sourceSlop) * ctx.options.slack * (hedged ? 4 : 1);
      const expected = iv(point - tol, point + tol);
      const stated = iv(b.value, b.value);
      if (overlaps(stated, expected)) continue;
      const base = parenthetical ? 0.93 : 0.87;
      const conf = confidenceFor(base, stated, expected);
      const dim = dimensionName(a.unit.def.dim);
      ctx.report({
        rule: 'unit-conversion',
        severity: severityFor(stated, expected),
        confidence: conf,
        message: `${a.span.text} is ${fmt(point, { unit: b.unit.surface })}, not ${b.span.text}.`,
        stated: b.span.text,
        expected: fmt(point, { unit: b.unit.surface }),
        workings: recip
          ? `${fmt(a.value)} ${a.unit.surface} ↔ ${fmt(point)} ${b.unit.surface} (reciprocal ${dim} units)`
          : `${fmt(a.value)} × ${fmt(a.unit.def.factor / b.unit.def.factor, { sig: 7 })} = ${fmt(point)} ${b.unit.surface}`,
        span: b.span,
        relatedSpans: [a.span],
        fix: `${fmt(roundLike(point, b))} ${b.unit.surface}`,
      });
    }
  },
};

/** Round the corrected value to the same precision the author used. */
function roundLike(value: number, like: Quantity): number {
  const decimals = Math.max(0, Math.round(-Math.log10(like.quantum * 2)));
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

export { midpoint };
