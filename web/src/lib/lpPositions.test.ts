import { beforeEach, describe, expect, it, vi } from "vitest";

const listAllPairs = vi.hoisted(() => vi.fn());
const getLpBalanceSnapshot = vi.hoisted(() => vi.fn());
const getTokenInfo = vi.hoisted(() => vi.fn());

vi.mock("./dex", () => ({ listAllPairs, getLpBalanceSnapshot }));
vi.mock("./tokens", () => ({ getTokenInfo }));

import { listOwnedLpPositions } from "./lpPositions";

const pair = (id: number, totalSupply = 100) => ({
  id,
  token0: `token_${id}_a`,
  token1: `token_${id}_b`,
  reserve0: 100,
  reserve1: 100,
  totalSupply,
  blockTimestampLast: null,
  creationTime: null
});

describe("listOwnedLpPositions", () => {
  beforeEach(() => {
    listAllPairs.mockReset();
    getLpBalanceSnapshot.mockReset();
    getTokenInfo.mockReset();

    getLpBalanceSnapshot.mockImplementation(async (id: number) => ({
      lpToken: `lp_${id}`,
      value: 0,
      input: "0"
    }));
    getTokenInfo.mockImplementation(async (contract: string) => ({
      contract,
      name: contract,
      symbol: contract.toUpperCase(),
      logoUrl: null,
      logoSvg: null,
      precision: 8
    }));
  });

  it("returns only positive LP balances and sorts positions by pool share", async () => {
    listAllPairs.mockResolvedValue([pair(1, 1_000), pair(2, 100), pair(3, 100)]);
    getLpBalanceSnapshot.mockImplementation(async (id: number) => {
      const value = id === 1 ? 100 : id === 2 ? 25 : 0;
      return { lpToken: `lp_${id}`, value, input: String(value) };
    });

    const positions = await listOwnedLpPositions("account");

    expect(positions.map((position) => position.pair.id)).toEqual([2, 1]);
    expect(positions.map((position) => position.lpToken)).toEqual(["lp_2", "lp_1"]);
    expect(positions.map((position) => position.balance)).toEqual([25, 100]);
  });

  it("isolates missing LP contracts and failed pair lookups", async () => {
    listAllPairs.mockResolvedValue([pair(1), pair(2), pair(3)]);
    getLpBalanceSnapshot.mockImplementation(async (id: number) => {
      if (id === 2) return { lpToken: null, value: 0, input: "0" };
      if (id === 3) throw new Error("RPC unavailable");
      return { lpToken: `lp_${id}`, value: 10, input: "10" };
    });

    const positions = await listOwnedLpPositions("account");

    expect(positions).toHaveLength(1);
    expect(positions[0]?.pair.id).toBe(1);
  });
});
