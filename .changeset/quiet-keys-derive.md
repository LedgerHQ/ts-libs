---
"@ledgerhq/hw-ledger-key-ring-protocol": minor
---

Fix the key SoftwareDevice derives or reads for a stream below the stream that holds its key, so it matches the device. readKey and StreamTreeCipher return a different key there than earlier versions. getPublishKeyEvent also returns the path of the stream that holds the key. DerivationPath.toIndexArray parses the root path ("", "m", "m/") as [] instead of [NaN], so StreamTree.update on the root stream replaces it, and a derived stream with an empty path is refused. It throws on any other malformed component (empty, not a number, above 2^31 - 1) instead of returning NaN, which the device encoding wrote as 0
