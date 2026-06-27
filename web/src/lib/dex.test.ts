import { beforeEach, describe, expect, it, vi } from "vitest";

const sendCall = vi.hoisted(() => vi.fn(async () => ({ txHash: "DEX123" })));
const getState = vi.hoisted(() => vi.fn(async () => null as unknown));

vi.mock("./wallet", () => ({ sendCall }));
vi.mock("./xian", () => ({ getClient: () => ({ getState }) }));

import { DEX_ROUTER } from "./constants";
import { approveLp, approveToken, deadlineFromNow, swap } from "./dex";

describe("DEX transaction helpers", () => {
  beforeEach(() => {
    sendCall.mockClear();
    getState.mockReset();
    getState.mockResolvedValue(null);
  });

  it("builds token approval calls", async () => {
    await approveToken("currency", DEX_ROUTER, 25);

    expect(sendCall).toHaveBeenCalledWith({
      contract: "currency",
      function: "approve",
      kwargs: { amount: 25, to: DEX_ROUTER }
    });
  });

  it("builds swap calls with the selected router function", async () => {
    const deadline = deadlineFromNow(15);

    await swap({
      amountIn: 10,
      amountOutMin: 9,
      path: [1, 2],
      src: "currency",
      to: "b".repeat(64),
      deadline,
      feeOnTransfer: true
    });

    expect(sendCall).toHaveBeenCalledWith({
      contract: DEX_ROUTER,
      function: "swapExactTokensForTokensSupportingFeeOnTransferTokens",
      kwargs: {
        amountIn: 10,
        amountOutMin: 9,
        path: [1, 2],
        src: "currency",
        to: "b".repeat(64),
        deadline
      }
    });
  });

  it("approves the router on the pair's bound LP token contract", async () => {
    // approveLp must resolve the pair's LP token (pairs[id, "lpToken"]) and call
    // approve on THAT token contract — not a nonexistent con_pairs.liqApprove.
    getState.mockResolvedValueOnce("con_lp_pair_7");

    await approveLp(7, DEX_ROUTER, 100);

    expect(getState).toHaveBeenCalledWith("con_pairs", "pairs", ["7", "lpToken"]);
    expect(sendCall).toHaveBeenCalledWith({
      contract: "con_lp_pair_7",
      function: "approve",
      kwargs: { amount: 100, to: DEX_ROUTER }
    });
  });

  it("throws when the pair has no bound LP token", async () => {
    getState.mockResolvedValueOnce(null);
    await expect(approveLp(99, DEX_ROUTER, 100)).rejects.toThrow("No LP token");
    expect(sendCall).not.toHaveBeenCalled();
  });
});
