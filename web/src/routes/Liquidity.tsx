import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronDown, Plus, Minus, Info, Settings as SettingsIcon } from "lucide-react";
import { TokenIcon } from "../components/TokenIcon";
import { ConnectButton } from "../components/ConnectButton";
import { TokenSelectorModal } from "../components/TokenSelectorModal";
import { LpPositionSelectorModal } from "../components/LpPositionSelectorModal";
import { SettingsModal } from "../components/SettingsModal";
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
  getLpBalanceSnapshot,
  getLpTokenName,
  getPair,
  invalidatePairCache,
  removeLiquidity,
  type PairInfo
} from "../lib/dex";
import { getAllowance, getBalance, getTokenInfo, type TokenInfo } from "../lib/tokens";
import { DEX_PAIRS, DEX_ROUTER, INFINITE_APPROVAL_AMOUNT, NATIVE_TOKEN } from "../lib/constants";
import { fixedUnits, minimumAmountOutV2 } from "@xian-tech/dex";
import { displayRate, positiveAmount, proportionalAmount } from "../lib/amounts";
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
  const [pickPosition, setPickPosition] = useState(false);
  const [pair, setPair] = useState<PairInfo | null>(null);
  const [balanceA, setBalanceA] = useState("0");
  const [balanceB, setBalanceB] = useState("0");
  const [allowanceA, setAllowanceA] = useState("0");
  const [allowanceB, setAllowanceB] = useState("0");
  const [lpBalanceInput, setLpBalanceInput] = useState("0");
  const [lpAllowance, setLpAllowance] = useState("0");
  const [removeAmount, setRemoveAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);

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
      }
    })();
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Add mode starts with XIAN selected. Remove mode deliberately stays empty
  // until the user selects an owned LP position.
  useEffect(() => {
    if (mode !== "add" || tokenA) return;
    let cancel = false;
    getTokenInfo(NATIVE_TOKEN)
      .then((xian) => {
        if (!cancel) setTokenA(xian);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [mode, tokenA]);

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
        setBalanceA("0");
        setBalanceB("0");
        setAllowanceA("0");
        setAllowanceB("0");
        setLpBalanceInput("0");
        setLpAllowance("0");
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
          getLpBalanceSnapshot(pair.id, wallet.account).then((balance) => {
            if (cancel) return;
            setLpBalanceInput(balance.input);
          }),
          getLpAllowance(pair.id, wallet.account, DEX_ROUTER).then(
            (a) => !cancel && setLpAllowance(a)
          )
        );
      } else {
        setLpBalanceInput("0");
        setLpAllowance("0");
      }
      await Promise.all(tasks);
    })();
    return () => {
      cancel = true;
    };
  }, [wallet.account, tokenA, tokenB, pair, reload, rpcEpoch]);

  // A pair can exist with zero reserves (created, then fully drained). It
  // must then behave like a brand-new pool: amount B stays editable and the
  // depositor sets the initial price.
  const poolSeeded = !!pair && fixedUnits(pair.reserve0) > 0n && fixedUnits(pair.reserve1) > 0n;

  const a = positiveAmount(amountA, tokenA?.precision);
  const b = positiveAmount(amountB, tokenB?.precision);
  const lp = positiveAmount(removeAmount);

  useEffect(() => {
    if (mode !== "add" || !poolSeeded || !pair || !tokenA || !tokenB) return;
    const forward = pair.token0 === tokenA.contract;
    const reserveA = forward ? pair.reserve0 : pair.reserve1;
    const reserveB = forward ? pair.reserve1 : pair.reserve0;
    setAmountB(a ? proportionalAmount(a, reserveB, reserveA, tokenB.precision) ?? "" : "");
  }, [a, pair, poolSeeded, tokenA, tokenB, mode]);

  const out0 = pair && lp ? proportionalAmount(lp, pair.reserve0, pair.totalSupply, pair.precision0) : null;
  const out1 = pair && lp ? proportionalAmount(lp, pair.reserve1, pair.totalSupply, pair.precision1) : null;

  // ── Add Liquidity ────────────────────────────────────────────
  async function handleAdd() {
    if (!wallet.account || !tokenA || !tokenB) return;
    if (!a || !b) return;
    setBusy(true);
    try {
      const approveAmtA = settings.infiniteApproval ? INFINITE_APPROVAL_AMOUNT : a;
      const approveAmtB = settings.infiniteApproval ? INFINITE_APPROVAL_AMOUNT : b;
      if (fixedUnits(allowanceA) < fixedUnits(a)) {
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
      if (fixedUnits(allowanceB) < fixedUnits(b)) {
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
              amountAMin: minimumAmountOutV2(a, settings.slippageBps, tokenA.precision ?? 30),
              amountBMin: minimumAmountOutV2(b, settings.slippageBps, tokenB.precision ?? 30),
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
    if (!lp || !out0 || !out1) return;
    setBusy(true);
    try {
      if (fixedUnits(lpAllowance) < fixedUnits(lp)) {
        const id = toasts.push({ kind: "pending", title: "Approving LP tokens…" });
        try {
          const lpApproveAmt = settings.infiniteApproval ? INFINITE_APPROVAL_AMOUNT : lp;
          const lpTokenContract = (await getLpTokenName(pair.id)) ?? DEX_PAIRS;
          const result = (await track(
            {
              label: `Approve LP #${pair.id}${settings.infiniteApproval ? " (∞)" : ""}`,
              contract: lpTokenContract,
              function: "approve"
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
      const minA = minimumAmountOutV2(out0, settings.slippageBps, pair.precision0 ?? 30);
      const minB = minimumAmountOutV2(out1, settings.slippageBps, pair.precision1 ?? 30);
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
          <div className="card-actions">
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
            <button
              className="icon-btn"
              title="Settings"
              aria-label="Settings"
              onClick={() => setSettingsOpen(true)}
            >
              <SettingsIcon size={14} />
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
                    <button className="link" onClick={() => setAmountA(balanceA)}>Max</button>
                  </span>
                )}
              </div>
              <div className="swap-panel-body">
                <input
                  className="swap-amount"
                  type="text"
                  inputMode="decimal"
                  placeholder="0.0"
                  aria-label="Token A amount"
                  value={amountA}
                  onChange={(e) => setAmountA(e.target.value)}
                />
                <button className="token-pick" onClick={() => setPickA(true)}>
                  {tokenA ? (
                    <>
                      <TokenIcon token={tokenA} size={24} />
                      <span>{tokenA.symbol}</span>
                    </>
                  ) : (
                    <>
                      <TokenIcon token={null} size={24} />
                      <span>Select</span>
                    </>
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
                  aria-label="Token B amount"
                  value={amountB}
                  readOnly={poolSeeded}
                  onChange={(e) => setAmountB(e.target.value)}
                />
                <button className="token-pick" onClick={() => setPickB(true)}>
                  {tokenB ? (
                    <>
                      <TokenIcon token={tokenB} size={24} />
                      <span>{tokenB.symbol}</span>
                    </>
                  ) : (
                    <>
                      <TokenIcon token={null} size={24} />
                      <span>Select</span>
                    </>
                  )}
                  <ChevronDown size={14} />
                </button>
              </div>
            </div>

            {tokenA && tokenB && !poolSeeded && (() => {
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
                  {a && b && (
                    <>
                      <div className="quote-row">
                        <span className="muted">Initial price</span>
                        <span>
                          1 {tokenA.symbol} ={" "}
                          <strong>{displayRate(b, a)}</strong> {tokenB.symbol}
                        </span>
                      </div>
                      <div className="quote-row">
                        <span className="muted"></span>
                        <span>
                          1 {tokenB.symbol} ={" "}
                          <strong>{displayRate(a, b)}</strong> {tokenA.symbol}
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
            {poolSeeded && pair && tokenA && tokenB && (
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
                    {fixedUnits(pair.totalSupply) > 0n
                      ? `≈ ${(
                          ((Number(amountA) || 0) /
                            ((Number(tokenA.contract === pair.token0 ? pair.reserve0 : pair.reserve1) || 1) +
                              (Number(amountA) || 0))) *
                          100
                        ).toFixed(2)}%`
                      : "100%"}
                  </span>
                </div>
              </div>
            )}

            {!wallet.account ? (
              <ConnectButton block />
            ) : !tokenA || !tokenB ? (
              <button className="btn btn-primary btn-block" disabled>
                Select two tokens
              </button>
            ) : tokenA.contract === tokenB.contract ? (
              <button className="btn btn-primary btn-block" disabled>
                Tokens must differ
              </button>
            ) : !a || !b ? (
              <button className="btn btn-primary btn-block" disabled>
                Enter amounts
              </button>
            ) : fixedUnits(balanceA) < fixedUnits(a) ? (
              <button className="btn btn-primary btn-block" disabled>
                Insufficient {tokenA.symbol}
              </button>
            ) : fixedUnits(balanceB) < fixedUnits(b) ? (
              <button className="btn btn-primary btn-block" disabled>
                Insufficient {tokenB.symbol}
              </button>
            ) : (
              <button className="btn btn-primary btn-block" onClick={handleAdd} disabled={busy}>
                {busy ? "Submitting…" : poolSeeded ? "Add Liquidity" : "Create Pool & Add"}
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
                    Balance: <strong>{lpBalanceInput}</strong>{" "}
                    {fixedUnits(lpBalanceInput) > 0n && (
                      <button className="link" onClick={() => setRemoveAmount(lpBalanceInput)}>
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
                  aria-label="LP tokens to remove"
                  value={removeAmount}
                  onChange={(e) => setRemoveAmount(e.target.value)}
                />
                <button className="token-pick" onClick={() => setPickPosition(true)}>
                  {pair && tokenA && tokenB ? (
                    <>
                      <TokenIcon token={tokenA} size={24} />
                      <TokenIcon token={tokenB} size={24} />
                      <span>{tokenA.symbol}/{tokenB.symbol} LP</span>
                    </>
                  ) : (
                    <>
                      <TokenIcon token={null} size={24} />
                      <span>Select pair</span>
                    </>
                  )}
                  <ChevronDown size={14} />
                </button>
              </div>
              {wallet.account && pair && fixedUnits(lpBalanceInput) > 0n && (
                <div className="slider-row">
                  {[25, 50, 75, 100].map((p) => (
                    <button
                      key={p}
                      className="chip"
                      onClick={() => setRemoveAmount(
                        minimumAmountOutV2(lpBalanceInput, (100 - p) * 100)
                      )}
                    >
                      {p}%
                    </button>
                  ))}
                </div>
              )}
            </div>

            {pair && tokenA && tokenB && lp && out0 && out1 && (
              <div className="quote-summary">
                {(() => {
                  const share = Number(lp) / Number(pair.totalSupply);
                  const sym0 = tokenA.contract === pair.token0 ? tokenA.symbol : tokenB.symbol;
                  const sym1 = tokenA.contract === pair.token0 ? tokenB.symbol : tokenA.symbol;
                  return (
                    <>
                      <div className="quote-row">
                        <span className="muted">You will receive (est.)</span>
                        <span>
                          {out0} {sym0}
                        </span>
                      </div>
                      <div className="quote-row">
                        <span className="muted"></span>
                        <span>
                          {out1} {sym1}
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
              <ConnectButton block />
            ) : !pair ? (
              <button className="btn btn-ghost btn-block" onClick={() => setPickPosition(true)}>
                Select an LP position
              </button>
            ) : !lp || !out0 || !out1 || out0 === "0" || out1 === "0" ? (
              <button className="btn btn-primary btn-block" disabled>
                Enter LP amount
              </button>
            ) : fixedUnits(lp) > fixedUnits(lpBalanceInput) ? (
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
        open={pickA && mode === "add"}
        onClose={() => setPickA(false)}
        onSelect={(t) => setTokenA(t)}
        exclude={tokenB?.contract}
        account={wallet.account}
      />
      <TokenSelectorModal
        open={pickB && mode === "add"}
        onClose={() => setPickB(false)}
        onSelect={(t) => setTokenB(t)}
        exclude={tokenA?.contract}
        account={wallet.account}
      />
      <LpPositionSelectorModal
        open={pickPosition && mode === "remove"}
        account={wallet.account}
        onClose={() => setPickPosition(false)}
        onSelect={(position) => {
          setTokenA(position.token0);
          setTokenB(position.token1);
          setPair(position.pair);
          setLpBalanceInput(position.balanceInput);
          setRemoveAmount("");
        }}
      />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
