import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Header } from "./components/Header";
import { Toasts } from "./components/Toasts";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider } from "./hooks/useToasts";
import { invalidatePairCache } from "./lib/dex";
import { clearTokenCache } from "./lib/tokens";
import { listTxs, reconcilePendingTxs, subscribe as subscribeTxs } from "./lib/txHistory";
import { subscribeRpcEpoch } from "./lib/xian";

const PENDING_RECONCILE_MS = 30_000;

const Swap = lazy(() => import("./routes/Swap"));
const Pools = lazy(() => import("./routes/Pools"));
const PairDetail = lazy(() => import("./routes/PairDetail"));
const Liquidity = lazy(() => import("./routes/Liquidity"));
const Portfolio = lazy(() => import("./routes/Portfolio"));

export default function App() {
  useEffect(() => {
    // Reconcile any txs that were left "pending" when the tab was closed.
    void reconcilePendingTxs();
    return subscribeRpcEpoch(() => {
      invalidatePairCache();
      clearTokenCache();
    });
  }, []);

  // While any tx is in "pending", poll the chain every 30s to resolve it.
  // The interval is started only when there's actually something pending and
  // torn down as soon as the queue clears, so idle tabs don't hit the RPC.
  useEffect(() => {
    let timer: number | null = null;
    const evaluate = () => {
      const hasPending = listTxs().some((t) => t.status === "pending");
      if (hasPending && timer == null) {
        timer = window.setInterval(() => {
          void reconcilePendingTxs();
        }, PENDING_RECONCILE_MS);
      } else if (!hasPending && timer != null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    evaluate();
    const unsub = subscribeTxs(evaluate);
    return () => {
      unsub();
      if (timer != null) window.clearInterval(timer);
    };
  }, []);

  return (
    <ToastProvider>
      <BrowserRouter>
        <div className="app-shell">
          <Header />
          <main className="app-main">
            <ErrorBoundary>
              <Suspense fallback={<div className="empty">Loading…</div>}>
                <Routes>
                  <Route path="/" element={<Navigate to="/swap" replace />} />
                  <Route path="/swap" element={<Swap />} />
                  <Route path="/pools" element={<Pools />} />
                  <Route path="/pools/:id" element={<PairDetail />} />
                  <Route path="/liquidity" element={<Liquidity />} />
                  <Route path="/portfolio" element={<Portfolio />} />
                  <Route path="*" element={<Navigate to="/swap" replace />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </main>
          <footer className="app-footer">
            <span className="muted small">SnakX • Xian DEX</span>
            <span className="muted small">
              Built on{" "}
              <a href="https://xian.org" className="link" target="_blank" rel="noreferrer">
                xian.org
              </a>
            </span>
          </footer>
          <Toasts />
        </div>
      </BrowserRouter>
    </ToastProvider>
  );
}
