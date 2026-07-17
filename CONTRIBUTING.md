# Contributing to ts-libs

`ts-libs` is an internal Ledger monorepo that hosts reusable TypeScript libraries extracted from `ledger-live` and other Ledger stacks. These guidelines apply to contributors and agents. Please read fully before opening a pull request.

> [!IMPORTANT]
> The primary activity here is **migrating libraries from `ledger-live`** — not creating new ones from scratch. PRs that introduce libraries unrelated to the Ledger ecosystem or that duplicate packages already handled in `ledger-live` will be closed without extensive review.

## Getting Started

1. Create your branch from `develop`.
2. Run `mise install` to get the correct toolchain (node, pnpm, gitleaks, hk…).
3. Run `pnpm install` to install dependencies.
4. Git hooks activate automatically after `mise install` — commit messages are validated against [Conventional Commits](https://www.conventionalcommits.org/).

## Branch & Commit Conventions

### Branch naming

| Prefix | When to use |
|--------|-------------|
| `feat/` | Migrating a new library from ledger-live |
| `bugfix/` | Fixing a bug in an existing library |
| `support/` | Refactors, tests, CI, tooling improvements |
| `chore/` | Maintenance, config, dependency updates |

### Commit messages

Enforced locally by commitlint. Format:

```
<type>(<scope>): <description>
```

Scope is the library name or area: `logs`, `devices`, `ci`, `deps`, etc.

### Rebase & merge strategy

Always rebase on `develop` before opening a PR. On a draft branch, prefer `git push origin +<branch>` (amend + force-push) over accumulating fix commits.

## The PR Lifecycle

Open your PR as a **Draft** and pass all automated checks before making it **Ready for Review**.

```mermaid
flowchart LR
    S0[Create draft<br>pull request] --> S1[Pass all<br>automated checks]
    S1 --> S2[Open pull request:<br>Ready for review]
    S2 --> S3[Pass review<br>by code-owners]
```

### Automated checks

Before marking your PR ready for review, ensure all of the following pass:

- **format** — `pnpm format`
- **knip** — `pnpm knip` (no unused files or exports)
- **lint** — `pnpm lint`
- **typecheck** — `pnpm typecheck`
- **tests** — `pnpm test`
- **Copilot** — request a Copilot review, address or explicitly dismiss every comment, and resolve all threads.

### Ready for review

- Click **"Ready for review"** to convert from Draft — this automatically requests the relevant code owners via `CODEOWNERS`.
- When a reviewer leaves feedback and you push a fix, **re-request their review** (GitHub "Re-request" button).

## Changelogs

We use [changesets](https://github.com/changesets/changesets) for versioning. Run:

```bash
pnpm changelog
```

A changeset is **required** for any change to a library's public API or behaviour. It is not required for tooling, CI, or documentation-only changes.

## Migrating a Library from ledger-live

Use the `/import-lib-from-live` skill. It handles discovery, dependency audit, file copy, config patching, and build verification. Once imported, set the library status in its README (see below).

## Library status

Every library README must carry a status block immediately after the title:

| Status | Alert | Meaning |
|---|---|---|
| `STABLE` | `[!NOTE]` | Production-ready, actively maintained, semver guaranteed |
| `DEPRECATED` | `[!WARNING]` | Superseded — migration path documented in the block |
| `UNSTABLE` | `[!CAUTION]` | API not stable, breaking changes possible without a major bump |

Example for a deprecated library:

```markdown
> [!WARNING]
> **Status: DEPRECATED**
> Use [`@ledgerhq/replacement`](link) instead.
```

## Appendix: Tips

#### Request Copilot while still in Draft

> [!TIP]
> <img width="500" alt="Request Copilot on a Draft PR" src="https://github.com/user-attachments/assets/1326c947-61bc-4793-b70c-9e39b04eb630" />

#### Re-request review after pushing fixes

> [!TIP]
> <img width="500" alt="Re-request review on a reviewer that did the review" src="https://github.com/user-attachments/assets/80f83822-0557-4375-8ed6-a4aebfcb5d10" />
