---
"@ledgerhq/live-currency-format": minor
---

BREAKING: support `bignumber.js` v11, now a peer dependency (`^9.1.2 || ^11.0.0`) that consumers must install. `parseCurrencyUnit` only accepts plain decimal input (exponent up to 3 digits) and returns zero otherwise, including for hex/binary/octal prefixes, underscores and `Infinity`; it always rounds with `ROUND_HALF_UP`. Unit scaling uses `shiftedBy`, so formatting no longer depends on the `DECIMAL_PLACES` config.
