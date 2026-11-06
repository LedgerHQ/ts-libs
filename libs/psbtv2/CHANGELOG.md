# @ledgerhq/psbtv2

## 0.7.0

### Minor Changes

- [#173](https://github.com/LedgerHQ/ts-libs/pull/173) [`b8d7a12`](https://github.com/LedgerHQ/ts-libs/commit/b8d7a1231d71a0f0b98bc768513ecb0d318ef3f1) Thanks [@thesan](https://github.com/thesan)! - Drop the @ledgerhq/source export condition, so consumers that enable it read the built declarations instead of compiling the sources

- [#174](https://github.com/LedgerHQ/ts-libs/pull/174) [`a9d2d28`](https://github.com/LedgerHQ/ts-libs/commit/a9d2d2826c5dff10c1df79ac73baa857e7a8f6b9) Thanks [@may01](https://github.com/may01)! - Keep proprietary (0xFC) output key-values when converting a PSBTv0 with `PsbtV2.fromV0`

## 0.6.2

### Patch Changes

- [#160](https://github.com/LedgerHQ/ts-libs/pull/160) [`fb8352d`](https://github.com/LedgerHQ/ts-libs/commit/fb8352dff5e113a927c71003c04261d56098bf92) Thanks [@gre-ledger](https://github.com/gre-ledger)! - Bump `bitcoinjs-lib` to ^7.0.4 (PSBT input value and fee cache security fixes)

## 0.6.1

### Patch Changes

- [#138](https://github.com/LedgerHQ/ts-libs/pull/138) [`cf35422`](https://github.com/LedgerHQ/ts-libs/commit/cf35422e59b1076004f504286b244f44dc535d15) Thanks [@gre-ledger](https://github.com/gre-ledger)! - Bump `bitcoinjs-lib` to v7 and `varuint-bitcoin` to v2 (Uint8Array-based); public API and types are unchanged

## 0.6.0

### Minor Changes

- [#76](https://github.com/LedgerHQ/ts-libs/pull/76) [`8f2c356`](https://github.com/LedgerHQ/ts-libs/commit/8f2c3564ddb5ffcf86de51781bcd4322223c90c1) Thanks [@gre-ledger](https://github.com/gre-ledger)! - Move the package from the ledger-live monorepo to ts-libs. No API change.
