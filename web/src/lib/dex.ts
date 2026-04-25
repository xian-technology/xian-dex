import { getClient } from "./xian";
import { sendCall } from "./wallet";
import {
  DEX_PAIRS,
  DEX_ROUTER,
  DEFAULT_FEE_BPS,
  MAX_HOPS,
  ZERO_FEE_BPS
} from "./constants";
import { toNumber } from "./format";

export interface PairInfo {
  id: number;
  token0: string;
  token1: string;
  reserve0: number;
  reserve1: number;
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

export async function getLpBalance(pairId: number, address: string): Promise<number> {
  const client = getClient();
  const v = await client.getState(DEX_PAIRS, "pairs", [String(pairId), "balances", address]);
  return toNumber(v);
}

export async function getLpAllowance(
  pairId: number,
  owner: string,
  spender: string
): Promise<number> {
  const client = getClient();
  const v = await client.getState(DEX_PAIRS, "pairs", [
    String(pairId),
    "balances",
    owner,
    spender
  ]);
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

export interface QuoteHop {
  pairId: number;
  fromToken: string;
  toToken: string;
  reserveIn: number;
  reserveOut: number;
  amountIn: number;
  amountOut: number;
}

export interface QuoteResult {
  amountIn: number;
  amountOut: number;
  hops: QuoteHop[];
  path: number[];
  feeBps: number;
  priceImpact: number; // fraction (0..1)
  midPriceOut: number; // amountOut / amountIn at zero-impact
}

function amountOut(amountIn: number, reserveIn: number, reserveOut: number, feeBps: number): number {
  if (amountIn <= 0 || reserveIn <= 0 || reserveOut <= 0) return 0;
  const inWithFee = amountIn * ((10000 - feeBps) / 10000);
  return (inWithFee * reserveOut) / (reserveIn + inWithFee);
}

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

interface AdjEdge {
  pairId: number;
  other: string;
  reserveSelf: number;
  reserveOther: number;
}

function buildAdjacency(pairs: PairInfo[]): Map<string, AdjEdge[]> {
  const adj = new Map<string, AdjEdge[]>();
  const push = (token: string, edge: AdjEdge) => {
    const list = adj.get(token);
    if (list) list.push(edge);
    else adj.set(token, [edge]);
  };
  for (const p of pairs) {
    if (p.reserve0 <= 0 || p.reserve1 <= 0) continue;
    push(p.token0, {
      pairId: p.id,
      other: p.token1,
      reserveSelf: p.reserve0,
      reserveOther: p.reserve1
    });
    push(p.token1, {
      pairId: p.id,
      other: p.token0,
      reserveSelf: p.reserve1,
      reserveOther: p.reserve0
    });
  }
  return adj;
}

interface CandidatePath {
  pairIds: number[];
  tokens: string[]; // length == pairIds.length + 1
  edges: AdjEdge[]; // length == pairIds.length
}

function enumeratePaths(
  adj: Map<string, AdjEdge[]>,
  from: string,
  to: string,
  maxHops: number
): CandidatePath[] {
  const out: CandidatePath[] = [];
  const visited = new Set<string>([from]);
  const usedPairs = new Set<number>();

  function dfs(current: string, path: CandidatePath) {
    if (path.pairIds.length > 0 && current === to) {
      out.push({
        pairIds: [...path.pairIds],
        tokens: [...path.tokens],
        edges: [...path.edges]
      });
      return;
    }
    if (path.pairIds.length >= maxHops) return;
    const edges = adj.get(current);
    if (!edges) return;
    for (const edge of edges) {
      if (usedPairs.has(edge.pairId)) continue;
      if (visited.has(edge.other) && edge.other !== to) continue;
      usedPairs.add(edge.pairId);
      visited.add(edge.other);
      path.pairIds.push(edge.pairId);
      path.tokens.push(edge.other);
      path.edges.push(edge);
      dfs(edge.other, path);
      path.pairIds.pop();
      path.tokens.pop();
      path.edges.pop();
      usedPairs.delete(edge.pairId);
      if (edge.other !== to) visited.delete(edge.other);
    }
  }

  dfs(from, { pairIds: [], tokens: [from], edges: [] });
  return out;
}

function quotePath(
  candidate: CandidatePath,
  amountIn: number,
  feeBps: number
): { amountOut: number; hops: QuoteHop[]; midPrice: number } {
  let current = amountIn;
  let mid = 1;
  const hops: QuoteHop[] = [];
  for (let i = 0; i < candidate.edges.length; i++) {
    const edge = candidate.edges[i];
    const fromToken = candidate.tokens[i];
    const toToken = candidate.tokens[i + 1];
    const out = amountOut(current, edge.reserveSelf, edge.reserveOther, feeBps);
    if (out <= 0) {
      return { amountOut: 0, hops: [], midPrice: 0 };
    }
    hops.push({
      pairId: edge.pairId,
      fromToken,
      toToken,
      reserveIn: edge.reserveSelf,
      reserveOut: edge.reserveOther,
      amountIn: current,
      amountOut: out
    });
    mid *= edge.reserveOther / edge.reserveSelf;
    current = out;
  }
  return { amountOut: current, hops, midPrice: mid };
}

export async function quoteSwap(
  fromToken: string,
  toToken: string,
  amountIn: number,
  feeBps: number
): Promise<QuoteResult | null> {
  if (amountIn <= 0) return null;
  const pairs = await getPairsCached();
  const adj = buildAdjacency(pairs);
  const paths = enumeratePaths(adj, fromToken, toToken, MAX_HOPS);
  if (paths.length === 0) return null;
  let best: { result: QuoteResult } | null = null;
  for (const candidate of paths) {
    const { amountOut: out, hops, midPrice } = quotePath(candidate, amountIn, feeBps);
    if (out <= 0) continue;
    const executionPrice = amountIn > 0 ? out / amountIn : 0;
    const priceImpact = midPrice > 0 ? Math.max(0, 1 - executionPrice / midPrice) : 0;
    const result: QuoteResult = {
      amountIn,
      amountOut: out,
      hops,
      path: candidate.pairIds,
      feeBps,
      priceImpact,
      midPriceOut: midPrice
    };
    if (!best || result.amountOut > best.result.amountOut) {
      best = { result };
    }
  }
  return best?.result ?? null;
}

// ── Tx helpers ─────────────────────────────────────────────────

// The Xian runtime decodes datetime values from {"__time__": [y, m, d, h, m, s, μs]}.
export interface XianDatetime {
  __time__: [number, number, number, number, number, number, number];
}

export function deadlineFromNow(minutesFromNow: number): XianDatetime {
  const d = new Date(Date.now() + minutesFromNow * 60_000);
  return {
    __time__: [
      d.getUTCFullYear(),
      d.getUTCMonth() + 1,
      d.getUTCDate(),
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
      d.getUTCMilliseconds() * 1000
    ]
  };
}

export async function approveToken(
  token: string,
  spender: string,
  amount: number
): Promise<unknown> {
  return sendCall({
    contract: token,
    function: "approve",
    kwargs: { amount, to: spender }
  });
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
    return { estimated: result.estimated, suggested: result.suggested };
  } catch {
    return null;
  }
}

export interface SwapArgs {
  amountIn: number;
  amountOutMin: number;
  path: number[];
  src: string;
  to: string;
  deadline: XianDatetime;
  feeOnTransfer: boolean;
}

export async function swap(args: SwapArgs): Promise<unknown> {
  const fn = args.feeOnTransfer
    ? "swapExactTokensForTokensSupportingFeeOnTransferTokens"
    : "swapExactTokensForTokens";
  return sendCall({
    contract: DEX_ROUTER,
    function: fn,
    kwargs: {
      amountIn: args.amountIn,
      amountOutMin: args.amountOutMin,
      path: args.path,
      src: args.src,
      to: args.to,
      deadline: args.deadline
    }
  });
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
  return sendCall({
    contract: DEX_PAIRS,
    function: "liqApprove",
    kwargs: { pair: pairId, amount, to: spender }
  });
}
