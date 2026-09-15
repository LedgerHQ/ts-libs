---
"@ledgerhq/live-env": minor
---

Move the package from the ledger-live monorepo to ts-libs. No API change; the package stays
DEPRECATED and is still being sunset — see MIGRATION.md.

The `exports` map now lists `.`, `./index`, `./env`, `./state`, `./lib/*` and `./lib-es/*`
explicitly, in place of the previous `./*` wildcard.
