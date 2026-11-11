import { describe, expect, it } from "vitest";

import { formatExecutionImpact, formatNumber, formatPrice } from "./format";

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
