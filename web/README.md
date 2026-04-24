# SnakX — Xian DEX Web

A modern, dark-first web frontend for the `con_dex` / `con_pairs` AMM
contracts in this package. Mirrors the conventions of the rest of the Xian
ecosystem (`@xian-tech/client`, the injected `window.xian.provider` wallet,
Vite + React 19 + TypeScript, no Tailwind).

## Stack

- **Vite 8** + **React 19** + **TypeScript** strict mode
- **`@xian-tech/client`** for ABCI reads, simulation, token metadata, and
  balances
- **`@xian-tech/provider`** types — wallet writes go through the injected
  `window.xian.provider` (`xian_sendCall`, `xian_requestAccounts`, etc.)
- **react-router-dom 7** for routing
- **lucide-react** icons
- Pure CSS (custom design tokens, glass cards, gradient accents)

## Pages

| Route | Purpose |
| --- | --- |
| `/swap` | Quote and execute swaps. Auto-detects fee-on-transfer source tokens and routes through the supporting path. Live price impact, slippage, deadline, and approval handling. |
| `/pools` | Searchable, sortable list of every pair (`con_pairs.pairs_num`). Per-pair card with reserves and mid-prices. |
| `/pools/:id` | Pair detail: reserves, prices, k = x·y, your LP balance and pool share, underlying token amounts. |
| `/liquidity` | Add/remove liquidity. Auto-derives the optimal second amount for existing pairs, supports new-pair creation, and handles router approvals + LP-token approvals (`con_pairs.liqApprove`) for removal. |
| `/portfolio` | All token balances (via `XianClient.getTokenBalances`) plus every LP position and your share of each pool. |

## Wallet integration

Reads use a shared `XianClient` (RPC URL configurable in the Settings modal,
persisted in `localStorage`). Writes are delegated to the browser wallet via
`window.xian.provider.request({ method: "xian_sendCall", ... })`. The wallet
signs and broadcasts; the dapp never holds keys.

The header detects whether the wallet is injected and shows a "No wallet"
chip if it is missing. Account / chain change events are observed.

## Local development

```bash
npm install
npm run dev    # http://localhost:5173
npm run build  # tsc -b && vite build → dist/
```

The default RPC is `https://node.xian.org`. Override it from the Settings
modal in the UI (the value is saved per-browser).

## Layout

```
src/
  App.tsx, main.tsx
  routes/
    Swap.tsx
    Pools.tsx
    PairDetail.tsx
    Liquidity.tsx
    Portfolio.tsx
  components/
    Header.tsx
    SettingsModal.tsx
    TokenSelectorModal.tsx
    TokenIcon.tsx
    Toasts.tsx
  hooks/
    useWallet.ts        # window.xian.provider lifecycle
    useSettings.ts      # slippage / deadline / persistence
    useToasts.tsx       # tx status + error notifications
  lib/
    xian.ts             # XianClient factory + RPC config
    wallet.ts           # injected provider helpers (sendCall, etc.)
    dex.ts              # contract reads/writes (pairs, quotes, swap, LP)
    tokens.ts           # token metadata + custom token registry
    constants.ts        # contract names, defaults, storage keys
    format.ts           # number / address / percent formatting
  styles/
    app.css             # design tokens + every component style
```

## Notes on the contracts

- `con_dex` is the router; `con_pairs` is the factory + pair store +
  LP-token ledger. The frontend uses both directly.
- `removeLiquidity` requires the user to first call
  `con_pairs.liqApprove(pair, amount, to="con_dex")` so the router can pull
  LP from them. The Liquidity page handles this automatically before the
  remove call.
- Trade fee is 30 bps by default; signers flagged via
  `set_zero_fee_trader` get 0%. The Swap page calls `getTradeFeeBps` and
  shows a "0% fee" badge when applicable.
- `fee_on_transfer_tokens[token]` is checked for the source token; when
  set, the swap routes through
  `swapExactTokensForTokensSupportingFeeOnTransferTokens`.

## Status

`candidate` — full feature set:

- Multi-hop swap routing (DFS up to `MAX_HOPS`, scored by output) with a
  pair-cache and the route visualised in the quote panel.
- Auto-selection between the plain and `SupportingFeeOnTransferTokens`
  router entrypoints based on whether src or dest tokens are flagged.
  Trades are blocked when an intermediate token is fee-on-transfer (the
  contract rejects them in either route).
- Add / remove liquidity with auto-derived second amount, new-pool
  creation, router approvals, and `con_pairs.liqApprove` for LP removal.
- Portfolio with token balances and every LP position.
- In-memory price sparkline on the pair detail page (polls reserves every
  12s, ring buffer of 90 samples, invertible).
- Persistent transaction history drawer (last 50 actions) with status,
  contract.function, age, copy-able tx hash.

Possible future work: cross-tab tx-status sync via storage events,
per-pair volume/APR derived from `Swap` events, and a notification when a
queued tx confirms while the user navigates elsewhere.
