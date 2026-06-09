export const DEX_ROUTER = "con_dex";
export const DEX_PAIRS = "con_pairs";
export const DEFAULT_RPC = "http://127.0.0.1:26657";

export const DEFAULT_FEE_BPS = 30;
export const ZERO_FEE_BPS = 0;
export const MAX_HOPS = 3;

export const STORAGE_KEYS = {
  rpc: "snakx.rpcUrl",
  slippage: "snakx.slippageBps",
  deadlineMin: "snakx.deadlineMin",
  infiniteApproval: "snakx.infiniteApproval",
  recentTokens: "snakx.recentTokens",
  customTokens: "snakx.customTokens",
  recentTxs: "snakx.recentTxs"
} as const;

export const NATIVE_TOKEN = "currency";

// Mirrors con_pairs.MAXIMUM_BALANCE; using this as an "approve once" amount
// covers any plausible trade size while staying inside the contract's bounds.
export const INFINITE_APPROVAL_AMOUNT = 1e14;
