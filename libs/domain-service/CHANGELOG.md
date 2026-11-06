# @ledgerhq/domain-service

## 1.10.0

### Minor Changes

- [#173](https://github.com/LedgerHQ/ts-libs/pull/173) [`b8d7a12`](https://github.com/LedgerHQ/ts-libs/commit/b8d7a1231d71a0f0b98bc768513ecb0d318ef3f1) Thanks [@thesan](https://github.com/thesan)! - Drop the @ledgerhq/source export condition, so consumers that enable it read the built declarations instead of compiling the sources

### Patch Changes

- Updated dependencies [[`c8d2d68`](https://github.com/LedgerHQ/ts-libs/commit/c8d2d682f5492433a14b3b7838e21ef0d890df4c), [`b8d7a12`](https://github.com/LedgerHQ/ts-libs/commit/b8d7a1231d71a0f0b98bc768513ecb0d318ef3f1)]:
  - @ledgerhq/logs@6.20.0

## 1.9.1

### Patch Changes

- [#118](https://github.com/LedgerHQ/ts-libs/pull/118) [`780fa8a`](https://github.com/LedgerHQ/ts-libs/commit/780fa8a6539909b9b98999a91093ac19635222d2) Thanks [@gre-ledger](https://github.com/gre-ledger)! - Bump axios to 1.20.0

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
