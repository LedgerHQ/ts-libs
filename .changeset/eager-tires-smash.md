---
"@ledgerhq/live-network": minor
---

Move the package from the ledger-live monorepo to ts-libs, and mark the package as DEPRECATED: use RTK Query inside Ledger Live, or plain fetch/axios elsewhere. It was extracted to unblock the migration of its dependents, not because it is the recommended path.
