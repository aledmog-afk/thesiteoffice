/** Character range in the source document. */
export interface Span {
  start: number;
  end: number;
  text: string;
}

/** Base dimensions. Currency is treated as a dimension so money can't be added to metres. */
export type BaseDim =
  | 'length' | 'mass' | 'time' | 'temperature' | 'current' | 'substance' | 'luminous'
  | 'currency' | 'count' | 'angle' | 'data' | 'ratio';

/** Exponent map, e.g. speed = { length: 1, time: -1 } */
export type Dimension = Partial<Record<BaseDim, number>>;

export interface UnitDef {
  /** canonical id */
  id: string;
  dim: Dimension;
  /** multiply a value in this unit by `factor` (then add `offset`) to reach the SI-ish base */
  factor: number;
  offset?: number;
  /** surface forms; matched case-sensitively when `cs` is true */
  forms: string[];
  cs?: boolean;
  /** system, used to decide whether a conversion pair is plausible */
  system?: 'si' | 'imperial' | 'us' | 'other';
  /** inverse-scale units such as L/100km, where bigger means less */
  inverse?: boolean;
}

export interface UnitRef {
  def: UnitDef;
  /** the literal text matched, e.g. "km" */
  surface: string;
}

/** How the writer hedged the number. Drives the tolerance interval. */
export type Hedge =
  | 'exact'        // 5,283,192
  | 'about'        // about / roughly / approximately / around / some / ~
  | 'nearly'       // nearly / almost / just under  -> slightly below
  | 'over'         // over / more than / at least / north of -> lower bound
  | 'under'        // under / less than / fewer than / up to -> upper bound
  | 'range';       // 5 to 10

export type QuantityKind =
  | 'plain'
  | 'percent'
  | 'percentage-point'
  | 'currency'
  | 'measure'
  | 'ordinal'
  | 'year'
  | 'duration'
  | 'multiplier';   // "doubled", "three times"

export interface Quantity {
  span: Span;
  /** value expressed in the surface unit (not converted) */
  value: number;
  /** for ranges, the upper endpoint */
  valueHigh?: number;
  kind: QuantityKind;
  unit?: UnitRef;
  currency?: string;
  hedge: Hedge;
  /**
   * Half-width of the rounding interval implied by how the number was written.
   * "8.5 km" -> 0.05 ; "8 km" -> 0.5 ; "1.2 million" -> 50_000 ; "1,234,567" -> 0.5
   */
  quantum: number;
  /** true when written with a scale word ("2.4 billion") or as a round number */
  scaleWord?: string;
  /** multiplier contributed by the scale word (1e6 for "million") */
  scaleMult?: number;
  /** the numeric literal exactly as written, without unit, currency or scale word */
  literalText?: string;
  spelled?: boolean;
  /** normalised head noun the number counts or modifies, e.g. "respondent" */
  noun?: string;
  /** raw text immediately following the quantity (up to 48 chars) */
  after?: string;
  /** raw text immediately preceding the quantity (up to 48 chars) */
  before?: string;
  /** for "1 in 5" / "3 out of 4" */
  ratio?: { num: number; den: number };
  /** true when the literal was an ordinal (3rd) */
  ordinal?: boolean;
  /** hyphenated modifier before a noun: "a 72-hole total", "a 30-year period" */
  attributive?: boolean;
  /** index in the document's quantity list */
  index: number;
  /** sentence index */
  sentence: number;
}

export type Severity = 'error' | 'warning' | 'info';

export interface Finding {
  /** stable rule id, e.g. "percent-of-base" */
  rule: string;
  severity: Severity;
  /** 0..1 — how sure we are this is a genuine inconsistency */
  confidence: number;
  message: string;
  /** what the document says */
  stated: string;
  /** what the other numbers imply */
  expected: string;
  /** the arithmetic, spelled out for a human */
  workings: string;
  span: Span;
  relatedSpans: Span[];
  /** suggested replacement for `span`, when unambiguous */
  fix?: string;
  line: number;
  column: number;
}

export interface LintOptions {
  /** minimum confidence to report; default 0.75 */
  minConfidence?: number;
  /** rules to run; default all */
  rules?: string[];
  /** rules to skip */
  disable?: string[];
  /** decimal convention; 'auto' sniffs the document */
  locale?: 'en' | 'eu' | 'auto';
  /** reference date for relative-date checks (ISO); default: none, relative checks skipped */
  today?: string;
  /** extra slack multiplier on every tolerance (>=1). Default 1. */
  slack?: number;
}

export interface LintResult {
  findings: Finding[];
  stats: {
    quantities: number;
    sentences: number;
    rulesRun: string[];
    ms: number;
  };
}
