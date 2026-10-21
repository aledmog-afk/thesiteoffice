/** An input the method cannot work with (zero, negative, missing, not a number). */
export class WindInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WindInputError';
  }
}

/** The input is valid, but the published factors do not cover it. */
export class OutsideMethodRangeError extends Error {
  constructor(detail: string) {
    super(`Outside method range: ${detail}`);
    this.name = 'OutsideMethodRangeError';
  }
}

/** Throws a WindInputError unless `value` is a finite number above zero. */
export function requirePositive(value: number, name: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new WindInputError(`${name} must be a number greater than zero (got ${String(value)}).`);
  }
}

/** Throws a WindInputError unless `value` is a finite number of zero or more. */
export function requireNonNegative(value: number, name: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new WindInputError(`${name} must be a number of zero or more (got ${String(value)}).`);
  }
}
