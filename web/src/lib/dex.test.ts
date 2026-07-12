import { beforeEach, describe, expect, it, vi } from "vitest";

const sendCall = vi.hoisted(() => vi.fn(async () => ({ txHash: "DEX123" })));
const getState = vi.hoisted(() => vi.fn(
  async (contract?: string, key?: string, args?: string[]) => {
    void contract;
    void key;
    void args;
    return null as unknown;
  }
));

vi.mock("./wallet", () => ({ sendCall }));
vi.mock("./xian", () => ({ getClient: () => ({ getState }) }));

import { DEX_ROUTER } from "./constants";
import {
  approveLp,
  approveToken,
  deadlineFromNow,
  invalidatePairCache,
  quoteSwap,
  swap
} from "./dex";

describe("DEX transaction helpers", () => {
  beforeEach(() => {
    sendCall.mockClear();
    getState.mockReset();
    getState.mockResolvedValue(null);
    invalidatePairCache();
  });

  it("builds token approval calls", async () => {
    await approveToken("currency", DEX_ROUTER, 25);

    expect(sendCall).toHaveBeenCalledWith({
      contract: "currency",
      function: "approve",
      kwargs: { amount: { __fixed__: "25" }, to: DEX_ROUTER }
    });
  });

  it("builds swap calls with the selected router function", async () => {
    const deadline = deadlineFromNow(15);
    const quote = {
      amountIn: 10,
      amountOut: 9,
      hops: [
        {
          pairId: 1,
          fromToken: "currency",
          toToken: "token_b",
          reserveIn: 100,
          reserveOut: 100,
          amountIn: 10,
          amountOut: 9
        }
      ],
      path: [1],
      feeBps: 30,
      priceImpact: 0.1,
      midPriceOut: 1
    };

    await swap({
      quote,
      recipient: "b".repeat(64),
      slippageBps: 100,
      deadline,
      supportingFeeOnTransfer: true
    });

    expect(sendCall).toHaveBeenCalledWith({
      contract: DEX_ROUTER,
      function: "swapExactTokensForTokensSupportingFeeOnTransferTokens",
      kwargs: {
        amountIn: { __fixed__: "10" },
        amountOutMin: { __fixed__: "8.91" },
        path: [1],
        src: "currency",
        to: "b".repeat(64),
        deadline
      }
    });
  });

  it("quotes cached chain pairs through the shared deterministic planner", async () => {
    const pairState = {
      "1": { token0: "a", token1: "b", reserve0: 1_000, reserve1: 1_000 },
      "2": { token0: "b", token1: "c", reserve0: 1_000, reserve1: 2_000 },
      "3": { token0: "a", token1: "c", reserve0: 1_000, reserve1: 1_500 }
    } as const;
    getState.mockImplementation(async (_contract, key, args) => {
      if (key === "pairs_num") return 3;
      if (key !== "pairs" || !args) return null;
      const pair = pairState[args[0] as keyof typeof pairState];
      if (!pair) return null;
      const field = args[1] as keyof typeof pair;
      return pair[field] ?? null;
    });

    const quote = await quoteSwap("a", "c", 100, 30);

    expect(quote?.path).toEqual([1, 2]);
    expect(quote?.hops.map((hop) => hop.toToken)).toEqual(["b", "c"]);
    expect(quote?.amountOut).toBeGreaterThan(150);
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
      kwargs: { amount: { __fixed__: "100" }, to: DEX_ROUTER }
    });
  });

  it("throws when the pair has no bound LP token", async () => {
    getState.mockResolvedValueOnce(null);
    await expect(approveLp(99, DEX_ROUTER, 100)).rejects.toThrow("No LP token");
    expect(sendCall).not.toHaveBeenCalled();
  });
});
