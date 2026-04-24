import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { TokenIcon } from "../components/TokenIcon";
import { Sparkline } from "../components/Sparkline";
import { getLpBalance, getPair, type PairInfo } from "../lib/dex";
import { getTokenInfo, type TokenInfo } from "../lib/tokens";
import { useWallet } from "../hooks/useWallet";
import { useRpcEpoch } from "../hooks/useRpcEpoch";
import { formatCompact, formatNumber, shortAddress, copyToClipboard } from "../lib/format";

const POLL_INTERVAL_MS = 12_000;
const HISTORY_CAP = 90;

export default function PairDetail() {
  const { id } = useParams<{ id: string }>();
  const wallet = useWallet();
  const rpcEpoch = useRpcEpoch();
  const pairId = Number(id);
  const [pair, setPair] = useState<PairInfo | null>(null);
  const [token0, setToken0] = useState<TokenInfo | null>(null);
  const [token1, setToken1] = useState<TokenInfo | null>(null);
  const [lp, setLp] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [inverted, setInverted] = useState(false);

  useEffect(() => {
    if (!Number.isFinite(pairId) || pairId <= 0) return;
    let cancel = false;
    setLoading(true);
    (async () => {
      const p = await getPair(pairId).catch(() => null);
      if (cancel) return;
      setPair(p);
      if (p) {
        const [t0, t1] = await Promise.all([
          getTokenInfo(p.token0),
          getTokenInfo(p.token1)
        ]);
        if (cancel) return;
        setToken0(t0);
        setToken1(t1);
        if (wallet.account) {
          const bal = await getLpBalance(pairId, wallet.account);
          if (cancel) return;
          setLp(bal);
        } else {
          setLp(0);
        }
      }
      setLoading(false);
    })();
    return () => {
      cancel = true;
    };
  }, [pairId, wallet.account, reloadKey, rpcEpoch]);

  // Poll reserves to build a price-history sparkline (in-memory only).
  useEffect(() => {
    if (!Number.isFinite(pairId) || pairId <= 0) return;
    let cancel = false;
    setHistory([]);
    const sample = async () => {
      try {
        const p = await getPair(pairId);
        if (cancel || !p) return;
        if (p.reserve0 <= 0 || p.reserve1 <= 0) return;
        const price = inverted
          ? p.reserve0 / p.reserve1
          : p.reserve1 / p.reserve0;
        setHistory((h) => {
          const next = [...h, price];
          if (next.length > HISTORY_CAP) next.shift();
          return next;
        });
      } catch {
        /* ignore polling errors */
      }
    };
    void sample();
    const handle = window.setInterval(sample, POLL_INTERVAL_MS);
    return () => {
      cancel = true;
      window.clearInterval(handle);
    };
  }, [pairId, inverted]);

  async function copy(text: string) {
    await copyToClipboard(text);
    setCopied(text);
    setTimeout(() => setCopied(null), 1200);
  }

  if (!Number.isFinite(pairId) || pairId <= 0) {
    return <div className="page"><div className="empty">Invalid pair id.</div></div>;
  }
  if (loading) return <div className="page"><div className="empty">Loading pair…</div></div>;
  if (!pair || !token0 || !token1) {
    return (
      <div className="page">
        <div className="empty">
          Pair not found.{" "}
          <Link to="/pools" className="link">
            Back to pools
          </Link>
        </div>
      </div>
    );
  }

  const price01 = pair.reserve0 > 0 ? pair.reserve1 / pair.reserve0 : 0;
  const price10 = pair.reserve1 > 0 ? pair.reserve0 / pair.reserve1 : 0;
  const share = pair.totalSupply > 0 ? (lp / pair.totalSupply) * 100 : 0;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <Link to="/pools" className="link small">
            <ArrowLeft size={12} /> All pools
          </Link>
          <h2 className="row gap-sm" style={{ marginTop: 6 }}>
            <span className="pool-pair-icons">
              <TokenIcon token={token0} size={28} />
              <TokenIcon token={token1} size={28} />
            </span>
            {token0.symbol} / {token1.symbol}
            <span className="badge badge-muted">#{pair.id}</span>
          </h2>
        </div>
        <div className="page-actions">
          <Link
            to={`/liquidity?pair=${pair.id}`}
            className="btn btn-primary"
          >
            Manage Liquidity
          </Link>
          <button className="icon-btn" onClick={() => setReloadKey((k) => k + 1)} title="Refresh">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>
            Price · 1 {inverted ? token1.symbol : token0.symbol} →{" "}
            {inverted ? token0.symbol : token1.symbol}
          </h3>
          <div className="card-actions">
            <button
              className="chip"
              onClick={() => {
                setInverted((v) => !v);
                setHistory([]);
              }}
            >
              Invert
            </button>
            <span className="muted small">samples every {Math.round(POLL_INTERVAL_MS / 1000)}s</span>
          </div>
        </div>
        <Sparkline values={history} height={120} />
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header"><h3>Reserves</h3></div>
          <div className="kv-list">
            <div className="kv">
              <span className="muted">{token0.symbol}</span>
              <strong>{formatNumber(pair.reserve0)}</strong>
            </div>
            <div className="kv">
              <span className="muted">{token1.symbol}</span>
              <strong>{formatNumber(pair.reserve1)}</strong>
            </div>
            <div className="kv">
              <span className="muted">Total LP supply</span>
              <strong>{formatCompact(pair.totalSupply)}</strong>
            </div>
            <div className="kv">
              <span className="muted">k = x · y</span>
              <strong>{formatCompact(pair.reserve0 * pair.reserve1)}</strong>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3>Price</h3></div>
          <div className="kv-list">
            <div className="kv">
              <span className="muted">1 {token0.symbol}</span>
              <strong>{formatNumber(price01)} {token1.symbol}</strong>
            </div>
            <div className="kv">
              <span className="muted">1 {token1.symbol}</span>
              <strong>{formatNumber(price10)} {token0.symbol}</strong>
            </div>
            <div className="kv">
              <span className="muted">Last sync</span>
              <span className="small mono">{pair.blockTimestampLast ?? "—"}</span>
            </div>
            <div className="kv">
              <span className="muted">Created</span>
              <span className="small mono">{pair.creationTime ?? "—"}</span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3>Your position</h3></div>
          {wallet.account ? (
            lp > 0 ? (
              <div className="kv-list">
                <div className="kv">
                  <span className="muted">LP balance</span>
                  <strong>{formatNumber(lp)}</strong>
                </div>
                <div className="kv">
                  <span className="muted">Pool share</span>
                  <strong>{share.toFixed(share < 0.01 ? 4 : 2)}%</strong>
                </div>
                <div className="kv">
                  <span className="muted">{token0.symbol} equivalent</span>
                  <strong>
                    {formatNumber(pair.totalSupply > 0 ? (lp / pair.totalSupply) * pair.reserve0 : 0)}
                  </strong>
                </div>
                <div className="kv">
                  <span className="muted">{token1.symbol} equivalent</span>
                  <strong>
                    {formatNumber(pair.totalSupply > 0 ? (lp / pair.totalSupply) * pair.reserve1 : 0)}
                  </strong>
                </div>
                <Link
                  to={`/liquidity?pair=${pair.id}&mode=remove`}
                  className="btn btn-ghost btn-block"
                  style={{ marginTop: 12 }}
                >
                  Remove liquidity
                </Link>
              </div>
            ) : (
              <div className="muted">
                You have no LP in this pool.{" "}
                <Link to={`/liquidity?pair=${pair.id}`} className="link">
                  Add some
                </Link>
                .
              </div>
            )
          ) : (
            <div className="muted">Connect wallet to see your position.</div>
          )}
        </div>

        <div className="card">
          <div className="card-header"><h3>Tokens</h3></div>
          {[token0, token1].map((t) => (
            <div key={t.contract} className="token-row" onClick={() => copy(t.contract)}>
              <TokenIcon token={t} size={32} />
              <div className="token-row-text">
                <div className="token-row-top">
                  <span className="token-symbol">{t.symbol}</span>
                  <span className="token-name">{t.name}</span>
                </div>
                <div className="token-contract mono">
                  {copied === t.contract ? "Copied!" : shortAddress(t.contract, 12)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
