---
name: import-lib-from-live
description: Import a single library from ledger-live into this ts-libs monorepo. Runs discovery, dep/PR audit, copies files, patches config, and verifies the build. Source repo: https://github.com/LedgerHQ/ledger-live
---

# import-lib-from-live

Import `<LIB_NAME>` from `ledger-live` into `ts-libs`.

## Usage

Invoke with the library name as argument:

```
/import-lib-from-live logs
/import-lib-from-live devices
```

---

## Steps

### 0. Locate the ledger-live checkout

Ask the user where their local `ledger-live` checkout is if not already known:

> "Where is your local `ledger-live` checkout? (e.g. `~/dev/ledger-live`)"
> Source repo: https://github.com/LedgerHQ/ledger-live

Store the answer as `$LIVE` for the rest of the steps.

### 1. Locate the library in ledger-live

Search for the package in:

- `$LIVE/libs/ledgerjs/packages/<name>/`
- `$LIVE/libs/<name>/`

Read its `package.json` to confirm the npm name and version.

### 2. Dependency audit

In the library's `package.json`, check `dependencies` and `peerDependencies`:

- Are any `workspace:*` references present?
- If yes: will those packages also migrate to ts-libs, or stay in ledger-live?
- If they stay in ledger-live and are published to npm → no issue (just unworkspace the ref to a pinned version).
- If they are private internal packages → **block the migration**, report to user.

### 3. Pending changeset check

```bash
grep -rl '"@ledgerhq/<name>"' $LIVE/.changeset/*.md 2>/dev/null
```

List any `.changeset/*.md` files in ledger-live that mention this package. If any exist, warn the user — those unreleased bumps should be merged/released in ledger-live first, or will need to be replicated in ts-libs after import.

### 4. Open PR check

```bash
gh pr list --repo LedgerHQ/ledger-live --state open --search "libs/ledgerjs/packages/<name>" --json number,title,url
```

List any open PRs in ledger-live that touch this library. Warn the user — those PRs will need to be redirected to ts-libs after migration.

### 5. Copy files

Create `libs/<name>/` in ts-libs. Copy from ledger-live:

| Copy                           | Skip            |
| ------------------------------ | --------------- |
| `src/`                         | `lib/`          |
| `package.json`                 | `lib-es/`       |
| `tsconfig.json`                | `node_modules/` |
| `tsconfig.build.json`          | `CHANGELOG.md`  |
| `jest.config.ts` (if present)  |                 |
| `README.md`                    |                 |
| Any other config files at root |                 |

### 6. Set library status in README

Ask the user (or infer from the migration context) which status applies to this library:

| Status | Meaning |
|---|---|
| **STABLE** | Production-ready, actively maintained, semver guaranteed |
| **DEPRECATED** | Superseded or being phased out; migration path required |
| **UNSTABLE** | API not stable; breaking changes possible without a major bump |

Prepend the appropriate block to the top of `libs/<name>/README.md`:

**STABLE:**
```markdown
> [!NOTE]
> **Status: STABLE**
```

**DEPRECATED:**
```markdown
> [!WARNING]
> **Status: DEPRECATED**
> Use [`@ledgerhq/<replacement>`](link) instead.
```

**UNSTABLE:**
```markdown
> [!CAUTION]
> **Status: UNSTABLE**
> API may change without notice. Not recommended for production use.
```

### 7. Patch `package.json`

Update these fields:

```json
{
  "repository": {
    "type": "git",
    "url": "https://github.com/LedgerHQ/ts-libs.git"
  },
  "bugs": {
    "url": "https://github.com/LedgerHQ/ts-libs/issues"
  },
  "homepage": "https://github.com/LedgerHQ/ts-libs/tree/main/libs/<name>"
}
```

Replace devDependencies that are in the workspace `catalog:` with `catalog:` references:

```json
{
  "devDependencies": {
    "typescript": "catalog:",
    "@types/node": "catalog:",
    "@types/jest": "catalog:",
    "jest": "catalog:",
    "jest-sonar": "catalog:",
    "@swc/jest": "catalog:",
    "@swc/core": "catalog:"
  }
}
```

Add `"oxlint": "catalog:"` to devDependencies and a `"lint": "oxlint ./src"` script.

Replace any `"rimraf"` clean scripts with `"rm -rf lib lib-es"`.

Replace any `workspace:*` runtime deps with their pinned npm version (look up current published version).

Remove wildcard sub-path exports from the `exports` field — keep only the `"."` root and `"./package.json"` entries:

```json
{
  "exports": {
    ".": {
      "@ledgerhq/source": "./src/index.ts",
      "import": "./lib-es/index.js",
      "require": "./lib/index.js",
      "default": "./lib/index.js"
    },
    "./package.json": "./package.json"
  }
}
```

Wildcard patterns like `"./*"`, `"./lib/*"`, `"./lib-es/*"` make knip treat every `src/*.ts` file as an entry point, preventing detection of unused files. If the lib genuinely exposes named sub-paths (e.g. `@ledgerhq/foo/bar`), list them explicitly instead.

### 8. Patch `tsconfig.json`

Change `"extends"` to point to the ts-libs root:

```json
{
  "extends": "../../tsconfig.base.json"
}
```

Also ensure `declaration: true`, `declarationMap: true`, and `types: ["jest", "node"]` are set. The `types` array is required so test files typecheck correctly (jest globals); `tsconfig.build.json` overrides it with `types: []` so jest globals don't leak into the build.

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "lib",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "types": ["jest", "node"]
  }
}
```

Remove any ledger-live-specific path aliases or references.

### 9. Patch `jest.config.ts`

If the file imports from a ledger-live base config (e.g. `../../jest.config.ts`), replace it with a self-contained config:

```typescript
export default {
  transform: {
    "^.+\\.(ts|tsx)$": ["@swc/jest", { jsc: { parser: { syntax: "typescript" } } }],
  },
  testEnvironment: "node",
  coverageReporters: ["json", ["lcov", { projectRoot: "../../" }], "json-summary", "text"],
  reporters: [
    "default",
    ["jest-sonar", { outputName: "sonar-executionTests-report.xml", reportedFilePath: "absolute" }],
  ],
};
```

### 10. Ensure nx targets are defined

In `package.json`, ensure the `scripts` block has all four targets nx expects:

```json
{
  "scripts": {
    "build": "tsc --project tsconfig.build.json && tsc --project tsconfig.build.json -m esnext --moduleResolution bundler --outDir lib-es",
    "lint": "oxlint ./src",
    "typecheck": "tsc --noEmit",
    "test": "jest --passWithNoTests",
    "coverage": "jest --coverage --passWithNoTests",
    "clean": "rm -rf lib lib-es"
  }
}
```

### 11. Install and build

```bash
mise exec -- pnpm install
mise exec -- pnpm --filter @ledgerhq/<name> build
mise exec -- pnpm --filter @ledgerhq/<name> typecheck
```

If pnpm install fails with `ERR_PNPM_IGNORED_BUILDS`, set the new package's build scripts to `true` in `pnpm-workspace.yaml`'s `allowBuilds` section, then re-run.

Fix any other errors that arise (usually tsconfig path issues or missing deps).

### 12. Report

After a successful build, report:

- ✅ Library imported and builds cleanly
- ⚠️ Any pending changesets found (list them)
- ⚠️ Any open PRs that need redirecting (list them with URLs)
- 📋 Next steps: update ledger-live to drop workspace ref and bump to the version published from ts-libs
