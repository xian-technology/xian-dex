import { useEffect, useMemo, useState } from "react";
import { Search, X, Plus, Trash2 } from "lucide-react";
import { TokenIcon } from "./TokenIcon";
import {
  forgetToken,
  getBalance,
  getTokenInfo,
  listKnownContracts,
  markRecent,
  rememberToken,
  type TokenInfo
} from "../lib/tokens";
import { isValidContractName, formatNumber } from "../lib/format";

interface Props {
  open: boolean;
  onClose(): void;
  onSelect(token: TokenInfo): void;
  exclude?: string;
  account?: string | null;
}

interface Row {
  info: TokenInfo;
  balance: number;
}

export function TokenSelectorModal({ open, onClose, onSelect, exclude, account }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setImportError(null);
    let cancel = false;
    (async () => {
      setLoading(true);
      const contracts = listKnownContracts();
      const settled = await Promise.all(
        contracts.map(async (c) => {
          try {
            const info = await getTokenInfo(c);
            const bal = account ? await getBalance(c, account) : 0;
            return { info, balance: bal };
          } catch {
            return null;
          }
        })
      );
      if (cancel) return;
      const filtered = settled.filter((r): r is Row => r != null);
      // Preserve insertion order from listKnownContracts (recents first),
      // then bubble entries with a positive balance to the top within that.
      const indexOf = new Map(contracts.map((c, i) => [c, i]));
      filtered.sort((a, b) => {
        if ((a.balance > 0) !== (b.balance > 0)) return a.balance > 0 ? -1 : 1;
        if (a.balance > 0 && b.balance > 0) return b.balance - a.balance;
        return (indexOf.get(a.info.contract) ?? 0) - (indexOf.get(b.info.contract) ?? 0);
      });
      setRows(filtered);
      setLoading(false);
    })();
    return () => {
      cancel = true;
    };
  }, [open, account]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let r = rows.filter((row) => row.info.contract !== exclude);
    if (q) {
      r = r.filter(
        (row) =>
          row.info.symbol.toLowerCase().includes(q) ||
          row.info.name.toLowerCase().includes(q) ||
          row.info.contract.toLowerCase().includes(q)
      );
    }
    return r;
  }, [rows, search, exclude]);

  const isPureContract = isValidContractName(search.trim());
  const showImportRow =
    isPureContract &&
    filteredRows.length === 0 &&
    !rows.some((r) => r.info.contract === search.trim());

  async function handleImport() {
    const contract = search.trim();
    if (!isValidContractName(contract)) return;
    setImportBusy(true);
    setImportError(null);
    try {
      const info = await getTokenInfo(contract);
      rememberToken(contract);
      markRecent(contract);
      onSelect(info);
      onClose();
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Could not fetch token");
    } finally {
      setImportBusy(false);
    }
  }

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Select a token</h3>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-search">
          <Search size={16} />
          <input
            autoFocus
            placeholder="Search name, symbol, or paste contract"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="token-list">
          {loading && <div className="muted center pad">Loading tokens…</div>}
          {!loading && filteredRows.length === 0 && !showImportRow && (
            <div className="muted center pad">No tokens match.</div>
          )}
          {filteredRows.map(({ info, balance }) => (
            <div
              key={info.contract}
              className="token-row"
              onClick={() => {
                markRecent(info.contract);
                onSelect(info);
                onClose();
              }}
            >
              <TokenIcon token={info} size={36} />
              <div className="token-row-text">
                <div className="token-row-top">
                  <span className="token-symbol">{info.symbol}</span>
                  <span className="token-name">{info.name}</span>
                </div>
                <div className="token-contract mono">{info.contract}</div>
              </div>
              <div className="token-balance">
                <div>{formatNumber(balance)}</div>
                {info.contract !== "currency" && (
                  <button
                    className="icon-btn ghost"
                    title="Forget custom token"
                    onClick={(e) => {
                      e.stopPropagation();
                      forgetToken(info.contract);
                      setRows((rs) => rs.filter((r) => r.info.contract !== info.contract));
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
          {showImportRow && (
            <button
              className="token-import"
              onClick={handleImport}
              disabled={importBusy}
            >
              <Plus size={16} />
              {importBusy ? "Loading…" : `Import "${search.trim()}"`}
            </button>
          )}
          {importError && <div className="error pad">{importError}</div>}
        </div>
      </div>
    </div>
  );
}
