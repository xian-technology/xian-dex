import { describe, expect, it, vi } from "vitest";
import type { XianDexCandle, XianDexCandlePage } from "@xian-tech/client";

import {
  candleFromApi,
  candleTimeline,
  fetchCandles,
  invertCandles,
  mergeCandles,
  prependRange,
  type Candle
} from "./candles";

function apiCandle(overrides: Partial<XianDexCandle> = {}): XianDexCandle {
  return {
    source: "xian_pairs_v1",
    marketId: "1",
    pairId: 1,
    bucketStart: "2026-07-05T12:00:00+00:00",
    bucketEnd: "2026-07-05T12:15:00+00:00",
    open: "2",
    high: "3",
    low: "1",
    close: "2.5",
    volumeToken0: "10",
    volumeToken1: "25",
    tradeCount: 4,
    firstBlockHeight: 100,
    lastBlockHeight: 110,
    firstEventId: 1,
    lastEventId: 9,
    raw: {},
    ...overrides
  };
}

function candle(time: number, close: number, overrides: Partial<Candle> = {}): Candle {
  return {
    time,
    open: close,
    high: close,
    low: close,
    close,
    volumeBase: 1,
    volumeQuote: 1,
    trades: 1,
    lastBlockHeight: 100,
    ...overrides
  };
}

describe("candleFromApi", () => {
  it("parses ISO bucket starts and string prices", () => {
    const c = candleFromApi(apiCandle());
    expect(c).toEqual({
      time: Date.parse("2026-07-05T12:00:00+00:00") / 1000,
      open: 2,
      high: 3,
      low: 1,
      close: 2.5,
      volumeBase: 10,
      volumeQuote: 25,
      trades: 4,
      lastBlockHeight: 110
    });
  });

  it("parses numeric epoch bucket starts", () => {
    const c = candleFromApi(apiCandle({ bucketStart: "1751716800" }));
    expect(c?.time).toBe(1751716800);
  });

  it("rejects candles with missing or non-positive prices", () => {
    expect(candleFromApi(apiCandle({ close: null }))).toBeNull();
    expect(candleFromApi(apiCandle({ low: "0" }))).toBeNull();
    expect(candleFromApi(apiCandle({ bucketStart: null }))).toBeNull();
  });
});

describe("invertCandles", () => {
  it("takes reciprocals, swapping high/low and the volume legs", () => {
    const [c] = invertCandles([
      candle(60, 0, { open: 2, high: 4, low: 1, close: 2.5, volumeBase: 10, volumeQuote: 25 })
    ]);
    expect(c.open).toBe(0.5);
    expect(c.high).toBe(1); // 1 / low
    expect(c.low).toBe(0.25); // 1 / high
    expect(c.close).toBe(0.4);
    expect(c.volumeBase).toBe(25);
    expect(c.volumeQuote).toBe(10);
  });
});

describe("candleTimeline", () => {
  it("keeps indexed OHLC and inserts only whitespace across an idle period", () => {
    const first = candle(0, 5);
    const second = candle(60_000, 7, { open: 8, high: 9, low: 6 });
    expect(candleTimeline([first, second], 60)).toEqual([first, { time: 60 }, second]);
    expect(candleTimeline([first, candle(60, 6)], 60)).toEqual([first, candle(60, 6)]);
  });

  it("keeps the same bars on-screen after prepending candles and whitespace", () => {
    const timeline = candleTimeline([candle(0, 5), candle(60, 6), candle(240, 7)], 60);
    expect(prependRange(timeline, 240, { from: -0.5, to: 6 })).toEqual({ from: 2.5, to: 9 });
  });
});

describe("mergeCandles", () => {
  it("replaces the still-open bucket and appends newer ones in order", () => {
    const existing = [candle(0, 5), candle(60, 6)];
    const incoming = [candle(60, 6.5), candle(120, 7)];
    const merged = mergeCandles(existing, incoming);
    expect(merged.map((c) => [c.time, c.close])).toEqual([
      [0, 5],
      [60, 6.5],
      [120, 7]
    ]);
  });

  it("keeps the existing series when the tail fetch is empty", () => {
    const existing = [candle(0, 5)];
    expect(mergeCandles(existing, [])).toBe(existing);
  });
});

describe("fetchCandles", () => {
  it("retains the cursor and normalizes the candles", async () => {
    const page: XianDexCandlePage = {
      items: [
        apiCandle({ bucketStart: "120", close: "7" }),
        apiCandle({ bucketStart: "60", close: "6" }),
        apiCandle({ bucketStart: "180", close: null })
      ],
      indexedHeight: 110,
      nextBefore: "2026-07-05T11:00:00+00:00"
    };
    const getDexCandlePage = vi.fn().mockResolvedValue(page);
    const result = await fetchCandles({ getDexCandlePage }, 1, "1m", {
      end: "2026-07-05T12:00:00+00:00"
    });
    expect(getDexCandlePage).toHaveBeenCalledWith(1, {
      interval: "1m", limit: 500, end: "2026-07-05T12:00:00+00:00"
    });
    expect(result.candles.map((c) => c.time)).toEqual([60, 120]);
    expect(result.nextBefore).toBe(page.nextBefore);
  });
});
