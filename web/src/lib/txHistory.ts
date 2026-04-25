import { STORAGE_KEYS } from "./constants";
import { getClient } from "./xian";

const RECONCILE_STALE_MS = 10 * 60 * 1000;

export type TxStatus = "pending" | "success" | "failed";

export interface TxRecord {
  id: string;
  timestamp: number;
  label: string;
  contract: string;
  function: string;
  status: TxStatus;
  txHash?: string;
  message?: string;
}

const MAX_RECORDS = 50;

const subscribers = new Set<() => void>();

function emit() {
  for (const fn of subscribers) {
    try {
      fn();
    } catch {
      /* noop */
    }
  }
}

export function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

function read(): TxRecord[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.recentTxs);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(records: TxRecord[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEYS.recentTxs, JSON.stringify(records.slice(0, MAX_RECORDS)));
  emit();
}

export function listTxs(): TxRecord[] {
  return read();
}

export function addTx(record: Omit<TxRecord, "id" | "timestamp">): TxRecord {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const full: TxRecord = { ...record, id, timestamp: Date.now() };
  write([full, ...read()]);
  return full;
}

export function updateTx(id: string, patch: Partial<Omit<TxRecord, "id" | "timestamp">>): void {
  const all = read();
  const idx = all.findIndex((r) => r.id === id);
  if (idx === -1) return;
  all[idx] = { ...all[idx], ...patch };
  write(all);
}

export function clearTxs(): void {
  write([]);
}

export interface SendResultLike {
  txHash?: string;
  accepted?: boolean | null;
  finalized?: boolean;
  message?: string;
}

/**
 * Reconcile any records left in "pending" state (e.g. user closed the tab
 * while a tx was in-flight). For each, look up the tx by hash; if it's old
 * enough and still missing, mark it failed so it doesn't sit forever.
 */
export async function reconcilePendingTxs(): Promise<void> {
  const pending = read().filter((r) => r.status === "pending");
  if (pending.length === 0) return;
  const client = getClient();
  const now = Date.now();
  await Promise.all(
    pending.map(async (record) => {
      // No hash means the wallet never even returned a submission ack.
      if (!record.txHash) {
        if (now - record.timestamp > RECONCILE_STALE_MS) {
          updateTx(record.id, { status: "failed", message: "No tx hash recorded" });
        }
        return;
      }
      try {
        const receipt = await client.getTx(record.txHash);
        if (receipt.success) {
          updateTx(record.id, { status: "success" });
        } else if (receipt.txHash) {
          updateTx(record.id, {
            status: "failed",
            message:
              typeof receipt.message === "string"
                ? receipt.message
                : "Transaction failed"
          });
        } else if (now - record.timestamp > RECONCILE_STALE_MS) {
          updateTx(record.id, { status: "failed", message: "Transaction not found on chain" });
        }
      } catch {
        if (now - record.timestamp > RECONCILE_STALE_MS) {
          updateTx(record.id, { status: "failed", message: "Could not reach RPC to confirm" });
        }
      }
    })
  );
}

/**
 * Wrap a sendCall-like promise: append a tx record while pending, then
 * patch it with the final status. Returns the original result.
 */
export async function track<T extends SendResultLike>(
  meta: { label: string; contract: string; function: string },
  call: () => Promise<T>
): Promise<T> {
  const record = addTx({
    ...meta,
    status: "pending"
  });
  try {
    const result = await call();
    const accepted = result?.accepted;
    const finalized = result?.finalized;
    const status: TxStatus =
      accepted === false ? "failed" : finalized ? "success" : "pending";
    updateTx(record.id, {
      status,
      txHash: result?.txHash,
      message: result?.message
    });
    return result;
  } catch (e) {
    updateTx(record.id, {
      status: "failed",
      message: e instanceof Error ? e.message : String(e)
    });
    throw e;
  }
}
