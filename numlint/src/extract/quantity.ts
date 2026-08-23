import type { Quantity, Hedge, QuantityKind, UnitRef } from '../types.js';
import { UNIT_FORMS, lookupUnit, convert, sameDimension } from '../units.js';
import { scanNumbers, sniffLocale, SCALE_WORD } from './number.js';
import { segment, span, type Sentence } from '../text.js';

const CURRENCY_BY_SYMBOL: Record<string, string> = {
  $: 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR', '₽': 'RUB', '₩': 'KRW',
  '₪': 'ILS', '₫': 'VND', '฿': 'THB', '₦': 'NGN', '₴': 'UAH', 'R$': 'BRL',
};
const CURRENCY_PREFIX_QUALIFIER: Record<string, string> = {
  US: 'USD', C: 'CAD', A: 'AUD', NZ: 'NZD', HK: 'HKD', NT: 'TWD', S: 'SGD', R: 'BRL',
};
const CURRENCY_CODES =
  'USD|EUR|GBP|JPY|CNY|RMB|INR|AUD|CAD|CHF|SEK|NOK|DKK|RUB|BRL|MXN|ZAR|KRW|SGD|HKD|NZD|PLN|TRY|AED|SAR|NGN|KES|ILS|THB|VND|IDR|PHP|MYR';
const CURRENCY_WORDS: Record<string, string> = {
  dollars: 'USD', dollar: 'USD', dlrs: 'USD', dlr: 'USD', euros: 'EUR', euro: 'EUR', yen: 'JPY', yuan: 'CNY',
  renminbi: 'CNY', rupees: 'INR', rupee: 'INR', roubles: 'RUB', rubles: 'RUB', won: 'KRW',
  francs: 'CHF', franc: 'CHF', shekels: 'ILS', reais: 'BRL', pesos: 'MXN', rand: 'ZAR',
  cents: 'cent', cent: 'cent', pence: 'pence', pennies: 'pence',
};
const MONEY_CONTEXT =
  /\b(cost|costs|cost of|price|priced|paid|pay|paying|worth|revenue|revenues|profit|loss|losses|sales|budget|funding|raised|raise|salary|salaries|wage|wages|spend|spending|spent|invest|invested|investment|fee|fees|fine|fined|donat|grant|contract|deal|valuation|valued|earn|earned|earnings|charge|charged|owe|owed|debt|deficit|surplus|billion-dollar|million-dollar)\b/i;
const WEIGHT_CONTEXT = /\b(weigh|weighs|weighed|weight|heavy|heavier|mass|gained|lost|shed|carr(?:y|ies|ied))\b/i;

const HEDGE_PATTERNS: Array<[RegExp, Hedge]> = [
  [/\b(?:more than|over|at least|north of|upwards? of|in excess of|exceeding|greater than|above)\s*$/i, 'over'],
  [/\b(?:less than|fewer than|under|up to|at most|no more than|as few as|below)\s*$/i, 'under'],
  [/\b(?:nearly|almost|just under|approaching|close to|shy of)\s*$/i, 'nearly'],
  [/\b(?:about|approximately|approx\.?|roughly|around|circa|c\.|an estimated|estimated at|estimated|somewhere around|on the order of|order of)\s*$/i, 'about'],
  [/\bsome\s*$/i, 'about'],
  [/~\s*$/, 'about'],
];

const VERBISH = new Set([
  'due', 'begins', 'began', 'begin', 'will', 'would', 'could', 'should', 'may', 'might',
  'must', 'can', 'cannot', 'goes', 'went', 'gone', 'came', 'come', 'comes', 'made', 'make',
  'makes', 'took', 'take', 'takes', 'gave', 'give', 'gives', 'got', 'get', 'gets', 'set',
  'put', 'held', 'hold', 'holds', 'ran', 'run', 'runs', 'rose', 'fell', 'grew', 'when',
  'while', 'after', 'before', 'during', 'because', 'since', 'until', 'though', 'although',
  'across', 'among', 'between', 'against', 'into', 'onto', 'out', 'off', 'if', 'so', 'but',
]);

const STOPWORDS = new Set([
  'of', 'the', 'a', 'an', 'and', 'or', 'in', 'on', 'at', 'to', 'for', 'from', 'by', 'with',
  'was', 'were', 'is', 'are', 'be', 'been', 'has', 'have', 'had', 'that', 'which', 'who',
  'more', 'less', 'than', 'per', 'each', 'every', 'all', 'total', 'about', 'other', 'new',
  'last', 'this', 'its', 'their', 'his', 'her', 'said', 'says', 'up', 'down', 'over', 'under',
]);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const UNIT_ALT = UNIT_FORMS.map(escapeRe).join('|');
const UNIT_RE_CS = new RegExp(`^[\\s\\u00a0\\u2009-]{0,2}(${UNIT_ALT})(?![A-Za-z])`);
const UNIT_RE_CI = new RegExp(`^[\\s\\u00a0\\u2009-]{0,2}(${UNIT_ALT})(?![A-Za-z])`, 'i');

