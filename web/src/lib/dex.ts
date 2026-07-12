import {
  DEFAULT_MAX_HOPS,
  deadlineFromNow,
  planXianDexV1ExactInSwap,
  planXianDexV1TokenApproval,
  selectBestXianDexV1ExactInRoute,
  type XianDexV1ExactInQuote,
  type XianDexV1Pair,
  type XianDexV1SwapPlanRequest,
  type XianDatetime
} from "@xian-tech/dex";
import { getClient } from "./xian";
import { sendCall } from "./wallet";
import {
  DEX_PAIRS,
  DEX_ROUTER,
  DEFAULT_FEE_BPS,
  ZERO_FEE_BPS
} from "./constants";
import { toNumber } from "./format";

export interface PairInfo extends XianDexV1Pair {
  totalSupply: number;
  blockTimestampLast: string | null;
  creationTime: string | null;
}

export async function getPairCount(): Promise<number> {
  const client = getClient();
  const v = await client.getState(DEX_PAIRS, "pairs_num");
  return toNumber(v);
}

export async function getPairId(tokenA: string, tokenB: string): Promise<number | null> {
  const [a, b] = tokenA < tokenB ? [tokenA, tokenB] : [tokenB, tokenA];
  const client = getClient();
  const v = await client.getState(DEX_PAIRS, "toks_to_pair", [a, b]);
  if (v == null) return null;
  const n = toNumber(v);
  return n > 0 ? n : null;
}

export async function getPair(id: number): Promise<PairInfo | null> {
  const client = getClient();
  const [token0, token1, reserve0, reserve1, totalSupply, blockTimestampLast, creationTime] =
    await Promise.all([
      client.getState(DEX_PAIRS, "pairs", [String(id), "token0"]),
      client.getState(DEX_PAIRS, "pairs", [String(id), "token1"]),
      client.getState(DEX_PAIRS, "pairs", [String(id), "reserve0"]),
      client.getState(DEX_PAIRS, "pairs", [String(id), "reserve1"]),
      client.getState(DEX_PAIRS, "pairs", [String(id), "totalSupply"]),
      client.getState(DEX_PAIRS, "pairs", [String(id), "blockTimestampLast"]),
      client.getState(DEX_PAIRS, "pairs", [String(id), "creationTime"])
    ]);
  if (token0 == null || token1 == null) return null;
  return {
    id,
    token0: String(token0),
    token1: String(token1),
    reserve0: toNumber(reserve0),
    reserve1: toNumber(reserve1),
    totalSupply: toNumber(totalSupply),
    blockTimestampLast: blockTimestampLast == null ? null : String(blockTimestampLast),
    creationTime: creationTime == null ? null : String(creationTime)
  };
}

export async function listAllPairs(): Promise<PairInfo[]> {
  const count = await getPairCount();
  if (count <= 0) return [];
  const ids = Array.from({ length: count }, (_, i) => i + 1);
  const results = await Promise.all(ids.map((id) => getPair(id).catch(() => null)));
  return results.filter((p): p is PairInfo => p != null);
}

// Each pair binds its own LP token contract (con_lp_token template). LP holder
// balances and approvals live in that token contract, NOT in con_pairs — the
// pair only records the token's name under pairs[id, "lpToken"].
export async function getLpTokenName(pairId: number): Promise<string | null> {
  const client = getClient();
  const v = await client.getState(DEX_PAIRS, "pairs", [String(pairId), "lpToken"]);
  if (v == null || v === 0) return null;
  return String(v);
}

export async function getLpBalance(pairId: number, address: string): Promise<number> {
  const lpToken = await getLpTokenName(pairId);
  if (!lpToken) return 0;
  const v = await getClient().getState(lpToken, "balances", [address]);
  return toNumber(v);
}

export async function getLpAllowance(
  pairId: number,
  owner: string,
  spender: string
): Promise<number> {
  const lpToken = await getLpTokenName(pairId);
  if (!lpToken) return 0;
  const v = await getClient().getState(lpToken, "approvals", [owner, spender]);
  return toNumber(v);
}

export async function getTradeFeeBps(account: string): Promise<number> {
  const client = getClient();
  try {
    const v = await client.call({
      sender: account,
      contract: DEX_ROUTER,
      function: "getTradeFeeBps",
      kwargs: { account }
    });
    const n = toNumber(v);
    return n === ZERO_FEE_BPS ? ZERO_FEE_BPS : DEFAULT_FEE_BPS;
  } catch {
    return DEFAULT_FEE_BPS;
  }
}

