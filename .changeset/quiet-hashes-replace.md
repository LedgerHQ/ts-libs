---
"@ledgerhq/evm-tools": major
---

Replace deprecated `crypto-js` with `@noble/hashes` v2 for the EIP712 schema hash (output unchanged).

Breaking: the CJS entry now `require`s the ESM-only `@noble/hashes`. Consumers need Node >= 20.19 / 22.12 (or a bundler), and their Jest configs must transform `@noble` (`transformIgnorePatterns: ["/node_modules/(?!(\\.pnpm/)?@noble)"]` plus a `.js` transform).
