import type { Rule, RuleContext } from '../rule.js';
import { severityFor, confidenceFor } from '../rule.js';
import type { Quantity } from '../types.js';
import { toInterval, overlaps, div, mul } from '../interval.js';
import { fmt, fmtQuantityValue } from '../format.js';
import { looksLikeYear } from './percentOfBase.js';

const AVERAGE_LEAD =
  /\b(?:an?\s+)?(?:average|mean)\s+of\s*$|\baveraging\s*$|\bon\s+average,?\s*$|\bor\s+(?:about\s+|roughly\s+|approximately\s+|around\s+|just\s+)?$/i;
const PER_TRAIL = /^[\s ]*(?:per|each|apiece|a|an|every|for\s+every|to\s+each)\b/i;
const SPREAD =
  /\b(?:across|among|amongst|over|between|in|spread\s+across|shared\s+(?:by|between)|divided\s+(?:by|among|between)|split\s+(?:across|among|between)|serving|covering)\b/i;

function money(q: Quantity): boolean {
  return q.kind === 'currency';
}
function sameKind(a: Quantity, b: Quantity): boolean {
  if (a.currency || b.currency) return a.currency === b.currency;
  if (a.unit || b.unit) return a.unit?.def.id === b.unit?.def.id;
  return a.kind === b.kind;
}

/**
 * "£4.2m across 12 councils, an average of £300,000 each" — the per-unit figure
 * that nobody divides out. Also covers "N at P each, totalling T".
 */
export const perUnit: Rule = {
  id: 'per-unit',
  description: 'A stated average or per-unit figure does not match the total and the count.',
  run(ctx: RuleContext) {
    const qs = ctx.quantities;

    for (let i = 2; i < qs.length; i++) {
      const avg = qs[i]!;
      if (avg.kind === 'year' || avg.ordinal) continue;
      const lead = ctx.text.slice(Math.max(0, avg.span.start - 40), avg.span.start).replace(/[$€£¥₹\s]+$/, ' ');
      const trail = ctx.text.slice(avg.span.end, avg.span.end + 26);
      if (!AVERAGE_LEAD.test(lead) || !PER_TRAIL.test(trail.replace(/^[\s]*(?:of\s+\w+\s*)?/, ''))) continue;

      const count = qs[i - 1]!;
      const total = qs[i - 2]!;
      if (count.sentence !== avg.sentence || total.sentence !== avg.sentence) continue;
      if (count.kind !== 'plain' || count.value <= 0 || count.ordinal) continue;
      if (looksLikeYear(count) || count.attributive || avg.attributive || total.attributive) continue;
      if (!sameKind(total, avg)) continue;
      const bridge = ctx.text.slice(total.span.end, count.span.start);
      if (!SPREAD.test(bridge) || bridge.length > 60) continue;

      const expected = div(toInterval(total, ctx.options.slack), toInterval(count, ctx.options.slack));
      if (!expected) continue;
      const stated = toInterval(avg, ctx.options.slack);
      if (overlaps(stated, expected)) continue;
      const point = total.value / count.value;
      ctx.report({
        rule: 'per-unit',
        severity: severityFor(stated, expected),
        confidence: confidenceFor(0.88, stated, expected),
        message: `${total.span.text} across ${count.span.text} is ${fmtQuantityValue(point, { currency: avg.currency, unit: avg.unit?.surface })} each, not ${avg.span.text}.`,
        stated: avg.span.text,
        expected: fmtQuantityValue(point, { currency: avg.currency, unit: avg.unit?.surface }),
        workings: `${fmt(total.value)} ÷ ${fmt(count.value)} = ${fmt(point)}`,
        span: avg.span,
        relatedSpans: [total.span, count.span],
      });
    }

    // "1,200 units at $50 each, for a total of $54,000"
    for (let i = 1; i < qs.length - 1; i++) {
      const price = qs[i]!;
      const count = qs[i - 1]!;
      const total = qs[i + 1]!;
      if (count.kind !== 'plain' || count.value <= 0 || looksLikeYear(count)) continue;
      if (!sameKind(price, total)) continue;
      if (price.sentence !== count.sentence || total.sentence !== price.sentence) continue;
      const atText = ctx.text.slice(count.span.end, price.span.start);
      if (!/\b(?:at|for|costing|priced at|worth)\b/i.test(atText) || atText.length > 40) continue;
      const eachText = ctx.text.slice(price.span.end, total.span.start);
      if (!/\b(?:each|apiece|per|a piece)\b/i.test(eachText)) continue;
      if (!/\b(?:total|totall?ing|altogether|in all|comes? to|comb ined|combined|amounting to|worth)\b/i.test(eachText)) continue;

      const expected = mul(toInterval(count, ctx.options.slack), toInterval(price, ctx.options.slack));
      const stated = toInterval(total, ctx.options.slack);
      if (overlaps(stated, expected)) continue;
      const point = count.value * price.value;
      ctx.report({
        rule: 'per-unit',
        severity: severityFor(stated, expected),
        confidence: confidenceFor(0.9, stated, expected),
        message: `${count.span.text} at ${price.span.text} each comes to ${fmtQuantityValue(point, { currency: total.currency, unit: total.unit?.surface })}, not ${total.span.text}.`,
        stated: total.span.text,
        expected: fmtQuantityValue(point, { currency: total.currency, unit: total.unit?.surface }),
        workings: `${fmt(count.value)} × ${fmt(price.value)} = ${fmt(point)}`,
        span: total.span,
        relatedSpans: [count.span, price.span],
      });
    }
    void money;
  },
};
