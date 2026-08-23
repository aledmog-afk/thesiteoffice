import type { Rule, RuleContext } from '../rule.js';
import type { Quantity } from '../types.js';
import { fmt } from '../format.js';

const OF_BASE = /^[\s ]*(?:of|out of|among|in)[\s ]+(?:the[\s ]+|all[\s ]+|its[\s ]+|these[\s ]+|those[\s ]+)?$/i;
const INTEGER_ITEM_HINT = /\b(likert|scale of 1|1[-–]5 scale|1[-–]7 scale|items? (?:scored|rated)|scored (?:from|out of)|ratings?|counts?|responses?)\b/i;

function roundTo(v: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(v * f + Number.EPSILON * v * f) / f;
}

function decimalsOf(q: Quantity): number {
  const m = /\.(\d+)/.exec(q.span.text);
  return m ? m[1]!.length : 0;
}

/**
 * The GRIM idea, generalised: people are whole numbers. If a document says
 * "27% of the 15 patients", no whole number of patients produces 27%, so one of
 * the two figures is wrong. Assumption-free — it needs no data beyond the page.
 */
export const impossiblePercentage: Rule = {
  id: 'impossible-percentage',
  description: 'A percentage is arithmetically impossible for the sample size given.',
  run(ctx: RuleContext) {
    const qs = ctx.quantities;
    for (let i = 0; i < qs.length - 1; i++) {
      const pct = qs[i]!;
      const base = qs[i + 1]!;
      if (pct.kind !== 'percent' || pct.hedge !== 'exact') continue;
      if (base.kind !== 'plain' || base.hedge !== 'exact' || base.ordinal) continue;
      if (pct.sentence !== base.sentence) continue;
      if (!OF_BASE.test(ctx.text.slice(pct.span.end, base.span.start))) continue;
      const n = base.value;
      if (!Number.isInteger(n) || n < 3 || n > 400) continue;
      if (pct.value < 0 || pct.value > 100) continue;
      const d = decimalsOf(pct);
      if (d > 2) continue;

      let possible = false;
      let below = 0;
      let above = 100;
      for (let k = 0; k <= n; k++) {
        const p = roundTo((k * 100) / n, d);
        if (Math.abs(p - pct.value) < Math.pow(10, -d) / 2) { possible = true; break; }
        if (p < pct.value) below = p;
        if (p > pct.value && above === 100) above = p;
      }
      if (possible) continue;
      const nearestK = Math.round((pct.value / 100) * n);
      const nearestPct = roundTo((nearestK * 100) / n, Math.max(d, 1));
      ctx.report({
        rule: 'impossible-percentage',
        severity: 'error',
        confidence: 0.88,
        message: `No whole number out of ${fmt(n)} gives ${pct.span.text} — the closest are ${fmt(below)}% and ${fmt(above)}%.`,
        stated: pct.span.text,
        expected: `${fmt(nearestPct)}% (${fmt(nearestK)} of ${fmt(n)})`,
        workings: `${fmt(nearestK)} ÷ ${fmt(n)} = ${fmt(nearestK / n, { sig: 4 })} → ${fmt(nearestPct)}%; every achievable value is a multiple of ${fmt(roundTo(100 / n, 2))}%`,
        span: pct.span,
        relatedSpans: [base.span],
        fix: `${fmt(nearestPct)}%`,
      });
    }
  },
};

const MEAN_RE =
  /\b(?:mean|average|M)\s*(?:score\s*)?(?:was|of|=|:)\s*(\d+\.\d{1,3})\b[^.]{0,80}?\b(?:n|N|sample|participants?|respondents?|subjects?|patients?)\s*(?:=|of|was|were|:)?\s*(\d{1,4})\b/g;
const MEAN_RE_REV =
  /\b(?:n|N)\s*=\s*(\d{1,4})\b[^.]{0,80}?\b(?:mean|average|M)\s*(?:was|of|=|:)\s*(\d+\.\d{1,3})\b/g;

/**
 * GRIM proper: a mean of integer-valued items must be a multiple of 1/n.
 * Only runs when the surrounding text signals integer items, because the
 * assumption is what does the work.
 */
export const grimMean: Rule = {
  id: 'grim-mean',
  description: 'A reported mean is impossible for the sample size (GRIM test).',
  run(ctx: RuleContext) {
    if (!INTEGER_ITEM_HINT.test(ctx.text)) return;
    const check = (meanStr: string, nStr: string, at: number, len: number) => {
      const mean = parseFloat(meanStr);
      const n = parseInt(nStr, 10);
      const d = (meanStr.split('.')[1] ?? '').length;
      if (!Number.isFinite(mean) || !n || n < 2 || n > 200) return;
      const tol = Math.pow(10, -d) / 2 + 1e-9;
      let possible = false;
      const lo = Math.floor((mean - tol) * n);
      const hi = Math.ceil((mean + tol) * n);
      for (let s = lo; s <= hi; s++) {
        if (Math.abs(s / n - mean) <= tol) { possible = true; break; }
      }
      if (possible) return;
      const nearest = Math.round(mean * n) / n;
      ctx.report({
        rule: 'grim-mean',
        severity: 'warning',
        confidence: 0.85,
        message: `A mean of ${meanStr} is impossible for n = ${n} if the items are whole numbers — the nearest achievable mean is ${fmt(nearest, { sig: 5 })}.`,
        stated: meanStr,
        expected: fmt(nearest, { sig: 5 }),
        workings: `${meanStr} × ${n} = ${fmt(mean * n, { sig: 6 })}, which is not a whole total; achievable means are multiples of 1/${n} = ${fmt(1 / n, { sig: 4 })}`,
        span: { start: at, end: at + len, text: ctx.text.slice(at, at + len) },
        relatedSpans: [],
      });
    };
    let m: RegExpExecArray | null;
    MEAN_RE.lastIndex = 0;
    while ((m = MEAN_RE.exec(ctx.text))) check(m[1]!, m[2]!, m.index + m[0].indexOf(m[1]!), m[1]!.length);
    MEAN_RE_REV.lastIndex = 0;
    while ((m = MEAN_RE_REV.exec(ctx.text))) check(m[2]!, m[1]!, m.index + m[0].lastIndexOf(m[2]!), m[2]!.length);
  },
};
