# @ledgerhq/domain-service

## 1.9.0

### Minor Changes

- [#98](https://github.com/LedgerHQ/ts-libs/pull/98) [`461d059`](https://github.com/LedgerHQ/ts-libs/commit/461d059638e47c2f73b7f9c214e42f330e67a0d1) Thanks [@gre-ledger](https://github.com/gre-ledger)! - Move the package from the ledger-live monorepo to ts-libs.
  
  `@ledgerhq/types-live` is no longer a dependency. `SupportedRegistries` and
  `DomainServiceResolution` are now defined in `@ledgerhq/domain-service/types`, which already
  re-exported them — the public surface is unchanged, and the types are structurally identical to the
  `types-live` ones.
  
  `react` moves from `dependencies` to `peerDependencies` (`^18.0.0 || ^19.0.0`) so consumers no
  longer risk a second copy of React, and the unused `react-dom` dependency is dropped. Consumers
  that already render these hooks satisfy the peer; anything relying on `@ledgerhq/domain-service`
  to supply React must now depend on it directly.
  
  The `exports` map now lists each module explicitly, in place of the previous `./*` wildcard.
