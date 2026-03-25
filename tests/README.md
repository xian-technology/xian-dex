# Tests

This package has package-local integration coverage for the router and pair
contracts.

Current coverage:

- pair creation and reserve setup
- liquidity add/remove against a fee-on-transfer token
- caller-order amount returns
- minimum amount checks on actual received amounts
- single-path fee-on-transfer swap return values

Still worth adding:

- multi-hop routing
- LP token transfer/approval edge cases
- protocol fee (`feeTo`) behavior
