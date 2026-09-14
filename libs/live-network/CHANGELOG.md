# @ledgerhq/live-network

## 3.1.0

### Minor Changes

- [#76](https://github.com/LedgerHQ/ts-libs/pull/76) [`8f2c356`](https://github.com/LedgerHQ/ts-libs/commit/8f2c3564ddb5ffcf86de51781bcd4322223c90c1) Thanks [@gre-ledger](https://github.com/gre-ledger)! - Move the package from the ledger-live monorepo to ts-libs, and mark the package as DEPRECATED: use RTK Query inside Ledger Live, or plain fetch/axios elsewhere. It was extracted to unblock the migration of its dependents, not because it is the recommended path.

### Patch Changes

- [#79](https://github.com/LedgerHQ/ts-libs/pull/79) [`b57c702`](https://github.com/LedgerHQ/ts-libs/commit/b57c7023c640b235d38cc1c0f3204a95222c8c41) Thanks [@gre-ledger](https://github.com/gre-ledger)! - Restore the `./batcher/index`, `./lib/*` and `./lib-es/*` sub-path exports.
  
  Narrowing the `exports` map when the library was imported from `ledger-live` dropped
  sub-paths that already-published `@ledgerhq/coin-evm`, `coin-tezos`, `coin-xrp` and
  `ledger-cal-service` import. Those tarballs are immutable, so the alias has to live
  here until they are republished.
- Updated dependencies [[`8f2c356`](https://github.com/LedgerHQ/ts-libs/commit/8f2c3564ddb5ffcf86de51781bcd4322223c90c1)]:
  - @ledgerhq/live-promise@0.4.0
