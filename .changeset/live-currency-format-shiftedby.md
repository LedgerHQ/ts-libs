---
"@ledgerhq/live-currency-format": patch
---

Scale units with `shiftedBy` instead of dividing or multiplying by `10^magnitude`, so formatting no longer depends on the global `DECIMAL_PLACES` config. A magnitude above 20 previously formatted 1 atom as `0.000…` under the default config.
