import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowDownUp, ChevronDown, RefreshCw, Settings as SettingsIcon, Info, Share2 } from "lucide-react";
import { TokenIcon } from "../components/TokenIcon";
import { TokenSelectorModal } from "../components/TokenSelectorModal";
import { SettingsModal } from "../components/SettingsModal";
import { SwapReviewModal } from "../components/SwapReviewModal";
import { useWallet } from "../hooks/useWallet";
import { useSettings } from "../hooks/useSettings";
import { useToasts } from "../hooks/useToasts";
import { useRpcEpoch } from "../hooks/useRpcEpoch";
import {
  approveToken,
  deadlineFromNow,
  getTradeFeeBps,
  invalidatePairCache,
  isFeeOnTransfer,
  quoteSwap,
  swap,
  type QuoteResult
} from "../lib/dex";
import { getTokenInfo, getAllowance, getBalance, type TokenInfo } from "../lib/tokens";
import { DEX_ROUTER, INFINITE_APPROVAL_AMOUNT, NATIVE_TOKEN } from "../lib/constants";
import { bpsToPercent, copyToClipboard, formatNumber, formatPercent, isValidContractName } from "../lib/format";
import { track } from "../lib/txHistory";

interface PanelProps {
  label: string;
  token: TokenInfo | null;
  amount: string;
  onAmount?(v: string): void;
  onPickToken(): void;
  balance?: number;
  readOnly?: boolean;
  account: string | null;
}

function Panel({ label, token, amount, onAmount, onPickToken, balance, readOnly, account }: PanelProps) {
  return (
    <div className="swap-panel">
      <div className="swap-panel-top">
        <span className="muted small">{label}</span>
        {account && balance != null && token && (
          <span className="muted small">
            Balance: <strong>{formatNumber(balance)}</strong>{" "}
            {!readOnly && balance > 0 && (
              <button className="link" onClick={() => onAmount?.(String(balance))}>
                Max
              </button>
            )}
          </span>
        )}
      </div>
      <div className="swap-panel-body">
        <input
          className="swap-amount"
          type="text"
          inputMode="decimal"
          placeholder="0.0"
          value={amount}
          readOnly={readOnly}
          onChange={(e) => onAmount?.(e.target.value.replace(/[^\d.]/g, ""))}
        />
        <button className="token-pick" onClick={onPickToken}>
          {token ? (
            <>
              <TokenIcon token={token} size={24} />
              <span>{token.symbol}</span>
            </>
          ) : (
            <span>Select</span>
          )}
          <ChevronDown size={14} />
        </button>
      </div>
    </div>
  );
}

