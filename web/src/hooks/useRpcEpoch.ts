import { useEffect, useState } from "react";
import { getRpcEpoch, subscribeRpcEpoch } from "../lib/xian";

/**
 * Returns a number that increments whenever the active RPC URL changes.
 * Include in effect dependency arrays so route components refetch on change.
 */
export function useRpcEpoch(): number {
  const [epoch, setEpoch] = useState(getRpcEpoch);
  useEffect(() => subscribeRpcEpoch(setEpoch), []);
  return epoch;
}
