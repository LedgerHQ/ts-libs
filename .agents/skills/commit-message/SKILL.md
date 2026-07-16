---
name: commit-message
description: Format a conventional commit message for ts-libs. Use when writing or reviewing a commit message.
---

# Commit Message

Format: **Conventional Commits**

```
<type>(<scope>): <description>
```

## Types

`feat` · `fix` · `refactor` · `test` · `docs` · `chore` · `ci` · `perf`

## Scope

Use the library name or area: `logs`, `errors`, `ci`, `deps`, `nx`, etc.

## Rules

- Description: imperative mood, lowercase, no trailing period
- Max ~72 chars for the first line
- Add a body only when the WHY is non-obvious

## Examples

```
feat(logs): add LocalTracer.withUpdatedContext
fix(errors): handle undefined message in serialize
chore(deps): bump typescript to 7.1.0
ci: parallelize lint and typecheck jobs
test(logs): add unsubscribe edge case
```

## Footer

For breaking changes:

```
feat(logs): rename listen to subscribe

BREAKING CHANGE: `listen` is now `subscribe`
```
