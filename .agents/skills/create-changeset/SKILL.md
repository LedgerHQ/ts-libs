---
name: create-changeset
description: Create a changeset for modified packages in ts-libs. Use when preparing a PR or documenting package changes for release.
---

# Create Changeset

Create a `.changeset/<adjective-noun-verb>.md` file with this format:

```markdown
---
"@ledgerhq/<name>": minor
---

Short description of the change.
```

## Package Names

Match exactly what's in each `libs/*/package.json` `name` field. Examples:

| Library | Package name                     |
| ------- | -------------------------------- |
| logs    | `@ledgerhq/logs`                 |
| errors  | `@ledgerhq/errors`               |
| other   | Check `libs/<name>/package.json` |

## Impact Levels

| Level   | When                                          |
| ------- | --------------------------------------------- |
| `minor` | New features, bug fixes, non-breaking changes |
| `major` | Breaking changes (requires discussion)        |
| `patch` | Internal changes, dep bumps, docs             |

## Description

One line, concise. Examples:

- `Add LocalTracer.withUpdatedContext builder method`
- `Fix dispatch crash when subscriber throws`
- `Export TraceContext type from public API`

## Multiple Packages

If multiple libs are modified:

```markdown
---
"@ledgerhq/logs": minor
"@ledgerhq/errors": patch
---

Description covering both changes.
```

## File Naming

Use a random human-readable slug matching `@changesets/cli` convention (e.g. `happy-cats-fly.md`, `silver-dogs-run.md`). Run `pnpm changelog` to generate interactively, or create the file manually.