export async function isFeeOnTransfer(token: string): Promise<boolean> {
  const client = getClient();
  const v = await client.getState(DEX_ROUTER, "fee_on_transfer_tokens", [token]);
  return v === true;
}

// ── Quoting ────────────────────────────────────────────────────

export type QuoteResult = XianDexV1ExactInQuote;

export async function findDirectRoute(
  fromToken: string,
  toToken: string
): Promise<{ pairId: number; pair: PairInfo } | null> {
  const id = await getPairId(fromToken, toToken);
  if (!id) return null;
  const pair = await getPair(id);
  return pair ? { pairId: id, pair } : null;
}

// ── Pair index (for multi-hop routing) ─────────────────────────

let pairCache: { ts: number; pairs: PairInfo[] } | null = null;
const PAIR_CACHE_MS = 30_000;

export async function getPairsCached(force = false): Promise<PairInfo[]> {
  const now = Date.now();
  if (!force && pairCache && now - pairCache.ts < PAIR_CACHE_MS) {
    return pairCache.pairs;
  }
  const pairs = await listAllPairs();
  pairCache = { ts: now, pairs };
  return pairs;
}

export function invalidatePairCache(): void {
  pairCache = null;
}

export async function quoteSwap(
  fromToken: string,
  toToken: string,
  amountIn: number,
  feeBps: number
): Promise<QuoteResult | null> {
  if (amountIn <= 0) return null;
  const pairs = await getPairsCached();
  return selectBestXianDexV1ExactInRoute({
    pairs,
    fromToken,
    toToken,
    amountIn,
    feeBps,
    maxHops: DEFAULT_MAX_HOPS
  });
}

// ── Tx helpers ─────────────────────────────────────────────────

export { deadlineFromNow };
export type { XianDatetime };

export async function approveToken(
  token: string,
  spender: string,
  amount: number
): Promise<unknown> {
  return sendCall(planXianDexV1TokenApproval({ token, spender, amount }));
}

export interface ChiEstimate {
  estimated: number;
  suggested: number;
}

export async function estimateChiFor(
  sender: string,
  contract: string,
  fn: string,
  kwargs: Record<string, unknown>
): Promise<ChiEstimate | null> {
  try {
    const result = await getClient().estimateChi({
      sender,
      contract,
      function: fn,
      kwargs
    });
    return {
      estimated: result.estimated,
      suggested: Math.ceil(result.estimated * 1.1)
    };
  } catch {
    return null;
  }
}

export async function swap(args: XianDexV1SwapPlanRequest): Promise<unknown> {
  return sendCall(planXianDexV1ExactInSwap({ ...args, routerContract: DEX_ROUTER }).call);
}

export interface AddLiquidityArgs {
  tokenA: string;
  tokenB: string;
  amountADesired: number;
  amountBDesired: number;
  amountAMin: number;
  amountBMin: number;
  to: string;
  deadline: XianDatetime;
}

export async function addLiquidity(args: AddLiquidityArgs): Promise<unknown> {
  return sendCall({
    contract: DEX_ROUTER,
    function: "addLiquidity",
    kwargs: {
      tokenA: args.tokenA,
      tokenB: args.tokenB,
      amountADesired: args.amountADesired,
      amountBDesired: args.amountBDesired,
      amountAMin: args.amountAMin,
      amountBMin: args.amountBMin,
      to: args.to,
      deadline: args.deadline
    }
  });
}

export interface RemoveLiquidityArgs {
  tokenA: string;
  tokenB: string;
  liquidity: number;
  amountAMin: number;
  amountBMin: number;
  to: string;
  deadline: XianDatetime;
}

export async function removeLiquidity(args: RemoveLiquidityArgs): Promise<unknown> {
  return sendCall({
    contract: DEX_ROUTER,
    function: "removeLiquidity",
    kwargs: {
      tokenA: args.tokenA,
      tokenB: args.tokenB,
      liquidity: args.liquidity,
      amountAMin: args.amountAMin,
      amountBMin: args.amountBMin,
      to: args.to,
      deadline: args.deadline
    }
  });
}

export async function approveLp(
  pairId: number,
  spender: string,
  amount: number
): Promise<unknown> {
  const lpToken = await getLpTokenName(pairId);
  if (!lpToken) {
    throw new Error(`No LP token bound to pair ${pairId}`);
  }
  return sendCall(planXianDexV1TokenApproval({ token: lpToken, spender, amount }));
}
