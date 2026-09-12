/**
 * Money primitives.
 *
 * Every monetary value in Dealer Digital is an integer number of US cents.
 * Using integers (never floats, never Decimal) keeps the vehicle economics
 * engine exact and deterministic — see docs/ARCHITECTURE.md.
 */

/** An integer number of US cents. */
export type Cents = number;

/** Basis points: 1 bp = 0.01%. 1250 bps = 12.50%. */
export type BasisPoints = number;

export const MAX_SAFE_CENTS = Number.MAX_SAFE_INTEGER;

/** True when the value is a usable, whole, non-negative cent amount. */
export function isValidCents(value: unknown): value is Cents {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_SAFE_CENTS
  );
}

/**
 * Validates a cent amount. Throws on bad input rather than silently coercing,
 * so a bad number can never quietly corrupt a gross-profit figure.
 */
export function assertCents(value: number, field = "amount"): Cents {
  if (!isValidCents(value)) {
    throw new RangeError(
      `${field} must be a non-negative integer number of cents, received ${String(value)}`,
    );
  }
  return value;
}

/** Coerces anything unusable to 0. Use at trust boundaries (DB/JSON reads). */
export function toCents(value: unknown): Cents {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return Math.max(0, Math.round(parsed));
  }
  return 0;
}

/** Exact integer sum. Optional values are ignored. */
export function sumCents(...values: readonly (number | null | undefined)[]): Cents {
  return values.reduce<number>((total, value) => {
    if (value === null || value === undefined) return total;
    return total + Math.max(0, Math.round(value));
  }, 0);
}

/**
 * Parses dealer-entered money into cents.
 * Accepts "18500", "$18,500", "18500.50", "18,500.5". Returns null when the
 * input is not a number at all so the caller can show a validation error.
 */
export function parseMoneyToCents(input: string | number | null | undefined): Cents | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") {
    return Number.isFinite(input) ? Math.round(input * 100) : null;
  }
  const cleaned = input.trim().replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  if (!/^-?\d*(\.\d*)?$/.test(cleaned)) return null;
  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100);
}

/** 1850000 -> "18500.00" (no symbol, no grouping) */
export function centsToDecimalString(cents: Cents): string {
  const safe = Math.round(cents);
  const sign = safe < 0 ? "-" : "";
  const abs = Math.abs(safe);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}${dollars}.${String(remainder).padStart(2, "0")}`;
}

/** 1850000, { withCents: false } -> "$18,500" */
export function formatCents(
  cents: Cents | null | undefined,
  options: { withCents?: boolean; fallback?: string } = {},
): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) {
    return options.fallback ?? "—";
  }
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: options.withCents ? 2 : 0,
    maximumFractionDigits: options.withCents ? 2 : 0,
  }).format(cents / 100);
  return formatted;
}

/** 1250 -> "12.50%" */
export function formatBasisPoints(bps: BasisPoints | null | undefined, digits = 2): string {
  if (bps === null || bps === undefined || !Number.isFinite(bps)) return "—";
  return `${(bps / 100).toFixed(digits)}%`;
}

/** Applies basis points to a cent amount, rounding half up. */
export function applyBasisPoints(cents: Cents, bps: BasisPoints): Cents {
  return Math.round((cents * bps) / 10_000);
}

export function percentToBasisPoints(percent: number): BasisPoints {
  return Math.round(percent * 100);
}

export function basisPointsToPercent(bps: BasisPoints): number {
  return bps / 100;
}
