---
name: git-workflow
description: Git workflow, branch naming and commit conventions for ts-libs
---

# Git Workflow

## Branch Naming

| Prefix     | Use                          |
| ---------- | ---------------------------- |
| `feat/`    | New library or feature       |
| `bugfix/`  | Bug fix                      |
| `support/` | Refactor, CI, tooling, tests |
| `chore/`   | Maintenance, config          |

Examples: `feat/add-errors-lib`, `bugfix/fix-logs-dispatch`, `support/update-nx`

Rules: kebab-case, short, one concern per branch.

## Base Branch

Always branch from and PR into **`develop`**. `main` is release-only (never commit directly).

## Commit Format

Follow **Conventional Commits**:

```
<type>(<scope>): <description>
```

- Description: imperative, lowercase, no period
- Scope: library name or area (e.g. `logs`, `ci`, `deps`)

### Types

| Type       | When                                |
| ---------- | ----------------------------------- |
| `feat`     | New library or feature              |
| `fix`      | Bug fix                             |
| `refactor` | Restructure without behavior change |
| `test`     | Add/update tests                    |
| `docs`     | Documentation only                  |
| `chore`    | Tooling, config, deps               |
| `ci`       | CI/CD changes                       |
| `perf`     | Performance improvement             |

### Examples

```
feat(logs): add LocalTracer.withUpdatedContext method
fix(errors): handle undefined message in serialize
refactor(logs): extract dispatch into separate module
test(logs): add listen/unsubscribe edge cases
chore(deps): bump typescript to 7.1.0
ci: add format check to pull_request workflow
```

## Best Practices

- One commit = one logical change
- Never use `--no-verify` — fix the underlying hook failure
- Rebase on `develop` before opening a PR
- Squash only for trivial cleanup branches
