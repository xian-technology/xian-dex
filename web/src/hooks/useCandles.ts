import { useCallback, useEffect, useRef, useState } from "react";

import { INITIAL_CANDLE_FEED, startCandleFeed } from "../lib/candleFeed";
import { getClient } from "../lib/xian";
import { useRpcEpoch } from "./useRpcEpoch";

export function useCandles(pairId: number, interval: string) {
  const rpcEpoch = useRpcEpoch();
  const key = `${rpcEpoch}:${pairId}:${interval}`;
  const [state, setState] = useState({ key, feed: INITIAL_CANDLE_FEED });
  const active = useRef<ReturnType<typeof startCandleFeed> | null>(null);
  const loadOlder = useCallback(() => active.current?.loadOlder(), []);

  useEffect(() => {
    if (!Number.isFinite(pairId) || pairId <= 0) return;
    const feed = startCandleFeed(getClient(), pairId, interval, (snapshot) => {
      setState({ key, feed: snapshot });
    });
    active.current = feed;
    return () => {
      active.current = null;
      feed.close();
    };
  }, [pairId, interval, key]);

  return { ...(state.key === key ? state.feed : INITIAL_CANDLE_FEED), loadOlder };
}