const SCALE_RE = /^[\s  ]{0,2}(hundred|thousand|million|billion|trillion|quadrillion|lakh|crore|mln|bln|trln)s?\b/i;
const SCALE_ABBR_RE = /^(bn|BN|tn|TN|k|K|m|M|b|B|T)\b/;
const SCALE_ABBR_VALUE: Record<string, number> = {
  k: 1e3, K: 1e3, m: 1e6, M: 1e6, bn: 1e9, BN: 1e9, b: 1e9, B: 1e9, tn: 1e12, TN: 1e12, T: 1e12,
};

const PERCENT_RE = /^[\s ]{0,2}(%|per\s?cent\.?|percent\.?|pct\.?)(?![a-z])/i;
const PP_RE = /^[\s ]{0,2}(percentage[- ]points?|pp|ppt|p\.p\.)(?![a-z])/i;
const BPS_RE = /^[\s ]{0,2}(basis points?|bps|bp)(?![a-z])/i;
const ORDINAL_RE = /^(st|nd|rd|th)(?![a-z])/i;

const TIME_UNIT_IDS = new Set(['second', 'minute', 'hour', 'day', 'week', 'month', 'year', 'decade', 'century', 'fortnight', 'millisecond']);

export interface ExtractResult {
  quantities: Quantity[];
  sentences: Sentence[];
  locale: 'en' | 'eu';
}

