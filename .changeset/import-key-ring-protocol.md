---
"@ledgerhq/hw-ledger-key-ring-protocol": minor
"@ledgerhq/ledger-key-ring-protocol": minor
---

Move the packages from the ledger-live monorepo to ts-libs.

`@ledgerhq/types-devices` is no longer a dependency of `@ledgerhq/ledger-key-ring-protocol` (it was unused in `src/`).

The `exports` maps drop the `./*`, `./lib/*` and `./lib-es/*` wildcards and list each module explicitly. `@ledgerhq/hw-ledger-key-ring-protocol` exposes `./ApduDevice`, `./CommandBlock` and `./Crypto`; `@ledgerhq/ledger-key-ring-protocol` exposes `./api`, `./errors`, `./index`, `./qrcode/index`, `./store`, `./types`, `./utils` and `./__mocks__/challenge`. Any other deep import (including `lib/*` and `lib-es/*` paths) no longer resolves.
