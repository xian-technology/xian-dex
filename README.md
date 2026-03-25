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
- Package-local automated tests are still missing.

## Validation

- repo-wide lint and compile checks
- no package-local automated tests yet
