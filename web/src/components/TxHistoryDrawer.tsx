import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Loader2, X, Trash2, ExternalLink } from "lucide-react";
import { useTxHistory } from "../hooks/useTxHistory";
import { clearTxs, type TxStatus } from "../lib/txHistory";
import { formatAge, copyToClipboard, shortAddress } from "../lib/format";

interface Props {
  open: boolean;
  onClose(): void;
}

function statusIcon(status: TxStatus) {
  switch (status) {
    case "success":
      return <CheckCircle2 size={14} className="success" />;
    case "failed":
      return <XCircle size={14} className="error" />;
    default:
      return <Loader2 size={14} className="spin" />;
  }
}

export function TxHistoryDrawer({ open, onClose }: Props) {
  const records = useTxHistory();
  const [tick, setTick] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);

  // Refresh "x ago" labels every 15s while open.
  useEffect(() => {
    if (!open) return;
    const handle = window.setInterval(() => setTick((t) => t + 1), 15000);
    return () => window.clearInterval(handle);
  }, [open]);
  void tick;

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Recent activity</h3>
          <div className="row gap-sm">
            {records.length > 0 && (
              <button
                className="icon-btn"
                title="Clear all"
                onClick={() => {
                  if (confirm("Clear transaction history?")) clearTxs();
                }}
              >
                <Trash2 size={14} />
              </button>
            )}
            <button className="icon-btn" aria-label="Close" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="drawer-body">
          {records.length === 0 ? (
            <div className="empty" style={{ padding: "40px 20px" }}>
              No transactions yet.
            </div>
          ) : (
            <div className="tx-list">
              {records.map((r) => (
                <div key={r.id} className={"tx-row tx-" + r.status}>
                  <div className="tx-icon">{statusIcon(r.status)}</div>
                  <div className="tx-body">
                    <div className="tx-row-top">
                      <span className="tx-label">{r.label}</span>
                      <span className="muted small">{formatAge(r.timestamp)}</span>
                    </div>
                    <div className="tx-meta mono">
                      {r.contract}.{r.function}
                    </div>
                    {r.txHash && (
                      <button
                        className="link small mono"
                        title="Copy tx hash"
                        onClick={async () => {
                          if (!r.txHash) return;
                          await copyToClipboard(r.txHash);
                          setCopied(r.id);
                          setTimeout(() => setCopied(null), 1200);
                        }}
                      >
                        <ExternalLink size={11} />
                        {copied === r.id ? "copied!" : shortAddress(r.txHash, 8)}
                      </button>
                    )}
                    {r.message && r.status !== "success" && (
                      <div className="tx-message small">{r.message}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
