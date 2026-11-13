import { OUT_OF_CHI_MESSAGE } from "@xian-tech/web-kit";
import { describe, expect, it } from "vitest";

import { txFailureMessage } from "./txFailure";

describe("txFailureMessage", () => {
  it("explains a transaction that ran out of chi as a changed state", () => {
    expect(txFailureMessage(new Error("'Out of chi.'"))).toBe(OUT_OF_CHI_MESSAGE);
    expect(txFailureMessage("VmExecutionError: out of chi")).toBe(OUT_OF_CHI_MESSAGE);
  });

  it("passes other failures through", () => {
    expect(txFailureMessage(new Error("Transaction rejected"))).toBe("Transaction rejected");
    expect(txFailureMessage("AssertionError('slippage')")).toBe("AssertionError('slippage')");
    expect(txFailureMessage(42)).toBe("42");
  });
});
