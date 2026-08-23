/** Numeric literal scanning: digits, spelled-out numbers, fractions, ranges. */

export interface NumLiteral {
  start: number;
  end: number;
  raw: string;
  value: number;
  /** granularity implied by how it was written: 0.5 * 10^-decimals (before scale words) */
  quantum: number;
  spelled: boolean;
  /** the literal was written with explicit decimals */
  decimals: number;
}

const UNITS_WORD: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS_WORD: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
export const SCALE_WORD: Record<string, number> = {
  hundred: 100, thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12, quadrillion: 1e15,
  lakh: 1e5, crore: 1e7, mln: 1e6, bln: 1e9, trln: 1e12,
};
const FRACTION_WORD: Record<string, number> = {
  half: 0.5, halves: 0.5, third: 1 / 3, thirds: 1 / 3, quarter: 0.25, quarters: 0.25,
  fourth: 0.25, fourths: 0.25, fifth: 0.2, fifths: 0.2, sixth: 1 / 6, sixths: 1 / 6,
  eighth: 0.125, eighths: 0.125, tenth: 0.1, tenths: 0.1,
};
const UNICODE_FRACTION: Record<string, number> = {
  '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75, '⅕': 0.2, '⅖': 0.4, '⅗': 0.6,
  '⅘': 0.8, '⅙': 1 / 6, '⅚': 5 / 6, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
};
const ORDINAL_WORD: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8,
  ninth: 9, tenth: 10, eleventh: 11, twelfth: 12,
};

const NUMBER_WORDS = new Set([
  ...Object.keys(UNITS_WORD), ...Object.keys(TENS_WORD), ...Object.keys(SCALE_WORD),
  ...Object.keys(FRACTION_WORD), 'and', 'a', 'an', 'dozen', 'dozens',
]);

