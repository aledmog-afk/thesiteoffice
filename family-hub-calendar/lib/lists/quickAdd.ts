export type QuickAddResult = { title: string; quantityText: string | null };

// Quantity is stored as text (§2.5) so quick-add keeps parity with what was
// typed: "2 tins" survives as "2 tins" rather than being forced into a number
// and a unit the household never picked.
//
// Three shapes, in priority order. Anything else stays wholly in the title,
// which is the safe default — a mis-parse that silently drops a word from a
// shopping item is worse than not parsing at all.
//
//   trailing multiplier   "milk x2"        -> milk        / x2
//   trailing bare number  "eggs 6"         -> eggs        / 6
//   leading count(+unit)  "2 tins beans"   -> tins beans  / 2
//                         "3 milk"         -> milk        / 3
const TRAILING_MULTIPLIER = /^(.*?)\s*[x×]\s*(\d+)$/i;
const TRAILING_NUMBER = /^(.*?)\s+(\d+)$/;
const LEADING_COUNT = /^(\d+)\s+(.*)$/;

export function parseQuickAdd(raw: string): QuickAddResult {
  const input = raw.trim().replace(/\s+/g, ' ');
  if (!input) return { title: '', quantityText: null };

  const multiplier = TRAILING_MULTIPLIER.exec(input);
  if (multiplier?.[1]?.trim()) {
    return { title: multiplier[1].trim(), quantityText: `x${multiplier[2]}` };
  }

  const trailing = TRAILING_NUMBER.exec(input);
  if (trailing?.[1]?.trim()) {
    return { title: trailing[1].trim(), quantityText: trailing[2] };
  }

  const leading = LEADING_COUNT.exec(input);
  if (leading?.[2]?.trim()) {
    return { title: leading[2].trim(), quantityText: leading[1] };
  }

  return { title: input, quantityText: null };
}
