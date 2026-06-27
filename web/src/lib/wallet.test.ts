import { afterEach, describe, expect, it, vi } from "vitest";

import { connect, sendCall } from "./wallet";
import {
  registerInjectedXianProvider,
  type XianInjectionTarget,
  type XianProvider
} from "@xian-tech/provider";

function installWallet(request: XianProvider["request"]) {
  const provider: XianProvider = {
    request,
    on: vi.fn(),
    removeListener: vi.fn()
  };
  // Install exactly the way a real Xian wallet does (the browser extension calls
  // registerInjectedXianProvider). Hand-stubbing window.xian.provider with an
  // empty providers array does not match the EIP-6963-style discovery the
  // web-kit performs, so the provider would never be found.
  const target = new EventTarget() as unknown as XianInjectionTarget;
  vi.stubGlobal("window", target);
  registerInjectedXianProvider({
    metadata: { id: "test-wallet", name: "Test Wallet" },
    provider,
    target
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
