import {
  getLpBalanceSnapshot,
  listAllPairs,
  type PairInfo
} from "./dex";
import { getTokenInfo, type TokenInfo } from "./tokens";

export interface OwnedLpPosition {
  pair: PairInfo;
  token0: TokenInfo;
  token1: TokenInfo;
  lpToken: string;
  balance: number;
  balanceInput: string;
  share: number;
}

/**
 * Resolve the account's positive LP balances into selectable pool positions.
 * Pair failures are isolated so one stale or unavailable pool does not hide
 * the account's other positions.
 */
export async function listOwnedLpPositions(account: string): Promise<OwnedLpPosition[]> {
  const pairs = await listAllPairs();
  const positions = await Promise.all(
    pairs.map(async (pair): Promise<OwnedLpPosition | null> => {
      try {
        const balance = await getLpBalanceSnapshot(pair.id, account);
        if (!balance.lpToken || !(balance.value > 0)) return null;

        const [token0, token1] = await Promise.all([
          getTokenInfo(pair.token0),
          getTokenInfo(pair.token1)
        ]);
        return {
          pair,
          token0,
          token1,
          lpToken: balance.lpToken,
          balance: balance.value,
          balanceInput: balance.input,
          share: pair.totalSupply > 0 ? balance.value / pair.totalSupply : 0
        };
      } catch {
        return null;
      }
    })
  );

  return positions
    .filter((position): position is OwnedLpPosition => position != null)
    .sort((a, b) => b.share - a.share || a.pair.id - b.pair.id);
}
