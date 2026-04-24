import { CheckCircle2, XCircle, Loader2, Info, X } from "lucide-react";
import { useToasts, type Toast } from "../hooks/useToasts";

function iconFor(t: Toast) {
  switch (t.kind) {
    case "success":
      return <CheckCircle2 size={18} className="toast-icon toast-success" />;
    case "error":
      return <XCircle size={18} className="toast-icon toast-error" />;
    case "pending":
      return <Loader2 size={18} className="toast-icon toast-pending spin" />;
    default:
      return <Info size={18} className="toast-icon" />;
  }
}

export function Toasts() {
  const { toasts, dismiss } = useToasts();
  // Render the container even when empty so it stays a stable live region
  // — assistive tech announces additions reliably this way.
  return (
    <div
      className="toasts"
      aria-live="polite"
      aria-relevant="additions"
      aria-atomic="false"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={"toast toast-" + t.kind}
          role={t.kind === "error" ? "alert" : "status"}
        >
          {iconFor(t)}
          <div className="toast-body">
            <div className="toast-title">{t.title}</div>
            {t.message && <div className="toast-message">{t.message}</div>}
            {t.txHash && (
              <div className="toast-tx mono">tx: {t.txHash.slice(0, 16)}…</div>
            )}
          </div>
          <button className="icon-btn" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
