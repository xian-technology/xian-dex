import { useEffect, useState } from "react";
import { getClient } from "../lib/xian";
import { useRpcEpoch } from "./useRpcEpoch";
import { useWallet } from "./useWallet";

export interface ChainCheck {
  rpcChainId: string | null;
  walletChainId: string | null;
  mismatch: boolean;
  loading: boolean;
}

export function useChainCheck(): ChainCheck {
  const wallet = useWallet();
  const rpcEpoch = useRpcEpoch();
  const [rpcChainId, setRpcChainId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setRpcChainId(null);
    getClient()
      .getChainId()
      .then((id) => {
        if (!cancel) setRpcChainId(id);
      })
      .catch(() => {
        if (!cancel) setRpcChainId(null);
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [rpcEpoch]);

  const walletChainId = wallet.chainId ?? null;
  const mismatch =
    !!rpcChainId && !!walletChainId && rpcChainId !== walletChainId;

  return { rpcChainId, walletChainId, mismatch, loading };
}
