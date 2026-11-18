---
"@ledgerhq/ledger-key-ring-protocol": minor
---

LkrpIdentityProvider now renews an expired or rejected Keycloak token by refreshing the IdP token of its last login (GET /openid/v1/token/refresh) and exchanging it again, instead of signing a new challenge. It logs in again when the refresh fails or the trustchain or member changed since.
