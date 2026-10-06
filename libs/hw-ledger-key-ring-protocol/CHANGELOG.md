# @ledgerhq/hw-ledger-key-ring-protocol

## 1.0.0

### Major Changes

- [#136](https://github.com/LedgerHQ/ts-libs/pull/136) [`34e071c`](https://github.com/LedgerHQ/ts-libs/commit/34e071cded156e78fa8994b58248656512e920e9) Thanks [@gre-ledger](https://github.com/gre-ledger)! - Upgrade @noble/curves, @noble/hashes and @noble/ciphers to v2 (ESM-only, `.js` subpath imports).
  
  Breaking: the CJS entry now `require`s ESM-only packages. Consumers need Node >= 20.19 / 22.12 (or a bundler), and their Jest configs must transform `@noble`:
  
  ```diff
  +  transform: { "^.+\\.(ts|tsx|js)$": ["@swc/jest", { jsc: { target: "es2022" } }] },
  +  transformIgnorePatterns: ["/node_modules/(?!(\\.pnpm/)?@noble)"],
  ```

### Patch Changes

- [#127](https://github.com/LedgerHQ/ts-libs/pull/127) [`640e199`](https://github.com/LedgerHQ/ts-libs/commit/640e19985efe86aaa2014145fdec930d6e7c2d72) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bump bip32 from 4.0.0 to 5.0.1

## 0.14.0

### Minor Changes

- [#119](https://github.com/LedgerHQ/ts-libs/pull/119) [`1117c90`](https://github.com/LedgerHQ/ts-libs/commit/1117c9041ac71dc61dc69f7b09e984f7f881b359) Thanks [@gre-ledger](https://github.com/gre-ledger)! - Move the packages from the ledger-live monorepo to ts-libs.
  
  `@ledgerhq/types-devices` is no longer a dependency of `@ledgerhq/ledger-key-ring-protocol` (it was unused in `src/`).
  
  The `exports` maps drop the `./*`, `./lib/*` and `./lib-es/*` wildcards and list each module explicitly. `@ledgerhq/hw-ledger-key-ring-protocol` exposes `./ApduDevice`, `./CommandBlock` and `./Crypto`; `@ledgerhq/ledger-key-ring-protocol` exposes `./api`, `./errors`, `./index`, `./qrcode/index`, `./store`, `./types`, `./utils` and `./__mocks__/challenge`. Any other deep import (including `lib/*` and `lib-es/*` paths) no longer resolves.

- [#119](https://github.com/LedgerHQ/ts-libs/pull/119) [`83c97b7`](https://github.com/LedgerHQ/ts-libs/commit/83c97b720eb8de3992b9df085b78abe10fd5d1e3) Thanks [@gre-ledger](https://github.com/gre-ledger)! - Use `@noble/ciphers` and `@noble/hashes` instead of Node's `crypto` and `create-hmac`, with golden vectors that pin the persisted byte format.
