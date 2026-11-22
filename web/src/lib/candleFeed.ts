import type { XianClient } from "@xian-tech/client";

import { fetchCandles, mergeCandles, type Candle, type CandlePage } from "./candles";

const POLL_INTERVAL_MS = 10_000;
const TAIL_PAGE_SIZE = 100;

export interface CandleFeed {
  candles: Candle[];
  loading: boolean;
  error: boolean;
  hasOlder: boolean;
  historyStatus: "idle" | "loading" | "error";
  lastTradeTime: string | null;
}

export const INITIAL_CANDLE_FEED: CandleFeed = {
  candles: [],
  loading: true,
  error: false,
  hasOlder: false,
  historyStatus: "idle",
  lastTradeTime: null
};

export function startCandleFeed(
  client: Pick<XianClient, "getDexCandlePage" | "getIndexedBlock">,
  pairId: number,
  interval: string,
  publish: (feed: CandleFeed) => void
) {
  let feed = INITIAL_CANDLE_FEED;
  let older: string | null = null;
  let tradeBlock: Candle["lastBlockHeight"] = null;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = Promise.resolve();

  function update(change: Partial<CandleFeed>) {
    if (closed) return;
    feed = { ...feed, ...change };
    publish(feed);
  }

  function enqueue(task: () => Promise<void>) {
    pending = pending.then(async () => {
      if (!closed) await task();
    });
  }

  async function readPages(start?: number, end?: string): Promise<CandlePage> {
    let candles: Candle[] = [];
    let page: CandlePage;
    do {
      page = await fetchCandles(client, pairId, interval, {
        ...(start === undefined ? {} : { start, limit: TAIL_PAGE_SIZE }),
        ...(end === undefined ? {} : { end })
      });
      candles = mergeCandles(page.candles, candles);
      if (closed || page.nextBefore === null) break;
      if (end && !(Date.parse(page.nextBefore) < Date.parse(end))) {
        throw new Error("Candle cursor must move backward");
      }
      end = page.nextBefore;
      // A tail refresh fills the range back to the previous latest candle.
      // History can stop on any page with trades and resume on the next pan.
    } while (start !== undefined || candles.length === 0);
    return { candles, nextBefore: page.nextBefore };
  }

  async function updateTradeTime(candle?: Candle) {
    const height = candle?.lastBlockHeight;
    if (height == null || height === tradeBlock) return;
    const block = await client.getIndexedBlock(String(height)).catch(() => null);
    const time = block?.blockTimeIso;
    if (time && Number.isFinite(Date.parse(time))) {
      tradeBlock = height;
      update({ lastTradeTime: time });
    }
  }

  async function refresh() {
    const last = feed.candles.at(-1);
    try {
      const page = await readPages(last?.time);
      if (closed) return;
      if (!last) older = page.nextBefore;
      const candles = mergeCandles(feed.candles, page.candles);
      const latest = candles.at(-1);
      update({
        candles,
        loading: false,
        error: false,
        hasOlder: older !== null,
        lastTradeTime: latest?.lastBlockHeight === tradeBlock ? feed.lastTradeTime : null
      });
      await updateTradeTime(latest);
    } catch {
      update({ loading: false, error: true });
    } finally {
      if (!closed) timer = setTimeout(() => enqueue(refresh), POLL_INTERVAL_MS);
    }
  }

  function loadOlder() {
    if (closed || older === null || feed.historyStatus === "loading") return;
    update({ historyStatus: "loading" });
    enqueue(async () => {
      try {
        const page = await readPages(undefined, older ?? undefined);
        older = page.nextBefore;
        update({
          candles: mergeCandles(page.candles, feed.candles),
          hasOlder: older !== null,
          historyStatus: "idle"
        });
      } catch {
        update({ historyStatus: "error" });
      }
    });
  }

  enqueue(refresh);
  return {
    loadOlder,
    close() {
      closed = true;
      clearTimeout(timer);
    }
  };
}
