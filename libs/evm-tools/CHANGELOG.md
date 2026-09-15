# @ledgerhq/evm-tools

## 1.15.0

### Minor Changes

- [#98](https://github.com/LedgerHQ/ts-libs/pull/98) [`461d059`](https://github.com/LedgerHQ/ts-libs/commit/461d059638e47c2f73b7f9c214e42f330e67a0d1) Thanks [@gre-ledger](https://github.com/gre-ledger)! - Move the package from the ledger-live monorepo to ts-libs.
  
  `@ledgerhq/types-live` is no longer a dependency. The EIP-712 message types it provided
  (`EIP712Message`, `EIP712MessageDomain`, `EIP712MessageTypes`, `EIP712MessageTypesEntry`) are now
  defined in `@ledgerhq/evm-tools/message/EIP712/types`, where they belong — this library is what
  gives them meaning. They are structurally identical, so code still holding the `types-live`
  versions keeps typechecking against them.
  
  Adds the missing `.` root export — `main` previously pointed at a non-existent `./index.ts`, so
  `import "@ledgerhq/evm-tools"` did not resolve.
  
  The `exports` map now lists each module explicitly, in place of the previous `./*` wildcard.

### Patch Changes

- Updated dependencies [[`461d059`](https://github.com/LedgerHQ/ts-libs/commit/461d059638e47c2f73b7f9c214e42f330e67a0d1)]:
  - @ledgerhq/live-env@4.1.0
