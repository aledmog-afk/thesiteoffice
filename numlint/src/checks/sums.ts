import type { Rule, RuleContext } from '../rule.js';
import { severityFor, confidenceFor } from '../rule.js';
import type { Quantity } from '../types.js';
import { toInterval, overlaps, add, iv, type Interval } from '../interval.js';
import { fmt, fmtQuantityValue } from '../format.js';
import { looksLikeYear } from './percentOfBase.js';

const TOTAL_BEFORE =
  /\b(?:for\s+)?(?:a\s+)?(?:combined\s+|grand\s+|running\s+)?total(?:l?ing|s)?(?:\s+of)?\s*[:—–-]?\s*$|\b(?:adds?\s+up\s+to|sum(?:ming)?\s+to|in\s+all|all\s+told|altogether|combined|in\s+total)\s*[:—–-]?\s*$/i;
const TOTAL_AFTER = /^[\s,]*(?:in\s+total|in\s+all|altogether|combined|overall|all\s+told)\b/i;
/**
 * Two quantities belong to the same list when the words between them contain a
 * list separator and nothing that signals a different relation ("of", "per").
 */
function listSeparated(between: string): boolean {
  if (between.length > 48) return false;
  if (/[;:()\[\]]/.test(between)) return false;
  if (!/,|\band\b|\bplus\b|&/i.test(between)) return false;
  if (/\b(?:of|per|out of|from|to|than|times|versus|vs\.?|between|compared)\b/i.test(between)) return false;
  return true;
}
const BREAKDOWN =
  /\b(?:of (?:those|them|respondents|voters|adults|people|households|firms|companies|customers|users|staff|students|patients)|respondents|surveyed|polled|share[sd]?\b|split|breakdown|support(?:ed)?|backed|chose|selected|preferred|responded|reported|answered|said|voted|market share|accounted for|made up|comprised|consisted)\b/i;

const MULTISELECT =
  /\b(?:more than one|multiple (?:answers|responses|options)|select all|choose all|check all|not (?:add|sum) to 100|do not sum|respondents could)\b/i;

function comparable(a: Quantity, b: Quantity): boolean {
  if (a.kind === 'year' || b.kind === 'year' || a.ordinal || b.ordinal) return false;
  if (a.attributive || b.attributive) return false;
  if (looksLikeYear(a) || looksLikeYear(b)) return false;
  if (a.currency || b.currency) return a.currency === b.currency;
  if (a.unit || b.unit) return a.unit?.def.id === b.unit?.def.id;
  return a.kind === b.kind;
}

/** The maximal list-like run of comparable quantities ending at index `end`. */
function runEndingAt(ctx: RuleContext, qs: Quantity[], end: number): Quantity[] {
  const run: Quantity[] = [qs[end]!];
  for (let i = end - 1; i >= 0; i--) {
    const cur = qs[i]!;
    const next = run[0]!;
    if (cur.sentence !== next.sentence) break;
    if (!comparable(cur, next)) break;
    const between = ctx.text.slice(cur.span.end, next.span.start);
    if (!listSeparated(between)) break;
    run.unshift(cur);
  }
  return run;
}

function sumInterval(ctx: RuleContext, parts: Quantity[]): Interval {
  return parts.map((p) => toInterval(p, ctx.options.slack)).reduce(add, iv(0, 0));
}

/**
 * "A, B and C — a total of T". Only fires when the document states the total
 * explicitly, and only when no suffix of the list can produce it either.
 */
