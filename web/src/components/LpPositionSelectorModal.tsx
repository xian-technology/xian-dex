import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { TokenIcon } from "./TokenIcon";
import { useModalBehavior } from "../hooks/useModalBehavior";
import {
  listOwnedLpPositions,
  type OwnedLpPosition
} from "../lib/lpPositions";

interface Props {
  open: boolean;
  account?: string | null;
  onClose(): void;
  onSelect(position: OwnedLpPosition): void;
}

export function LpPositionSelectorModal({ open, account, onClose, onSelect }: Props) {
  const [positions, setPositions] = useState<OwnedLpPosition[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useModalBehavior(open, onClose);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setError(null);
    if (!account) {
      setPositions([]);
      setLoading(false);
      return;
    }

    let cancel = false;
    setLoading(true);
    listOwnedLpPositions(account)
      .then((next) => {
        if (!cancel) setPositions(next);
      })
      .catch((reason: unknown) => {
        if (cancel) return;
        setPositions([]);
        setError(reason instanceof Error ? reason.message : "Could not load LP positions");
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });

    return () => {
      cancel = true;
    };
  }, [open, account]);

  const filteredPositions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return positions;
    return positions.filter(({ token0, token1, lpToken, pair }) =>
      [
        token0.symbol,
        token0.name,
        token0.contract,
        token1.symbol,
        token1.name,
        token1.contract,
        lpToken,
        String(pair.id)
      ].some((value) => value.toLowerCase().includes(query))
    );
  }, [positions, search]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Select an LP position"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h3>Select an LP position</h3>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-search">
          <Search size={16} />
          <input
            autoFocus
            aria-label="Search LP positions"
            placeholder="Search pair or LP contract"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="token-list">
          {loading && <div className="muted center pad">Loading LP positions…</div>}
          {!loading && !error && filteredPositions.length === 0 && (
            <div className="muted center pad">
              {positions.length === 0
                ? "No LP positions with a positive balance."
                : "No LP positions match."}
            </div>
          )}
          {error && <div className="error pad">{error}</div>}
          {filteredPositions.map((position) => (
            <button
              type="button"
              key={position.pair.id}
              className="token-row lp-position-option"
              onClick={() => {
                onSelect(position);
                onClose();
              }}
            >
              <span className="pool-pair-icons">
                <TokenIcon token={position.token0} size={30} />
                <TokenIcon token={position.token1} size={30} />
              </span>
              <span className="token-row-text">
                <span className="token-row-top">
                  <span className="token-symbol">
                    {position.token0.symbol} / {position.token1.symbol}
                  </span>
                  <span className="token-name">LP position</span>
                </span>
                <span className="token-contract mono">
                  #{position.pair.id} · {position.lpToken}
                </span>
              </span>
              <span className="token-balance lp-position-balance">
                <span>{position.balanceInput}</span>
                <span className="muted small">LP</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
