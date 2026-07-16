# Project Context

## Overview

`ts-libs` is a pnpm + Nx monorepo hosting reusable TypeScript libraries extracted from `ledger-live` and other Ledger stacks. Libraries live under `libs/` and are published to npm/JFrog under the `@ledgerhq/` scope.

## Structure

```
ts-libs/
├── libs/              ← one directory per library
│   └── <name>/
│       ├── src/
│       ├── package.json
│       ├── tsconfig.json
│       ├── tsconfig.build.json
│       └── jest.config.ts
├── .agents/skills/    ← Claude/Copilot skills
├── .changeset/        ← versioning config
├── .github/workflows/ ← CI/CD
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── nx.json
```

## Adding a New Library

Use the `/import-lib-from-live` skill to import from ledger-live, or create manually:

1. Create `libs/<name>/` with `src/`, `package.json`, `tsconfig.json`, `tsconfig.build.json`, `jest.config.ts`
2. Extend `../../tsconfig.base.json`; add `declaration: true` and `declarationMap: true`
3. Use `catalog:` references for all shared devDependencies (see `pnpm-workspace.yaml`)
4. Scripts: `build`, `lint` (oxlint), `typecheck`, `test` (jest --passWithNoTests), `clean`
5. Add a changeset: `pnpm changelog`

## Key Commands

```bash
pnpm install                              # install dependencies
pnpm build                                # build all libs (nx)
pnpm lint                                 # lint all libs
pnpm typecheck                            # typecheck all libs
pnpm test                                 # test all libs
pnpm --filter @ledgerhq/<name> build      # build a single lib
pnpm changelog                            # add a changeset
```

## Conventions

- **TypeScript**: strict mode, NodeNext module resolution, `customConditions: ["@ledgerhq/source"]`
- **Build outputs**: `lib/` (CJS) and `lib-es/` (ESM)
- **DevDeps**: all shared tools (jest, swc, typescript, oxlint…) go in `catalog:` in `pnpm-workspace.yaml`
- **No `rimraf`**: use `rm -rf lib lib-es` in clean scripts
- **No comments** unless the WHY is non-obvious

## Git Flow

- `develop` — default branch, target for PRs
- `main` — triggers automatic publish via Changesets + JFrog OIDC
- Feature branches: `feat/`, `bugfix/`, `support/`, `chore/`

## Validate Before Finishing

Before declaring a task done:

1. `pnpm --filter @ledgerhq/<name> build` — builds cleanly
2. `pnpm --filter @ledgerhq/<name> typecheck` — no TS errors
3. `pnpm --filter @ledgerhq/<name> lint` — no lint errors
4. `pnpm --filter @ledgerhq/<name> test` — tests pass
5. `pnpm format` — formatting check passes

## Skills Available

- `/import-lib-from-live` — import a library from ledger-live
- `/create-changeset` — create a changeset for modified packages
- `/github-pr` — create a well-formed draft PR
- `/pre-review` — run a multi-agent code review before opening a PR
- `/git-workflow` — branch naming and commit conventions
- `/commit-message` — format a conventional commit message
