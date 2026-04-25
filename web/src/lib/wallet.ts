/**
 * Browser wallet integration through the injected window.xian.provider.
 * Mirrors the InjectedXianWallet API exposed by @xian-tech/provider but
 * stays as a thin wrapper so the rest of the app keeps a small surface.
 */

export interface WalletInfo {
  connected: boolean;
  locked: boolean;
  accounts: string[];
  selectedAccount?: string;
  chainId?: string;
}

type Args = { method: string; params?: unknown[] };

interface InjectedProvider {
  request(args: Args): Promise<unknown>;
  on(event: string, cb: (...args: unknown[]) => void): void;
  removeListener(event: string, cb: (...args: unknown[]) => void): void;
}

type XianWindow = Window & {
  xian?: { provider?: InjectedProvider };
};

export function isWalletAvailable(): boolean {
  return typeof window !== "undefined" && !!(window as XianWindow).xian?.provider;
}

function provider(): InjectedProvider {
  const p = (window as XianWindow).xian?.provider;
  if (!p) throw new Error("Xian wallet not detected. Install the Xian browser wallet to continue.");
  return p;
}

async function request<T = unknown>(method: string, params?: unknown[]): Promise<T> {
  return provider().request({ method, params: params ?? [] }) as Promise<T>;
}

export async function connect(): Promise<string[]> {
  return request<string[]>("xian_requestAccounts");
}

export async function getAccounts(): Promise<string[]> {
  return request<string[]>("xian_accounts");
}

export async function getWalletInfo(): Promise<WalletInfo> {
  return request<WalletInfo>("xian_getWalletInfo");
}

export interface CallIntent {
  contract: string;
  function: string;
  kwargs: Record<string, unknown>;
  chiSupplied?: number;
  chainId?: string;
}

export interface SendCallResult {
  submitted?: boolean;
  accepted?: boolean | null;
  finalized?: boolean;
  txHash?: string;
  message?: string;
  receipt?: { success: boolean; message?: unknown; txHash?: string };
  [key: string]: unknown;
}

export async function sendCall(
  intent: CallIntent,
  options?: { waitForTx?: boolean; timeoutMs?: number }
): Promise<SendCallResult> {
  return request<SendCallResult>("xian_sendCall", [
    {
      intent,
      waitForTx: options?.waitForTx ?? true,
      timeoutMs: options?.timeoutMs ?? 30_000
    }
  ]);
}

export function onAccountsChanged(cb: (accounts: string[]) => void): () => void {
  if (!isWalletAvailable()) return () => {};
  const p = provider();
  const handler = (a: unknown) => cb(a as string[]);
  p.on("accountsChanged", handler);
  return () => p.removeListener("accountsChanged", handler);
}

export function onChainChanged(cb: (chainId: string) => void): () => void {
  if (!isWalletAvailable()) return () => {};
  const p = provider();
  const handler = (id: unknown) => cb(id as string);
  p.on("chainChanged", handler);
  return () => p.removeListener("chainChanged", handler);
}
