/**
 * Curated registry of known Xian tokens.
 *
 * Add entries here for tokens that should always appear in the token
 * picker without the user having to paste the contract name. Anything
 * the user imports manually is persisted alongside this list via
 * `STORAGE_KEYS.customTokens`.
 *
 * Keep entries minimal — name/symbol/logo come from the chain when the
 * picker first opens, this list just bootstraps the contract list.
 */

export interface RegistryEntry {
  contract: string;
  /** Optional override; leave undefined to read from chain metadata. */
  symbol?: string;
  /** Optional override; leave undefined to read from chain metadata. */
  name?: string;
  /** Optional logo override; otherwise the chain metadata logo (if any) is used. */
  logoUrl?: string;
}

export const TOKEN_REGISTRY: RegistryEntry[] = [
  {
    contract: "currency",
    symbol: "XIAN",
    name: "Xian"
  }
  // Add more known Xian tokens here, e.g.:
  // { contract: "con_usdc_lst001", symbol: "USDC", name: "USD Coin" },
];

export function registryContracts(): string[] {
  return TOKEN_REGISTRY.map((e) => e.contract);
}

export function registryOverride(contract: string): RegistryEntry | undefined {
  return TOKEN_REGISTRY.find((e) => e.contract === contract);
}
