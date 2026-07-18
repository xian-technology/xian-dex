import { describe, expect, it } from "vitest";

import { formatExecutionImpact, formatNumber, formatPrice, toDecimalInput } from "./format";

describe("toDecimalInput", () => {
  it("never emits grouping separators", () => {
    const s = toDecimalInput(1234567.8912);
    expect(s).not.toContain(",");
    expect(Number(s)).toBeCloseTo(1234567.8912, 4);
  });

  it("expands small values instead of exponent notation", () => {
    expect(toDecimalInput(1e-7)).toBe("0.0000001");
    expect(toDecimalInput(0.000001)).toBe("0.000001");
  });

  it("trims trailing zeros and the dangling dot", () => {
    expect(toDecimalInput(1.5)).toBe("1.5");
    expect(toDecimalInput(2)).toBe("2");
  });

  it("returns 0 for non-finite input", () => {
    expect(toDecimalInput(NaN)).toBe("0");
    expect(toDecimalInput(Infinity)).toBe("0");
  });

  it("round-trips through Number()", () => {
    for (const v of [0.1, 33.333333333333336, 1234.5678, 1e-6, 999999.999]) {
      expect(Number(toDecimalInput(v))).toBeCloseTo(v, 6);
    }
  });

  it("never exceeds the original value (Max must stay spendable)", () => {
    for (const v of [0.123456789, 1.9999999999999, 0.10000000000000009, 777.7777777777]) {
      expect(Number(toDecimalInput(v))).toBeLessThanOrEqual(v);
    }
  });

  it("preserves the canonical eight-decimal LP balance for Max removal", () => {
    expect(toDecimalInput("9999.99999999")).toBe("9999.99999999");
  });
});

describe("formatNumber", () => {
  it("groups thousands for display", () => {
    expect(formatNumber(1234.5)).toBe("1,234.5");
  });

  it("is therefore NOT safe as input value (documents the contrast)", () => {
    expect(Number(formatNumber(1234.5))).toBeNaN();
  });
});

describe("formatPrice", () => {
  it("normalizes floating-point residue around a zero chart tick", () => {
    expect(formatPrice(2.78e-16)).toBe("0");
    expect(formatPrice(-Number.EPSILON)).toBe("0");
  });

  it("keeps meaningful small prices in scientific notation", () => {
    expect(formatPrice(1e-12)).toBe("1.00e-12");
  });
});

describe("formatExecutionImpact", () => {
  it("describes quote impact as execution loss rather than market direction", () => {
    expect(formatExecutionImpact(0.86532668)).toBe("86.53% worse than spot");
    expect(formatExecutionImpact(0)).toBe("0.00% worse than spot");
  });

  it("does not render a negative directional impact", () => {
    expect(formatExecutionImpact(-0.1)).toBe("0.00% worse than spot");
  });
});
