---
"@ledgerhq/ledger-key-ring-protocol": minor
---

Add useDeviceJwt, cacheDeviceJwt and hasOwnDeviceJwt to TrustchainSDK (a full implementation, such as a test fake, needs them too), log the device in once when the backend refuses a cached device login, and accept a trustchain API base URL ending with / or /v1 (trustchainApiRoot). After a refreshed or renewed login, a permission refusal now throws TrustchainNotAllowed and a path mismatch TrustchainOutdated, instead of the raw HTTP error