export const sumOfParts: Rule = {
  id: 'sum-of-parts',
  description: 'An explicitly stated total does not match the parts listed beside it.',
  run(ctx: RuleContext) {
    const qs = ctx.quantities;
    for (let t = 0; t < qs.length; t++) {
      const total = qs[t]!;
      if (total.kind === 'year' || total.ordinal || total.attributive || looksLikeYear(total)) continue;
      const before = ctx.text.slice(Math.max(0, total.span.start - 40), total.span.start);
      const after = ctx.text.slice(total.span.end, total.span.end + 24);
      const anchored = TOTAL_BEFORE.test(before.replace(/[$€£¥₹\s]+$/, ' ')) || TOTAL_AFTER.test(after);
      if (!anchored) continue;
      if (t === 0) continue;
      const run = runEndingAt(ctx, qs, t - 1);
      if (run.length < 2) continue;
      // the list and its total must be the same statement
      if (run.some((p) => p.sentence !== total.sentence)) continue;
      // real prose lists join their last two items with a conjunction; tabular
      // fragments ("Maize Mar 48.0, total 48.0") do not
      const joined = run.slice(1).some((p, k) => /\band\b|\bplus\b|&/i.test(ctx.text.slice(run[k]!.span.end, p.span.start)));
      if (!joined) continue;
      // "£5m of the £20m raised, plus £2m" — £20m is a base, not an addend, and we
      // cannot tell which of the rest are parts, so we say nothing at all
      if (run.some((p) => /\b(?:of|out of|from)\s+(?:the\s+|its\s+)?[$€£¥₹]?\s*$/i.test(p.before ?? ''))) continue;
      // any suffix of the run that reconciles means the document is fine
      let ok = false;
      for (let s = 0; s <= run.length - 2; s++) {
        const parts = run.slice(s);
        if (overlaps(sumInterval(ctx, parts), toInterval(total, ctx.options.slack))) { ok = true; break; }
      }
      if (ok) continue;
      const parts = run;
      const point = parts.reduce((acc, p) => acc + p.value, 0);
      const stated = toInterval(total, ctx.options.slack);
      const expected = sumInterval(ctx, parts);
      ctx.report({
        rule: 'sum-of-parts',
        severity: severityFor(stated, expected),
        confidence: confidenceFor(0.88, stated, expected),
        message: `The parts add up to ${fmtQuantityValue(point, { currency: total.currency, unit: total.unit?.surface, percent: total.kind === 'percent' })}, not ${total.span.text}.`,
        stated: total.span.text,
        expected: fmtQuantityValue(point, { currency: total.currency, unit: total.unit?.surface, percent: total.kind === 'percent' }),
        workings: `${parts.map((p) => fmt(p.value)).join(' + ')} = ${fmt(point)}`,
        span: total.span,
        relatedSpans: parts.map((p) => p.span),
      });
    }
  },
};

/**
 * Shares of a whole that add to more than 100%. Suppressed when the text says
 * respondents could pick more than one answer.
 */
export const percentSum: Rule = {
  id: 'percent-sum',
  description: 'Percentages presented as a breakdown add to more than 100%.',
  run(ctx: RuleContext) {
    const qs = ctx.quantities;
    const used = new Set<number>();
    for (let i = 0; i < qs.length; i++) {
      if (used.has(i)) continue;
      const start = qs[i]!;
      if (start.kind !== 'percent') continue;
      const run: Quantity[] = [start];
      let j = i + 1;
      while (j < qs.length) {
        const cur = qs[j]!;
        const prev = run[run.length - 1]!;
        if (cur.kind !== 'percent' || cur.sentence !== prev.sentence) break;
        const between = ctx.text.slice(prev.span.end, cur.span.start);
        if (!listSeparated(between)) break;
        run.push(cur);
        j++;
      }
      if (run.length < 3) continue;
      for (let k = i; k < j; k++) used.add(k);
      const para = ctx.sentences[start.sentence]?.para;
      const paraText = ctx.sentences.filter((s) => s.para === para).map((s) => s.text).join(' ');
      if (MULTISELECT.test(paraText)) continue;
      if (run.some((q) => q.hedge === 'over' || q.hedge === 'range')) continue;
      // rhetoric repeats a figure ("50 percent richer, 50 percent happier"); a
      // breakdown does not
      if (new Set(run.map((q) => q.value)).size < 2) continue;
      // and a breakdown says what it is a breakdown of
      const isList = ctx.sentences[start.sentence]?.listItem === true || /\|/.test(ctx.sentences[start.sentence]?.text ?? '');
      if (!isList && !BREAKDOWN.test(paraText)) continue;
      const total = sumInterval(ctx, run);
      if (total.lo <= 100) continue;
      const point = run.reduce((a, p) => a + p.value, 0);
      const stated = iv(point, point);
      const expected = iv(100, 100);
      ctx.report({
        rule: 'percent-sum',
        severity: 'error',
        confidence: confidenceFor(0.85, stated, expected),
        message: `These shares add up to ${fmt(point)}%, which is more than the whole.`,
        stated: `${fmt(point)}%`,
        expected: '100% or less',
        workings: `${run.map((p) => fmt(p.value)).join('% + ')}% = ${fmt(point)}%`,
        span: run[run.length - 1]!.span,
        relatedSpans: run.slice(0, -1).map((p) => p.span),
      });
    }
  },
};

interface Cell { text: string; start: number; end: number }

function parseTables(text: string): Array<{ rows: Cell[][] }> {
  const tables: Array<{ rows: Cell[][] }> = [];
  const lines: Array<{ text: string; start: number }> = [];
  let pos = 0;
  for (const line of text.split('\n')) {
    lines.push({ text: line, start: pos });
    pos += line.length + 1;
  }
  let current: Cell[][] = [];
  const flush = () => {
    if (current.length >= 3) tables.push({ rows: current });
    current = [];
  };
  for (const line of lines) {
    const isRow = (line.text.match(/\|/g) ?? []).length >= 2;
    if (!isRow) { flush(); continue; }
    const cells: Cell[] = [];
    let idx = 0;
    const parts = line.text.split('|');
    for (let p = 0; p < parts.length; p++) {
      const raw = parts[p]!;
      const cellStart = line.start + idx;
      idx += raw.length + 1;
      if (p === 0 && raw.trim() === '') continue;
      if (p === parts.length - 1 && raw.trim() === '') continue;
      cells.push({ text: raw, start: cellStart, end: cellStart + raw.length });
    }
    if (cells.length >= 2) current.push(cells);
  }
  flush();
  return tables;
}

