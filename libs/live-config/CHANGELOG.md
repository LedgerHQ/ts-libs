# @ledgerhq/live-config

## 3.9.1

### Patch Changes

- [#162](https://github.com/LedgerHQ/ts-libs/pull/162) [`16133ef`](https://github.com/LedgerHQ/ts-libs/commit/16133efb647a773852f33beffc5b9b29a13cd795) Thanks [@gre-ledger](https://github.com/gre-ledger)! - Bump `lodash` to 4.18.1

## 3.9.0

### Minor Changes

- [#98](https://github.com/LedgerHQ/ts-libs/pull/98) [`461d059`](https://github.com/LedgerHQ/ts-libs/commit/461d059638e47c2f73b7f9c214e42f330e67a0d1) Thanks [@gre-ledger](https://github.com/gre-ledger)! - Move the package from the ledger-live monorepo to ts-libs. No API change.
  
  The `exports` map now lists `./LiveConfig`, `./providers`, `./providers/index`,
  `./providers/firebaseRemoteConfig`, `./providers/firebaseRemoteConfig/index`,
  `./providers/firebaseRemoteConfig/parser`, `./lib/*` and `./lib-es/*` explicitly, in place of
  the previous `./*` wildcard. Every sub-path the wildcard resolved to is still reachable.
