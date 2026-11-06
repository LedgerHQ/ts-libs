# @ledgerhq/hw-transport-mocker

## 6.36.0

### Minor Changes

- [#173](https://github.com/LedgerHQ/ts-libs/pull/173) [`b8d7a12`](https://github.com/LedgerHQ/ts-libs/commit/b8d7a1231d71a0f0b98bc768513ecb0d318ef3f1) Thanks [@thesan](https://github.com/thesan)! - Drop the @ledgerhq/source export condition, so consumers that enable it read the built declarations instead of compiling the sources

### Patch Changes

- Updated dependencies [[`c8d2d68`](https://github.com/LedgerHQ/ts-libs/commit/c8d2d682f5492433a14b3b7838e21ef0d890df4c), [`b8d7a12`](https://github.com/LedgerHQ/ts-libs/commit/b8d7a1231d71a0f0b98bc768513ecb0d318ef3f1)]:
  - @ledgerhq/logs@6.20.0
  - @ledgerhq/hw-transport@6.37.0

## 6.35.1

### Patch Changes

- Updated dependencies []:
  - @ledgerhq/hw-transport@6.36.1

## 6.35.0

### Minor Changes

- [#76](https://github.com/LedgerHQ/ts-libs/pull/76) [`8f2c356`](https://github.com/LedgerHQ/ts-libs/commit/8f2c3564ddb5ffcf86de51781bcd4322223c90c1) Thanks [@gre-ledger](https://github.com/gre-ledger)! - Move the package from the ledger-live monorepo to ts-libs. Declares its `events` dependency explicitly instead of relying on `@ledgerhq/hw-transport` to hoist it.

### Patch Changes

- Updated dependencies [[`8f2c356`](https://github.com/LedgerHQ/ts-libs/commit/8f2c3564ddb5ffcf86de51781bcd4322223c90c1)]:
  - @ledgerhq/hw-transport@6.36.0
