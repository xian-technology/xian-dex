# DEX

Multi-contract decentralized exchange package with pair management, router
logic, and convenience helpers.

## Status

`candidate`

## Contracts

- `src/con_pairs.py`: pair factory, reserve bookkeeping, and LP balance logic
- `src/con_dex.py`: router-style liquidity and swap entrypoints
- `src/con_dex_helper.py`: convenience helper around the router

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

## Validation

- repo-wide lint and compile checks
- package-local router integration tests
