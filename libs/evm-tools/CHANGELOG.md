# @ledgerhq/evm-tools

## 2.0.0

### Major Changes

- [#137](https://github.com/LedgerHQ/ts-libs/pull/137) [`b965e6f`](https://github.com/LedgerHQ/ts-libs/commit/b965e6fa45bfebd87074aec5703effe26e6a46bb) Thanks [@gre-ledger](https://github.com/gre-ledger)! - Replace deprecated `crypto-js` with `@noble/hashes` v2 for the EIP712 schema hash (output unchanged).
  
  Breaking: the CJS entry now `require`s the ESM-only `@noble/hashes`. Consumers need Node >= 20.19 / 22.12 (or a bundler), and their Jest configs must transform `@noble` (`transformIgnorePatterns: ["/node_modules/(?!(\\.pnpm/)?@noble)"]` plus a `.js` transform).

## 1.15.1

### Patch Changes

- [#118](https://github.com/LedgerHQ/ts-libs/pull/118) [`780fa8a`](https://github.com/LedgerHQ/ts-libs/commit/780fa8a6539909b9b98999a91093ac19635222d2) Thanks [@gre-ledger](https://github.com/gre-ledger)! - Bump axios to 1.20.0

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
