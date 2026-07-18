import { describe, expect, it, vi } from "vitest";
import type { XianDexCandle } from "@xian-tech/client";

const listDexCandles = vi.hoisted(() => vi.fn(async () => [] as unknown[]));

vi.mock("./xian", () => ({ getClient: () => ({ listDexCandles }) }));

import {
  candleFromApi,
  connectCandleOpens,
  fetchCandles,
  fillCandleGaps,
  invertCandles,
  mergeCandles,
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
      trades: 4
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

describe("connectCandleOpens", () => {
  it("shows movement from the prior close for a single-trade bucket", () => {
    const connected = connectCandleOpens([
      candle(0, 1.532717),
      candle(300, 0.276932)
    ]);

    expect(connected[0]).toEqual(candle(0, 1.532717));
    expect(connected[1]).toMatchObject({
      open: 1.532717,
      high: 1.532717,
      low: 0.276932,
      close: 0.276932,
      trades: 1
    });
  });

  it("includes the prior close without discarding intrabucket extremes", () => {
    const connected = connectCandleOpens([
      candle(0, 2),
      candle(300, 2.5, { open: 3, high: 4, low: 2.25 })
    ]);

    expect(connected[1]).toMatchObject({
      open: 2,
      high: 4,
      low: 2,
      close: 2.5
    });
  });
});

describe("fillCandleGaps", () => {
  it("bridges empty buckets with flat zero-volume candles at the prior close", () => {
    const filled = fillCandleGaps([candle(0, 5), candle(180, 7)], 60);
    expect(filled.map((c) => c.time)).toEqual([0, 60, 120, 180]);
    expect(filled[1]).toMatchObject({ open: 5, high: 5, low: 5, close: 5, volumeBase: 0, trades: 0 });
    expect(filled[2].close).toBe(5);
    expect(filled[3].close).toBe(7);
  });

  it("leaves contiguous series untouched", () => {
    const series = [candle(0, 5), candle(60, 6)];
    expect(fillCandleGaps(series, 60)).toEqual(series);
  });

  it("caps output at maxCandles by dropping the oldest buckets", () => {
    // Two trades 1000 minutes apart on 1m candles: without the cap this
    // would fill 999 buckets.
    const filled = fillCandleGaps([candle(0, 5), candle(60_000, 7)], 60, 10);
    expect(filled.length).toBe(10);
    expect(filled[filled.length - 1].close).toBe(7);
    expect(filled[0].time).toBe(60_000 - 9 * 60);
    expect(filled[0].close).toBe(5);
  });

  it("handles empty input", () => {
    expect(fillCandleGaps([], 60)).toEqual([]);
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
  it("sorts ascending and drops unparseable rows", async () => {
    listDexCandles.mockResolvedValueOnce([
      apiCandle({ bucketStart: "120", close: "7" }),
      apiCandle({ bucketStart: "60", close: "6" }),
      apiCandle({ bucketStart: "180", close: null })
    ]);
    const candles = await fetchCandles(1, "1m");
    expect(listDexCandles).toHaveBeenCalledWith(1, { interval: "1m", limit: 500, start: undefined });
    expect(candles.map((c) => c.time)).toEqual([60, 120]);
  });
});
