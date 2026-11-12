---
"@ledgerhq/live-network": minor
---

Add a per-request `retry` option to GET requests: `false` sends the request once, `{ statuses }` sets the retried HTTP statuses for that request. Without it, behaviour is unchanged.
