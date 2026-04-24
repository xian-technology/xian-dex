import { useCallback, useEffect, useState } from "react";
import {
  connect as connectWallet,
  getAccounts,
  getWalletInfo,
  isWalletAvailable,
  onAccountsChanged,
  onChainChanged,
  type WalletInfo
} from "../lib/wallet";

export interface WalletState {
  available: boolean;
  account: string | null;
  chainId: string | null;
  info: WalletInfo | null;
  connecting: boolean;
  error: string | null;
}

const initial: WalletState = {
  available: typeof window !== "undefined" && isWalletAvailable(),
  account: null,
  chainId: null,
  info: null,
  connecting: false,
  error: null
};

export function useWallet() {
  const [state, setState] = useState<WalletState>(initial);

  const refresh = useCallback(async () => {
    if (!isWalletAvailable()) {
      setState((s) => ({ ...s, available: false, account: null, info: null }));
      return;
    }
    try {
      const info = await getWalletInfo();
      const account = info.selectedAccount ?? info.accounts[0] ?? null;
      setState((s) => ({
        ...s,
        available: true,
        connecting: false,
        info,
        account: account,
        chainId: info.chainId ?? s.chainId,
        error: null
      }));
    } catch {
      try {
        const accounts = await getAccounts();
        setState((s) => ({
          ...s,
          available: true,
          connecting: false,
          account: accounts[0] ?? null
        }));
      } catch {
        setState((s) => ({ ...s, available: true, connecting: false }));
      }
    }
  }, []);

  const connect = useCallback(async () => {
    if (!isWalletAvailable()) {
      setState((s) => ({ ...s, error: "Xian wallet extension not detected" }));
      return null;
    }
    setState((s) => ({ ...s, connecting: true, error: null }));
    try {
      const accounts = await connectWallet();
      const account = accounts[0] ?? null;
      setState((s) => ({ ...s, connecting: false, account, error: null }));
      void refresh();
      return account;
    } catch (e) {
      setState((s) => ({
        ...s,
        connecting: false,
        error: e instanceof Error ? e.message : "Failed to connect"
      }));
      return null;
    }
  }, [refresh]);

  useEffect(() => {
    let timer: number | undefined;
    const detectInjection = () => {
      if (isWalletAvailable()) {
        setState((s) => ({ ...s, available: true }));
        void refresh();
        if (timer) window.clearInterval(timer);
      }
    };
    detectInjection();
    timer = window.setInterval(detectInjection, 600);
    const stop1 = onAccountsChanged((accounts) => {
      setState((s) => ({ ...s, account: accounts[0] ?? null }));
    });
    const stop2 = onChainChanged((chainId) => {
      setState((s) => ({ ...s, chainId }));
    });
    return () => {
      if (timer) window.clearInterval(timer);
      stop1();
      stop2();
    };
  }, [refresh]);

  return { ...state, connect, refresh };
}
