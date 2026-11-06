# @ledgerhq/live-currency-format

## 0.17.0

### Minor Changes

- [#173](https://github.com/LedgerHQ/ts-libs/pull/173) [`b8d7a12`](https://github.com/LedgerHQ/ts-libs/commit/b8d7a1231d71a0f0b98bc768513ecb0d318ef3f1) Thanks [@thesan](https://github.com/thesan)! - Drop the @ledgerhq/source export condition, so consumers that enable it read the built declarations instead of compiling the sources

## 0.16.0

### Minor Changes

- [#98](https://github.com/LedgerHQ/ts-libs/pull/98) [`461d059`](https://github.com/LedgerHQ/ts-libs/commit/461d059638e47c2f73b7f9c214e42f330e67a0d1) Thanks [@gre-ledger](https://github.com/gre-ledger)! - Move the package from the ledger-live monorepo to ts-libs. No API change.
  
  The `exports` map now lists each module explicitly, in place of the previous `./*` wildcard.