export function extractQuantities(text: string, localeOpt: 'en' | 'eu' | 'auto' = 'auto'): ExtractResult {
  const locale = localeOpt === 'auto' ? sniffLocale(text) : localeOpt;
  const sentences = segment(text);
  const literals = scanNumbers(text, { locale });
  const quantities: Quantity[] = [];

  const sentenceOf = (offset: number): number => {
    for (const s of sentences) if (offset >= s.start && offset <= s.end) return s.index;
    return sentences.length ? sentences[sentences.length - 1]!.index : 0;
  };

  for (const lit of literals) {
    const before = text.slice(Math.max(0, lit.start - 48), lit.start);
    let cursor = lit.end;
    let value = lit.value;
    let quantum = lit.quantum;
    let kind: QuantityKind = 'plain';
    let unit: UnitRef | undefined;
    let currency: string | undefined;
    let scaleWord: string | undefined;
    let scaleMult: number | undefined;
    let ordinal = false;

    // ---- ordinal suffix ----
    const ordM = ORDINAL_RE.exec(text.slice(cursor));
    if (ordM && !lit.spelled) {
      ordinal = true;
      kind = 'ordinal';
      cursor += ordM[0].length;
    }

    // ---- currency prefix ----
    let spanStart = lit.start;
    const symM = /(?:\b(US|C|A|NZ|HK|NT|S|R)\s?)?([$€£¥₹₽₩₪₫฿₦₴])\s?$/.exec(before);
    const codeM = new RegExp(`\\b(${CURRENCY_CODES})\\s?$`, 'i').exec(before);
    if (symM) {
      const sym = symM[2]!;
      const qual = symM[1];
      currency = (qual && CURRENCY_PREFIX_QUALIFIER[qual]) || CURRENCY_BY_SYMBOL[sym] || 'USD';
      kind = 'currency';
      spanStart = lit.start - before.length + symM.index;
    } else if (codeM) {
      currency = codeM[1]!.toUpperCase();
      kind = 'currency';
      spanStart = lit.start - before.length + codeM.index;
    }

    // ---- scale word / abbreviation ----
    if (!ordinal) {
      const sc = SCALE_RE.exec(text.slice(cursor));
      if (sc) {
        const mult = SCALE_WORD[sc[1]!.toLowerCase()]!;
        // "hundreds of thousands" style plurals without a leading number are not scaled here
        value *= mult;
        quantum *= mult;
        scaleWord = sc[1]!.toLowerCase();
        scaleMult = mult;
        cursor += sc[0].length;
      } else if (!lit.spelled) {
        const ab = SCALE_ABBR_RE.exec(text.slice(cursor));
        if (ab) {
          const tok = ab[1]!;
          const rest = text.slice(cursor + tok.length);
          const acceptsScale =
            currency !== undefined ||
            tok === 'bn' || tok === 'BN' || tok === 'tn' || tok === 'TN' ||
            tok === 'k' || tok === 'K' ||
            // "5m people", "300m users" — a scale word glued to the number, then a noun
            (/^[\s ]+[a-z]/i.test(rest) && !UNIT_RE_CS.test(rest) && /^(m|M|b|B|T)$/.test(tok));
          if (acceptsScale) {
            const mult = SCALE_ABBR_VALUE[tok]!;
            value *= mult;
            quantum *= mult;
            scaleWord = tok;
            scaleMult = mult;
            cursor += tok.length;
          }
        }
      }
    }

    // ---- percent family ----
    if (!ordinal) {
      const pp = PP_RE.exec(text.slice(cursor));
      const bps = BPS_RE.exec(text.slice(cursor));
      const pc = PERCENT_RE.exec(text.slice(cursor));
      if (pp) {
        kind = 'percentage-point';
        cursor += pp[0].length;
      } else if (bps) {
        kind = 'percentage-point';
        value /= 100;
        quantum /= 100;
        cursor += bps[0].length;
      } else if (pc) {
        kind = 'percent';
        cursor += pc[0].length;
      }
    }

    // ---- unit ----
    if (kind === 'plain' || kind === 'currency') {
      const rest = text.slice(cursor);
      let mu = UNIT_RE_CS.exec(rest);
      let surface = mu?.[1];
      if (!surface) {
        const ci = UNIT_RE_CI.exec(rest);
        // single-character units must match case exactly (5G is not 5 grams)
        if (ci && ci[1]!.length > 1) {
          surface = ci[1];
          mu = ci;
        }
      }
      if (surface && !currency) {
        const accepted = acceptUnit(surface, text, lit.start, cursor, mu![0]);
        if (accepted) {
          const def = lookupUnit(surface);
          if (def) {
            unit = { def, surface };
            kind = 'measure';
            cursor += mu![0].length;
          }
        }
      }
    }

    // ---- currency words after the number ("5 million dollars", "12 pounds") ----
    if (!currency && (kind === 'plain' || kind === 'measure')) {
      const cw = /^[\s ]{0,2}([A-Za-z]+)/.exec(text.slice(cursor));
      const w = cw?.[1]?.toLowerCase();
      if (w && w in CURRENCY_WORDS && !(unit && unit.def.id === 'pound')) {
        currency = CURRENCY_WORDS[w]!;
        kind = 'currency';
        cursor += cw![0].length;
      } else if (unit && unit.def.id === 'pound') {
        // "pounds" is money or mass depending on the sentence
        const sIdx = sentenceOf(lit.start);
        const sTxt = sentences[sIdx]?.text ?? '';
        if (MONEY_CONTEXT.test(sTxt) && !WEIGHT_CONTEXT.test(sTxt)) {
          currency = 'GBP';
          kind = 'currency';
          unit = undefined;
        }
      }
      const codeAfter = new RegExp(`^[\\s\\u00a0]{0,2}(${CURRENCY_CODES})\\b`, 'i').exec(text.slice(cursor));
      if (!currency && codeAfter) {
        currency = codeAfter[1]!.toUpperCase();
        kind = 'currency';
        cursor += codeAfter[0].length;
      }
    }

    // ---- year ----
    if (kind === 'plain' && !unit && Number.isInteger(lit.value) && lit.value >= 1000 && lit.value <= 2200 &&
        !lit.spelled && !scaleWord && /^\d{4}$/.test(lit.raw)) {
      if (/\b(in|since|by|from|until|till|during|between|and|of|after|before|for|to|,)\s*$/i.test(before) ||
          /^[\s,.)]|^$/.test(text.slice(cursor, cursor + 1))) {
        kind = 'year';
      }
    }

    // ---- hedge ----
    let hedge: Hedge = 'exact';
    for (const [re, h] of HEDGE_PATTERNS) {
      // "Some 27% of the 15 patients" — a determiner, not a hedge
      if (kind === 'percent' && h === 'about' && /\bsome\b/i.test(re.source)) continue;
      const trimmed = before.replace(/[\s $€£¥₹]*$/, '');
      if (re.test(trimmed + ' ') || re.test(trimmed)) {
        // "over the past 10 years" is not a bound
        if (h === 'over' && /\b(over|above)\s*$/i.test(trimmed) && /^\s*(the|his|her|their|its|a|an)\b/i.test(text.slice(lit.end))) break;
        hedge = h;
        break;
      }
    }
    if (hedge === 'exact' && /\b(?:about|around|roughly|approximately|nearly|almost)\s+[A-Za-z]{0,12}\s*$/i.test(before)) {
      hedge = 'about';
    }

    // ---- following text / noun head ----
    const after = text.slice(cursor, cursor + 48);
    const noun = headNoun(after) ?? trailingNoun(before);
    // "a 72-hole total", "a 30-year period": the number modifies the noun, it is not a value in a list
    const attributive = /^-[A-Za-z]/.test(text.slice(cursor)) || /^[A-Za-z-]*-/.test(text.slice(lit.end, cursor));

    quantities.push({
      span: span(text, spanStart, cursor),
      value,
      kind,
      unit,
      currency,
      hedge,
      quantum,
      scaleWord,
      scaleMult,
      literalText: lit.raw,
      spelled: lit.spelled,
      noun,
      after,
      before,
      ordinal,
      attributive,
      index: quantities.length,
      sentence: sentenceOf(lit.start),
    });
  }

  const deduped = dropContained(quantities);
  const merged = mergeRanges(text, mergeCompounds(text, deduped));
  detectRatios(text, merged);
  merged.forEach((q, i) => (q.index = i));
  return { quantities: merged, sentences, locale };
}

