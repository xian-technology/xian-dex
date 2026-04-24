import { useEffect, useState } from "react";
import { Settings as SettingsIcon, X, Check } from "lucide-react";
import { getRpcUrl, pingRpc, setRpcUrl } from "../lib/xian";
import { useSettings } from "../hooks/useSettings";

interface Props {
  open: boolean;
  onClose(): void;
  onChange?(): void;
}

export function SettingsModal({ open, onClose, onChange }: Props) {
  const settings = useSettings();
  const [rpc, setRpc] = useState(getRpcUrl());
  const [slipInput, setSlipInput] = useState((settings.slippageBps / 100).toString());
  const [dlInput, setDlInput] = useState(settings.deadlineMin.toString());
  const [pinging, setPinging] = useState(false);
  const [pingResult, setPingResult] = useState<null | "ok" | "fail">(null);

  useEffect(() => {
    if (open) {
      setRpc(getRpcUrl());
      setSlipInput((settings.slippageBps / 100).toString());
      setDlInput(settings.deadlineMin.toString());
      setPingResult(null);
    }
  }, [open, settings.slippageBps, settings.deadlineMin]);

  function applySlippage(value: string) {
    setSlipInput(value);
    const num = parseFloat(value);
    if (Number.isFinite(num) && num >= 0 && num <= 50) {
      settings.setSlippageBps(Math.round(num * 100));
    }
  }

  function applyDeadline(value: string) {
    setDlInput(value);
    const num = parseInt(value, 10);
    if (Number.isFinite(num) && num >= 1) settings.setDeadlineMin(num);
  }

  async function applyRpc() {
    setRpcUrl(rpc);
    setPinging(true);
    setPingResult(null);
    const ok = await pingRpc(rpc);
    setPinging(false);
    setPingResult(ok ? "ok" : "fail");
    onChange?.();
  }

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>
            <SettingsIcon size={16} /> Settings
          </h3>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="setting-block">
            <div className="setting-label">Slippage tolerance</div>
            <div className="setting-row">
              {[0.1, 0.5, 1.0].map((v) => (
                <button
                  key={v}
                  className={
                    "chip " + (Math.abs(settings.slippageBps / 100 - v) < 0.001 ? "chip-active" : "")
                  }
                  onClick={() => applySlippage(v.toString())}
                >
                  {v}%
                </button>
              ))}
              <div className="input-suffix">
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="50"
                  value={slipInput}
                  onChange={(e) => applySlippage(e.target.value)}
                />
                <span>%</span>
              </div>
            </div>
            {settings.slippageBps > 300 && (
              <div className="warning small">High slippage may result in unfavorable trades.</div>
            )}
          </div>

          <div className="setting-block">
            <div className="setting-label">Token approvals</div>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={settings.infiniteApproval}
                onChange={(e) => settings.setInfiniteApproval(e.target.checked)}
              />
              <div>
                <div>Use unlimited approvals</div>
                <div className="muted small">
                  One approval covers all future trades for that token. Saves
                  gas but trusts the router with the full balance.
                </div>
              </div>
            </label>
          </div>

          <div className="setting-block">
            <div className="setting-label">Transaction deadline</div>
            <div className="setting-row">
              <div className="input-suffix">
                <input
                  type="number"
                  min="1"
                  max="180"
                  value={dlInput}
                  onChange={(e) => applyDeadline(e.target.value)}
                />
                <span>min</span>
              </div>
            </div>
          </div>

          <div className="setting-block">
            <div className="setting-label">RPC node</div>
            <div className="setting-row">
              <input
                type="text"
                value={rpc}
                onChange={(e) => setRpc(e.target.value)}
                spellCheck={false}
                style={{ flex: 1 }}
              />
              <button className="btn btn-secondary" onClick={applyRpc} disabled={pinging}>
                {pinging ? "Testing…" : "Apply"}
              </button>
            </div>
            {pingResult === "ok" && (
              <div className="success small"><Check size={12} /> Reached node.</div>
            )}
            {pingResult === "fail" && (
              <div className="error small">Could not reach RPC. Saved anyway.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
