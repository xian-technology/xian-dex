import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowDownUp, ChevronDown, RefreshCw, Settings as SettingsIcon, Info, Share2 } from "lucide-react";
import {
  deadlineFromNow,
  minimumAmountOutV2,
  planXianDexV2ExactInSwap,
  fixedUnits,
  type XianDexV2ExactInQuote as QuoteResult
} from "@xian-tech/dex";
import { TokenIcon } from "../components/TokenIcon";
import { ConnectButton } from "../components/ConnectButton";
import { TokenSelectorModal } from "../components/TokenSelectorModal";
import { SettingsModal } from "../components/SettingsModal";
import { SwapReviewModal } from "../components/SwapReviewModal";
import { useWallet } from "../hooks/useWallet";
import { useSettings } from "../hooks/useSettings";
import { useToasts } from "../hooks/useToasts";
import { useRpcEpoch } from "../hooks/useRpcEpoch";
import {
  approveToken,
  getTradeFeeBps,
  invalidatePairCache,
  isFeeOnTransfer,
  quoteSwap,
  swap
} from "../lib/dex";
import { getTokenInfo, getAllowance, getBalance, type TokenInfo } from "../lib/tokens";
import { DEX_ROUTER, INFINITE_APPROVAL_AMOUNT, NATIVE_TOKEN } from "../lib/constants";
import {
  bpsToPercent,
  copyToClipboard,
  formatExecutionImpact,
  formatNumber,
  isValidContractName
} from "../lib/format";
import { displayRate, positiveAmount } from "../lib/amounts";
import { track } from "../lib/txHistory";

