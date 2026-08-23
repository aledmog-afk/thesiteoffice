import type { Rule, RuleContext } from '../rule.js';
import { severityFor, confidenceFor } from '../rule.js';
import type { Quantity } from '../types.js';
import { toInterval, overlaps, iv, mul } from '../interval.js';
import { fmt, fmtQuantityValue, symbolFor } from '../format.js';
import { looksLikeYear } from './percentOfBase.js';

const OF_LINK = /^[\s ]*(?:of|out of)[\s ]+(?:the[\s ]+|its[\s ]+|all[\s ]+)?$/i;

/** "1 in 5 households (25%)" — the ratio and the percentage disagree. */
export const ratioPercent: Rule = {
  id: 'ratio-percent',
  description: 'A stated percentage does not match the "one in N" ratio beside it.',
  run(ctx: RuleContext) {
    const qs = ctx.quantities;
    for (let i = 0; i < qs.length; i++) {
      const q = qs[i]!;
      if (!q.ratio || q.ratio.den <= 0) continue;
      for (let j = i + 1; j < qs.length && j <= i + 3; j++) {
        const pct = qs[j]!;
        if (pct.sentence !== q.sentence) break;
        if (pct.kind !== 'percent') continue;
        if (pct.span.start - q.span.end > 44) break;
        const between = ctx.text.slice(q.span.end, pct.span.start);
        if (/[;.]|\bbut\b|\bwhile\b/i.test(between)) break;
        const point = (q.ratio.num / q.ratio.den) * 100;
        const expected = iv(point - 0.55, point + 0.55);
        const stated = toInterval(pct, ctx.options.slack);
        if (overlaps(stated, expected)) break;
        ctx.report({
          rule: 'ratio-percent',
          severity: severityFor(stated, expected),
          confidence: confidenceFor(0.9, stated, expected),
          message: `${fmt(q.ratio.num)} in ${fmt(q.ratio.den)} is ${fmt(point)}%, not ${pct.span.text}.`,
          stated: pct.span.text,
          expected: `${fmt(point)}%`,
          workings: `${fmt(q.ratio.num)} ÷ ${fmt(q.ratio.den)} = ${fmt(point / 100, { sig: 4 })} → ${fmt(point)}%`,
          span: pct.span,
          relatedSpans: [q.span],
          fix: `${fmt(Math.round(point * 10) / 10)}%`,
        });
        break;
      }
    }
  },
};

/** "£25m of the £20m fund" — a part cannot exceed its whole. */
export const partExceedsWhole: Rule = {
  id: 'part-exceeds-whole',
  description: 'A part is larger than the whole it is said to come from.',
  run(ctx: RuleContext) {
    const qs = ctx.quantities;
    for (let i = 0; i < qs.length - 1; i++) {
      const part = qs[i]!;
      const whole = qs[i + 1]!;
      if (part.sentence !== whole.sentence) continue;
      if (!OF_LINK.test(ctx.text.slice(part.span.end, whole.span.start))) continue;
      if (looksLikeYear(part) || looksLikeYear(whole)) continue;
      if (part.attributive || whole.attributive) continue;
      if (part.kind === 'percent' || whole.kind === 'percent') continue;
      if (part.currency !== whole.currency) continue;
      if (part.unit?.def.id !== whole.unit?.def.id) continue;
      if (whole.value <= 0) continue;
      // "£4bn of the £20bn fund" is fine; only a genuine excess counts
      const p = toInterval(part, ctx.options.slack);
      const w = toInterval(whole, ctx.options.slack);
      if (p.lo <= w.hi) continue;
      // a whole restated in a larger scale word is a different claim
      ctx.report({
        rule: 'part-exceeds-whole',
        severity: 'error',
        confidence: 0.9,
        message: `${part.span.text} cannot be part of ${whole.span.text} — the part is larger than the whole.`,
        stated: part.span.text,
        expected: `at most ${whole.span.text}`,
        workings: `${fmt(part.value)} > ${fmt(whole.value)}`,
        span: part.span,
        relatedSpans: [whole.span],
      });
    }
  },
};

const RATE_RE =
  /\bat\s+(?:a\s+rate\s+of\s+)?([$€£¥₹])?\s?(\d+(?:\.\d+)?)\s*(?:to|per|=|\/)\s*(?:the\s+)?([$€£¥₹])?\s?(?:1\s*)?([a-z]{3,8}|[$€£¥₹])\b/i;

/**
 * "€5m ($5.4m at $1.08 to the euro)" — the only currency conversion that can be
 * checked from the page alone is one whose rate the page states.
 */
export const currencyRate: Rule = {
  id: 'currency-rate',
  description: 'A currency conversion does not match the exchange rate stated in the same sentence.',
  run(ctx: RuleContext) {
    const qs = ctx.quantities;
    for (let i = 0; i < qs.length - 1; i++) {
      const a = qs[i]!;
      const b = qs[i + 1]!;
      if (a.kind !== 'currency' || b.kind !== 'currency') continue;
      if (!a.currency || !b.currency || a.currency === b.currency) continue;
      if (a.sentence !== b.sentence) continue;
      const between = ctx.text.slice(a.span.end, b.span.start);
      if (between.length > 20 || !/[([]|,?\s*or\s*/i.test(between)) continue;
      const sentence = ctx.sentences[a.sentence];
      if (!sentence) continue;
      const tail = ctx.text.slice(b.span.end, sentence.end);
      const m = RATE_RE.exec(tail);
      if (!m) continue;
      const rate = parseFloat(m[2]!);
      if (!Number.isFinite(rate) || rate <= 0) continue;
      // work out which direction the quoted rate runs
      const quoted = (m[1] ?? m[3] ?? '').trim();
      const perSymbol = symbolFor(a.currency);
      const rateIsBPerA = quoted === symbolFor(b.currency) || m[4]?.toLowerCase() === currencyWord(a.currency);
      const factor = rateIsBPerA ? rate : quoted === perSymbol ? 1 / rate : rate;
      const expected = mul(toInterval(a, ctx.options.slack), iv(factor * 0.995, factor * 1.005));
      const stated = toInterval(b, ctx.options.slack);
      if (overlaps(stated, expected)) continue;
      const point = a.value * factor;
      ctx.report({
        rule: 'currency-rate',
        severity: severityFor(stated, expected),
        confidence: confidenceFor(0.85, stated, expected),
        message: `At the rate given, ${a.span.text} is ${fmtQuantityValue(point, { currency: b.currency, scaled: true })}, not ${b.span.text}.`,
        stated: b.span.text,
        expected: fmtQuantityValue(point, { currency: b.currency, scaled: true }),
        workings: `${fmt(a.value)} × ${fmt(factor, { sig: 5 })} = ${fmt(point)}`,
        span: b.span,
        relatedSpans: [a.span],
      });
    }
  },
};

function currencyWord(code: string): string {
  const map: Record<string, string> = {
    EUR: 'euro', GBP: 'pound', USD: 'dollar', JPY: 'yen', INR: 'rupee', CHF: 'franc',
  };
  return map[code] ?? code.toLowerCase();
}

void ((q: Quantity) => q);