export default function Swap() {
  const wallet = useWallet();
  const settings = useSettings();
  const toasts = useToasts();
  const rpcEpoch = useRpcEpoch();
  const [searchParams, setSearchParams] = useSearchParams();
  const [shared, setShared] = useState(false);

  const [fromToken, setFromToken] = useState<TokenInfo | null>(null);
  const [toToken, setToToken] = useState<TokenInfo | null>(null);
  const [amountIn, setAmountIn] = useState("");
  const [pickFrom, setPickFrom] = useState(false);
  const [pickTo, setPickTo] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [feeBps, setFeeBps] = useState(30);
  const [feeOnTransferIn, setFeeOnTransferIn] = useState(false);
  const [hopFotFlags, setHopFotFlags] = useState<Map<string, boolean>>(new Map());
  const [hopTokens, setHopTokens] = useState<Map<string, TokenInfo>>(new Map());
  const [allowance, setAllowance] = useState<number>(0);
  const [balanceFrom, setBalanceFrom] = useState<number>(0);
  const [balanceTo, setBalanceTo] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);

  // seed tokens from URL params (?from=&to=&amount=) or fall back to native
  useEffect(() => {
    let cancel = false;
    (async () => {
      const from = searchParams.get("from");
      const to = searchParams.get("to");
      const amt = searchParams.get("amount");
      const seed = from && isValidContractName(from) ? from : NATIVE_TOKEN;
      const xian = await getTokenInfo(seed).catch(() => null);
      if (cancel) return;
      if (!fromToken && xian) setFromToken(xian);
      if (to && isValidContractName(to) && from !== to) {
        const target = await getTokenInfo(to).catch(() => null);
        if (cancel) return;
        if (target && !toToken) setToToken(target);
      }
      if (amt && /^\d*\.?\d+$/.test(amt) && !amountIn) {
        setAmountIn(amt);
      }
    })();
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // refresh fee tier when account changes
  useEffect(() => {
    if (!wallet.account) {
      setFeeBps(30);
      return;
    }
    let cancel = false;
    (async () => {
      const f = await getTradeFeeBps(wallet.account!);
      if (!cancel) setFeeBps(f);
    })();
    return () => {
      cancel = true;
    };
  }, [wallet.account]);

  // refresh balances + allowance
  useEffect(() => {
    let cancel = false;
    (async () => {
      if (fromToken && wallet.account) {
        const [bal, allow, fot] = await Promise.all([
          getBalance(fromToken.contract, wallet.account),
          getAllowance(fromToken.contract, wallet.account, DEX_ROUTER),
          isFeeOnTransfer(fromToken.contract).catch(() => false)
        ]);
        if (cancel) return;
        setBalanceFrom(bal);
        setAllowance(allow);
        setFeeOnTransferIn(fot);
      } else {
        setBalanceFrom(0);
        setAllowance(0);
        setFeeOnTransferIn(false);
      }
      if (toToken && wallet.account) {
        const bal = await getBalance(toToken.contract, wallet.account);
        if (cancel) return;
        setBalanceTo(bal);
      } else {
        setBalanceTo(0);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [fromToken, toToken, wallet.account, reloadKey, rpcEpoch]);

  // quote
  useEffect(() => {
    let cancel = false;
    setQuote(null);
    setQuoteError(null);
    const inAmount = Number(amountIn);
    if (!fromToken || !toToken || !Number.isFinite(inAmount) || inAmount <= 0) return;
    if (fromToken.contract === toToken.contract) {
      setQuoteError("Tokens must differ");
      return;
    }
    setQuoting(true);
    const handle = setTimeout(async () => {
      try {
        const q = await quoteSwap(fromToken.contract, toToken.contract, inAmount, feeBps);
        if (cancel) return;
        if (!q) {
          setQuoteError("No route exists between these tokens.");
          setHopFotFlags(new Map());
          setHopTokens(new Map());
        } else {
          setQuote(q);
          // Hydrate hop token metadata + fee-on-transfer flags
          const allHopTokens = [
            fromToken.contract,
            ...q.hops.map((h) => h.toToken)
          ];
          // Need FoT flag for every token except src (already known via feeOnTransferIn)
          const fotTargets = q.hops.map((h) => h.toToken);
          const [fotEntries, infoEntries] = await Promise.all([
            Promise.all(
              fotTargets.map(async (t) => [t, await isFeeOnTransfer(t).catch(() => false)] as const)
            ),
            Promise.all(
              allHopTokens.map(async (t) => [t, await getTokenInfo(t).catch(() => null)] as const)
            )
          ]);
          if (cancel) return;
          setHopFotFlags(new Map(fotEntries));
          setHopTokens(new Map(infoEntries.filter((e): e is readonly [string, TokenInfo] => e[1] != null)));
        }
      } catch (e) {
        if (!cancel) setQuoteError(e instanceof Error ? e.message : "Quote failed");
      } finally {
        if (!cancel) setQuoting(false);
      }
    }, 200);
    return () => {
      cancel = true;
      clearTimeout(handle);
    };
  }, [fromToken, toToken, amountIn, feeBps, reloadKey, rpcEpoch]);

  // Mirror the current selection into the URL (so it stays shareable).
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (fromToken) next.set("from", fromToken.contract);
    else next.delete("from");
    if (toToken) next.set("to", toToken.contract);
    else next.delete("to");
    if (amountIn) next.set("amount", amountIn);
    else next.delete("amount");
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromToken, toToken, amountIn]);

  async function handleShare() {
    await copyToClipboard(window.location.href);
    setShared(true);
    setTimeout(() => setShared(false), 1500);
  }

  const minOut = useMemo(() => {
    if (!quote) return 0;
    return quote.amountOut * (1 - settings.slippageBps / 10000);
  }, [quote, settings.slippageBps]);

  function flip() {
    setFromToken(toToken);
    setToToken(fromToken);
    setAmountIn("");
  }

  const insufficient = quote && balanceFrom < quote.amountIn;
  const needsApproval = !!fromToken && !!quote && allowance < quote.amountIn && fromToken.contract !== "currency_native_unused";
  const priceImpactPct = quote ? quote.priceImpact * 100 : 0;
  const priceImpactClass =
    priceImpactPct >= 5 ? "danger" : priceImpactPct >= 1.5 ? "warning" : "muted";

  const intermediateTokens = quote?.hops.slice(0, -1).map((h) => h.toToken) ?? [];
  const blockedIntermediate = intermediateTokens.find((t) => hopFotFlags.get(t));
  const destFot = !!toToken && hopFotFlags.get(toToken.contract) === true;
  const useSupporting = feeOnTransferIn || destFot;
  const isMultiHop = (quote?.hops.length ?? 0) > 1;

  async function handleApprove() {
    if (!fromToken || !quote) return;
    setBusy(true);
    const id = toasts.push({ kind: "pending", title: `Approving ${fromToken.symbol}…` });
    try {
      const amount = settings.infiniteApproval
        ? INFINITE_APPROVAL_AMOUNT
        : quote.amountIn * 1.05;
      const result = (await track(
        {
          label: `Approve ${fromToken.symbol}${settings.infiniteApproval ? " (∞)" : ""}`,
          contract: fromToken.contract,
          function: "approve"
        },
        () => approveToken(fromToken.contract, DEX_ROUTER, amount) as Promise<{
          accepted?: boolean | null;
          finalized?: boolean;
          txHash?: string;
          message?: string;
        }>
      )) as { accepted?: boolean | null; message?: string };
      if (result?.accepted === false) throw new Error(result.message ?? "Rejected");
      toasts.update(id, { kind: "success", title: `${fromToken.symbol} approved` });
      setReloadKey((k) => k + 1);
    } catch (e) {
      toasts.update(id, {
        kind: "error",
        title: "Approval failed",
        message: e instanceof Error ? e.message : String(e)
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleSwap() {
    if (!fromToken || !toToken || !quote || !wallet.account) return;
    setBusy(true);
    const id = toasts.push({
      kind: "pending",
      title: `Swapping ${formatNumber(quote.amountIn)} ${fromToken.symbol} → ${toToken.symbol}`
    });
    try {
      const fn = useSupporting
        ? "swapExactTokensForTokensSupportingFeeOnTransferTokens"
        : "swapExactTokensForTokens";
      const result = await track(
        {
          label: `Swap ${fromToken.symbol} → ${toToken.symbol}`,
          contract: DEX_ROUTER,
          function: fn
        },
        () =>
          swap({
            amountIn: quote.amountIn,
            amountOutMin: minOut,
            path: quote.path,
            src: fromToken.contract,
            to: wallet.account!,
            deadline: deadlineFromNow(settings.deadlineMin),
            feeOnTransfer: useSupporting
          }) as Promise<{
            accepted?: boolean | null;
            finalized?: boolean;
            txHash?: string;
            message?: string;
          }>
      );
      const accepted = result?.accepted;
      const finalized = result?.finalized;
      const message = result?.message;
      const txHash = result?.txHash;
      if (accepted === false) throw new Error(message ?? "Transaction rejected");
      toasts.update(id, {
        kind: finalized ? "success" : "info",
        title: finalized ? "Swap complete" : "Swap submitted",
        message,
        txHash
      });
      setAmountIn("");
      invalidatePairCache();
      setReloadKey((k) => k + 1);
    } catch (e) {
      toasts.update(id, {
        kind: "error",
        title: "Swap failed",
        message: e instanceof Error ? e.message : String(e)
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-narrow">
      <div className="card swap-card">
        <div className="card-header">
          <h2>Swap</h2>
          <div className="card-actions">
            {feeBps === 0 && <span className="badge badge-accent">0% fee</span>}
            <button
              className={
                "badge " +
                (settings.slippageBps > 300
                  ? "badge-warn"
                  : "badge-muted")
              }
              title="Click to change slippage"
              onClick={() => setSettingsOpen(true)}
            >
              {settings.slippageBps > 300 && <Info size={11} />}
              {(settings.slippageBps / 100).toFixed(2)}% slip
            </button>
            <button
              className="icon-btn"
              title={shared ? "Link copied!" : "Copy shareable link"}
              onClick={handleShare}
            >
              <Share2 size={14} />
            </button>
            <button
              className="icon-btn"
              title="Refresh"
              onClick={() => {
                invalidatePairCache();
                setReloadKey((k) => k + 1);
              }}
            >
              <RefreshCw size={14} />
            </button>
            <button
              className="icon-btn"
              title="Settings"
              onClick={() => setSettingsOpen(true)}
            >
              <SettingsIcon size={14} />
            </button>
          </div>
        </div>

        <Panel
          label="From"
          token={fromToken}
          amount={amountIn}
          onAmount={setAmountIn}
          onPickToken={() => setPickFrom(true)}
          balance={wallet.account ? balanceFrom : undefined}
          account={wallet.account}
        />

        <div className="flip-wrap">
          <button className="flip-btn" onClick={flip} aria-label="Flip">
            <ArrowDownUp size={14} />
          </button>
        </div>

        <Panel
          label="To"
          token={toToken}
          amount={quote ? formatNumber(quote.amountOut) : ""}
          onPickToken={() => setPickTo(true)}
          balance={wallet.account ? balanceTo : undefined}
          account={wallet.account}
          readOnly
        />

        {quoteError && <div className="info-row error">{quoteError}</div>}
        {quote && (
          <div className="quote-summary">
            <div className="quote-row">
              <span className="muted">Rate</span>
              <span>
                1 {fromToken?.symbol} ≈{" "}
                <strong>
                  {formatNumber(quote.amountOut / Math.max(quote.amountIn, 1e-12))}
                </strong>{" "}
                {toToken?.symbol}
              </span>
            </div>
            <div className="quote-row">
              <span className="muted">Min received ({(settings.slippageBps / 100).toFixed(2)}% slippage)</span>
              <span>
                <strong>{formatNumber(minOut)}</strong> {toToken?.symbol}
              </span>
            </div>
            <div className="quote-row">
              <span className="muted">Price impact</span>
              <span className={priceImpactClass}>
                {formatPercent(-priceImpactPct, 2)}
              </span>
            </div>
            <div className="quote-row">
              <span className="muted">Fee</span>
              <span>{bpsToPercent(quote.feeBps)}</span>
            </div>
            <div className="quote-row">
              <span className="muted">Route</span>
              <span className="route-display">
                {[fromToken?.contract, ...quote.hops.map((h) => h.toToken)]
                  .filter((c): c is string => !!c)
                  .map((c, i, arr) => {
                    const tok = hopTokens.get(c);
                    const sym = tok?.symbol ?? c.slice(0, 6);
                    return (
                      <span key={i} className="route-step">
                        <span className="route-token">{sym}</span>
                        {i < arr.length - 1 && <span className="route-arrow">›</span>}
                      </span>
                    );
                  })}
              </span>
            </div>
            {isMultiHop && (
              <div className="quote-row muted small">
                <Info size={11} /> {quote.hops.length} hops · best route auto-selected
              </div>
            )}
            {useSupporting && (
              <div className="quote-row warning small">
                <Info size={12} /> Using fee-on-transfer path
                {destFot && !feeOnTransferIn ? " (output token)" : ""}.
              </div>
            )}
            {blockedIntermediate && (
              <div className="info-row danger small">
                <Info size={12} /> Route blocked: intermediate token{" "}
                <span className="mono">{blockedIntermediate}</span> is fee-on-transfer.
              </div>
            )}
            {priceImpactPct >= 5 && (
              <div className="info-row danger small">
                <Info size={12} /> Price impact is high. Consider a smaller trade.
              </div>
            )}
          </div>
        )}

        {!wallet.account ? (
          <button
            className="btn btn-primary btn-block"
            onClick={() => wallet.connect()}
            disabled={!wallet.available || wallet.connecting}
          >
            {wallet.available ? (wallet.connecting ? "Connecting…" : "Connect Wallet") : "Wallet missing"}
          </button>
        ) : !fromToken || !toToken ? (
          <button className="btn btn-primary btn-block" disabled>
            Select tokens
          </button>
        ) : !quote || quoting ? (
          <button className="btn btn-primary btn-block" disabled>
            {quoting ? "Quoting…" : "Enter amount"}
          </button>
        ) : insufficient ? (
          <button className="btn btn-primary btn-block" disabled>
            Insufficient {fromToken.symbol}
          </button>
        ) : blockedIntermediate ? (
          <button className="btn btn-primary btn-block" disabled>
            Route unavailable
          </button>
        ) : needsApproval ? (
          <button className="btn btn-primary btn-block" onClick={handleApprove} disabled={busy}>
            {busy ? "Working…" : `Approve ${fromToken.symbol}`}
          </button>
        ) : (
          <button
            className={
              "btn btn-block " + (priceImpactPct >= 5 ? "btn-danger" : "btn-primary")
            }
            onClick={() => setReviewOpen(true)}
            disabled={busy}
          >
            {busy ? "Submitting…" : priceImpactPct >= 5 ? "Review (high impact)" : "Review Swap"}
          </button>
        )}
      </div>

      <SwapReviewModal
        open={reviewOpen}
        fromToken={fromToken}
        toToken={toToken}
        quote={quote}
        minOut={minOut}
        slippageBps={settings.slippageBps}
        deadlineMin={settings.deadlineMin}
        account={wallet.account}
        estimateRequest={
          quote && fromToken && toToken && wallet.account
            ? {
                contract: DEX_ROUTER,
                function: useSupporting
                  ? "swapExactTokensForTokensSupportingFeeOnTransferTokens"
                  : "swapExactTokensForTokens",
                kwargs: {
                  amountIn: quote.amountIn,
                  amountOutMin: minOut,
                  path: quote.path,
                  src: fromToken.contract,
                  to: wallet.account,
                  deadline: deadlineFromNow(settings.deadlineMin)
                }
              }
            : null
        }
        busy={busy}
        onClose={() => setReviewOpen(false)}
        onConfirm={async () => {
          await handleSwap();
          setReviewOpen(false);
        }}
        hopTokenSymbol={(c) => hopTokens.get(c)?.symbol ?? c.slice(0, 6)}
      />

      <TokenSelectorModal
        open={pickFrom}
        onClose={() => setPickFrom(false)}
        onSelect={(t) => setFromToken(t)}
        exclude={toToken?.contract}
        account={wallet.account}
      />
      <TokenSelectorModal
        open={pickTo}
        onClose={() => setPickTo(false)}
        onSelect={(t) => setToToken(t)}
        exclude={fromToken?.contract}
        account={wallet.account}
      />
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onChange={() => setReloadKey((k) => k + 1)}
      />
    </div>
  );
}