interface PanelProps {
  label: string;
  token: TokenInfo | null;
  amount: string;
  onAmount?(v: string): void;
  onPickToken(): void;
  balance?: string;
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
            {!readOnly && fixedUnits(balance) > 0n && (
              <button className="link" onClick={() => onAmount?.(balance)}>
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
          aria-label={`${label} amount`}
          value={amount}
          readOnly={readOnly}
          onChange={(e) => onAmount?.(e.target.value)}
        />
        <button className="token-pick" onClick={onPickToken}>
          {token ? (
            <>
              <TokenIcon token={token} size={24} />
              <span>{token.symbol}</span>
            </>
          ) : (
            <>
              <TokenIcon token={null} size={24} />
              <span>Select</span>
            </>
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
  const [latestQuote, setQuote] = useState<QuoteResult | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [feeBps, setFeeBps] = useState(30);
  const [feeOnTransferIn, setFeeOnTransferIn] = useState(false);
  const [hopFotFlags, setHopFotFlags] = useState<Map<string, boolean>>(new Map());
  const [hopTokens, setHopTokens] = useState<Map<string, TokenInfo>>(new Map());
  const [allowance, setAllowance] = useState("0");
  const [balanceFrom, setBalanceFrom] = useState("0");
  const [balanceTo, setBalanceTo] = useState("0");
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);

  const quote = latestQuote && latestQuote.amountIn === positiveAmount(amountIn, fromToken?.precision)
    && latestQuote.hops[0]?.fromToken === fromToken?.contract
    && latestQuote.hops.at(-1)?.toToken === toToken?.contract && latestQuote.feeBps === feeBps
    ? latestQuote : null;

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
      // Compare against the resolved seed, not the raw param — with no valid
      // "from", both sides would otherwise end up on the native token.
      if (to && isValidContractName(to) && to !== seed) {
        const target = await getTokenInfo(to).catch(() => null);
        if (cancel) return;
        if (target && !toToken) setToToken(target);
      }
      if (amt && positiveAmount(amt) && !amountIn) {
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
        setBalanceFrom("0");
        setAllowance("0");
        setFeeOnTransferIn(false);
      }
      if (toToken && wallet.account) {
        const bal = await getBalance(toToken.contract, wallet.account);
        if (cancel) return;
        setBalanceTo(bal);
      } else {
        setBalanceTo("0");
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
    // A cancelled in-flight quote skips its `finally`, so reset the flag here
    // or "Quoting…" sticks after the amount is cleared mid-fetch.
    setQuoting(false);
    const inAmount = positiveAmount(amountIn, fromToken?.precision);
    if (!fromToken || !toToken) return;
    if (!inAmount) {
      if (amountIn) setQuoteError(`Enter a positive amount with at most ${fromToken.precision ?? 30} decimal places.`);
      return;
    }
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
    if (!quote) return "0";
    return minimumAmountOutV2(quote.amountOut, settings.slippageBps, quote.outputPrecision);
  }, [quote, settings.slippageBps]);

  function flip() {
    setFromToken(toToken);
    setToToken(fromToken);
    setAmountIn("");
  }

  const insufficient = quote && fixedUnits(balanceFrom) < fixedUnits(quote.amountIn);
  const needsApproval = !!fromToken && !!quote && fixedUnits(allowance) < fixedUnits(quote.amountIn);
  const priceImpactPct = quote ? Number(quote.priceImpact) * 100 : 0;
  const priceImpactClass =
    priceImpactPct >= 5 ? "danger" : priceImpactPct >= 1.5 ? "warning" : "muted";

  const intermediateTokens = quote?.hops.slice(0, -1).map((h) => h.toToken) ?? [];
  const blockedIntermediate = intermediateTokens.find((t) => hopFotFlags.get(t));
  const destFot = !!toToken && hopFotFlags.get(toToken.contract) === true;
  const useSupporting = feeOnTransferIn || destFot;
  const isMultiHop = (quote?.hops.length ?? 0) > 1;

  function feeOnTransferTokens(): string[] {
    const tokens = [...hopFotFlags.entries()]
      .filter(([, flagged]) => flagged)
      .map(([token]) => token);
    if (feeOnTransferIn && fromToken) tokens.push(fromToken.contract);
    return tokens;
  }

  async function handleApprove() {
    if (!fromToken || !quote) return;
    setBusy(true);
    const id = toasts.push({ kind: "pending", title: `Approving ${fromToken.symbol}…` });
    try {
      const amount = settings.infiniteApproval
        ? INFINITE_APPROVAL_AMOUNT
        : quote.amountIn;
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
      const request = {
        quote,
        recipient: wallet.account,
        slippageBps: settings.slippageBps,
        deadline: deadlineFromNow(settings.deadlineMin),
        feeOnTransferTokens: feeOnTransferTokens(),
        supportingFeeOnTransfer: useSupporting
      };
      const fn = planXianDexV2ExactInSwap(request).call.function;
      const result = await track(
        {
          label: `Swap ${fromToken.symbol} → ${toToken.symbol}`,
          contract: DEX_ROUTER,
          function: fn
        },
        () => swap(request) as Promise<{
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
          amount={quote ? quote.amountOut : ""}
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
                  {displayRate(quote.amountOut, quote.amountIn)}
                </strong>{" "}
                {toToken?.symbol}
              </span>
            </div>
            <div className="quote-row">
              <span className="muted">Min received ({(settings.slippageBps / 100).toFixed(2)}% slippage)</span>
              <span>
                <strong>{minOut}</strong> {toToken?.symbol}
              </span>
            </div>
            <div className="quote-row">
              <span className="muted">Execution impact</span>
              <span className={priceImpactClass}>
                {formatExecutionImpact(Number(quote.priceImpact))}
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
              <div className="quote-note muted small">
                <Info size={11} /> {quote.hops.length} hops · best route auto-selected
              </div>
            )}
            {useSupporting && (
              <div className="quote-note warning small">
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
                <Info size={12} /> Execution impact is high. Consider a smaller trade.
              </div>
            )}
          </div>
        )}

        {!wallet.account ? (
          <ConnectButton block />
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
            {busy ? "Approving…" : `Approve ${fromToken.symbol}`}
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
          reviewOpen && !blockedIntermediate && quote && fromToken && toToken && wallet.account
            ? planXianDexV2ExactInSwap({
                quote,
                recipient: wallet.account,
                slippageBps: settings.slippageBps,
                deadline: deadlineFromNow(settings.deadlineMin),
                routerContract: DEX_ROUTER,
                feeOnTransferTokens: feeOnTransferTokens(),
                supportingFeeOnTransfer: useSupporting
              }).call
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
