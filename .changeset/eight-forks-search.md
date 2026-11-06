---
"@ledgerhq/auth": minor
"@ledgerhq/devices": minor
"@ledgerhq/domain-service": minor
"@ledgerhq/evm-tools": minor
"@ledgerhq/hw-ledger-key-ring-protocol": minor
"@ledgerhq/hw-transport-mocker": minor
"@ledgerhq/hw-transport": minor
"@ledgerhq/ledger-key-ring-protocol": minor
"@ledgerhq/live-config": minor
"@ledgerhq/live-currency-format": minor
"@ledgerhq/live-env": minor
"@ledgerhq/live-network": minor
"@ledgerhq/live-promise": minor
"@ledgerhq/logs": minor
"@ledgerhq/psbtv2": minor
---

Drop the @ledgerhq/source export condition, so consumers that enable it read the built declarations instead of compiling the sources
