import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronDown, Plus, Minus, Info } from "lucide-react";
import { TokenIcon } from "../components/TokenIcon";
import { TokenSelectorModal } from "../components/TokenSelectorModal";
import { useWallet } from "../hooks/useWallet";
import { useSettings } from "../hooks/useSettings";
import { useToasts } from "../hooks/useToasts";
import { useRpcEpoch } from "../hooks/useRpcEpoch";
import {
  addLiquidity,
  approveLp,
  approveToken,
  deadlineFromNow,
  findDirectRoute,
  getLpAllowance,
  getLpBalance,
  getPair,
  invalidatePairCache,
  removeLiquidity,
  type PairInfo
} from "../lib/dex";
import { getAllowance, getBalance, getTokenInfo, type TokenInfo } from "../lib/tokens";
import { DEX_PAIRS, DEX_ROUTER, INFINITE_APPROVAL_AMOUNT, NATIVE_TOKEN } from "../lib/constants";
import { formatNumber } from "../lib/format";
import { track } from "../lib/txHistory";

type SendResult = {
  accepted?: boolean | null;
  finalized?: boolean;
  txHash?: string;
  message?: string;
};

type Mode = "add" | "remove";

export default function Liquidity() {
  const wallet = useWallet();
  const settings = useSettings();
  const toasts = useToasts();
  const rpcEpoch = useRpcEpoch();
  const [params] = useSearchParams();

  const [mode, setMode] = useState<Mode>(params.get("mode") === "remove" ? "remove" : "add");
  const [tokenA, setTokenA] = useState<TokenInfo | null>(null);
  const [tokenB, setTokenB] = useState<TokenInfo | null>(null);
  const [amountA, setAmountA] = useState("");
  const [amountB, setAmountB] = useState("");
  const [pickA, setPickA] = useState(false);
  const [pickB, setPickB] = useState(false);
  const [pair, setPair] = useState<PairInfo | null>(null);
  const [balanceA, setBalanceA] = useState(0);
  const [balanceB, setBalanceB] = useState(0);
  const [allowanceA, setAllowanceA] = useState(0);
  const [allowanceB, setAllowanceB] = useState(0);
  const [lpBalance, setLpBalance] = useState(0);
  const [lpAllowance, setLpAllowance] = useState(0);
  const [removeAmount, setRemoveAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  // seed initial tokens / pair
  useEffect(() => {
    const initialPair = params.get("pair");
    let cancel = false;
    (async () => {
      if (initialPair) {
        const id = Number(initialPair);
        const p = await getPair(id);
        if (cancel || !p) return;
        const [t0, t1] = await Promise.all([getTokenInfo(p.token0), getTokenInfo(p.token1)]);
        if (cancel) return;
        setTokenA(t0);
        setTokenB(t1);
        setPair(p);
      } else if (!tokenA) {
        const xian = await getTokenInfo(NATIVE_TOKEN).catch(() => null);
        if (!cancel && xian) setTokenA(xian);
      }
    })();
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // resolve pair when both tokens chosen
  useEffect(() => {
    let cancel = false;
    setPair(null);
    if (!tokenA || !tokenB) return;
    if (tokenA.contract === tokenB.contract) return;
    (async () => {
      const route = await findDirectRoute(tokenA.contract, tokenB.contract);
      if (cancel) return;
      setPair(route?.pair ?? null);
    })();
    return () => {
      cancel = true;
    };
  }, [tokenA, tokenB, reload, rpcEpoch]);

  // balances + allowances
  useEffect(() => {
    let cancel = false;
    (async () => {
      if (!wallet.account) {
        setBalanceA(0);
        setBalanceB(0);
        setAllowanceA(0);
        setAllowanceB(0);
        setLpBalance(0);
        setLpAllowance(0);
        return;
      }
      const tasks: Promise<unknown>[] = [];
      if (tokenA) {
        tasks.push(
          getBalance(tokenA.contract, wallet.account).then((b) => !cancel && setBalanceA(b)),
          getAllowance(tokenA.contract, wallet.account, DEX_ROUTER).then(
            (a) => !cancel && setAllowanceA(a)
          )
        );
      }
      if (tokenB) {
        tasks.push(
          getBalance(tokenB.contract, wallet.account).then((b) => !cancel && setBalanceB(b)),
          getAllowance(tokenB.contract, wallet.account, DEX_ROUTER).then(
            (a) => !cancel && setAllowanceB(a)
          )
        );
      }
      if (pair) {
        tasks.push(
          getLpBalance(pair.id, wallet.account).then((b) => !cancel && setLpBalance(b)),
          getLpAllowance(pair.id, wallet.account, DEX_ROUTER).then(
            (a) => !cancel && setLpAllowance(a)
          )
        );
      } else {
        setLpBalance(0);
        setLpAllowance(0);
      }
      await Promise.all(tasks);
    })();
    return () => {
      cancel = true;
    };
  }, [wallet.account, tokenA, tokenB, pair, reload, rpcEpoch]);

  // auto-derive amountB when adding to existing pair
  useEffect(() => {
    if (mode !== "add" || !pair || !tokenA || !tokenB) return;
    const a = Number(amountA);
    if (!Number.isFinite(a) || a <= 0) {
      setAmountB("");
      return;
    }
    const orderForward = pair.token0 === tokenA.contract;
    const reserveA = orderForward ? pair.reserve0 : pair.reserve1;
    const reserveB = orderForward ? pair.reserve1 : pair.reserve0;
    if (reserveA <= 0 || reserveB <= 0) return;
    const optimal = (a * reserveB) / reserveA;
    setAmountB(formatNumber(optimal));
  }, [amountA, pair, tokenA, tokenB, mode]);

  const minAmounts = useMemo(() => {
    const slipFactor = 1 - settings.slippageBps / 10000;
    return {
      a: Number(amountA) * slipFactor,
      b: Number(amountB) * slipFactor
    };
  }, [amountA, amountB, settings.slippageBps]);

  // ── Add Liquidity ────────────────────────────────────────────
  async function handleAdd() {
    if (!wallet.account || !tokenA || !tokenB) return;
    const a = Number(amountA);
    const b = Number(amountB);
    if (!(a > 0) || !(b > 0)) return;
    setBusy(true);
    try {
      const approveAmtA = settings.infiniteApproval ? INFINITE_APPROVAL_AMOUNT : a * 1.05;
      const approveAmtB = settings.infiniteApproval ? INFINITE_APPROVAL_AMOUNT : b * 1.05;
      if (allowanceA < a) {
        const id = toasts.push({ kind: "pending", title: `Approving ${tokenA.symbol}…` });
        try {
          const result = (await track(
            {
              label: `Approve ${tokenA.symbol}${settings.infiniteApproval ? " (∞)" : ""}`,
              contract: tokenA.contract,
              function: "approve"
            },
            () => approveToken(tokenA.contract, DEX_ROUTER, approveAmtA) as Promise<SendResult>
          )) as SendResult;
          if (result?.accepted === false) throw new Error(result.message ?? "Rejected");
          toasts.update(id, { kind: "success", title: `${tokenA.symbol} approved` });
        } catch (e) {
          toasts.update(id, {
            kind: "error",
            title: "Approval failed",
            message: e instanceof Error ? e.message : String(e)
          });
          return;
        }
      }
      if (allowanceB < b) {
        const id = toasts.push({ kind: "pending", title: `Approving ${tokenB.symbol}…` });
        try {
          const result = (await track(
            {
              label: `Approve ${tokenB.symbol}${settings.infiniteApproval ? " (∞)" : ""}`,
              contract: tokenB.contract,
              function: "approve"
            },
            () => approveToken(tokenB.contract, DEX_ROUTER, approveAmtB) as Promise<SendResult>
          )) as SendResult;
          if (result?.accepted === false) throw new Error(result.message ?? "Rejected");
          toasts.update(id, { kind: "success", title: `${tokenB.symbol} approved` });
        } catch (e) {
          toasts.update(id, {
            kind: "error",
            title: "Approval failed",
            message: e instanceof Error ? e.message : String(e)
          });
          return;
        }
      }
      const id = toasts.push({
        kind: "pending",
        title: `Adding liquidity ${tokenA.symbol}/${tokenB.symbol}…`
      });
      try {
        const result = await track(
          {
            label: `Add ${tokenA.symbol}/${tokenB.symbol} liquidity`,
            contract: DEX_ROUTER,
            function: "addLiquidity"
          },
          () =>
            addLiquidity({
              tokenA: tokenA.contract,
              tokenB: tokenB.contract,
              amountADesired: a,
              amountBDesired: b,
              amountAMin: minAmounts.a,
              amountBMin: minAmounts.b,
              to: wallet.account!,
              deadline: deadlineFromNow(settings.deadlineMin)
            }) as Promise<SendResult>
        );
        if (result?.accepted === false) throw new Error(result.message ?? "Rejected");
        toasts.update(id, {
          kind: result?.finalized ? "success" : "info",
          title: result?.finalized ? "Liquidity added" : "Liquidity submitted",
          message: result?.message,
          txHash: result?.txHash
        });
        setAmountA("");
        setAmountB("");
        invalidatePairCache();
        setReload((k) => k + 1);
      } catch (e) {
        toasts.update(id, {
          kind: "error",
          title: "Add liquidity failed",
          message: e instanceof Error ? e.message : String(e)
        });
      }
    } finally {
      setBusy(false);
    }
  }

  // ── Remove Liquidity ─────────────────────────────────────────
  async function handleRemove() {
    if (!wallet.account || !pair || !tokenA || !tokenB) return;
    const lp = Number(removeAmount);
    if (!(lp > 0)) return;
    setBusy(true);
    try {
      if (lpAllowance < lp) {
        const id = toasts.push({ kind: "pending", title: "Approving LP tokens…" });
        try {
          const lpApproveAmt = settings.infiniteApproval ? INFINITE_APPROVAL_AMOUNT : lp * 1.05;
          const result = (await track(
            {
              label: `Approve LP #${pair.id}${settings.infiniteApproval ? " (∞)" : ""}`,
              contract: DEX_PAIRS,
              function: "liqApprove"
            },
            () => approveLp(pair.id, DEX_ROUTER, lpApproveAmt) as Promise<SendResult>
          )) as SendResult;
          if (result?.accepted === false) throw new Error(result.message ?? "Rejected");
          toasts.update(id, { kind: "success", title: "LP approved" });
        } catch (e) {
          toasts.update(id, {
            kind: "error",
            title: "LP approval failed",
            message: e instanceof Error ? e.message : String(e)
          });
          return;
        }
      }
      const slipFactor = 1 - settings.slippageBps / 10000;
      const share = pair.totalSupply > 0 ? lp / pair.totalSupply : 0;
      const minA = share * pair.reserve0 * slipFactor;
      const minB = share * pair.reserve1 * slipFactor;
      const tokenAisToken0 = pair.token0 === tokenA.contract;
      const id = toasts.push({
        kind: "pending",
        title: `Removing liquidity ${tokenA.symbol}/${tokenB.symbol}…`
      });
      try {
        const result = await track(
          {
            label: `Remove ${tokenA.symbol}/${tokenB.symbol} liquidity`,
            contract: DEX_ROUTER,
            function: "removeLiquidity"
          },
          () =>
            removeLiquidity({
              tokenA: tokenA.contract,
              tokenB: tokenB.contract,
              liquidity: lp,
              amountAMin: tokenAisToken0 ? minA : minB,
              amountBMin: tokenAisToken0 ? minB : minA,
              to: wallet.account!,
              deadline: deadlineFromNow(settings.deadlineMin)
            }) as Promise<SendResult>
        );
        if (result?.accepted === false) throw new Error(result.message ?? "Rejected");
        toasts.update(id, {
          kind: result?.finalized ? "success" : "info",
          title: result?.finalized ? "Liquidity removed" : "Removal submitted",
          message: result?.message,
          txHash: result?.txHash
        });
        setRemoveAmount("");
        invalidatePairCache();
        setReload((k) => k + 1);
      } catch (e) {
        toasts.update(id, {
          kind: "error",
          title: "Remove failed",
          message: e instanceof Error ? e.message : String(e)
        });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-narrow">
      <div className="card">
        <div className="card-header">
          <h2>Liquidity</h2>
          <div className="tab-row">
            <button
              className={"tab " + (mode === "add" ? "tab-active" : "")}
              onClick={() => setMode("add")}
            >
              <Plus size={12} /> Add
            </button>
            <button
              className={"tab " + (mode === "remove" ? "tab-active" : "")}
              onClick={() => setMode("remove")}
            >
              <Minus size={12} /> Remove
            </button>
          </div>
        </div>

        {mode === "add" ? (
          <>
            <div className="swap-panel">
              <div className="swap-panel-top">
                <span className="muted small">Token A</span>
                {wallet.account && tokenA && (
                  <span className="muted small">
                    Balance: <strong>{formatNumber(balanceA)}</strong>{" "}
                    <button className="link" onClick={() => setAmountA(String(balanceA))}>Max</button>
                  </span>
                )}
              </div>
              <div className="swap-panel-body">
                <input
                  className="swap-amount"
                  type="text"
                  inputMode="decimal"
                  placeholder="0.0"
                  value={amountA}
                  onChange={(e) => setAmountA(e.target.value.replace(/[^\d.]/g, ""))}
                />
                <button className="token-pick" onClick={() => setPickA(true)}>
                  {tokenA ? (
                    <>
                      <TokenIcon token={tokenA} size={24} />
                      <span>{tokenA.symbol}</span>
                    </>
                  ) : (
                    <span>Select</span>
                  )}
                  <ChevronDown size={14} />
                </button>
              </div>
            </div>

            <div className="flip-wrap"><div className="plus-mark">+</div></div>

            <div className="swap-panel">
              <div className="swap-panel-top">
                <span className="muted small">Token B</span>
                {wallet.account && tokenB && (
                  <span className="muted small">
                    Balance: <strong>{formatNumber(balanceB)}</strong>
                  </span>
                )}
              </div>
              <div className="swap-panel-body">
                <input
                  className="swap-amount"
                  type="text"
                  inputMode="decimal"
                  placeholder="0.0"
                  value={amountB}
                  readOnly={!!pair}
                  onChange={(e) => setAmountB(e.target.value.replace(/[^\d.]/g, ""))}
                />
                <button className="token-pick" onClick={() => setPickB(true)}>
                  {tokenB ? (
                    <>
                      <TokenIcon token={tokenB} size={24} />
                      <span>{tokenB.symbol}</span>
                    </>
                  ) : (
                    <span>Select</span>
                  )}
                  <ChevronDown size={14} />
                </button>
              </div>
            </div>

            {tokenA && tokenB && !pair && (() => {
              const a = Number(amountA);
              const b = Number(amountB);
              const havePrice = a > 0 && b > 0;
              return (
                <div className="quote-summary">
                  <div className="info-row warning small">
                    <Info size={12} />
                    <div>
                      <strong>You're creating a new pool.</strong> The ratio you
                      deposit becomes the initial price for everyone. If it's
                      off-market, arbitrage bots will rebalance you at a loss.
                    </div>
                  </div>
                  {havePrice && (
                    <>
                      <div className="quote-row">
                        <span className="muted">Initial price</span>
                        <span>
                          1 {tokenA.symbol} ={" "}
                          <strong>{formatNumber(b / a)}</strong> {tokenB.symbol}
                        </span>
                      </div>
                      <div className="quote-row">
                        <span className="muted"></span>
                        <span>
                          1 {tokenB.symbol} ={" "}
                          <strong>{formatNumber(a / b)}</strong> {tokenA.symbol}
                        </span>
                      </div>
                      <div className="quote-row">
                        <span className="muted">Initial pool share</span>
                        <strong>100% (you'll be the only LP)</strong>
                      </div>
                    </>
                  )}
                </div>
              );
            })()}
            {pair && tokenA && tokenB && (
              <div className="quote-summary">
                <div className="quote-row">
                  <span className="muted">Pool reserves</span>
                  <span>
                    {formatNumber(pair.reserve0)} {tokenA.contract === pair.token0 ? tokenA.symbol : tokenB.symbol}
                    {" / "}
                    {formatNumber(pair.reserve1)} {tokenA.contract === pair.token0 ? tokenB.symbol : tokenA.symbol}
                  </span>
                </div>
                <div className="quote-row">
                  <span className="muted">Your share after deposit (est.)</span>
                  <span>
                    {pair.totalSupply > 0
                      ? `≈ ${(
                          ((Number(amountA) || 0) /
                            (((tokenA.contract === pair.token0 ? pair.reserve0 : pair.reserve1) || 1) +
                              (Number(amountA) || 0))) *
                          100
                        ).toFixed(2)}%`
                      : "100%"}
                  </span>
                </div>
              </div>
            )}

            {!wallet.account ? (
              <button
                className="btn btn-primary btn-block"
                onClick={() => wallet.connect()}
                disabled={!wallet.available}
              >
                Connect Wallet
              </button>
            ) : !tokenA || !tokenB ? (
              <button className="btn btn-primary btn-block" disabled>
                Select two tokens
              </button>
            ) : tokenA.contract === tokenB.contract ? (
              <button className="btn btn-primary btn-block" disabled>
                Tokens must differ
              </button>
            ) : !(Number(amountA) > 0) || !(Number(amountB) > 0) ? (
              <button className="btn btn-primary btn-block" disabled>
                Enter amounts
              </button>
            ) : balanceA < Number(amountA) ? (
              <button className="btn btn-primary btn-block" disabled>
                Insufficient {tokenA.symbol}
              </button>
            ) : balanceB < Number(amountB) ? (
              <button className="btn btn-primary btn-block" disabled>
                Insufficient {tokenB.symbol}
              </button>
            ) : (
              <button className="btn btn-primary btn-block" onClick={handleAdd} disabled={busy}>
                {busy ? "Submitting…" : pair ? "Add Liquidity" : "Create Pool & Add"}
              </button>
            )}
          </>
        ) : (
          <>
            <div className="swap-panel">
              <div className="swap-panel-top">
                <span className="muted small">LP tokens to remove</span>
                {wallet.account && pair && (
                  <span className="muted small">
                    Balance: <strong>{formatNumber(lpBalance)}</strong>{" "}
                    {lpBalance > 0 && (
                      <button className="link" onClick={() => setRemoveAmount(String(lpBalance))}>
                        Max
                      </button>
                    )}
                  </span>
                )}
              </div>
              <div className="swap-panel-body">
                <input
                  className="swap-amount"
                  type="text"
                  inputMode="decimal"
                  placeholder="0.0"
                  value={removeAmount}
                  onChange={(e) => setRemoveAmount(e.target.value.replace(/[^\d.]/g, ""))}
                />
                <button className="token-pick" onClick={() => setPickA(true)}>
                  {tokenA ? (
                    <>
                      <TokenIcon token={tokenA} size={20} />
                      <span>/</span>
                      {tokenB && <TokenIcon token={tokenB} size={20} />}
                      <span>LP</span>
                    </>
                  ) : (
                    <span>Select pair</span>
                  )}
                  <ChevronDown size={14} />
                </button>
              </div>
              {wallet.account && pair && lpBalance > 0 && (
                <div className="slider-row">
                  {[25, 50, 75, 100].map((p) => (
                    <button
                      key={p}
                      className="chip"
                      onClick={() => setRemoveAmount(String((lpBalance * p) / 100))}
                    >
                      {p}%
                    </button>
                  ))}
                </div>
              )}
            </div>

            {pair && tokenA && tokenB && Number(removeAmount) > 0 && (
              <div className="quote-summary">
                {(() => {
                  const lp = Number(removeAmount);
                  const share = pair.totalSupply > 0 ? lp / pair.totalSupply : 0;
                  const out0 = share * pair.reserve0;
                  const out1 = share * pair.reserve1;
                  const sym0 = tokenA.contract === pair.token0 ? tokenA.symbol : tokenB.symbol;
                  const sym1 = tokenA.contract === pair.token0 ? tokenB.symbol : tokenA.symbol;
                  return (
                    <>
                      <div className="quote-row">
                        <span className="muted">You will receive (est.)</span>
                        <span>
                          {formatNumber(out0)} {sym0}
                        </span>
                      </div>
                      <div className="quote-row">
                        <span className="muted"></span>
                        <span>
                          {formatNumber(out1)} {sym1}
                        </span>
                      </div>
                      <div className="quote-row">
                        <span className="muted">Pool share removed</span>
                        <span>{(share * 100).toFixed(2)}%</span>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}

            {!wallet.account ? (
              <button
                className="btn btn-primary btn-block"
                onClick={() => wallet.connect()}
                disabled={!wallet.available}
              >
                Connect Wallet
              </button>
            ) : !pair ? (
              <Link to="/portfolio" className="btn btn-ghost btn-block">
                Pick a position from your portfolio
              </Link>
            ) : !(Number(removeAmount) > 0) ? (
              <button className="btn btn-primary btn-block" disabled>
                Enter LP amount
              </button>
            ) : Number(removeAmount) > lpBalance ? (
              <button className="btn btn-primary btn-block" disabled>
                Exceeds LP balance
              </button>
            ) : (
              <button className="btn btn-primary btn-block" onClick={handleRemove} disabled={busy}>
                {busy ? "Submitting…" : "Remove Liquidity"}
              </button>
            )}
          </>
        )}
      </div>

      <TokenSelectorModal
        open={pickA}
        onClose={() => setPickA(false)}
        onSelect={(t) => setTokenA(t)}
        exclude={tokenB?.contract}
        account={wallet.account}
      />
      <TokenSelectorModal
        open={pickB}
        onClose={() => setPickB(false)}
        onSelect={(t) => setTokenB(t)}
        exclude={tokenA?.contract}
        account={wallet.account}
      />
    </div>
  );
}
