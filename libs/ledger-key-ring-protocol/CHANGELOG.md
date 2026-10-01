# @ledgerhq/ledger-key-ring-protocol

## 0.24.0

### Minor Changes

- [#119](https://github.com/LedgerHQ/ts-libs/pull/119) [`1117c90`](https://github.com/LedgerHQ/ts-libs/commit/1117c9041ac71dc61dc69f7b09e984f7f881b359) Thanks [@gre-ledger](https://github.com/gre-ledger)! - Move the packages from the ledger-live monorepo to ts-libs.
  
  `@ledgerhq/types-devices` is no longer a dependency of `@ledgerhq/ledger-key-ring-protocol` (it was unused in `src/`).
  
  The `exports` maps drop the `./*`, `./lib/*` and `./lib-es/*` wildcards and list each module explicitly. `@ledgerhq/hw-ledger-key-ring-protocol` exposes `./ApduDevice`, `./CommandBlock` and `./Crypto`; `@ledgerhq/ledger-key-ring-protocol` exposes `./api`, `./errors`, `./index`, `./qrcode/index`, `./store`, `./types`, `./utils` and `./__mocks__/challenge`. Any other deep import (including `lib/*` and `lib-es/*` paths) no longer resolves.

### Patch Changes

- Updated dependencies [[`780fa8a`](https://github.com/LedgerHQ/ts-libs/commit/780fa8a6539909b9b98999a91093ac19635222d2), [`1117c90`](https://github.com/LedgerHQ/ts-libs/commit/1117c9041ac71dc61dc69f7b09e984f7f881b359), [`83c97b7`](https://github.com/LedgerHQ/ts-libs/commit/83c97b720eb8de3992b9df085b78abe10fd5d1e3)]:
  - @ledgerhq/live-network@3.2.0
  - @ledgerhq/hw-ledger-key-ring-protocol@0.14.0
