import { getClient } from "./xian";
import { chainAmount } from "./amounts";
import { STORAGE_KEYS } from "./constants";
import { isValidContractName } from "./format";
import { registryContracts, registryOverride } from "./tokenRegistry";

export interface TokenInfo {
  contract: string;
  name: string;
  symbol: string;
  logoUrl: string | null;
  logoSvg: string | null;
  precision: number | null;
}

const memoryCache = new Map<string, Promise<TokenInfo>>();
const RECENT_LIMIT = 8;

function readArray(key: string): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function writeArray(key: string, list: string[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(key, JSON.stringify(list));
}

function readCustom(): string[] {
  return readArray(STORAGE_KEYS.customTokens);
}

function writeCustom(list: string[]): void {
  writeArray(STORAGE_KEYS.customTokens, list);
}

function readRecent(): string[] {
  return readArray(STORAGE_KEYS.recentTokens);
}

function writeRecent(list: string[]): void {
  writeArray(STORAGE_KEYS.recentTokens, list);
}

/**
 * Return a deduped list of token contracts the picker should know about,
 * with recents first, then registry, then custom imports.
 */
export function listKnownContracts(): string[] {
  const recent = readRecent();
  const registry = registryContracts();
  const custom = readCustom();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of [...recent, ...registry, ...custom]) {
    if (seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

/** Save a token contract as imported (persists across sessions). */
export function rememberToken(contract: string): void {
  if (!isValidContractName(contract)) return;
  if (registryContracts().includes(contract)) return;
  const custom = readCustom();
  if (custom.includes(contract)) return;
  custom.push(contract);
  writeCustom(custom);
}

/** Mark a token as recently used so the picker prioritises it. */
export function markRecent(contract: string): void {
  if (!isValidContractName(contract)) return;
  const recent = readRecent().filter((c) => c !== contract);
  recent.unshift(contract);
  writeRecent(recent.slice(0, RECENT_LIMIT));
}

export function forgetToken(contract: string): void {
  writeCustom(readCustom().filter((c) => c !== contract));
  writeRecent(readRecent().filter((c) => c !== contract));
  memoryCache.delete(contract);
}

export async function getTokenInfo(contract: string): Promise<TokenInfo> {
  const cached = memoryCache.get(contract);
  if (cached) return cached;
  const pending = readTokenInfo(contract);
  memoryCache.set(contract, pending);
  try {
    return await pending;
  } catch (error) {
    if (memoryCache.get(contract) === pending) memoryCache.delete(contract);
    throw error;
  }
}

async function readTokenInfo(contract: string): Promise<TokenInfo> {
  const override = registryOverride(contract);
  const client = getClient();
  const meta = await client.getTokenMetadata(contract).catch(() => null);
  // The router reads get_metadata(), which can compute precision dynamically.
  const methods = await client.getContractMethods(contract);
  const metadata = methods.some((method) => method.name === "get_metadata")
    ? await client.call({ sender: "0".repeat(64), contract, function: "get_metadata", kwargs: {} })
    : null;
  const precisionRaw = metadata && typeof metadata === "object" && "precision" in metadata
    ? metadata.precision : null;
  const integerPrecision = typeof precisionRaw === "bigint" || Number.isSafeInteger(precisionRaw);
  const precision = integerPrecision && Number(precisionRaw) >= 0
    ? Math.min(30, Number(precisionRaw)) : null;
  return {
    contract,
    name: override?.name ?? (meta?.name ?? contract),
    symbol:
      override?.symbol ??
      (meta?.symbol ?? contract.replace(/^con_/, "").toUpperCase().slice(0, 8)),
    logoUrl: override?.logoUrl ?? meta?.logoUrl ?? null,
    logoSvg: meta?.logoSvg ?? null,
    precision
  };
}

export async function getBalance(contract: string, address: string): Promise<string> {
  const client = getClient();
  try {
    const value = await client.getBalance(address, { contract });
    return chainAmount(value);
  } catch {
    return "0";
  }
}

export async function getAllowance(
  contract: string,
  owner: string,
  spender: string
): Promise<string> {
  const client = getClient();
  try {
    const value = await client.getState(contract, "approvals", [owner, spender]);
    return chainAmount(value);
  } catch {
    return "0";
  }
}

export function clearTokenCache(): void {
  memoryCache.clear();
}
