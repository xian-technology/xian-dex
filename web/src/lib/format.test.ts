import { describe, expect, it } from "vitest";

import { formatNumber, toDecimalInput } from "./format";

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
});

describe("formatNumber", () => {
  it("groups thousands for display", () => {
    expect(formatNumber(1234.5)).toBe("1,234.5");
  });

  it("is therefore NOT safe as input value (documents the contrast)", () => {
    expect(Number(formatNumber(1234.5))).toBeNaN();
  });
});
