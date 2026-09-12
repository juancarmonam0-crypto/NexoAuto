import { describe, expect, it } from "vitest";
import {
  applyBasisPoints,
  assertCents,
  basisPointsToPercent,
  centsToDecimalString,
  formatBasisPoints,
  formatCents,
  isValidCents,
  MAX_SAFE_CENTS,
  parseMoneyToCents,
  percentToBasisPoints,
  sumCents,
  toCents,
} from "@/lib/money";

describe("money — isValidCents / assertCents", () => {
  it("accepts whole non-negative cent amounts", () => {
    expect(isValidCents(0)).toBe(true);
    expect(isValidCents(1)).toBe(true);
    expect(isValidCents(1_850_000)).toBe(true);
    expect(isValidCents(MAX_SAFE_CENTS)).toBe(true);
  });

  it("rejects negatives, fractions and non-finite values", () => {
    expect(isValidCents(-1)).toBe(false);
    expect(isValidCents(1.5)).toBe(false);
    expect(isValidCents(Number.NaN)).toBe(false);
    expect(isValidCents(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidCents("100")).toBe(false);
    expect(isValidCents(null)).toBe(false);
    expect(isValidCents(undefined)).toBe(false);
  });

  it("returns the value when valid and throws RangeError when not", () => {
    expect(assertCents(500)).toBe(500);
    expect(() => assertCents(-1)).toThrow(RangeError);
    expect(() => assertCents(1.5)).toThrow(RangeError);
    expect(() => assertCents(-1, "acquisitionPriceCents")).toThrow(/acquisitionPriceCents/);
  });
});

describe("money — toCents (trust-boundary coercion)", () => {
  it("rounds and clamps anything unusable to a usable cent amount", () => {
    expect(toCents(100)).toBe(100);
    expect(toCents(1.6)).toBe(2);
    expect(toCents(1.4)).toBe(1);
    expect(toCents(-500)).toBe(0);
    expect(toCents("1234")).toBe(1234);
    expect(toCents("12.7")).toBe(13);
    expect(toCents("abc")).toBe(0);
    expect(toCents(null)).toBe(0);
    expect(toCents(undefined)).toBe(0);
    expect(toCents(Number.NaN)).toBe(0);
    expect(toCents(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("money — sumCents", () => {
  it("sums exactly and ignores null/undefined", () => {
    expect(sumCents(100, 200, 300)).toBe(600);
    expect(sumCents(100, null, 200, undefined)).toBe(300);
    expect(sumCents()).toBe(0);
  });

  it("clamps negative components to zero rather than subtracting", () => {
    expect(sumCents(-500, 100)).toBe(100);
  });
});

describe("money — parseMoneyToCents", () => {
  it("parses dealer-entered money in the accepted formats", () => {
    expect(parseMoneyToCents("18500")).toBe(1_850_000);
    expect(parseMoneyToCents("$18,500")).toBe(1_850_000);
    expect(parseMoneyToCents("18500.50")).toBe(1_850_050);
    expect(parseMoneyToCents("18,500.5")).toBe(1_850_050);
    expect(parseMoneyToCents("  $1,234.56  ")).toBe(123_456);
    expect(parseMoneyToCents("$1,000,000")).toBe(100_000_000);
  });

  it("parses numeric input as dollars", () => {
    expect(parseMoneyToCents(185.5)).toBe(18_550);
    expect(parseMoneyToCents(0)).toBe(0);
  });

  it("returns null for values that are not numbers at all", () => {
    expect(parseMoneyToCents("")).toBeNull();
    expect(parseMoneyToCents("   ")).toBeNull();
    expect(parseMoneyToCents("abc")).toBeNull();
    expect(parseMoneyToCents("12.3.4")).toBeNull();
    expect(parseMoneyToCents(null)).toBeNull();
    expect(parseMoneyToCents(undefined)).toBeNull();
    expect(parseMoneyToCents(Number.NaN)).toBeNull();
    expect(parseMoneyToCents(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("rounds half a cent up at the boundary", () => {
    expect(parseMoneyToCents("0.005")).toBe(1);
    expect(parseMoneyToCents("0.004")).toBe(0);
    expect(parseMoneyToCents("0.015")).toBe(2);
  });

  // Documented behaviour: parseMoneyToCents is a PARSER, not a validator. It
  // returns negative cents for a negative input. Callers must reject negatives
  // in their validation layer (assertCents/isValidCents exist for that).
  it("passes negative input through as negative cents (validation is the caller's job)", () => {
    expect(parseMoneyToCents("-5")).toBe(-500);
    expect(parseMoneyToCents(-5)).toBe(-500);
  });
});

describe("money — centsToDecimalString", () => {
  it("renders exact decimal strings without grouping", () => {
    expect(centsToDecimalString(0)).toBe("0.00");
    expect(centsToDecimalString(1)).toBe("0.01");
    expect(centsToDecimalString(150)).toBe("1.50");
    expect(centsToDecimalString(1_850_000)).toBe("18500.00");
    expect(centsToDecimalString(123_456_789)).toBe("1234567.89");
  });

  it("handles negatives", () => {
    expect(centsToDecimalString(-500)).toBe("-5.00");
    expect(centsToDecimalString(-1)).toBe("-0.01");
  });
});

describe("money — formatCents", () => {
  it("formats whole dollars by default", () => {
    expect(formatCents(1_850_000)).toBe("$18,500");
    expect(formatCents(0)).toBe("$0");
    expect(formatCents(10_000_000)).toBe("$100,000");
  });

  it("includes cents when asked", () => {
    expect(formatCents(1_850_050, { withCents: true })).toBe("$18,500.50");
  });

  it("returns the em-dash fallback for missing values", () => {
    expect(formatCents(null)).toBe("—");
    expect(formatCents(undefined)).toBe("—");
    expect(formatCents(Number.NaN)).toBe("—");
    expect(formatCents(null, { fallback: "N/A" })).toBe("N/A");
  });
});

describe("money — basis points", () => {
  it("formats basis points as a percentage", () => {
    expect(formatBasisPoints(1250)).toBe("12.50%");
    expect(formatBasisPoints(1000)).toBe("10.00%");
    expect(formatBasisPoints(0)).toBe("0.00%");
    expect(formatBasisPoints(899)).toBe("8.99%");
    expect(formatBasisPoints(1250, 1)).toBe("12.5%");
    expect(formatBasisPoints(null)).toBe("—");
    expect(formatBasisPoints(undefined)).toBe("—");
  });

  it("converts between percent and basis points", () => {
    expect(percentToBasisPoints(8.99)).toBe(899);
    expect(percentToBasisPoints(12.5)).toBe(1250);
    expect(percentToBasisPoints(0)).toBe(0);
    expect(basisPointsToPercent(1250)).toBe(12.5);
    expect(basisPointsToPercent(899)).toBe(8.99);
  });

  it("applies basis points to a cent amount with half-up rounding", () => {
    expect(applyBasisPoints(1_000_000, 825)).toBe(82_500);
    expect(applyBasisPoints(1_500_000, 625)).toBe(93_750);
    expect(applyBasisPoints(100, 0)).toBe(0);
    // rounding boundaries: 100 * bps / 10000
    expect(applyBasisPoints(100, 125)).toBe(1); // 1.25 -> 1
    expect(applyBasisPoints(100, 135)).toBe(1); // 1.35 -> 1
    expect(applyBasisPoints(100, 150)).toBe(2); // 1.50 -> 2 (half up)
    expect(applyBasisPoints(100, 250)).toBe(3); // 2.50 -> 3 (half up, toward +inf)
  });
});
