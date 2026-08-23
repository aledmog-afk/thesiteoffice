import type { Rule, RuleContext } from '../rule.js';
import type { Quantity } from '../types.js';
import { toInterval, overlaps } from '../interval.js';
import { fmt, fmtQuantityValue } from '../format.js';

/** a sentence that compares two periods restates nothing */
const COMPARING =
  /\b(?:vs\.?|versus|compared|earlier|previous|prior|ago|forecast|projected|expects?|expected|estimates?|estimated|target|budget(?:ed)?|guidance|whole sector|industry-wide)\b/i;

const COMPARATIVE =
  /\b(?:vs\.?|versus|compared\s+(?:with|to)|against|from|than|earlier|previous|prior|ago|forecast|expected|estimate[ds]?|target|up|down|to)\s*[$€£¥₹]?\s*$/i;

const GENERIC_NOUNS = new Set([
  'people', 'person', 'time', 'thing', 'case', 'year', 'day', 'month', 'week', 'number',
  'one', 'other', 'part', 'point', 'way', 'item', 'unit', 'total', 'level', 'rate', 'share',
]);

function key(q: Quantity): string | undefined {
  if (!q.noun || q.noun.length < 4 || GENERIC_NOUNS.has(q.noun)) return undefined;
  if (q.kind === 'year' || q.ordinal) return undefined;
  const dim = q.currency ?? q.unit?.def.id ?? q.kind;
  return `${dim}|${q.noun}`;
}

/** the two words before the number, which usually carry the referent ("the Halton bridge") */
function context(ctx: { text: string }, q: Quantity): string {
  const before = q.before ?? '';
  const words = before.trim().split(/[\s ]+/).filter((w) => /[A-Za-z]/.test(w));
  return words.slice(-2).join(' ').toLowerCase().replace(/[^a-z\s]/g, '');
}

/**
 * The same figure given twice with different values — and its nastiest variant,
 * the scale slip, where "$4.2 billion" becomes "$4.2 million" three paragraphs later.
 */
export const restatement: Rule = {
  id: 'restatement',
  description: 'The same quantity is given two different values in one document.',
  run(ctx: RuleContext) {
    const groups = new Map<string, Quantity[]>();
    for (const q of ctx.quantities) {
      const k = key(q);
      if (!k) continue;
      const arr = groups.get(k) ?? [];
      arr.push(q);
      groups.set(k, arr);
    }
    for (const [k, group] of groups) {
      if (group.length < 2) continue;
      const noun = k.split('|')[1]!;
      for (let i = 0; i < group.length - 1; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i]!;
          const b = group[j]!;
          if (a.sentence === b.sentence) continue;
          if (a.hedge !== 'exact' || b.hedge !== 'exact') continue;
          if (overlaps(toInterval(a, ctx.options.slack), toInterval(b, ctx.options.slack))) continue;

          // a comparison is not a restatement: "6.5 mln vs 6.5 bln a year earlier"
          if (COMPARATIVE.test(a.before ?? '') || COMPARATIVE.test(b.before ?? '')) continue;
          if (a.attributive || b.attributive) continue;
          const ratio = b.value !== 0 ? a.value / b.value : 0;
          // The signature of a scale slip is the same digits under a different scale
          // word: "$4.2 billion" becoming "$4.2 million". Two different counts that
          // happen to be 1000x apart are not slips.
          const sameDigits = !!a.literalText && a.literalText === b.literalText;
          const bothScaled = !!a.scaleWord && !!b.scaleWord && a.scaleWord !== b.scaleWord;
          const scaleSlip =
            sameDigits && bothScaled &&
            [1e3, 1e6, 1e9, 1 / 1e3, 1 / 1e6, 1 / 1e9].some((r) => Math.abs(ratio - r) / r < 1e-6);
          if (scaleSlip) {
            const sa = ctx.sentences[a.sentence]?.text ?? '';
            const sb = ctx.sentences[b.sentence]?.text ?? '';
            if (COMPARING.test(sa) || COMPARING.test(sb)) continue;
            const bigger = Math.abs(a.value) > Math.abs(b.value) ? a : b;
            const smaller = bigger === a ? b : a;
            ctx.report({
              rule: 'scale-slip',
              severity: 'error',
              confidence: 0.88,
              message: `The same ${noun} figure appears as ${bigger.span.text} and ${smaller.span.text} — a factor of ${fmt(Math.abs(bigger.value / smaller.value))} apart.`,
              stated: smaller.span.text,
              expected: bigger.span.text,
              workings: `${fmtQuantityValue(bigger.value, { currency: bigger.currency, unit: bigger.unit?.surface, scaled: true })} vs ${fmtQuantityValue(smaller.value, { currency: smaller.currency, unit: smaller.unit?.surface, scaled: true })}`,
              span: smaller.span,
              relatedSpans: [bigger.span],
            });
            continue;
          }
        }
      }
    }
  },
};
