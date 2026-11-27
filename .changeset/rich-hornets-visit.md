---
"@ledgerhq/ledger-key-ring-protocol": minor
---

Add getStreams, getApplicationStream, addMemberToApplicationWithDevice, addMemberToStreamWithDevice, createStreamWithDevice, prepareApplicationStreamRotationWithDevice, closeApplicationStreamWithDevice and closeStreamWithDevice to TrustchainSDK (a full implementation, such as a test fake, needs them), and softwareMemberPermissions to getOrCreateTrustchain. addMember now refuses a closed application stream (TrustchainEjected, as restoreTrustchain), a member already there with other permissions, and permissions that do not fit in 32 bits
