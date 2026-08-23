/** Human-friendly number formatting for findings. */
export function fmt(n: number, opts: { sig?: number; unit?: string; currency?: string } = {}): string {
  if (!Number.isFinite(n)) return n > 0 ? '∞' : '−∞';
  const sig = opts.sig ?? 4;
  const abs = Math.abs(n);
  let body: string;
  if (abs !== 0 && (abs >= 1e15 || abs < 1e-4)) {
    body = n.toExponential(2);
  } else if (Number.isInteger(n) && abs < 1e15) {
    body = n.toLocaleString('en-US');
  } else {
    const decimals = Math.max(0, Math.min(6, sig - Math.max(1, Math.floor(Math.log10(abs || 1)) + 1)));
    body = Number(n.toFixed(decimals)).toLocaleString('en-US', { maximumFractionDigits: decimals });
  }
  if (opts.currency) return `${symbolFor(opts.currency)}${body}`;
  if (opts.unit) return `${body} ${opts.unit}`;
  return body;
}

export function symbolFor(code: string): string {
  const map: Record<string, string> = {
    USD: '$', EUR: '€', GBP: '£', JPY: '¥', INR: '₹', CNY: '¥', KRW: '₩', RUB: '₽',
    AUD: 'A$', CAD: 'C$', NZD: 'NZ$', BRL: 'R$', ILS: '₪', NGN: '₦',
  };
  return map[code] ?? `${code} `;
}

/** Compact money/scale rendering: 4200000000 -> "4.2 billion" */
export function fmtScaled(n: number, currency?: string): string {
  const abs = Math.abs(n);
  const units: Array<[number, string]> = [
    [1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand'],
  ];
  for (const [f, name] of units) {
    if (abs >= f) {
      const v = n / f;
      const s = Number(v.toFixed(v < 10 ? 2 : 1)).toString();
      return currency ? `${symbolFor(currency)}${s} ${name}` : `${s} ${name}`;
    }
  }
  return fmt(n, { currency });
}

export function fmtQuantityValue(value: number, opts: { unit?: string; currency?: string; percent?: boolean; scaled?: boolean }): string {
  if (opts.percent) return `${fmt(value)}%`;
  if (opts.scaled && Math.abs(value) >= 1e6) return fmtScaled(value, opts.currency);
  return fmt(value, { unit: opts.unit, currency: opts.currency });
}
