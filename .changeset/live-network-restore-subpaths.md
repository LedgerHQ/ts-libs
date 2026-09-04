---
"@ledgerhq/live-network": patch
---

Restore the `./batcher/index`, `./lib/*` and `./lib-es/*` sub-path exports.

Narrowing the `exports` map when the library was imported from `ledger-live` dropped
sub-paths that already-published `@ledgerhq/coin-evm`, `coin-tezos`, `coin-xrp` and
`ledger-cal-service` import. Those tarballs are immutable, so the alias has to live
here until they are republished.
