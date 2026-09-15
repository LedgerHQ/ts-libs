# @ledgerhq/live-env

## 4.1.0

### Minor Changes

- [#98](https://github.com/LedgerHQ/ts-libs/pull/98) [`461d059`](https://github.com/LedgerHQ/ts-libs/commit/461d059638e47c2f73b7f9c214e42f330e67a0d1) Thanks [@gre-ledger](https://github.com/gre-ledger)! - Move the package from the ledger-live monorepo to ts-libs. No API change; the package stays
  DEPRECATED and is still being sunset — see MIGRATION.md.
  
  The `exports` map now lists `.`, `./index`, `./env`, `./state`, `./lib/*` and `./lib-es/*`
  explicitly, in place of the previous `./*` wildcard.
