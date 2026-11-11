import { describe, expect, it } from "vitest";
import { chainAmount, displayRate, positiveAmount, proportionalAmount, slippageBpsFromPercent } from "./amounts";

describe("V2 transaction amounts", () => {
  it("preserves the last decimal place and integers larger than 2^53", () => {
    const exact = "9007199254740993.000000000000000000000000000001";
    expect(positiveAmount(chainAmount(exact))).toBe(exact);
    expect(chainAmount(42)).toBe("42");
    expect(chainAmount(null)).toBe("0");
    expect(chainAmount(9007199254740993n)).toBe("9007199254740993");
    expect(() => chainAmount(1.25)).toThrow();
    expect(() => chainAmount(2 ** 53)).toThrow();
  });

  it("disables inputs that cannot be expressed in the token's units", () => {
    expect(positiveAmount("1.1", 0)).toBeNull();
    expect(positiveAmount("1.000001", 5)).toBeNull();
    expect(positiveAmount(".1000", 1)).toBe("0.1");
    expect(positiveAmount("0", 8)).toBeNull();
    expect(positiveAmount("1e-31")).toBeNull();
  });

  it("derives rate text and percentage settings without binary floating point", () => {
    expect(displayRate("3", "0")).toBe("—");
    expect(displayRate("9007199254740993.1", "10")).toBe("900719925474099.31");
    expect(displayRate("1e-30", "2")).toBe("< 1e-30");
    expect(displayRate("1e60", "0.01")).toBe("1" + "0".repeat(62));
    expect(slippageBpsFromPercent("0")).toBe(0);
    expect(slippageBpsFromPercent("50")).toBe(5000);
    expect(slippageBpsFromPercent("1.005")).toBe(101);
    expect(slippageBpsFromPercent("1.00499999999999999999")).toBe(100);
    expect(slippageBpsFromPercent("50.00001")).toBeNull();
    expect(slippageBpsFromPercent("")).toBeNull();
  });

  it("mirrors the contract's intermediate truncation and final token rounding", () => {
    expect(proportionalAmount("0.000000000000000000000000000001", "0.5", "0.5")).toBe("0");
    expect(proportionalAmount("9007199254740993.02", "2", "3", 4)).toBe("6004799503160662.0133");
    expect(proportionalAmount("1.5", "1", "1", 0)).toBe("1");
    expect(proportionalAmount("1e60", "10", "10")).toBeNull();
    expect(proportionalAmount("1", "2", "0")).toBeNull();
  });
});
