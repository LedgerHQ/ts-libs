---
"@ledgerhq/live-currency-format": minor
---

BREAKING: support `bignumber.js` v11. It is now a peer dependency (`^9.1.2 || ^11.0.0`) that consumers must install.

- `parseCurrencyUnit` only accepts plain decimal input and rounds with `ROUND_HALF_UP`. It returns zero for invalid input instead of throwing under v11, and also for hex/binary/octal prefixes, `1_000`, `Infinity` and exponents over 3 digits.
- `formatPriceFragment` and `formatSignedFiatVariation` return the empty state for a missing (`undefined`/`null`) fiat amount instead of throwing under v11.
