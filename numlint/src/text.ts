import type { Span } from './types.js';

export interface Sentence {
  index: number;
  start: number;
  end: number;
  text: string;
  /** paragraph index */
  para: number;
  /** true when the sentence is a list item or table row */
  listItem: boolean;
}

const ABBREV = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'mt', 'no', 'vs', 'etc', 'inc', 'ltd', 'co',
  'corp', 'dept', 'est', 'fig', 'al', 'eg', 'ie', 'approx', 'vol', 'pp', 'ed', 'jan', 'feb', 'mar',
  'apr', 'jun', 'jul', 'aug', 'sept', 'sep', 'oct', 'nov', 'dec', 'u.s', 'u.k', 'e.g', 'i.e',
]);

/** Sentence segmentation that respects decimals, abbreviations and list structure. */
export function segment(text: string): Sentence[] {
  const out: Sentence[] = [];
  let para = 0;
  let start = 0;
  let i = 0;
  const push = (end: number) => {
    const raw = text.slice(start, end);
    if (raw.trim().length === 0) {
      start = end;
      return;
    }
    const lead = raw.length - raw.trimStart().length;
    const trail = raw.length - raw.trimEnd().length;
    const s = start + lead;
    const e = end - trail;
    const body = text.slice(s, e);
    out.push({
      index: out.length,
      start: s,
      end: e,
      text: body,
      para,
      listItem: /^\s*(?:[-*•–]|\d+[.)]|\|)/.test(raw),
    });
    start = end;
  };

  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '\n') {
      // blank line => paragraph break; single newline in a list also breaks
      const nextNl = text.indexOf('\n', i + 1);
      const isBlank = /^\s*$/.test(text.slice(i + 1, nextNl === -1 ? text.length : nextNl));
      push(i);
      start = i + 1;
      if (isBlank) para++;
      i++;
      continue;
    }
    if (ch === '.' || ch === '!' || ch === '?') {
      const prev = text.slice(Math.max(0, i - 12), i);
      const next = text[i + 1] ?? ' ';
      const isDecimal = ch === '.' && /\d$/.test(prev) && /\d/.test(next);
      const wordBefore = /([A-Za-z.]+)$/.exec(prev)?.[1]?.toLowerCase() ?? '';
      const isAbbrev = ch === '.' && (ABBREV.has(wordBefore) || /^[A-Za-z]$/.test(wordBefore));
      const followedByBreak = /^\s/.test(next) || i + 1 >= text.length;
      if (!isDecimal && !isAbbrev && followedByBreak) {
        push(i + 1);
        i++;
        continue;
      }
    }
    i++;
  }
  push(text.length);
  return out;
}

export function lineCol(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let last = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') {
      line++;
      last = i + 1;
    }
  }
  return { line, column: offset - last + 1 };
}

export function span(text: string, start: number, end: number): Span {
  return { start, end, text: text.slice(start, end) };
}

export function spanOf(a: Span, b: Span): Span {
  return { start: Math.min(a.start, b.start), end: Math.max(a.end, b.end), text: '' };
}