/** Regions that must never be read as quantities: URLs, ISO dates, times, versions, refs. */
export function maskedRegions(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const patterns: RegExp[] = [
    /https?:\/\/\S+/g,
    /\bwww\.\S+/g,
    /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g,
    /\b\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?\b/g,          // ISO date/time
    /\b(?:19|20)\d{2}[\/–-]\d{2}\b/g,                  // season/fiscal spans: 1987/88, 1947-49
    /\b(?:19|20)\d{2}\/(?:19|20)\d{2}\b/g,
    /\b\d{1,2}:\d{2}(?::\d{2})?\s?(?:[ap]\.?m\.?)?/gi, // clock time
    /\bv?\d+\.\d+\.\d+\b/g,                            // semver
    /\[\d+(?:[,–-]\d+)*\]/g,                           // [3] citation markers
    /\b(?:ISBN|DOI|ISSN)[\s:]*\S+/gi,
    /\b\+?\d[\d ()-]{8,}\d\b/g,                        // phone-ish
    /\b[A-Z]{1,3}-?\d{3,}\b/g,                         // identifiers
    /\bp{1,2}\.\s?\d+(?:\s?[–-]\s?\d+)?/g,             // page refs
    /`[^`\n]*`/g,                                      // inline code
    /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?\b(?!\s*(?:%|per\s?cent|percent))/gi,
    /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b/gi,
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) out.push([m.index, m.index + m[0].length]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

export function isMasked(regions: Array<[number, number]>, start: number, end: number): boolean {
  for (const [a, b] of regions) {
    if (start >= a && end <= b) return true;
    if (a > end) break;
  }
  return false;
}

const DIGIT_RE =
  /(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)/;

/** Locale sniff: does this document use "1.234,56"? */
export function sniffLocale(text: string): 'en' | 'eu' {
  const eu = (text.match(/\d{1,3}(?:\.\d{3})+,\d+/g) ?? []).length;
  const en = (text.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?/g) ?? []).length;
  const enDec = (text.match(/\d\.\d/g) ?? []).length;
  return eu > en + enDec ? 'eu' : 'en';
}

function parseDigits(raw: string, locale: 'en' | 'eu'): { value: number; decimals: number } {
  let s = raw.trim();
  if (locale === 'eu') s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const dot = s.indexOf('.');
  const decimals = dot === -1 ? 0 : s.length - dot - 1;
  return { value: parseFloat(s), decimals };
}

/** Parse a run of number words starting at `words[i]`. Returns value and words consumed. */
export function parseSpelled(words: string[], i: number): { value: number; used: number } | undefined {
  let total = 0;
  let current = 0;
  let used = 0;
  let lastNumeric = -1;
  let any = false;
  let sawScale = false;
  let k = i;
  while (k < words.length) {
    const w = words[k]!.toLowerCase().replace(/[^a-z-]/g, '');
    if (!w) break;
    const parts = w.includes('-') ? w.split('-') : [w];
    let consumedAll = true;
    let localAdd = 0;
    let localScale: number | undefined;
    let localFraction: number | undefined;
    for (const p of parts) {
      if (p in UNITS_WORD) localAdd += UNITS_WORD[p]!;
      else if (p in TENS_WORD) localAdd += TENS_WORD[p]!;
      else if (p in SCALE_WORD) localScale = SCALE_WORD[p]!;
      else if (p === 'dozen' || p === 'dozens') localScale = 12;
      else if (p in FRACTION_WORD && (any || current > 0 || localAdd > 0)) localFraction = FRACTION_WORD[p]!;
      else if (p === 'and' && any) { /* filler */ }
      else if ((p === 'a' || p === 'an') && !any && k + 1 < words.length &&
               words[k + 1]!.toLowerCase().replace(/[^a-z]/g, '') in SCALE_WORD) { /* "a million" */ }
      else { consumedAll = false; break; }
    }
    if (!consumedAll) break;
    if (localFraction !== undefined) {
      // "two thirds" / "three quarters"
      const numerator = localAdd || current || 1;
      total = 0;
      current = numerator * localFraction;
      used = k - i + 1;
      lastNumeric = used;
      any = true;
      k++;
      break;
    }
    if (localScale !== undefined) {
      if (localScale === 100) current = (current || 1) * 100;
      else {
        total += (current || 1) * localScale;
        current = 0;
      }
      sawScale = true;
    } else {
      current += localAdd;
    }
    any = true;
    used = k - i + 1;
    if (localAdd !== 0 || localScale !== undefined || /zero/i.test(w)) lastNumeric = used;
    k++;
  }
  if (!any) return undefined;
  if (lastNumeric > 0) used = lastNumeric;
  const value = total + current;
  if (value === 0 && !/zero/i.test(words[i] ?? '')) return undefined;
  void sawScale;
  return { value, used };
}

export interface ScanOptions {
  locale: 'en' | 'eu';
}

/** Scan a document for numeric literals (digits and words), skipping masked regions. */
export function scanNumbers(text: string, opts: ScanOptions): NumLiteral[] {
  const masks = maskedRegions(text);
  let out: NumLiteral[] = [];

  // --- digit literals ---
  const digitRe = new RegExp(
    opts.locale === 'eu'
      ? /(?:\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?)/.source
      : DIGIT_RE.source,
    'g',
  );
  let m: RegExpExecArray | null;
  while ((m = digitRe.exec(text))) {
    const start = m.index;
    const end = start + m[0].length;
    if (isMasked(masks, start, end)) continue;
    const before = text[start - 1] ?? ' ';
    const after = text[end] ?? ' ';
    if (/[\d/]/.test(before)) continue;
    if (/\d/.test(after)) continue;
    // skip ordinal suffixes handled elsewhere but keep the value
    const { value, decimals } = parseDigits(m[0], opts.locale);
    if (!Number.isFinite(value)) continue;
    let realEnd = end;
    let val = value;
    let dec = decimals;
    // unicode fraction glued on: "1½"
    const uf = UNICODE_FRACTION[text[end] ?? ''];
    if (uf !== undefined) {
      val += uf;
      realEnd = end + 1;
      dec = 3;
    }
    out.push({
      start,
      end: realEnd,
      raw: text.slice(start, realEnd),
      value: val,
      decimals: dec,
      quantum: 0.5 * Math.pow(10, -dec),
      spelled: false,
    });
  }

  // --- mixed and vulgar fractions: "3-1/2 pct", "4-7/8", "13/16" ---
  const fracRe = /(?:(\d{1,4})[\s-])?\b(\d{1,3})\/(\d{1,3})\b/g;
  while ((m = fracRe.exec(text))) {
    const whole = m[1] ? parseInt(m[1], 10) : 0;
    const num = parseInt(m[2]!, 10);
    const den = parseInt(m[3]!, 10);
    if (!den || num >= den) continue;                       // 5/3 is a date, not a fraction
    if (den > 64 || ![2, 3, 4, 5, 6, 8, 10, 16, 32, 64].includes(den)) continue;
    const start = m.index;
    const end = start + m[0].length;
    if (isMasked(masks, start, end)) continue;
    if (/[\d/.]/.test(text[start - 1] ?? ' ')) continue;
    if (/[\d/]/.test(text[end] ?? ' ')) continue;
    const value = whole + num / den;
    out = out.filter((n) => n.end <= start || n.start >= end);
    out.push({ start, end, raw: m[0], value, decimals: 3, quantum: 0.5 / den, spelled: false });
  }

  // --- standalone unicode fractions ---
  const ufRe = /[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/g;
  while ((m = ufRe.exec(text))) {
    if (out.some((n) => m!.index >= n.start && m!.index < n.end)) continue;
    if (isMasked(masks, m.index, m.index + 1)) continue;
    out.push({
      start: m.index, end: m.index + 1, raw: m[0], value: UNICODE_FRACTION[m[0]]!,
      decimals: 3, quantum: 0.0005, spelled: true,
    });
  }

  // --- spelled numbers ---
  const wordRe = /[A-Za-z]+/g;
  const tokens: Array<{ w: string; start: number; end: number }> = [];
  while ((m = wordRe.exec(text))) tokens.push({ w: m[0], start: m.index, end: m.index + m[0].length });
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const lw = t.w.toLowerCase();
    const head = lw.split('-')[0]!;
    if (!NUMBER_WORDS.has(head) && !NUMBER_WORDS.has(lw)) continue;
    if (head === 'and' || head === 'a' || head === 'an') continue;
    // don't start mid-run
    if (i > 0) {
      const prev = tokens[i - 1]!.w.toLowerCase();
      const prevHead = prev.split('-')[0]!;
      const adjacent = t.start - tokens[i - 1]!.end <= 1;
      const prevIsArticle = /^(a|an|and)$/.test(prevHead);
      if (adjacent && !prevIsArticle && (NUMBER_WORDS.has(prevHead) || NUMBER_WORDS.has(prev))) continue;
    }
    // a scale word glued to a digit literal ("4.2 billion") already belongs to that literal
    const preceding = text.slice(Math.max(0, t.start - 3), t.start);
    if (head in SCALE_WORD && /[\d.,][\s\u00a0]*$/.test(preceding)) continue;
    if (head in SCALE_WORD) {
      // "millions of people" is not the number 1,000,000
      const prevWord = i > 0 ? tokens[i - 1]!.w.toLowerCase() : '';
      const isBare = !/^(a|an|one)$/.test(prevWord) || t.start - tokens[i - 1]!.end > 1;
      if (isBare) continue;
    }
    const words = tokens.slice(i).map((x) => x.w);
    const parsed = parseSpelled(words, 0);
    if (!parsed || parsed.used === 0) continue;
    const last = tokens[i + parsed.used - 1]!;
    if (isMasked(masks, t.start, last.end)) continue;
    // guard: "one" as a pronoun ("one of the", "no one") — require a following noun/unit
    if (parsed.value === 1 && parsed.used === 1 && /^(one|a|an)$/i.test(t.w)) {
      const nxt = text.slice(last.end, last.end + 10);
      if (!/^\s+(?:in|out of|of every)\b/i.test(nxt)) continue;
    }
    const isFractional = !Number.isInteger(parsed.value);
    out.push({
      start: t.start, end: last.end, raw: text.slice(t.start, last.end),
      value: parsed.value, decimals: isFractional ? 3 : 0,
      quantum: isFractional ? 0.0005 : roundnessQuantum(parsed.value),
      spelled: true,
    });
    i += parsed.used - 1;
  }

  // --- word ordinals used as counts are ignored; ordinal digits handled in quantity layer ---
  void ORDINAL_WORD;
  return out.sort((a, b) => a.start - b.start || b.end - a.end);
}

/** A spelled number like "two million" carries the granularity of its own last significant word. */
function roundnessQuantum(v: number): number {
  if (!Number.isInteger(v)) return 0.0005;
  if (v === 0) return 0.5;
  let q = 0.5;
  let n = Math.abs(v);
  while (n % 10 === 0 && n >= 10) {
    q *= 10;
    n /= 10;
  }
  return Math.min(q, Math.max(0.5, Math.abs(v) * 0.05));
}

export { UNICODE_FRACTION, ORDINAL_WORD, FRACTION_WORD };
