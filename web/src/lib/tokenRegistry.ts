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
  },
  ...Array.from(new Set<string>(
    (import.meta.env.VITE_XIAN_TOKEN_CONTRACTS ?? "")
      .split(",")
      .map((contract: string) => contract.trim())
  ))
    .filter((contract) => contract !== "currency" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(contract))
    .map((contract) => ({ contract }))
];

export function registryContracts(): string[] {
  return TOKEN_REGISTRY.map((e) => e.contract);
}

export function registryOverride(contract: string): RegistryEntry | undefined {
  return TOKEN_REGISTRY.find((e) => e.contract === contract);
}
