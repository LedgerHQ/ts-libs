---
"@ledgerhq/auth": minor
---

Add an optional IdentityProvider.refresh. AuthSDK now renews an expired or rejected token with it before authenticating again, and authenticates when a token that refresh returned is rejected
