import type { Rule, RuleContext } from '../rule.js';
import { severityFor, confidenceFor } from '../rule.js';
import type { Quantity } from '../types.js';
import { toInterval, overlaps, sub, div, scale, iv, type Interval } from '../interval.js';
import { fmt } from '../format.js';
import { looksLikeYear } from './percentOfBase.js';

const UP_WORDS = /\b(increase[ds]?|increasing|rise|rose|risen|rising|grew|grow(?:th|ing|n)?|jump(?:ed)?|climb(?:ed)?|gain(?:ed|s)?|up|higher|more|surge[ds]?|soar(?:ed)?|expand(?:ed)?|added)\b/i;
const DOWN_WORDS = /\b(decrease[ds]?|decreasing|fall|fell|fallen|falling|drop(?:ped)?|declin(?:e|ed|ing)|reduc(?:e|ed|tion)|cut|down|lower|less|fewer|shrank|shrunk|slid|slipped|plunge[ds]?|contract(?:ed)?|lost)\b/i;
const CHANGE_NOUN = /\b(increase|rise|growth|jump|gain|surge|decrease|decline|drop|fall|reduction|cut|loss|change|swing|difference)\b/i;
const MULTIPLIERS: Array<[RegExp, number, string]> = [
  [/\bdoubl(?:ed|ing)\b/i, 2, 'doubled'],
  [/\btripl(?:ed|ing)\b/i, 3, 'tripled'],
  [/\bquadrupl(?:ed|ing)\b/i, 4, 'quadrupled'],
  [/\bhalv(?:ed|ing)\b/i, 0.5, 'halved'],
];

function directionOf(s: string): 1 | -1 | 0 {
  const up = UP_WORDS.test(s);
  const down = DOWN_WORDS.test(s);
  if (up && !down) return 1;
  if (down && !up) return -1;
  return 0;
}

/**
 * "revenue rose from $4.5m to $6.2m, a 33% increase" and its many cousins,
 * including the percent / percentage-point conflation that style guides have
 * been losing the war against for fifty years.
 */
