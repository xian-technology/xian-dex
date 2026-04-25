import { XianClient } from "@xian-tech/client";
import { DEFAULT_RPC, STORAGE_KEYS } from "./constants";

let cached: { url: string; client: XianClient } | null = null;
let epoch = 0;
const epochSubs = new Set<(epoch: number) => void>();

export function getRpcUrl(): string {
  if (typeof localStorage === "undefined") return DEFAULT_RPC;
  return localStorage.getItem(STORAGE_KEYS.rpc) ?? DEFAULT_RPC;
}

export function setRpcUrl(url: string): void {
  const cleaned = url.trim().replace(/\/+$/, "");
  if (cleaned === getRpcUrl()) return;
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEYS.rpc, cleaned);
  }
  cached = null;
  // Invalidate any module-level caches built against the previous RPC.
  // (Both modules expose top-level cache state we shouldn't reach into here,
  // so callers / consumers reset themselves via the RPC epoch hook.)
  epoch += 1;
  for (const cb of epochSubs) {
    try {
      cb(epoch);
    } catch {
      /* noop */
    }
  }
}

export function getRpcEpoch(): number {
  return epoch;
}

export function subscribeRpcEpoch(cb: (epoch: number) => void): () => void {
  epochSubs.add(cb);
  return () => epochSubs.delete(cb);
}

export function getClient(): XianClient {
  const url = getRpcUrl();
  if (!cached || cached.url !== url) {
    cached = { url, client: new XianClient({ rpcUrl: url }) };
  }
  return cached.client;
}

export async function pingRpc(url: string, timeoutMs = 4000): Promise<boolean> {
  try {
    const cleaned = url.trim().replace(/\/+$/, "");
    const resp = await fetch(`${cleaned}/status`, {
      signal: AbortSignal.timeout(timeoutMs)
    });
    return resp.ok;
  } catch {
    return false;
  }
}
