import { NavLink } from "react-router-dom";
import { Wallet as WalletIcon, Zap, AlertTriangle, History, Lock } from "lucide-react";
import { useState } from "react";
import { ConnectButton } from "./ConnectButton";
import { useWallet } from "../hooks/useWallet";
import { useTxHistory } from "../hooks/useTxHistory";
import { useChainCheck } from "../hooks/useChainCheck";
import { shortAddress, copyToClipboard } from "../lib/format";
import { TxHistoryDrawer } from "./TxHistoryDrawer";

export function Header() {
  const wallet = useWallet();
  const txs = useTxHistory();
  const chain = useChainCheck();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const pendingCount = txs.filter((t) => t.status === "pending").length;

  async function handleAddress() {
    if (!wallet.account) return;
    await copyToClipboard(wallet.account);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <header className="app-header">
      <div className="header-left">
        <div className="brand">
          <Zap size={18} />
          <span>SnakX</span>
        </div>
        <nav className="nav-links">
          <NavLink to="/swap" className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}>
            Swap
          </NavLink>
          <NavLink to="/pools" className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}>
            Pools
          </NavLink>
          <NavLink
            to="/liquidity"
            className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
          >
            Liquidity
          </NavLink>
          <NavLink
            to="/portfolio"
            className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
          >
            Portfolio
          </NavLink>
        </nav>
      </div>

      <div className="header-right">
        {!wallet.available && (
          <span className="badge badge-warn" title="Browser wallet missing">
            <AlertTriangle size={12} /> No wallet
          </span>
        )}
        {wallet.available && wallet.info?.locked && !wallet.account && (
          <span
            className="badge badge-warn"
            title="Open your Xian wallet extension and unlock it with your password to connect."
          >
            <Lock size={12} /> Wallet locked
          </span>
        )}
        {chain.mismatch && (
          <span
            className="badge badge-danger"
            title={`Wallet chain ${chain.walletChainId} ≠ RPC chain ${chain.rpcChainId}. Switch one of them before sending transactions.`}
          >
            <AlertTriangle size={12} /> Chain mismatch
          </span>
        )}
        {wallet.account ? (
          <button className="btn btn-ghost mono" onClick={handleAddress} title="Copy address">
            <WalletIcon size={14} />
            <span>{copied ? "Copied!" : shortAddress(wallet.account)}</span>
          </button>
        ) : (
          <ConnectButton showIcon />
        )}
        <button
          className="icon-btn"
          aria-label="Recent activity"
          onClick={() => setHistoryOpen(true)}
          title="Recent activity"
          style={{ position: "relative" }}
        >
          <History size={16} />
          {pendingCount > 0 && <span className="dot dot-accent" />}
        </button>
      </div>

      <TxHistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </header>
  );
}