/** A scale word or unit swallowed by a previous quantity must not become its own quantity. */
function dropContained(qs: Quantity[]): Quantity[] {
  const out: Quantity[] = [];
  let maxEnd = -1;
  for (const q of qs) {
    if (q.span.start < maxEnd) continue;
    out.push(q);
    maxEnd = Math.max(maxEnd, q.span.end);
  }
  return out;
}

/** Guard rails for units whose abbreviations collide with ordinary words. */
function acceptUnit(surface: string, text: string, numStart: number, unitStart: number, matchText: string): boolean {
  const attached = !/^[\s ]/.test(matchText);
  const afterChar = text[unitStart + matchText.length] ?? ' ';
  switch (surface) {
    case 'C': case 'F': case 'K':
      // only "72F"/"21C" glued to the digits, or the °-prefixed forms elsewhere in the list
      return attached && !/[A-Za-z0-9]/.test(afterChar);
    case 's': case 'g': case 'b': case 'B': case 'l': case 'L': case 'N': case 'W': case 'J':
      return !/[A-Za-z0-9]/.test(afterChar);
    case 'pc': case 'ct':
      return false;
    case 'm': case 'M': {
      // "5m people" was already consumed as a scale word if applicable
      const rest = text.slice(unitStart + matchText.length);
      if (/^[\s ]+(people|users|customers|viewers|subscribers|voters|residents|homes|jobs|units|copies|shares|tonnes|tons|barrels)\b/i.test(rest)) return false;
      return true;
    }
    case 'in.':
      return true;
    case 'in':
      return /\b(ft|feet|foot)[\s\u00a0]*$/.test(text.slice(Math.max(0, numStart - 14), numStart));
    case 'st':
      return attached === false;
    default:
      return true;
  }
}

