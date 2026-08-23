import type { Rule, RuleContext } from '../rule.js';
import { severityFor, confidenceFor } from '../rule.js';
import type { Quantity } from '../types.js';
import { toInterval, overlaps, div, scale, iv } from '../interval.js';
import { fmt, fmtQuantityValue } from '../format.js';

const OF_LINK = /^[\s\u00a0]*(?:of|out of|among|amongst)[\s\u00a0]+(?:the[\s\u00a0]+|its[\s\u00a0]+|all[\s\u00a0]+|some[\s\u00a0]+|these[\s\u00a0]+|those[\s\u00a0]+)?$/i;
const SOFT_CONNECTOR =
  /^[\s,;—–-]*(?:\(|\[|or|i\.e\.|that is|about|roughly|approximately|around|representing|equal to|equivalent to|amounting to|—|–|:)?[\s,]*(?:just[\s ]+)?(?:about|roughly|approximately|around|nearly|almost)?[\s ]*$/i;

/** Is `part` plausibly countable against `whole`? Avoid mixing dollars with people. */
/** A bare four-digit number is a year, not a population. */
export function looksLikeYear(q: Quantity): boolean {
  if (q.kind === 'year') return true;
  if (q.unit || q.currency || q.scaleWord || q.spelled) return false;
  return /^\d{4}$/.test(q.span.text) && q.value >= 1500 && q.value <= 2100;
}

function comparable(part: Quantity, whole: Quantity): boolean {
  if (part.kind === 'percent' || whole.kind === 'percent') return false;
  if (part.currency || whole.currency) return part.currency === whole.currency;
  if (part.unit || whole.unit) return part.unit?.def.id === whole.unit?.def.id;
  return true;
}

/**
 * "45 of the 200 respondents (25%)" — the share stated next to its own numerator
 * and denominator. This is the single most common numeric error in survey write-ups.
 */
export const percentOfBase: Rule = {
  id: 'percent-of-base',
  description: 'A stated percentage does not match the part and whole given beside it.',
  run(ctx: RuleContext) {
    const qs = ctx.quantities;
    for (let i = 0; i < qs.length - 1; i++) {
      const part = qs[i]!;
      const whole = qs[i + 1]!;
      if (part.sentence !== whole.sentence) continue;
      if (!OF_LINK.test(ctx.text.slice(part.span.end, whole.span.start))) continue;
      if (!comparable(part, whole)) continue;
      if (whole.value <= 0 || looksLikeYear(part) || looksLikeYear(whole)) continue;
      if (part.attributive || whole.attributive) continue;

      // find a percentage nearby that describes this fraction
      const pct = findPercent(ctx, whole, qs, i + 2);
      if (!pct) continue;

      const ratio = div(toInterval(part, ctx.options.slack), toInterval(whole, ctx.options.slack));
      if (!ratio) continue;
      const expected = scale(ratio, 100);
      const stated = toInterval(pct, ctx.options.slack);
      if (overlaps(stated, expected)) continue;
      // guard: the percentage may describe something else entirely if it is wildly different
      const point = (part.value / whole.value) * 100;
      if (point > 100.5 && pct.value <= 100) continue;

      ctx.report({
        rule: 'percent-of-base',
        severity: severityFor(stated, expected),
        confidence: confidenceFor(0.9, stated, expected),
        message: `${part.span.text} of ${whole.span.text} is ${fmt(point)}%, not ${pct.span.text}.`,
        stated: pct.span.text,
        expected: `${fmt(point)}%`,
        workings: `${fmt(part.value)} ÷ ${fmt(whole.value)} = ${fmt(point / 100, { sig: 4 })} → ${fmt(point)}%`,
        span: pct.span,
        relatedSpans: [part.span, whole.span],
        fix: `${fmt(round1(point))}%`,
      });
    }

    // reverse order: "25% of the 200 respondents (45 people)"
    for (let i = 0; i < qs.length - 1; i++) {
      const pct = qs[i]!;
      const whole = qs[i + 1]!;
      if (pct.kind !== 'percent' || pct.sentence !== whole.sentence) continue;
      if (!OF_LINK.test(ctx.text.slice(pct.span.end, whole.span.start))) continue;
      if (whole.kind === 'percent' || whole.value <= 0 || looksLikeYear(whole)) continue;
      const part = qs[i + 2];
      if (!part || part.sentence !== whole.sentence || part.kind === 'percent') continue;
      if (looksLikeYear(part) || part.attributive) continue;
      if (!comparable(part, whole)) continue;
      const between = ctx.text.slice(whole.span.end, part.span.start);
      if (between.length > 34 || !SOFT_CONNECTOR.test(stripNoun(between))) continue;

      const expected = scale(
        (div(toInterval(pct, ctx.options.slack), iv(100, 100)) ?? iv(0, 0)),
        1,
      );
      const expectedCount = {
        lo: expected.lo * toInterval(whole, ctx.options.slack).lo,
        hi: expected.hi * toInterval(whole, ctx.options.slack).hi,
      };
      const stated = toInterval(part, ctx.options.slack);
      if (overlaps(stated, expectedCount)) continue;
      const point = (pct.value / 100) * whole.value;
      ctx.report({
        rule: 'percent-of-base',
        severity: severityFor(stated, expectedCount),
        confidence: confidenceFor(0.88, stated, expectedCount),
        message: `${pct.span.text} of ${whole.span.text} is ${fmt(point)}, not ${part.span.text}.`,
        stated: part.span.text,
        expected: fmtQuantityValue(point, { currency: part.currency, unit: part.unit?.surface }),
        workings: `${fmt(pct.value)}% × ${fmt(whole.value)} = ${fmt(point)}`,
        span: part.span,
        relatedSpans: [pct.span, whole.span],
      });
    }
  },
};

/** the words between a whole and its restatement, minus the noun phrase */
function stripNoun(s: string): string {
  return s.replace(/[A-Za-z][\w-]*/g, (w) =>
    /^(or|about|roughly|approximately|around|nearly|almost|i|e|that|is|just|representing|equal|equivalent|to|amounting)$/i.test(w) ? w : '',
  );
}

function findPercent(ctx: RuleContext, whole: Quantity, qs: Quantity[], from: number): Quantity | undefined {
  for (let j = from; j < qs.length; j++) {
    const q = qs[j]!;
    if (q.sentence !== whole.sentence) return undefined;
    if (q.span.start - whole.span.end > 60) return undefined;
    const between = ctx.text.slice(whole.span.end, q.span.start);
    if (/[;:.]|\band\b|\bbut\b|\bwhile\b/i.test(between)) return undefined;
    if (q.kind === 'percent') {
      if (!SOFT_CONNECTOR.test(stripNoun(between))) return undefined;
      return q;
    }
  }
  return undefined;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
