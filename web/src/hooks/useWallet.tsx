import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
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

export interface WalletContextValue extends WalletState {
  connect: () => Promise<string | null>;
  refresh: () => Promise<void>;
}

const initial: WalletState = {
  available: typeof window !== "undefined" && isWalletAvailable(),
  account: null,
  chainId: null,
  info: null,
  connecting: false,
  error: null
};

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>(initial);
  // Single in-flight connect promise — prevents two cards calling connect()
  // simultaneously from triggering two `xian_requestAccounts` prompts.
  const connectInFlight = useRef<Promise<string | null> | null>(null);

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
        account,
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
    if (connectInFlight.current) return connectInFlight.current;
    if (!isWalletAvailable()) {
      setState((s) => ({ ...s, error: "Xian wallet extension not detected" }));
      return null;
    }
    setState((s) => ({ ...s, connecting: true, error: null }));
    const p = (async () => {
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
      } finally {
        connectInFlight.current = null;
      }
    })();
    connectInFlight.current = p;
    return p;
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
      // Re-fetch info so derived flags like `locked` track unlock/relock from
      // outside our UI (e.g. user unlocks via the extension popup directly).
      void refresh();
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

  const value = useMemo<WalletContextValue>(
    () => ({ ...state, connect, refresh }),
    [state, connect, refresh]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}
