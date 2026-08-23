import type { Rule, RuleContext } from '../rule.js';
import type { Quantity } from '../types.js';
import { fmt } from '../format.js';

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7,
  september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_ALT = Object.keys(MONTHS).join('|');

/** "Tuesday, 5 March 2026" — the weekday and the date disagree. */
export const weekdayDate: Rule = {
  id: 'weekday-date',
  description: 'A named weekday does not fall on the date given.',
  run(ctx: RuleContext) {
    const patterns = [
      new RegExp(`\\b(${DAYS.join('|')}),?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_ALT})\\.?,?\\s+(\\d{4})\\b`, 'gi'),
      new RegExp(`\\b(${DAYS.join('|')}),?\\s+(${MONTH_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'gi'),
    ];
    for (let p = 0; p < patterns.length; p++) {
      const re = patterns[p]!;
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(ctx.text))) {
        const day = parseInt(p === 0 ? m[2]! : m[3]!, 10);
        const month = MONTHS[(p === 0 ? m[3]! : m[2]!).toLowerCase().replace('.', '')];
        const year = parseInt(m[4]!, 10);
        if (month === undefined || !day || day > 31) continue;
        const d = new Date(Date.UTC(year, month, day));
        if (d.getUTCMonth() !== month || d.getUTCDate() !== day) {
          ctx.report({
            rule: 'weekday-date',
            severity: 'error',
            confidence: 0.95,
            message: `${m[0]} is not a real date — ${monthName(month)} ${year} has no day ${day}.`,
            stated: m[0], expected: 'a valid date',
            workings: `${monthName(month)} ${year} has ${new Date(Date.UTC(year, month + 1, 0)).getUTCDate()} days`,
            span: { start: m.index, end: m.index + m[0].length, text: m[0] },
            relatedSpans: [],
          });
          continue;
        }
        const actual = DAYS[d.getUTCDay()]!;
        const claimed = m[1]!;
        if (actual.toLowerCase() === claimed.toLowerCase()) continue;
        ctx.report({
          rule: 'weekday-date',
          severity: 'error',
          confidence: 0.94,
          message: `${day} ${monthName(month)} ${year} was a ${actual}, not a ${capitalise(claimed)}.`,
          stated: claimed,
          expected: actual,
          workings: `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')} is a ${actual}`,
          span: { start: m.index, end: m.index + claimed.length, text: claimed },
          relatedSpans: [],
          fix: actual,
        });
      }
    }
  },
};

const SPAN_WORDS = /\b(?:period|span|spanning|over|between|from|across|during|study|programme|program)\b/i;

