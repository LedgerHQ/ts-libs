---
"@ledgerhq/live-config": minor
---

Move the package from the ledger-live monorepo to ts-libs. No API change.

The `exports` map now lists `./LiveConfig`, `./providers`, `./providers/index`,
`./providers/firebaseRemoteConfig`, `./providers/firebaseRemoteConfig/index`,
`./providers/firebaseRemoteConfig/parser`, `./lib/*` and `./lib-es/*` explicitly, in place of
the previous `./*` wildcard. Every sub-path the wildcard resolved to is still reachable.
