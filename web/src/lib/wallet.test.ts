import { afterEach, describe, expect, it, vi } from "vitest";

import { connect, sendCall } from "./wallet";
import type { XianProvider } from "@xian-tech/provider";

function installWallet(request: XianProvider["request"]) {
  const provider: XianProvider = {
    request,
    on: vi.fn(),
    removeListener: vi.fn()
  };
  vi.stubGlobal("window", {
    xian: { provider },
    xianProviders: []
  });
  return provider;
}

describe("wallet bridge", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("connects through the injected provider", async () => {
    const request = vi.fn(async () => ["a".repeat(64)]);
    installWallet(request);

    await expect(connect()).resolves.toEqual(["a".repeat(64)]);
    expect(request).toHaveBeenCalledWith({
      method: "xian_requestAccounts",
      params: undefined
    });
  });

  it("sends calls with DEX wait defaults", async () => {
    const request = vi.fn(async () => ({ txHash: "DEX123", accepted: true }));
    installWallet(request);

    await expect(
      sendCall({
        contract: "currency",
        function: "approve",
        kwargs: { amount: 10, to: "router" }
      })
    ).resolves.toMatchObject({ txHash: "DEX123" });

    expect(request).toHaveBeenCalledWith({
      method: "xian_sendCall",
      params: [
        {
          intent: {
            contract: "currency",
            function: "approve",
            kwargs: { amount: 10, to: "router" }
          },
          mode: undefined,
          waitForTx: true,
          timeoutMs: 30_000,
          pollIntervalMs: undefined
        }
      ]
    });
  });
});
