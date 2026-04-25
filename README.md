# xian-dex

`xian-dex` owns the Xian DEX product surface:

- the canonical AMM contracts under `src/`
- contract tests under `tests/`
- the SnakX web frontend under `web/`
- localnet/bootstrap consumers that deploy `con_pairs`, `con_dex`,
  `con_dex_helper`, and LP token contracts

## Status

`candidate`

The contracts are usable and covered by package-local tests, but still deserve
deeper hardening before being treated as a polished production drop-in.

## Quick Start

```bash
uv sync --group dev
uv run python scripts/validate_contracts.py
uv run pytest
```

The Python workspace expects sibling `xian-contracting` and `xian-linter`
checkouts, matching the rest of the Xian repo set.

```bash
cd web
npm install
npm run dev
npm run build
```

## Contracts

- `src/con_pairs.py`: pair factory, reserve bookkeeping, and LP balance logic
- `src/con_dex.py`: router-style liquidity and swap entrypoints
- `src/con_dex_helper.py`: convenience helper around the router for single-pair
  buy/sell flows
- `src/con_lp_token.py`: XSC001-compatible LP token template for pairs that
  should mint transferable LP tokens

## Web Frontend

The SnakX frontend is a Vite + React app in `web/`. It talks to the canonical
contract names (`con_pairs`, `con_dex`, and `con_dex_helper`) through
`@xian-tech/client` reads and the injected browser wallet provider for writes.

See [web/README.md](web/README.md) for route-level and wallet integration
details.

## Notes

- This package is tightly coupled internally and should be reviewed as one
  system.
- `con_dex_helper.py` is wired to the package router name `con_dex`.
- Router liquidity paths now return and enforce actual received amounts, which
  matters for fee-on-transfer tokens.
- Pair balance crediting is router-driven; unsolicited token transfers into
  `con_pairs` are not automatically attributed to any pair.
- Package-local tests now cover protocol-fee minting, multi-hop routing, and
  standard LP token allowance flows.
- Every pair has a bound XSC001 LP token contract. Create pairs with
  `createPair(tokenA, tokenB, lpToken=...)`, or pass `lpToken=...` to
  `addLiquidity` when the router needs to auto-create the pair. The pair
  contract mints/burns that LP token directly; users transfer it with
  `transfer` and approve removals with `approve(amount, to="con_dex")`.
- Multi-hop fee-on-transfer support is intentionally limited: the router can
  handle fee-on-transfer ingress and final output, but known fee-on-transfer
  bridge tokens must be flagged with `set_fee_on_transfer_token(...)` and are
  then rejected in supporting multi-hop routes.
- Fee-on-transfer token flags are router-owner controlled.
- Router-owner controlled zero-fee signer accounts can be enabled with
  `set_zero_fee_trader(...)` for market makers or other approved flow.
- Zero-fee routing is signer-based and only applies through the router. Direct
  pair swaps remain on the standard 30 bps fee path.
- Plain swap routes reject flagged fee-on-transfer tokens and require the
  supporting-fee router path instead.
- Tokens that expose `get_metadata().precision` now route through the DEX with
  precision-aware amount normalization. That covers integer-precision public
  balances such as `shielded-note-token`.
- The helper contract now requires an explicit absolute `deadline`. The older
  relative `deadline_min` pattern was not a real pre-inclusion expiry guard,
  because it was computed from on-chain `now` at execution time.
- Helper quoting is fee-tier aware, so zero-fee market-maker signers no longer
  overpay when using the helper path.

## Validation

- contract lint and compile checks via `scripts/validate_contracts.py`
- package-local router integration tests
- frontend TypeScript build via `npm run build`

Some optional integration assertions use contracts that still live in the
sibling `xian-contracts` checkout. Set `XIAN_CONTRACTS_ROOT` when that checkout
is not at `../xian-contracts/contracts`.