/** "6 ft 2 in", "2 hours 30 minutes" -> one quantity. */
function mergeCompounds(text: string, qs: Quantity[]): Quantity[] {
  const out: Quantity[] = [];
  for (let i = 0; i < qs.length; i++) {
    const a = qs[i]!;
    const b = qs[i + 1];
    if (
      b && a.unit && b.unit && a.kind === 'measure' && b.kind === 'measure' &&
      sameDimension(a.unit.def.dim, b.unit.def.dim) &&
      b.unit.def.factor < a.unit.def.factor &&
      /^[\s\u00a0-]{0,3}(?:and[\s\u00a0]+)?$/.test(text.slice(a.span.end, b.span.start))
    ) {
      const conv = convert(b.value, b.unit.def, a.unit.def) ?? 0;
      const convQ = (b.quantum * b.unit.def.factor) / a.unit.def.factor;
      out.push({
        ...a,
        value: a.value + conv,
        quantum: convQ,
        span: span(text, a.span.start, b.span.end),
        after: text.slice(b.span.end, b.span.end + 48),
      });
      i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

/** "between 5 and 10", "5–10%" -> a single range quantity. */
function mergeRanges(text: string, qs: Quantity[]): Quantity[] {
  const out: Quantity[] = [];
  for (let i = 0; i < qs.length; i++) {
    const a = qs[i]!;
    const b = qs[i + 1];
    if (b && a.sentence === b.sentence && a.kind !== 'year') {
      const between = text.slice(a.span.end, b.span.start);
      const beforeA = (a.before ?? '').replace(/[$€£¥₹₽₩₪₫฿₦₴\s]+$/, ' ');
      const isBetween = /\bbetween\s*$/i.test(beforeA) && /^[\s ]*and[\s ]*$/.test(between);
      const isDash = /^[\s ]*[–—-][\s ]*$/.test(between) && !/\bfrom\s*$/i.test(beforeA);
      const isTo = /^[\s ]+to[\s ]+$/.test(between) && !/\b(from|rose|grew|fell|dropped|increased|decreased|climbed|declined|up|down|jumped|slid|expanded|shrank)\s*$/i.test(beforeA.trim());
      const compatible =
        b.value > a.value &&
        (a.kind === b.kind || a.kind === 'plain') &&
        ((!a.unit && !b.unit) || (!!a.unit && !!b.unit && a.unit.def.id === b.unit.def.id) || (!a.unit && !!b.unit));
      if ((isBetween || isDash || isTo) && compatible) {
        const lowScaled = !a.scaleMult && b.scaleMult && a.value < 1000 ? a.value * b.scaleMult : a.value;
        out.push({
          ...(b.unit && !a.unit ? { ...a, unit: b.unit, kind: b.kind } : a),
          hedge: 'range',
          value: lowScaled,
          valueHigh: b.value,
          quantum: Math.max(a.quantum, b.quantum),
          span: span(text, a.span.start, b.span.end),
          after: b.after,
        });
        i++;
        continue;
      }
    }
    out.push(a);
  }
  return out;
}

/** "1 in 5", "3 out of 4", "one in ten" */
function detectRatios(text: string, qs: Quantity[]): void {
  for (let i = 0; i < qs.length - 1; i++) {
    const a = qs[i]!;
    const b = qs[i + 1]!;
    const between = text.slice(a.span.end, b.span.start);
    if (/^[\s ]*(?:in|out of|of every)[\s ]*$/i.test(between) && a.kind === 'plain' && b.kind === 'plain' && b.value > 0) {
      a.ratio = { num: a.value, den: b.value };
    }
  }
}

/** the last content word before the number — "the tunnel cost 4.2 billion" -> "tunnel" */
function trailingNoun(before: string): string | undefined {
  const words = before.split(/[^A-Za-z'-]+/).filter(Boolean);
  for (let i = words.length - 1; i >= 0; i--) {
    const w = words[i]!.toLowerCase();
    if (STOPWORDS.has(w) || w.length < 3) continue;
    if (/^(worth|cost|costs|priced|valued|reached|hit|totall?ed|spent|paid|raised|earned|lost|about|roughly|nearly|almost|approximately|just|only|some|estimated)$/.test(w)) continue;
    return singular(w);
  }
  return undefined;
}

const ADJECTIVAL = new Set([
  'new', 'old', 'large', 'small', 'big', 'additional', 'total', 'extra', 'further', 'other',
  'more', 'less', 'senior', 'junior', 'local', 'national', 'federal', 'annual', 'average',
  'net', 'gross', 'key', 'top', 'main', 'major', 'minor', 'full', 'part', 'high', 'low',
  'first', 'second', 'third', 'last', 'next', 'same', 'such', 'own', 'whole', 'entire',
  'single', 'double', 'former', 'current', 'separate', 'different', 'similar', 'young',
]);

function isAdjectival(w: string): boolean {
  return ADJECTIVAL.has(w) || /(?:ous|ive|ful|less|ary|ic|ish|able|ible|ional|ern)$/.test(w);
}

/** The head of the noun phrase the number modifies: "1,200 new homes" -> "home". */
function headNoun(after: string): string | undefined {
  const m = /^[\s -]{0,3}(?:of\s+(?:the\s+)?)?((?:[A-Za-z][\w'-]*[\s ]+){0,3}[A-Za-z][\w'-]*)/.exec(after);
  if (!m) return undefined;
  const words = m[1]!.split(/[\s ]+/).map((w) => w.toLowerCase().replace(/[^a-z-]/g, '')).filter(Boolean);
  let fallback: string | undefined;
  for (const w of words.slice(0, 3)) {
    if (STOPWORDS.has(w) || VERBISH.has(w)) break;
    if (!fallback) fallback = w;
    if (!isAdjectival(w)) return singular(w);
  }
  return fallback ? singular(fallback) : undefined;
}

export function singular(w: string): string {
  if (w.endsWith('ies') && w.length > 4) return `${w.slice(0, -3)}y`;
  if (/(ches|shes|xes|sses|zes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && w.length > 3) return w.slice(0, -1);
  return w;
}

export function isTimeUnit(q: Quantity): boolean {
  return !!q.unit && TIME_UNIT_IDS.has(q.unit.def.id);
}
