import { beforeEach, describe, expect, it, vi } from "vitest";

const sendCall = vi.hoisted(() => vi.fn(async () => ({ txHash: "DEX123" })));

vi.mock("./wallet", () => ({ sendCall }));

import { DEX_PAIRS, DEX_ROUTER } from "./constants";
import { approveLp, approveToken, deadlineFromNow, swap } from "./dex";

describe("DEX transaction helpers", () => {
  beforeEach(() => {
    sendCall.mockClear();
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

  it("builds LP approval calls", async () => {
    await approveLp(7, DEX_ROUTER, 100);

    expect(sendCall).toHaveBeenCalledWith({
      contract: DEX_PAIRS,
      function: "liqApprove",
      kwargs: { pair: 7, amount: 100, to: DEX_ROUTER }
    });
  });
});
