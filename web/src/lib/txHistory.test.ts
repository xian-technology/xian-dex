import { beforeEach, describe, expect, it, vi } from "vitest";

const getTx = vi.hoisted(() => vi.fn());
vi.mock("./xian", () => ({ getClient: () => ({ getTx }) }));

import { OUT_OF_CHI_MESSAGE } from "@xian-tech/web-kit";
import { addTx, listTxs, reconcilePendingTxs, track } from "./txHistory";

const STALE_MS = 10 * 60 * 1000;
const meta = { label: "Swap", contract: "con_dex", function: "swap" };

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value)
  };
}

const NOW = Date.UTC(2026, 10, 13, 12, 0, 0);

function pending(txHash: string | undefined, ageMs: number) {
  vi.setSystemTime(NOW - ageMs);
  const record = addTx({ ...meta, status: "pending", txHash });
  vi.setSystemTime(NOW);
  return record;
}

function statusOf(id: string) {
  const record = listTxs().find((tx) => tx.id === id);
  return record && { status: record.status, message: record.message };
}

describe("reconcilePendingTxs", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.useFakeTimers({ toFake: ["Date"] });
    getTx.mockReset();
  });

  it("settles pending records from their receipts", async () => {
    const ok = pending("OK", 0);
    const outOfChi = pending("CHI", 0);
    const reverted = pending("REV", 0);
    const silent = pending("SILENT", 0);
    const messages: Record<string, string> = { CHI: "'Out of chi.'", REV: "boom", SILENT: "" };
    getTx.mockImplementation(async (hash: string) =>
      hash === "OK"
        ? { success: true, txHash: hash }
        : { success: false, txHash: hash, message: messages[hash] }
    );

    await reconcilePendingTxs();

    expect(statusOf(ok.id)).toEqual({ status: "success", message: undefined });
    expect(statusOf(outOfChi.id)).toEqual({ status: "failed", message: OUT_OF_CHI_MESSAGE });
    expect(statusOf(reverted.id)).toEqual({ status: "failed", message: "boom" });
    expect(statusOf(silent.id)).toEqual({ status: "failed", message: "Transaction failed" });
  });

  it("settles a single pending record", async () => {
    const only = pending("OK", 0);
    getTx.mockResolvedValue({ success: true, txHash: "OK" });

    await reconcilePendingTxs();

    expect(statusOf(only.id)?.status).toBe("success");
  });

  it("fails only stale records it cannot confirm", async () => {
    const freshMissing = pending("NEW", 0);
    const staleMissing = pending("OLD", STALE_MS + 1);
    const borderMissing = pending("BORDER", STALE_MS);
    const staleNoHash = pending(undefined, STALE_MS + 1);
    const freshNoHash = pending(undefined, 0);
    const staleUnreachable = pending("ERR", STALE_MS + 1);
    getTx.mockImplementation(async (hash: string) => {
      if (hash === "ERR") throw new Error("offline");
      return { success: false };
    });

    await reconcilePendingTxs();

    expect(statusOf(freshMissing.id)?.status).toBe("pending");
    expect(statusOf(freshNoHash.id)?.status).toBe("pending");
    expect(statusOf(borderMissing.id)?.status).toBe("pending");
    expect(statusOf(staleMissing.id)).toEqual({
      status: "failed",
      message: "Transaction not found on chain"
    });
    expect(statusOf(staleNoHash.id)).toEqual({ status: "failed", message: "No tx hash recorded" });
    expect(statusOf(staleUnreachable.id)).toEqual({
      status: "failed",
      message: "Could not reach RPC to confirm"
    });
  });
});

describe("track", () => {
  beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));

  it("records a rejected call with the failure message", async () => {
    await expect(
      track(meta, async () => {
        throw new Error("'Out of chi.'");
      })
    ).rejects.toThrow("Out of chi");
    expect(listTxs()[0]).toMatchObject({ status: "failed", message: OUT_OF_CHI_MESSAGE });
  });
});
