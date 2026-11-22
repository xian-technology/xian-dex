import type { XianClient, XianDexCandle, XianDexCandleOptions } from "@xian-tech/client";

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
  lastBlockHeight: XianDexCandle["lastBlockHeight"];
}

export interface CandlePage {
  candles: Candle[];
  nextBefore: string | null;
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

const CANDLE_FETCH_LIMIT = 500;

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
    trades: item.tradeCount ?? 0,
    lastBlockHeight: item.lastBlockHeight
  };
}

export async function fetchCandles(
  client: Pick<XianClient, "getDexCandlePage">,
  pairId: number,
  interval: string,
  options?: Pick<XianDexCandleOptions, "start" | "end" | "limit">
): Promise<CandlePage> {
  const page = await client.getDexCandlePage(pairId, { interval, limit: CANDLE_FETCH_LIMIT, ...options });
  return {
    candles: page.items.map(candleFromApi).filter((c) => c != null).sort((a, b) => a.time - b.time),
    nextBefore: page.nextBefore
  };
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
    ...c,
    open: 1 / c.open,
    high: 1 / c.low,
    low: 1 / c.high,
    close: 1 / c.close,
    volumeBase: c.volumeQuote,
    volumeQuote: c.volumeBase
  }));
}

export type CandlePoint = Candle | { time: number };

// One whitespace slot marks each idle period on the chart's ordinal time axis.
export function candleTimeline(candles: Candle[], interval: number): CandlePoint[] {
  const points: CandlePoint[] = [];
  let previous: Candle | undefined;
  for (const candle of candles) {
    if (previous && candle.time > previous.time + interval) {
      points.push({ time: previous.time + interval });
    }
    points.push(candle);
    previous = candle;
  }
  return points;
}

export function prependRange(
  points: CandlePoint[],
  previousFirstTime: number,
  range: { from: number; to: number }
): { from: number; to: number } {
  const added = Math.max(0, points.findIndex((point) => point.time === previousFirstTime));
  return { from: range.from + added, to: range.to + added };
}