/** "from 1990 to 2015, a 30-year period" — the span and the years disagree. */
export const dateSpan: Rule = {
  id: 'date-span',
  description: 'A stated number of years does not match the years given.',
  run(ctx: RuleContext) {
    const qs = ctx.quantities;
    for (let i = 0; i < qs.length - 1; i++) {
      const y1 = qs[i]!;
      const y2 = qs[i + 1]!;
      if (y1.kind !== 'year' || y2.kind !== 'year') continue;
      if (y1.sentence !== y2.sentence) continue;
      const between = ctx.text.slice(y1.span.end, y2.span.start);
      if (!/^[\s  ]*(?:[a-z][\w'-]*[\s  ]+){0,3}(?:to|and|[–—-]|until|through)[\s  ]*$/i.test(between)) continue;
      const diff = y2.value - y1.value;
      if (diff <= 0 || diff > 400) continue;
      const sentence = ctx.sentences[y1.sentence];
      if (!sentence) continue;
      const lead = ctx.text.slice(sentence.start, y1.span.start);
      if (!SPAN_WORDS.test(lead) && !SPAN_WORDS.test(ctx.text.slice(y2.span.end, sentence.end))) continue;

      // an unrelated duration elsewhere in the sentence is not this span's length
      const NEAR = 28;
      const tightlyJoined = /^[\s]*(?:to|and|[–—-]|until|through)[\s]*$/i.test(between);
      const dur =
        findDuration(ctx, qs, i + 2, Math.min(sentence.end, y2.span.end + NEAR), y2) ??
        (tightlyJoined
          ? findDurationBefore(ctx, qs, i - 1, Math.max(sentence.start, y1.span.start - NEAR), y1)
          : undefined);
      if (!dur) continue;
      const years = dur.years;
      // both the exclusive and inclusive readings are defensible
      if (Math.abs(years - diff) <= dur.tolerance || Math.abs(years - (diff + 1)) <= dur.tolerance) continue;
      ctx.report({
        rule: 'date-span',
        severity: 'error',
        confidence: 0.87,
        message: `${y1.span.text} to ${y2.span.text} is ${fmt(diff)} years, not ${fmt(dur.years)}.`,
        stated: dur.q.span.text,
        expected: `${fmt(diff)} years`,
        workings: `${fmt(y2.value)} − ${fmt(y1.value)} = ${fmt(diff)}`,
        span: dur.q.span,
        relatedSpans: [y1.span, y2.span],
        fix: `${fmt(diff)} years`,
      });
    }
  },
};

function findDuration(ctx: RuleContext, qs: Quantity[], from: number, limit: number, anchor: Quantity) {
  for (let j = from; j < qs.length; j++) {
    const q = qs[j]!;
    if (q.span.start > limit) return undefined;
    if (q.sentence !== anchor.sentence) return undefined;
    if (q.unit && (q.unit.def.id === 'year' || q.unit.def.id === 'decade')) {
      if (RELATIVE_TIME.test(ctx.text.slice(q.span.end, q.span.end + 12))) return undefined;
      const years = q.unit.def.id === 'decade' ? q.value * 10 : q.value;
      return { q, years, tolerance: q.quantum + (q.hedge === 'about' ? Math.abs(years) * 0.05 : 0) };
    }
  }
  return undefined;
}

/** "six years ago" measures a distance from now, not the length of a span. */
const RELATIVE_TIME = /^[\s]*(?:ago|earlier|later|before|after|since|old|hence|previously)\b/i;

function findDurationBefore(ctx: RuleContext, qs: Quantity[], from: number, limit: number, anchor: Quantity) {
  for (let j = from; j >= 0; j--) {
    const q = qs[j]!;
    if (q.span.end < limit) return undefined;
    if (q.sentence !== anchor.sentence) return undefined;
    if (q.unit && (q.unit.def.id === 'year' || q.unit.def.id === 'decade')) {
      if (RELATIVE_TIME.test(ctx.text.slice(q.span.end, q.span.end + 12))) return undefined;
      const years = q.unit.def.id === 'decade' ? q.value * 10 : q.value;
      return { q, years, tolerance: q.quantum + (q.hedge === 'about' ? Math.abs(years) * 0.05 : 0) };
    }
  }
  return undefined;
}

const AGE_RE =
  /\bborn\s+in\s+(\d{4})\b[^.]{0,160}?\b(?:died|passed\s+away)\b[^.]{0,60}?\bin\s+(\d{4})\b[^.]{0,60}?\b(?:aged|at\s+the\s+age\s+of)\s+(\d{1,3})\b/gi;
const AGE_RE_DIED_FIRST =
  /\bborn\s+in\s+(\d{4})\b[^.]{0,160}?\b(?:died|passed\s+away)\b[^.]{0,40}?\b(?:aged|at\s+the\s+age\s+of)\s+(\d{1,3})\b[^.]{0,40}?\bin\s+(\d{4})\b/gi;
const AGE_RE_2 =
  /\b(?:aged|at\s+the\s+age\s+of)\s+(\d{1,3})\b[^.]{0,80}?\bin\s+(\d{4})\b[^.]{0,80}?\bborn\s+in\s+(\d{4})\b/gi;

/** "born in 1943 … died in 1999 at the age of 55" */
export const ageArithmetic: Rule = {
  id: 'age-arithmetic',
  description: 'A stated age does not match the years of birth and death.',
  run(ctx: RuleContext) {
    AGE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = AGE_RE.exec(ctx.text))) {
      report(ctx, parseInt(m[1]!, 10), parseInt(m[2]!, 10), parseInt(m[3]!, 10), m.index + m[0].lastIndexOf(m[3]!), m[3]!);
    }
    AGE_RE_DIED_FIRST.lastIndex = 0;
    while ((m = AGE_RE_DIED_FIRST.exec(ctx.text))) {
      report(ctx, parseInt(m[1]!, 10), parseInt(m[3]!, 10), parseInt(m[2]!, 10), m.index + m[0].indexOf(m[2]!, m[0].indexOf('aged')), m[2]!);
    }
    AGE_RE_2.lastIndex = 0;
    while ((m = AGE_RE_2.exec(ctx.text))) {
      report(ctx, parseInt(m[3]!, 10), parseInt(m[2]!, 10), parseInt(m[1]!, 10), m.index + m[0].indexOf(m[1]!), m[1]!);
    }
  },
};

function report(ctx: RuleContext, born: number, died: number, age: number, at: number, raw: string): void {
  const diff = died - born;
  if (age === diff || age === diff - 1) return;
  if (diff < 0 || diff > 130) return;
  ctx.report({
    rule: 'age-arithmetic',
    severity: 'error',
    confidence: 0.9,
    message: `Someone born in ${born} who died in ${died} was ${diff - 1} or ${diff}, not ${age}.`,
    stated: raw,
    expected: `${diff - 1} or ${diff}`,
    workings: `${died} − ${born} = ${diff}`,
    span: { start: at, end: at + raw.length, text: raw },
    relatedSpans: [],
    fix: String(diff),
  });
}

function monthName(m: number): string {
  return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m]!;
}
function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