export const percentChange: Rule = {
  id: 'percent-change',
  description: 'A stated percentage change does not match the before and after values.',
  run(ctx: RuleContext) {
    const qs = ctx.quantities;

    for (let i = 0; i < qs.length - 1; i++) {
      const a = qs[i]!;
      const b = qs[i + 1]!;
      if (a.sentence !== b.sentence) continue;
      const link = ctx.text.slice(a.span.end, b.span.start);
      if (!/^[\s ]*(?:[a-z][\w'-]*[\s ]+){0,2}to[\s ]+(?:[a-z][\w'-]*[\s ]+){0,2}$/i.test(link)) continue;
      const lead = ctx.text.slice(Math.max(0, a.span.start - 60), a.span.start);
      if (!/\bfrom[\s ]*$/i.test(lead.replace(/[$€£¥₹\s]*$/, ' '))) continue;
      if (a.value === 0) continue;
      if (!compatible(a, b)) continue;

      const sentence = ctx.sentences[a.sentence];
      const tail = ctx.text.slice(b.span.end, sentence ? sentence.end : b.span.end + 90);
      const change = nextChangeQuantity(ctx, qs, i + 2, b, 90);

      const bothPercent = a.kind === 'percent' && b.kind === 'percent';
      const ppDiff = b.value - a.value;
      const relPoint = ((b.value - a.value) / a.value) * 100;

      if (change) {
        const context = ctx.text.slice(b.span.end, change.q.span.end + 24);
        const dir = directionOf(context) || directionOf(lead);
        const signed = dir === -1 ? -Math.abs(change.q.value) : dir === 1 ? Math.abs(change.q.value) : change.q.value;

        // direction contradicts the numbers
        if (dir !== 0 && Math.sign(b.value - a.value) !== 0 && dir !== Math.sign(b.value - a.value)) {
          ctx.report({
            rule: 'percent-change',
            severity: 'error',
            confidence: 0.9,
            message: `${b.span.text} is ${b.value > a.value ? 'higher' : 'lower'} than ${a.span.text}, so this is ${b.value > a.value ? 'an increase' : 'a decrease'}, not ${dir === 1 ? 'an increase' : 'a decrease'}.`,
            stated: change.q.span.text,
            expected: `${fmt(Math.abs(relPoint))}% ${relPoint > 0 ? 'increase' : 'decrease'}`,
            workings: `${fmt(a.value)} → ${fmt(b.value)} is a ${relPoint > 0 ? 'rise' : 'fall'} of ${fmt(Math.abs(b.value - a.value))}`,
            span: change.q.span,
            relatedSpans: [a.span, b.span],
          });
          continue;
        }

        if (bothPercent && change.q.kind === 'percentage-point') {
          const expected = sub(toInterval(b, ctx.options.slack), toInterval(a, ctx.options.slack));
          const stated = iv(Math.abs(signed) * Math.sign(ppDiff || 1), Math.abs(signed) * Math.sign(ppDiff || 1));
          const statedIv = expand(stated, change.q.quantum * ctx.options.slack);
          if (!overlaps(statedIv, expected)) {
            report(ctx, change.q, a, b,
              `${fmt(Math.abs(ppDiff))} percentage points`,
              `${fmt(a.value)}% → ${fmt(b.value)}% is a change of ${fmt(Math.abs(ppDiff))} percentage points`,
              0.9);
          }
          continue;
        }

        if (bothPercent && change.q.kind === 'percent') {
          const relIv = relativeInterval(ctx, a, b);
          const statedIv = expand(iv(signed, signed), change.q.quantum * ctx.options.slack);
          const ppIv = expand(iv(ppDiff, ppDiff), change.q.quantum * ctx.options.slack);
          if (relIv && overlaps(statedIv, relIv)) continue;    // correct relative reading
          if (overlaps(statedIv, ppIv)) {
            ctx.report({
              rule: 'percentage-point-confusion',
              severity: 'warning',
              confidence: 0.84,
              message: `A move from ${a.span.text} to ${b.span.text} is ${fmt(Math.abs(ppDiff))} percentage points, not ${change.q.span.text} — as a percentage it is a ${fmt(Math.abs(relPoint))}% ${relPoint > 0 ? 'rise' : 'fall'}.`,
              stated: change.q.span.text,
              expected: `${fmt(Math.abs(ppDiff))} percentage points (= ${fmt(Math.abs(relPoint))}%)`,
              workings: `${fmt(b.value)}% − ${fmt(a.value)}% = ${fmt(Math.abs(ppDiff))} pp; ${fmt(Math.abs(ppDiff))} ÷ ${fmt(a.value)} = ${fmt(Math.abs(relPoint))}%`,
              span: change.q.span,
              relatedSpans: [a.span, b.span],
              fix: `${fmt(Math.abs(ppDiff))} percentage points`,
            });
            continue;
          }
          if (relIv) {
            report(ctx, change.q, a, b,
              `${fmt(Math.abs(relPoint))}% (or ${fmt(Math.abs(ppDiff))} percentage points)`,
              `(${fmt(b.value)} − ${fmt(a.value)}) ÷ ${fmt(a.value)} = ${fmt(relPoint / 100, { sig: 4 })} → ${fmt(Math.abs(relPoint))}%`,
              0.86);
          }
          continue;
        }

        if (change.q.kind === 'percent') {
          const relIv = relativeInterval(ctx, a, b);
          if (!relIv) continue;
          const statedIv = expand(iv(signed, signed), change.q.quantum * ctx.options.slack);
          if (overlaps(statedIv, relIv)) continue;
          report(ctx, change.q, a, b,
            `${fmt(Math.abs(relPoint))}%`,
            `(${fmt(b.value)} − ${fmt(a.value)}) ÷ ${fmt(a.value)} = ${fmt(relPoint / 100, { sig: 4 })} → ${fmt(Math.abs(relPoint))}%`,
            0.89);
          continue;
        }
      }

      // "doubled from A to B"
      for (const [re, mult, word] of MULTIPLIERS) {
        if (!re.test(lead) && !re.test(tail.slice(0, 40))) continue;
        const ratio = b.value / a.value;
        if (Math.abs(ratio - mult) / mult <= 0.2) break;
        ctx.report({
          rule: 'multiplier-mismatch',
          severity: 'warning',
          confidence: 0.8,
          message: `${a.span.text} → ${b.span.text} is a ${fmt(ratio, { sig: 3 })}× change, which is not "${word}".`,
          stated: word,
          expected: `${fmt(mult)}× would be ${fmt(a.value * mult)}`,
          workings: `${fmt(b.value)} ÷ ${fmt(a.value)} = ${fmt(ratio, { sig: 3 })}×`,
          span: b.span,
          relatedSpans: [a.span],
        });
        break;
      }
    }

    // "Revenue hit $6.2m, up 33% from $4.5m"
    for (let i = 1; i < qs.length - 1; i++) {
      const pct = qs[i]!;
      if (pct.kind !== 'percent') continue;
      const b = qs[i - 1]!;
      const a = qs[i + 1]!;
      if (b.sentence !== pct.sentence || a.sentence !== pct.sentence) continue;
      if (!compatible(a, b) || a.value === 0) continue;
      const mid = ctx.text.slice(b.span.end, pct.span.start);
      const post = ctx.text.slice(pct.span.end, a.span.start);
      if (mid.length > 30 || post.length > 30) continue;
      if (!/\b(up|down|rose|fell|grew|increased|decreased|declined|dropped|climbed|jumped|higher|lower|gain|loss)\b/i.test(mid)) continue;
      if (!/^[\s,]*(?:from|compared (?:with|to)|versus|vs\.?|against|on)\b[\s ]*(?:the[\s ]+)?$/i.test(post)) continue;
      const dir = directionOf(mid);
      const signed = dir === -1 ? -Math.abs(pct.value) : Math.abs(pct.value);
      const relIv = relativeInterval(ctx, a, b);
      if (!relIv) continue;
      const statedIv = expand(iv(signed, signed), pct.quantum * ctx.options.slack);
      if (overlaps(statedIv, relIv)) continue;
      const relPoint = ((b.value - a.value) / a.value) * 100;
      report(ctx, pct, a, b,
        `${fmt(Math.abs(relPoint))}%`,
        `(${fmt(b.value)} − ${fmt(a.value)}) ÷ ${fmt(a.value)} = ${fmt(relPoint / 100, { sig: 4 })} → ${fmt(Math.abs(relPoint))}%`,
        0.87);
    }
  },
};

