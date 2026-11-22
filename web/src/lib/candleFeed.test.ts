import { afterEach, describe, expect, it, vi } from "vitest";
import type { XianClient } from "@xian-tech/client";

import { startCandleFeed, type CandleFeed } from "./candleFeed";

function page(times: number[], nextBefore: string | null = null) {
  return {
    items: times.map((time) => ({
      bucketStart: String(time), open: "3", high: "5", low: "2", close: "4",
      volumeToken0: "10", volumeToken1: "40", tradeCount: 1, lastBlockHeight: time
    })),
    indexedHeight: 500,
    nextBefore
  };
}

function openFeed() {
  vi.useFakeTimers();
  const getDexCandlePage = vi.fn();
  const getIndexedBlock = vi.fn<XianClient["getIndexedBlock"]>().mockResolvedValue({
    height: null, blockHash: null, appHash: null, blockTime: null,
    blockTimeIso: "2026-11-22T13:45:23Z", proposer: null, txCount: null, raw: {}
  });
  const publish = vi.fn<(feed: CandleFeed) => void>();
  const feed = startCandleFeed({ getDexCandlePage, getIndexedBlock }, 1, "1m", publish);
  return { getDexCandlePage, getIndexedBlock, feed, latest: () => publish.mock.lastCall?.[0] };
}

afterEach(() => vi.useRealTimers());

describe("candle history", () => {
  it("follows the cursor through a short page and stops at a null cursor", async () => {
    const { getDexCandlePage, feed, latest } = openFeed();
    const cursor = "2026-11-22T10:00:00Z";
    const olderCursor = "2026-11-21T10:00:00Z";
    getDexCandlePage.mockResolvedValueOnce(page([360], cursor))
      .mockResolvedValueOnce(page([], olderCursor))
      .mockResolvedValueOnce(page([120, 180]));
    await vi.advanceTimersByTimeAsync(0);
    expect(latest()?.hasOlder).toBe(true);

    feed.loadOlder();
    feed.loadOlder();
    await vi.advanceTimersByTimeAsync(0);
    expect(getDexCandlePage.mock.calls.map(([, options]) => options.end))
      .toEqual([undefined, cursor, olderCursor]);
    expect(latest()?.candles.map((c) => c.time)).toEqual([120, 180, 360]);
    expect(latest()?.hasOlder).toBe(false);
    feed.loadOlder();
    await vi.advanceTimersByTimeAsync(0);
    expect(getDexCandlePage).toHaveBeenCalledTimes(3);
    feed.close();
  });

  it("keeps the cursor on a history error and retries from the same end", async () => {
    const { getDexCandlePage, feed, latest } = openFeed();
    const cursor = "2026-11-22T10:00:00Z";
    getDexCandlePage.mockResolvedValueOnce(page([360], cursor))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(page([120]));
    await vi.advanceTimersByTimeAsync(0);
    feed.loadOlder();
    await vi.advanceTimersByTimeAsync(0);
    expect(latest()).toMatchObject({ hasOlder: true, historyStatus: "error" });
    expect(latest()?.candles.map((c) => c.time)).toEqual([360]);
    feed.loadOlder();
    await vi.advanceTimersByTimeAsync(0);
    expect(getDexCandlePage.mock.calls.slice(1).map(([, options]) => options.end))
      .toEqual([cursor, cursor]);
    expect(latest()?.candles.map((c) => c.time)).toEqual([120, 360]);
    feed.close();
  });
});

describe("candle refresh", () => {
  it("ends the initial loading state on failure and retries a full load", async () => {
    const { getDexCandlePage, feed, latest } = openFeed();
    getDexCandlePage.mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(page([360]));
    await vi.advanceTimersByTimeAsync(0);
    expect(latest()).toMatchObject({ loading: false, error: true, candles: [] });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(getDexCandlePage).toHaveBeenLastCalledWith(1, { interval: "1m", limit: 500 });
    expect(latest()).toMatchObject({ loading: false, error: false });
    expect(latest()?.candles.map((c) => c.time)).toEqual([360]);
    feed.close();
  });

  it("waits for a slow refresh, keeps the last good data on failure, and recovers", async () => {
    const { getDexCandlePage, getIndexedBlock, feed, latest } = openFeed();
    let failRefresh!: (error: Error) => void;
    const pending = new Promise<ReturnType<typeof page>>((_, reject) => {
      failRefresh = reject;
    });
    getDexCandlePage.mockResolvedValueOnce(page([360]))
      .mockReturnValueOnce(pending)
      .mockResolvedValueOnce(page([360, 420]));
    await vi.advanceTimersByTimeAsync(0);
    expect(latest()?.lastTradeTime).toBe("2026-11-22T13:45:23Z");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(getDexCandlePage).toHaveBeenCalledTimes(2);
    expect(getDexCandlePage).toHaveBeenLastCalledWith(1, { interval: "1m", start: 360, limit: 100 });

    failRefresh(new Error("offline"));
    await vi.advanceTimersByTimeAsync(0);
    expect(latest()).toMatchObject({ error: true, lastTradeTime: "2026-11-22T13:45:23Z" });
    expect(latest()?.candles.map((c) => c.time)).toEqual([360]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(latest()?.error).toBe(false);
    expect(latest()?.candles.map((c) => c.time)).toEqual([360, 420]);
    expect(getIndexedBlock.mock.calls).toEqual([["360"], ["420"]]);
    feed.close();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(getDexCandlePage).toHaveBeenCalledTimes(3);
  });

  it("fills multiple tail pages after a long pause without losing history", async () => {
    const { getDexCandlePage, feed, latest } = openFeed();
    const historyCursor = "2026-11-20T10:00:00Z";
    const tailCursor = "2026-11-22T10:00:00Z";
    getDexCandlePage.mockResolvedValueOnce(page([360], historyCursor))
      .mockResolvedValueOnce(page([480, 540], tailCursor))
      .mockResolvedValueOnce(page([360, 420]))
      .mockResolvedValueOnce(page([120]));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getDexCandlePage).toHaveBeenLastCalledWith(1, {
      interval: "1m", limit: 100, start: 360, end: tailCursor
    });
    expect(latest()?.candles.map((c) => c.time)).toEqual([360, 420, 480, 540]);
    feed.loadOlder();
    await vi.advanceTimersByTimeAsync(0);
    expect(getDexCandlePage).toHaveBeenLastCalledWith(1, {
      interval: "1m", limit: 500, end: historyCursor
    });
    feed.close();
  });
});
