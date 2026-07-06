import { useEffect, useState } from "react";

import { fetchCandles, mergeCandles, type Candle } from "../lib/candles";
import { useRpcEpoch } from "./useRpcEpoch";

const CANDLE_POLL_MS = 10_000;
// Tail refetch window: the still-open bucket plus room for fresh ones.
const CANDLE_TAIL_LIMIT = 100;

export interface CandleFeed {
  candles: Candle[];
  loading: boolean;
  error: boolean;
}

// Streams OHLC history for a pair: one full load per pair/interval/RPC,
// then a light tail poll that refetches from the last known bucket so the
// open candle keeps ticking and new buckets appear without a full reload.
// Candles are returned in raw orientation (token1 per token0); invert in
// the consumer so flipping the axis doesn't refetch.
export function useCandles(pairId: number, interval: string): CandleFeed {
  const rpcEpoch = useRpcEpoch();
  const [feed, setFeed] = useState<CandleFeed>({ candles: [], loading: true, error: false });

  useEffect(() => {
    if (!Number.isFinite(pairId) || pairId <= 0) return;
    let cancel = false;
    let current: Candle[] = [];
    setFeed({ candles: [], loading: true, error: false });

    const load = async () => {
      const candles = await fetchCandles(pairId, interval);
      if (cancel) return;
      current = candles;
      setFeed({ candles, loading: false, error: false });
    };

    const refresh = async () => {
      try {
        if (current.length === 0) {
          await load();
          return;
        }
        const last = current[current.length - 1].time;
        const tail = await fetchCandles(pairId, interval, {
          start: last,
          limit: CANDLE_TAIL_LIMIT
        });
        if (cancel || tail.length === 0) return;
        current = mergeCandles(current, tail);
        setFeed({ candles: current, loading: false, error: false });
      } catch {
        /* keep last good data on poll errors */
      }
    };

    void load().catch(() => {
      if (!cancel) setFeed({ candles: [], loading: false, error: true });
    });
    const timer = window.setInterval(() => void refresh(), CANDLE_POLL_MS);
    return () => {
      cancel = true;
      window.clearInterval(timer);
    };
  }, [pairId, interval, rpcEpoch]);

  return feed;
}
