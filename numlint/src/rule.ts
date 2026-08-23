import type { Finding, LintOptions, Quantity, Severity, Span } from './types.js';
import type { Sentence } from './text.js';
import { lineCol } from './text.js';
import { relativeGap, type Interval } from './interval.js';

export interface ResolvedOptions {
  minConfidence: number;
  slack: number;
  locale: 'en' | 'eu' | 'auto';
  today?: string;
}

export interface RuleContext {
  text: string;
  quantities: Quantity[];
  sentences: Sentence[];
  options: ResolvedOptions;
  /** quantities belonging to a sentence index */
  inSentence(i: number): Quantity[];
  /** quantity whose span starts at or contains `offset` */
  at(offset: number): Quantity | undefined;
  /** first quantity starting at or after `offset` within `limit` chars */
  after(offset: number, limit?: number): Quantity | undefined;
  report(f: RawFinding): void;
}

export interface RawFinding {
  rule: string;
  severity?: Severity;
  confidence: number;
  message: string;
  stated: string;
  expected: string;
  workings: string;
  span: Span;
  relatedSpans?: Span[];
  fix?: string;
}

export interface Rule {
  id: string;
  description: string;
  run(ctx: RuleContext): void;
}

export function makeContext(
  text: string,
  quantities: Quantity[],
  sentences: Sentence[],
  options: ResolvedOptions,
  sink: Finding[],
): RuleContext {
  const bySentence = new Map<number, Quantity[]>();
  for (const q of quantities) {
    const arr = bySentence.get(q.sentence) ?? [];
    arr.push(q);
    bySentence.set(q.sentence, arr);
  }
  return {
    text,
    quantities,
    sentences,
    options,
    inSentence: (i) => bySentence.get(i) ?? [],
    at: (offset) => quantities.find((q) => offset >= q.span.start && offset < q.span.end),
    after: (offset, limit = 40) =>
      quantities.find((q) => q.span.start >= offset && q.span.start <= offset + limit),
    report(f) {
      const { line, column } = lineCol(text, f.span.start);
      sink.push({
        rule: f.rule,
        severity: f.severity ?? 'error',
        confidence: f.confidence,
        message: f.message,
        stated: f.stated,
        expected: f.expected,
        workings: f.workings,
        span: f.span,
        relatedSpans: f.relatedSpans ?? [],
        fix: f.fix,
        line,
        column,
      });
    },
  };
}

/** Severity from how far the stated interval sits from the computed one. */
export function severityFor(stated: Interval, expected: Interval): Severity {
  const g = relativeGap(stated, expected);
  if (g > 0.02) return 'error';
  if (g > 0) return 'warning';
  return 'info';
}

/** Confidence rises with the size of the miss: near-misses may be sloppy rounding. */
export function confidenceFor(base: number, stated: Interval, expected: Interval): number {
  const g = relativeGap(stated, expected);
  if (g <= 0) return 0;
  const bump = Math.min(0.12, g * 0.6);
  return Math.min(0.99, base + bump);
}
