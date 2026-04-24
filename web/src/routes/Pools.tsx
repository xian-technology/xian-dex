import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search, RefreshCw, ChevronDown, ChevronUp, Activity } from "lucide-react";
import { TokenIcon } from "../components/TokenIcon";
import { Sparkline } from "../components/Sparkline";
import { getLpBalance, getPair, listAllPairs, type PairInfo } from "../lib/dex";
import { getTokenInfo, type TokenInfo } from "../lib/tokens";
import { formatCompact, formatNumber } from "../lib/format";
import { useRpcEpoch } from "../hooks/useRpcEpoch";
import { useWallet } from "../hooks/useWallet";

const LIVE_POLL_MS = 12_000;
const LIVE_HISTORY_CAP = 60;

interface EnrichedPair {
  pair: PairInfo;
  token0: TokenInfo;
  token1: TokenInfo;
}

type SortKey = "id" | "tvl" | "name";

export default function Pools() {
  const wallet = useWallet();
  const [pairs, setPairs] = useState<EnrichedPair[]>([]);
  const [lpBalances, setLpBalances] = useState<Map<number, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("tvl");
  const [reloadKey, setReloadKey] = useState(0);
  const [myOnly, setMyOnly] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const rpcEpoch = useRpcEpoch();

  // Load pairs + token metadata
  useEffect(() => {
    let cancel = false;
    setLoading(true);
    (async () => {
      const all = await listAllPairs();
      const enriched = await Promise.all(
        all.map(async (pair) => {
          const [t0, t1] = await Promise.all([
            getTokenInfo(pair.token0).catch(() => null),
            getTokenInfo(pair.token1).catch(() => null)
          ]);
          if (!t0 || !t1) return null;
          return { pair, token0: t0, token1: t1 };
        })
      );
      if (cancel) return;
      setPairs(enriched.filter((x): x is EnrichedPair => x != null));
      setLoading(false);
    })();
    return () => {
      cancel = true;
    };
  }, [reloadKey, rpcEpoch]);

  // Load LP balances when wallet connects (only when needed)
  useEffect(() => {
    if (!wallet.account || pairs.length === 0) {
      setLpBalances(new Map());
      return;
    }
    let cancel = false;
    (async () => {
      const entries = await Promise.all(
        pairs.map(async ({ pair }) => {
          const bal = await getLpBalance(pair.id, wallet.account!).catch(() => 0);
          return [pair.id, bal] as const;
        })
      );
      if (cancel) return;
      setLpBalances(new Map(entries));
    })();
    return () => {
      cancel = true;
    };
  }, [pairs, wallet.account, reloadKey, rpcEpoch]);

  // Live-poll the expanded pair
  useEffect(() => {
    if (expandedId == null) {
      setHistory([]);
      return;
    }
    let cancel = false;
    setHistory([]);
    const sample = async () => {
      try {
        const p = await getPair(expandedId);
        if (cancel || !p) return;
        if (p.reserve0 <= 0 || p.reserve1 <= 0) return;
        setHistory((h) => {
          const next = [...h, p.reserve1 / p.reserve0];
          if (next.length > LIVE_HISTORY_CAP) next.shift();
          return next;
        });
      } catch {
        /* ignore */
      }
    };
    void sample();
    const handle = window.setInterval(sample, LIVE_POLL_MS);
    return () => {
      cancel = true;
      window.clearInterval(handle);
    };
  }, [expandedId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = pairs.slice();
    if (myOnly) {
      list = list.filter(({ pair }) => (lpBalances.get(pair.id) ?? 0) > 0);
    }
    if (q) {
      list = list.filter(({ token0, token1 }) =>
        [token0.symbol, token1.symbol, token0.name, token1.name, token0.contract, token1.contract]
          .some((v) => v.toLowerCase().includes(q))
      );
    }
    list.sort((a, b) => {
      switch (sortKey) {
        case "id":
          return a.pair.id - b.pair.id;
        case "name":
          return (a.token0.symbol + a.token1.symbol).localeCompare(
            b.token0.symbol + b.token1.symbol
          );
        case "tvl":
        default:
          return b.pair.reserve0 + b.pair.reserve1 - (a.pair.reserve0 + a.pair.reserve1);
      }
    });
    return list;
  }, [pairs, lpBalances, search, sortKey, myOnly]);

  return (
    <div className="page">
      <div className="page-header">
        <h2>Liquidity Pools</h2>
        <div className="page-actions">
          <Link to="/liquidity" className="btn btn-primary">
            + Add Liquidity
          </Link>
          <button className="icon-btn" onClick={() => setReloadKey((k) => k + 1)} title="Refresh">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      <div className="filter-bar">
        <div className="modal-search">
          <Search size={14} />
          <input
            placeholder="Search pools by symbol, name, or contract"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="sort-row">
          {wallet.account && (
            <button
              className={"chip " + (myOnly ? "chip-active" : "")}
              onClick={() => setMyOnly((v) => !v)}
              title="Only pools where you have an LP balance"
            >
              My positions
            </button>
          )}
          <span className="muted small">Sort:</span>
          {(["tvl", "name", "id"] as SortKey[]).map((k) => (
            <button
              key={k}
              className={"chip " + (sortKey === k ? "chip-active" : "")}
              onClick={() => setSortKey(k)}
            >
              {k === "tvl" ? "Liquidity" : k === "name" ? "Name" : "Newest"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="empty">Loading pools…</div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          {pairs.length === 0
            ? "No pools have been created yet. Be the first — add liquidity to create a pool."
            : myOnly
              ? "You have no LP positions in any pool."
              : "No pools match your search."}
        </div>
      ) : (
        <div className="pool-grid">
          {filtered.map(({ pair, token0, token1 }) => {
            const price0in1 = pair.reserve0 > 0 ? pair.reserve1 / pair.reserve0 : 0;
            const price1in0 = pair.reserve1 > 0 ? pair.reserve0 / pair.reserve1 : 0;
            const lp = lpBalances.get(pair.id) ?? 0;
            const isExpanded = expandedId === pair.id;
            return (
              <div
                key={pair.id}
                className={"pool-card" + (isExpanded ? " pool-card-expanded" : "")}
              >
                <Link to={`/pools/${pair.id}`} className="pool-card-link">
                  <div className="pool-card-top">
                    <div className="pool-pair-icons">
                      <TokenIcon token={token0} size={28} />
                      <TokenIcon token={token1} size={28} />
                    </div>
                    <div className="pool-pair-symbols">
                      <strong>{token0.symbol}</strong> / <strong>{token1.symbol}</strong>
                    </div>
                    {lp > 0 && (
                      <span className="badge badge-accent" title="You hold LP in this pool">
                        LP
                      </span>
                    )}
                    <span className="badge badge-muted">#{pair.id}</span>
                  </div>
                  <div className="pool-card-body">
                    <div className="pool-stat">
                      <span className="muted small">Reserves</span>
                      <span>
                        {formatCompact(pair.reserve0)} {token0.symbol}
                      </span>
                      <span>
                        {formatCompact(pair.reserve1)} {token1.symbol}
                      </span>
                    </div>
                    <div className="pool-stat">
                      <span className="muted small">Mid price</span>
                      <span className="mono small">
                        1 {token0.symbol} = {formatNumber(price0in1)} {token1.symbol}
                      </span>
                      <span className="mono small">
                        1 {token1.symbol} = {formatNumber(price1in0)} {token0.symbol}
                      </span>
                    </div>
                  </div>
                </Link>
                <button
                  className="pool-expand"
                  onClick={() => setExpandedId(isExpanded ? null : pair.id)}
                  title={isExpanded ? "Hide live chart" : "Show live chart"}
                >
                  <Activity size={12} />
                  {isExpanded ? "Hide live chart" : "Live chart"}
                  {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
                {isExpanded && (
                  <div className="pool-live">
                    <Sparkline values={history} height={70} />
                    <div className="muted small center">
                      polling every {Math.round(LIVE_POLL_MS / 1000)}s
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
