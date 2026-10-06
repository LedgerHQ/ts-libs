---
"@ledgerhq/evm-tools": patch
---

Pin `@noble/hashes` to 1.8.0 (dual CJS/ESM) so the CJS build loads under consumers' Jest and on Node < 22.12; EIP712 schema hash output unchanged
