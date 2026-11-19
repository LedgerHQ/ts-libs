---
"@ledgerhq/ledger-key-ring-protocol": minor
---

Add getStreams, createStreamWithDevice and closeStreamWithDevice to TrustchainSDK (a full implementation, such as a test fake, needs them), addMember options and softwareMemberPermissions to getOrCreateTrustchain. addMember now refuses a closed or replaced stream, a stream below one, a member already there with other permissions, and permissions that do not fit in 32 bits
