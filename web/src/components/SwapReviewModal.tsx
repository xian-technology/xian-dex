import { useEffect, useState } from "react";
import { X, Info, Loader2 } from "lucide-react";
import { TokenIcon } from "./TokenIcon";
import { estimateChiFor, type QuoteResult } from "../lib/dex";
import type { TokenInfo } from "../lib/tokens";
import { bpsToPercent, formatExecutionImpact, impactClassFor } from "../lib/format";
import { useModalBehavior } from "../hooks/useModalBehavior";

interface Props {
  open: boolean;
  fromToken: TokenInfo | null;
  toToken: TokenInfo | null;
  quote: QuoteResult | null;
  minOut: string;
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

type EstimateRequest = Props["estimateRequest"];

const CONFIRM_BUTTON_CLASS = { danger: "btn-danger", warning: "btn-primary", "": "btn-primary" };

/** The simulated chi of the swap call: exactly what the wallet supplies. */
function useChiEstimate(open: boolean, estimateRequest: EstimateRequest, account: string | null) {
  const [chi, setChi] = useState<number | null>(null);
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

  return { chi, chiLoading };
}

function ChiEstimateValue({ chi, loading }: { chi: number | null; loading: boolean }) {
  if (loading) return <Loader2 size={12} className="spin" />;
  if (chi === null) return <span className="muted">unavailable</span>;
  return <strong>{chi.toLocaleString()}</strong>;
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
  const { chi, chiLoading } = useChiEstimate(open, estimateRequest, account);
  // While submitting, closing must go through the (disabled) Cancel button.
  useModalBehavior(open && !busy, onClose);

  if (!open || !quote || !fromToken || !toToken) return null;

  const priceImpactPct = Number(quote.priceImpact) * 100;
  const impactClass = impactClassFor(priceImpactPct);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Review swap"
        onClick={(e) => e.stopPropagation()}
      >
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
                  {quote.amountIn} <span className="small">{fromToken.symbol}</span>
                </div>
              </div>
            </div>
            <div className="review-arrow">→</div>
            <div className="review-side">
              <TokenIcon token={toToken} size={36} />
              <div>
                <div className="muted small">You receive (≈)</div>
                <div className="review-amount">
                  {quote.amountOut} <span className="small">{toToken.symbol}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="kv-list">
            <div className="kv">
              <span className="muted">Minimum received</span>
              <strong>
                {minOut} {toToken.symbol}
              </strong>
            </div>
            <div className="kv">
              <span className="muted">Slippage tolerance</span>
              <span>{(slippageBps / 100).toFixed(2)}%</span>
            </div>
            <div className="kv">
              <span className="muted">Execution impact</span>
              <span className={impactClass}>
                {formatExecutionImpact(Number(quote.priceImpact))}
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
                <ChiEstimateValue chi={chi} loading={chiLoading} />
              </span>
            </div>
          </div>

          {impactClass === "danger" && (
            <div className="info-row danger small">
              <Info size={12} /> Execution impact is high. Consider a smaller trade.
            </div>
          )}

          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              className={"btn " + CONFIRM_BUTTON_CLASS[impactClass]}
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
