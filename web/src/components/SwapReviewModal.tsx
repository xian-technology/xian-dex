import { useEffect, useState } from "react";
import { X, Info, Loader2 } from "lucide-react";
import { TokenIcon } from "./TokenIcon";
import { estimateChiFor, type ChiEstimate, type QuoteResult } from "../lib/dex";
import type { TokenInfo } from "../lib/tokens";
import { bpsToPercent, formatNumber } from "../lib/format";

interface Props {
  open: boolean;
  fromToken: TokenInfo | null;
  toToken: TokenInfo | null;
  quote: QuoteResult | null;
  minOut: number;
  slippageBps: number;
  deadlineMin: number;
  account: string | null;
  /** Built kwargs that the swap call will use; passed to chi estimate. */
  estimateRequest: {
    contract: string;
    function: string;
    kwargs: Record<string, unknown>;
  } | null;
  busy: boolean;
  onClose(): void;
  onConfirm(): void;
  hopTokenSymbol(contract: string): string;
}

export function SwapReviewModal({
  open,
  fromToken,
  toToken,
  quote,
  minOut,
  slippageBps,
  deadlineMin,
  account,
  estimateRequest,
  busy,
  onClose,
  onConfirm,
  hopTokenSymbol
}: Props) {
  const [chi, setChi] = useState<ChiEstimate | null>(null);
  const [chiLoading, setChiLoading] = useState(false);

  useEffect(() => {
    if (!open || !estimateRequest || !account) {
      setChi(null);
      return;
    }
    let cancel = false;
    setChiLoading(true);
    setChi(null);
    estimateChiFor(account, estimateRequest.contract, estimateRequest.function, estimateRequest.kwargs)
      .then((res) => {
        if (!cancel) setChi(res);
      })
      .finally(() => {
        if (!cancel) setChiLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [open, estimateRequest, account]);

  if (!open || !quote || !fromToken || !toToken) return null;

  const priceImpactPct = quote.priceImpact * 100;
  const impactClass =
    priceImpactPct >= 5 ? "danger" : priceImpactPct >= 1.5 ? "warning" : "";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Review swap</h3>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <div className="review-flow">
            <div className="review-side">
              <TokenIcon token={fromToken} size={36} />
              <div>
                <div className="muted small">You pay</div>
                <div className="review-amount">
                  {formatNumber(quote.amountIn)} <span className="small">{fromToken.symbol}</span>
                </div>
              </div>
            </div>
            <div className="review-arrow">→</div>
            <div className="review-side">
              <TokenIcon token={toToken} size={36} />
              <div>
                <div className="muted small">You receive (≈)</div>
                <div className="review-amount">
                  {formatNumber(quote.amountOut)} <span className="small">{toToken.symbol}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="kv-list">
            <div className="kv">
              <span className="muted">Minimum received</span>
              <strong>
                {formatNumber(minOut)} {toToken.symbol}
              </strong>
            </div>
            <div className="kv">
              <span className="muted">Slippage tolerance</span>
              <span>{(slippageBps / 100).toFixed(2)}%</span>
            </div>
            <div className="kv">
              <span className="muted">Price impact</span>
              <span className={impactClass}>
                {priceImpactPct.toFixed(2)}%
              </span>
            </div>
            <div className="kv">
              <span className="muted">Fee per hop</span>
              <span>{bpsToPercent(quote.feeBps)}</span>
            </div>
            <div className="kv">
              <span className="muted">Route</span>
              <span className="route-display">
                {[fromToken.contract, ...quote.hops.map((h) => h.toToken)].map((c, i, arr) => (
                  <span className="route-step" key={i}>
                    <span className="route-token">{hopTokenSymbol(c)}</span>
                    {i < arr.length - 1 && <span className="route-arrow">›</span>}
                  </span>
                ))}
              </span>
            </div>
            <div className="kv">
              <span className="muted">Deadline</span>
              <span>{deadlineMin} min from now</span>
            </div>
            <div className="kv">
              <span className="muted">CHI estimate</span>
              <span>
                {chiLoading ? (
                  <Loader2 size={12} className="spin" />
                ) : chi ? (
                  <>
                    <strong>{chi.estimated.toLocaleString()}</strong>{" "}
                    <span className="muted small">
                      (max {chi.suggested.toLocaleString()})
                    </span>
                  </>
                ) : (
                  <span className="muted">unavailable</span>
                )}
              </span>
            </div>
          </div>

          {priceImpactPct >= 5 && (
            <div className="info-row danger small">
              <Info size={12} /> High price impact. You may want to split the trade.
            </div>
          )}

          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              className={"btn " + (priceImpactPct >= 5 ? "btn-danger" : "btn-primary")}
              onClick={onConfirm}
              disabled={busy}
            >
              {busy ? "Submitting…" : "Confirm Swap"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
