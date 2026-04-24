import { NavLink } from "react-router-dom";
import { Settings as SettingsIcon, Wallet as WalletIcon, Zap, AlertTriangle, History } from "lucide-react";
import { useState } from "react";
import { useWallet } from "../hooks/useWallet";
import { useTxHistory } from "../hooks/useTxHistory";
import { useChainCheck } from "../hooks/useChainCheck";
import { shortAddress, copyToClipboard } from "../lib/format";
import { SettingsModal } from "./SettingsModal";
import { TxHistoryDrawer } from "./TxHistoryDrawer";

export function Header({ onRpcChange }: { onRpcChange?: () => void }) {
  const wallet = useWallet();
  const txs = useTxHistory();
  const chain = useChainCheck();
  const [settingsOpen, setSettingsOpen] = useState(false);
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
        {chain.mismatch && (
          <span
            className="badge badge-danger"
            title={`Wallet chain ${chain.walletChainId} ≠ RPC chain ${chain.rpcChainId}. Switch one of them before sending transactions.`}
          >
            <AlertTriangle size={12} /> Chain mismatch
          </span>
        )}
        {wallet.account ? (
          <button className="btn btn-ghost mono" onClick={handleAddress}>
            <WalletIcon size={14} />
            <span>{copied ? "Copied!" : shortAddress(wallet.account)}</span>
          </button>
        ) : (
          <button
            className="btn btn-primary"
            disabled={wallet.connecting || !wallet.available}
            onClick={() => wallet.connect()}
          >
            <WalletIcon size={14} />
            {wallet.connecting ? "Connecting…" : "Connect Wallet"}
          </button>
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
        <button
          className="icon-btn"
          aria-label="Settings"
          onClick={() => setSettingsOpen(true)}
        >
          <SettingsIcon size={16} />
        </button>
      </div>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} onChange={onRpcChange} />
      <TxHistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </header>
  );
}