/** Markdown tables with a total row or column — the natural habitat of generated reports. */
export const tableSum: Rule = {
  id: 'table-sum',
  description: 'A total row or column in a table does not match the cells it totals.',
  run(ctx: RuleContext) {
    const qIn = (c: Cell): Quantity | undefined =>
      ctx.quantities.find((q) => q.span.start >= c.start && q.span.end <= c.end + 1);
    for (const table of parseTables(ctx.text)) {
      const rows = table.rows.filter((r) => !r.every((c) => /^[\s:|-]*$/.test(c.text)));
      if (rows.length < 2) continue;
      const totalRowIdx = rows.findIndex((r, i) => i > 0 && /^\s*\**\s*(total|totals|sum|overall|all|grand total)\b/i.test(r[0]?.text ?? ''));
      const width = Math.max(...rows.map((r) => r.length));

      if (totalRowIdx > 0) {
        for (let col = 1; col < width; col++) {
          const totalCell = rows[totalRowIdx]![col];
          if (!totalCell) continue;
          const totalQ = qIn(totalCell);
          if (!totalQ) continue;
          const parts: Quantity[] = [];
          for (let r = 1; r < rows.length; r++) {
            if (r === totalRowIdx) continue;
            if (/^\s*\**\s*(total|totals|sum|overall|grand total)\b/i.test(rows[r]![0]?.text ?? '')) continue;
            const c = rows[r]![col];
            const q = c ? qIn(c) : undefined;
            if (q) parts.push(q);
          }
          if (parts.length < 2) continue;
          if (!parts.every((p) => comparable(p, totalQ))) continue;
          // growth rates, margins and other per-row percentages do not add up to
          // anything; only a column of shares of one whole does
          if (totalQ.kind === 'percent' && (totalQ.value < 95 || totalQ.value > 105)) continue;
          const expected = sumInterval(ctx, parts);
          const stated = toInterval(totalQ, ctx.options.slack);
          if (overlaps(stated, expected)) continue;
          const point = parts.reduce((a, p) => a + p.value, 0);
          const header = rows[0]![col]?.text.trim() ?? `column ${col + 1}`;
          ctx.report({
            rule: 'table-sum',
            severity: severityFor(stated, expected),
            confidence: confidenceFor(0.92, stated, expected),
            message: `The "${header}" column adds up to ${fmt(point)}, but the total row says ${totalQ.span.text}.`,
            stated: totalQ.span.text,
            expected: fmtQuantityValue(point, { currency: totalQ.currency, unit: totalQ.unit?.surface, percent: totalQ.kind === 'percent' }),
            workings: `${parts.map((p) => fmt(p.value)).join(' + ')} = ${fmt(point)}`,
            span: totalQ.span,
            relatedSpans: parts.map((p) => p.span),
          });
        }
      }

      // a "Total" column at the end of each row
      const headerCells = rows[0] ?? [];
      const totalColIdx = headerCells.findIndex((c, i) => i > 0 && /^\s*\**\s*(total|totals|sum|overall)\b/i.test(c.text));
      if (totalColIdx > 0) {
        for (let r = 1; r < rows.length; r++) {
          const row = rows[r]!;
          const totalQ = row[totalColIdx] ? qIn(row[totalColIdx]!) : undefined;
          if (!totalQ) continue;
          const parts: Quantity[] = [];
          for (let c = 1; c < row.length; c++) {
            if (c === totalColIdx) continue;
            const q = qIn(row[c]!);
            if (q) parts.push(q);
          }
          if (parts.length < 2 || !parts.every((p) => comparable(p, totalQ))) continue;
          if (totalQ.kind === 'percent' && (totalQ.value < 95 || totalQ.value > 105)) continue;
          const expected = sumInterval(ctx, parts);
          const stated = toInterval(totalQ, ctx.options.slack);
          if (overlaps(stated, expected)) continue;
          const point = parts.reduce((a, p) => a + p.value, 0);
          const label = row[0]?.text.trim() ?? `row ${r + 1}`;
          ctx.report({
            rule: 'table-sum',
            severity: severityFor(stated, expected),
            confidence: confidenceFor(0.92, stated, expected),
            message: `Row "${label}" adds up to ${fmt(point)}, but its total says ${totalQ.span.text}.`,
            stated: totalQ.span.text,
            expected: fmt(point),
            workings: `${parts.map((p) => fmt(p.value)).join(' + ')} = ${fmt(point)}`,
            span: totalQ.span,
            relatedSpans: parts.map((p) => p.span),
          });
        }
      }
    }
  },
};
