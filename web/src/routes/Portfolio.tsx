import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, Wallet } from "lucide-react";
import { TokenIcon } from "../components/TokenIcon";
import { useWallet } from "../hooks/useWallet";
import { useRpcEpoch } from "../hooks/useRpcEpoch";
import { getClient } from "../lib/xian";
import { listAllPairs, getLpBalance, type PairInfo } from "../lib/dex";
import { getTokenInfo, type TokenInfo, rememberToken } from "../lib/tokens";
import { formatCompact, formatNumber, shortAddress, copyToClipboard } from "../lib/format";

interface TokenRow {
  info: TokenInfo;
  balance: number;
}

interface PositionRow {
  pair: PairInfo;
  token0: TokenInfo;
  token1: TokenInfo;
  lp: number;
  share: number;
  amount0: number;
  amount1: number;
}

export default function Portfolio() {
  const wallet = useWallet();
  const rpcEpoch = useRpcEpoch();
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [positions, setPositions] = useState<PositionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!wallet.account) return;
    let cancel = false;
    setLoading(true);
    (async () => {
      const client = getClient();
      try {
        const balances = await client.getTokenBalances(wallet.account!, {
          limit: 200,
          includeZero: false
        });
        if (cancel) return;
        const rows: TokenRow[] = balances.items
          .filter((b) => b.balance != null && Number(b.balance) > 0)
          .map((b) => {
            rememberToken(b.contract);
            return {
              info: {
                contract: b.contract,
                name: b.name ?? b.contract,
                symbol: b.symbol ?? b.contract.replace(/^con_/, "").toUpperCase().slice(0, 8),
                logoUrl: b.logoUrl,
                logoSvg: null,
                precision: null
              },
              balance: Number(b.balance ?? 0)
            } as TokenRow;
          });
        rows.sort((a, b) => b.balance - a.balance);
        setTokens(rows);
      } catch {
        setTokens([]);
      }

      try {
        const pairs = await listAllPairs();
        const positionRows: PositionRow[] = [];
        for (const pair of pairs) {
          const lp = await getLpBalance(pair.id, wallet.account!);
          if (lp <= 0) continue;
          const [t0, t1] = await Promise.all([
            getTokenInfo(pair.token0),
            getTokenInfo(pair.token1)
          ]);
          const share = pair.totalSupply > 0 ? lp / pair.totalSupply : 0;
          positionRows.push({
            pair,
            token0: t0,
            token1: t1,
            lp,
            share,
            amount0: share * pair.reserve0,
            amount1: share * pair.reserve1
          });
        }
        if (cancel) return;
        positionRows.sort((a, b) => b.share - a.share);
        setPositions(positionRows);
      } catch {
        setPositions([]);
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [wallet.account, reload, rpcEpoch]);

  if (!wallet.account) {
    return (
      <div className="page">
        <div className="empty">
          <Wallet size={28} className="muted" />
          <div style={{ marginTop: 10 }}>Connect a wallet to view your portfolio.</div>
          {wallet.available && (
            <button
              className="btn btn-primary"
              onClick={() => wallet.connect()}
              style={{ marginTop: 14 }}
            >
              Connect Wallet
            </button>
          )}
        </div>
      </div>
    );
  }

  async function handleAddrCopy() {
    if (!wallet.account) return;
    await copyToClipboard(wallet.account);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>Portfolio</h2>
          <button className="link mono small" onClick={handleAddrCopy}>
            {copied ? "Copied!" : shortAddress(wallet.account, 12)}
          </button>
        </div>
        <div className="page-actions">
          <button className="icon-btn" onClick={() => setReload((k) => k + 1)} title="Refresh">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <h3>Token balances</h3>
            {tokens.length > 0 && <span className="muted small">{tokens.length} tokens</span>}
          </div>
          {loading && tokens.length === 0 ? (
            <div className="muted center pad">Loading…</div>
          ) : tokens.length === 0 ? (
            <div className="muted center pad">No tokens with a positive balance.</div>
          ) : (
            <div className="token-list">
              {tokens.map((t) => (
                <div key={t.info.contract} className="token-row static">
                  <TokenIcon token={t.info} size={32} />
                  <div className="token-row-text">
                    <div className="token-row-top">
                      <span className="token-symbol">{t.info.symbol}</span>
                      <span className="token-name">{t.info.name}</span>
                    </div>
                    <div className="token-contract mono">{t.info.contract}</div>
                  </div>
                  <div className="token-balance">
                    <div>{formatCompact(t.balance)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <h3>Liquidity positions</h3>
            <Link to="/liquidity" className="link small">+ Add liquidity</Link>
          </div>
          {loading && positions.length === 0 ? (
            <div className="muted center pad">Loading…</div>
          ) : positions.length === 0 ? (
            <div className="muted center pad">
              No LP positions.{" "}
              <Link to="/liquidity" className="link">
                Provide liquidity
              </Link>
              .
            </div>
          ) : (
            <div className="position-list">
              {positions.map((p) => (
                <Link
                  to={`/pools/${p.pair.id}`}
                  key={p.pair.id}
                  className="position-row"
                >
                  <div className="position-pair">
                    <span className="pool-pair-icons">
                      <TokenIcon token={p.token0} size={24} />
                      <TokenIcon token={p.token1} size={24} />
                    </span>
                    <strong>
                      {p.token0.symbol} / {p.token1.symbol}
                    </strong>
                    <span className="badge badge-muted">#{p.pair.id}</span>
                  </div>
                  <div className="position-amounts">
                    <div>
                      {formatNumber(p.amount0)} {p.token0.symbol}
                    </div>
                    <div>
                      {formatNumber(p.amount1)} {p.token1.symbol}
                    </div>
                  </div>
                  <div className="position-share muted small">
                    {(p.share * 100).toFixed(p.share < 0.0001 ? 6 : 2)}% of pool
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
