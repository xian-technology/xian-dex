# DEX

Multi-contract decentralized exchange package with pair management, router
logic, and convenience helpers.

## Status

`candidate`

## Contracts

- `src/con_pairs.py`: pair factory, reserve bookkeeping, and LP balance logic
- `src/con_dex.py`: router-style liquidity and swap entrypoints
- `src/con_dex_helper.py`: convenience helper around the router for single-pair
  buy/sell flows

## Notes

- This package is tightly coupled internally and should be reviewed as one
  system.
- The contracts use an older code style and deserve deeper hardening before
  being treated as a polished production drop-in.
- `con_dex_helper.py` is wired to the package router name `con_dex`.
- Router liquidity paths now return and enforce actual received amounts, which
  matters for fee-on-transfer tokens.
- Pair balance crediting is router-driven; unsolicited token transfers into
  `con_pairs` are not automatically attributed to any pair.
- Package-local tests now cover protocol-fee minting, multi-hop routing, and
  router-mediated LP allowance flows.
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
- The helper contract now requires an explicit absolute `deadline`. The older
  relative `deadline_min` pattern was not a real pre-inclusion expiry guard,
  because it was computed from on-chain `now` at execution time.
- Helper quoting is fee-tier aware, so zero-fee market-maker signers no longer
  overpay when using the helper path.

## Validation

- repo-wide lint and compile checks
- package-local router integration tests
