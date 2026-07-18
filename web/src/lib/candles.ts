import type { XianDexCandle } from "@xian-tech/client";

import { getClient } from "./xian";

// OHLC bucket in chart-friendly form. Prices are always quoted as
// "quote per base"; for a raw (non-inverted) pair that is token1 per
// token0, matching the BDS candle SQL.
export interface Candle {
  time: number; // bucket start, unix seconds (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volumeBase: number; // traded amount of the base (priced) token
  volumeQuote: number; // traded amount of the quote token
  trades: number;
}

export interface CandleInterval {
  key: string; // BDS interval param ("1m", "1h", …)
  label: string;
  seconds: number;
}

// The BDS accepts any s/m/h/d/w duration up to 1w; this is the curated
// set exposed in the UI.
export const CANDLE_INTERVALS: CandleInterval[] = [
  { key: "1m", label: "1m", seconds: 60 },
  { key: "5m", label: "5m", seconds: 300 },
  { key: "15m", label: "15m", seconds: 900 },
  { key: "1h", label: "1H", seconds: 3600 },
  { key: "4h", label: "4H", seconds: 14400 },
  { key: "1d", label: "1D", seconds: 86400 },
  { key: "1w", label: "1W", seconds: 604800 }
];
export const DEFAULT_CANDLE_INTERVAL = "15m";

export function intervalSeconds(key: string): number {
  return CANDLE_INTERVALS.find((i) => i.key === key)?.seconds ?? 900;
}

// The BDS only materialises buckets that contain trades, so 500 buckets
// can span an arbitrarily long wall-clock window on quiet pairs.
export const CANDLE_FETCH_LIMIT = 500;
// Hard cap on candles handed to the chart after gap filling.
export const MAX_CHART_CANDLES = 2500;

function parseTime(value: string | null): number | null {
  if (value == null || value === "") return null;
  if (/^\d+(\.\d+)?$/.test(value)) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.floor(n) : null;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

function parsePositive(value: string | null): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function candleFromApi(item: XianDexCandle): Candle | null {
  const time = parseTime(item.bucketStart);
  const open = parsePositive(item.open);
  const high = parsePositive(item.high);
  const low = parsePositive(item.low);
  const close = parsePositive(item.close);
  if (time == null || open == null || high == null || low == null || close == null) {
    return null;
  }
  return {
    time,
    open,
    high,
    low,
    close,
    volumeBase: Math.max(0, Number(item.volumeToken0) || 0),
    volumeQuote: Math.max(0, Number(item.volumeToken1) || 0),
    trades: item.tradeCount ?? 0
  };
}

export async function fetchCandles(
  pairId: number,
  interval: string,
  options?: { start?: number; limit?: number }
): Promise<Candle[]> {
  const items = await getClient().listDexCandles(pairId, {
    interval,
    limit: options?.limit ?? CANDLE_FETCH_LIMIT,
    start: options?.start
  });
  return items
    .map(candleFromApi)
    .filter((c): c is Candle => c != null)
    .sort((a, b) => a.time - b.time);
}

// Merge a freshly fetched tail into an existing ascending series. Buckets
// sharing a timestamp are replaced by the incoming version (the current
// bucket keeps accumulating trades until its window closes).
export function mergeCandles(existing: Candle[], incoming: Candle[]): Candle[] {
  if (incoming.length === 0) return existing;
  if (existing.length === 0) return incoming;
  const byTime = new Map<number, Candle>();
  for (const c of existing) byTime.set(c.time, c);
  for (const c of incoming) byTime.set(c.time, c);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

// Flip the price axis: quote-per-base becomes base-per-quote. High/low
// swap because inversion is monotonically decreasing.
export function invertCandles(candles: Candle[]): Candle[] {
  return candles.map((c) => ({
    time: c.time,
    open: 1 / c.open,
    high: 1 / c.low,
    low: 1 / c.high,
    close: 1 / c.close,
    volumeBase: c.volumeQuote,
    volumeQuote: c.volumeBase,
    trades: c.trades
  }));
}

// BDS OHLC values are built from executions inside each bucket. On a quiet
// market, a bucket with one trade therefore has open === close even when that
// trade moved sharply away from the preceding price. Carry the prior close
// into the next bucket's open so the rendered tape shows that movement while
// retaining the indexed close, volume, trade count, and intrabucket extremes.
export function connectCandleOpens(candles: Candle[]): Candle[] {
  return candles.map((candle, index) => {
    if (index === 0) return candle;
    const open = candles[index - 1].close;
    return {
      ...candle,
      open,
      high: Math.max(candle.high, open),
      low: Math.min(candle.low, open)
    };
  });
}

// The BDS omits buckets without trades. Insert flat zero-volume candles at
// the previous close so the chart reads as a continuous tape. Output is
// capped at maxCandles by dropping the oldest buckets first, which keeps a
// pair with two trades months apart from exploding into 40k fillers.
export function fillCandleGaps(
  candles: Candle[],
  seconds: number,
  maxCandles = MAX_CHART_CANDLES
): Candle[] {
  if (candles.length === 0 || seconds <= 0) return candles;
  const last = candles[candles.length - 1].time;
  const cutoff = last - (maxCandles - 1) * seconds;
  const out: Candle[] = [];
  let prev: Candle | null = null;
  for (const c of candles) {
    if (c.time < cutoff) {
      prev = c;
      continue;
    }
    if (prev != null) {
      for (
        let t = Math.max(prev.time + seconds, cutoff);
        t < c.time && out.length < maxCandles;
        t += seconds
      ) {
        out.push({
          time: t,
          open: prev.close,
          high: prev.close,
          low: prev.close,
          close: prev.close,
          volumeBase: 0,
          volumeQuote: 0,
          trades: 0
        });
      }
    }
    out.push(c);
    prev = c;
  }
  return out;
}
