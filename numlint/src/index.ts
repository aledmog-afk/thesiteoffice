import type { Finding, LintOptions, LintResult } from './types.js';
import { extractQuantities } from './extract/quantity.js';
import { makeContext, type Rule, type ResolvedOptions } from './rule.js';
import { unitConversion } from './checks/conversion.js';
import { percentOfBase } from './checks/percentOfBase.js';
import { percentChange } from './checks/percentChange.js';
import { sumOfParts, percentSum, tableSum } from './checks/sums.js';
import { impossiblePercentage, grimMean } from './checks/granularity.js';
import { weekdayDate, dateSpan, ageArithmetic } from './checks/dates.js';
import { perUnit } from './checks/perUnit.js';
import { restatement } from './checks/restatement.js';
import { ratioPercent, partExceedsWhole, currencyRate } from './checks/extra.js';

export const RULES: Rule[] = [
  unitConversion,
  percentOfBase,
  percentChange,
  sumOfParts,
  percentSum,
  tableSum,
  impossiblePercentage,
  grimMean,
  weekdayDate,
  dateSpan,
  ageArithmetic,
  perUnit,
  restatement,
  ratioPercent,
  partExceedsWhole,
  currencyRate,
];

/** rule ids a rule can emit beyond its own id */
const EMITS: Record<string, string[]> = {
  'percent-change': ['percent-change', 'percentage-point-confusion', 'multiplier-mismatch'],
  restatement: ['scale-slip'],
};

export function ruleIds(): string[] {
  return [...new Set(RULES.flatMap((r) => EMITS[r.id] ?? [r.id]))];
}

export function lint(text: string, options: LintOptions = {}): LintResult {
  const t0 = Date.now();
  const resolved: ResolvedOptions = {
    minConfidence: options.minConfidence ?? 0.75,
    slack: Math.max(1, options.slack ?? 1),
    locale: options.locale ?? 'auto',
    today: options.today,
  };
  const { quantities, sentences } = extractQuantities(text, resolved.locale);
  const findings: Finding[] = [];
  const ctx = makeContext(text, quantities, sentences, resolved, findings);

  const enabled = RULES.filter((r) => {
    const emitted = EMITS[r.id] ?? [r.id];
    if (options.rules && !emitted.some((e) => options.rules!.includes(e))) return false;
    if (options.disable && emitted.every((e) => options.disable!.includes(e))) return false;
    return true;
  });

  for (const rule of enabled) {
    try {
      rule.run(ctx);
    } catch (err) {
      // a broken rule must never take down the whole run
      if (process.env.NUMLINT_DEBUG) console.error(`[numlint] rule ${rule.id} failed:`, err);
    }
  }

  const filtered = dedupe(findings)
    .filter((f) => f.confidence >= resolved.minConfidence)
    .filter((f) => !options.rules || options.rules.includes(f.rule))
    .filter((f) => !options.disable || !options.disable.includes(f.rule))
    .sort((a, b) => a.span.start - b.span.start || b.confidence - a.confidence);

  return {
    findings: filtered,
    stats: {
      quantities: quantities.length,
      sentences: sentences.length,
      rulesRun: enabled.map((r) => r.id),
      ms: Date.now() - t0,
    },
  };
}

/** One wrong number should produce one finding, not four. */
function dedupe(findings: Finding[]): Finding[] {
  const bySpan = new Map<string, Finding>();
  for (const f of findings) {
    const k = `${f.span.start}:${f.span.end}`;
    const prev = bySpan.get(k);
    if (!prev || f.confidence > prev.confidence) bySpan.set(k, f);
  }
  return [...bySpan.values()];
}

export type { Finding, LintOptions, LintResult, Quantity, Span, Severity } from './types.js';
export { extractQuantities } from './extract/quantity.js';
export { UNITS, convert, lookupUnit } from './units.js';
