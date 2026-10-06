---
"@ledgerhq/hw-ledger-key-ring-protocol": major
"@ledgerhq/ledger-key-ring-protocol": major
---

Upgrade @noble/curves, @noble/hashes and @noble/ciphers to v2 (ESM-only, `.js` subpath imports).

Breaking: the CJS entry now `require`s ESM-only packages. Consumers need Node >= 20.19 / 22.12 (or a bundler), and their Jest configs must transform `@noble`:

```diff
+  transform: { "^.+\\.(ts|tsx|js)$": ["@swc/jest", { jsc: { target: "es2022" } }] },
+  transformIgnorePatterns: ["/node_modules/(?!(\\.pnpm/)?@noble)"],
```