function compatible(a: Quantity, b: Quantity): boolean {
  if (a.kind === 'year' || b.kind === 'year') return false;
  if (a.attributive || b.attributive) return false;
  if (looksLikeYear(a) || looksLikeYear(b)) return false;
  if (a.currency || b.currency) return a.currency === b.currency;
  if (a.unit || b.unit) return a.unit?.def.id === b.unit?.def.id;
  return a.kind === b.kind || (a.kind === 'plain' && b.kind === 'plain');
}

function relativeInterval(ctx: RuleContext, a: Quantity, b: Quantity): Interval | undefined {
  const A = toInterval(a, ctx.options.slack);
  const B = toInterval(b, ctx.options.slack);
  if (A.lo <= 0 && A.hi >= 0) return undefined;
  const r = div(sub(B, A), A);
  return r ? scale(r, 100) : undefined;
}

function expand(i: Interval, by: number): Interval {
  return iv(i.lo - by, i.hi + by);
}

function nextChangeQuantity(
  ctx: RuleContext,
  qs: Quantity[],
  from: number,
  b: Quantity,
  limit: number,
): { q: Quantity } | undefined {
  for (let j = from; j < qs.length; j++) {
    const q = qs[j]!;
    if (q.sentence !== b.sentence) return undefined;
    if (q.span.start - b.span.end > limit) return undefined;
    const between = ctx.text.slice(b.span.end, q.span.start);
    if (/[;.]/.test(between)) return undefined;
    if (q.kind === 'percent' || q.kind === 'percentage-point') {
      const window = ctx.text.slice(b.span.end, Math.min(ctx.text.length, q.span.end + 20));
      if (!CHANGE_NOUN.test(window) && !UP_WORDS.test(window) && !DOWN_WORDS.test(window)) return undefined;
      return { q };
    }
    return undefined;
  }
  return undefined;
}

function report(
  ctx: RuleContext,
  stated: Quantity,
  a: Quantity,
  b: Quantity,
  expected: string,
  workings: string,
  base: number,
): void {
  const statedIv = iv(stated.value, stated.value);
  const expIv = iv(0, 0);
  ctx.report({
    rule: 'percent-change',
    severity: severityFor(statedIv, expIv) === 'info' ? 'warning' : 'error',
    confidence: confidenceFor(base, statedIv, expIv),
    message: `${a.span.text} → ${b.span.text} is ${expected}, not ${stated.span.text}.`,
    stated: stated.span.text,
    expected,
    workings,
    span: stated.span,
    relatedSpans: [a.span, b.span],
  });
}
