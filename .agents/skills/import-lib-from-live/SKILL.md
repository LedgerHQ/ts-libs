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

**Hard requirement: ts-libs must be fully agnostic of ledger-live.** No package in this repo may
depend on — or import from — a package that still lives in `ledger-live`, and that holds whether or
not the package is published to npm. Being on npm is *not* an escape hatch: pinning
`@ledgerhq/types-live` still means ts-libs cannot be built, typechecked or released without a
package whose source, versioning and release cadence belong to another repo. That is the coupling
the migration exists to remove, so re-creating it in the import defeats the point.

Check `dependencies`, `peerDependencies` **and every `import` in `src/`** for `@ledgerhq/*` and
other ledger-live-internal scopes (`@domain/*`, `@shared/*`, `@support/*`). Each one must resolve to
one of:

| The dependency… | Do this |
|---|---|
| already lives in ts-libs | `workspace:*` |
| migrates in the same batch | `workspace:*` |
| is a third-party package | normal npm range, `catalog:` if shared |
| **stays in ledger-live** | **not allowed** — resolve it before importing |

To resolve a dependency that stays in ledger-live, in order of preference:

1. **The dependency is really this library's own.** A type or helper parked in a shared package
   that only this library defines the meaning of — move it here. `@ledgerhq/types-live/domain`
   (`SupportedRegistries`, `DomainServiceResolution`) belongs to `domain-service`;
   `EIP712Message*` belongs to `evm-tools`. TypeScript is structural, so a consumer still holding
   the ledger-live copy keeps typechecking against the relocated one — the public surface does not
   move. This is the usual answer for type-only deps, and it is cheap.
2. **Migrate that package too**, in the same batch.
3. **Invert it** — take the dependency as a parameter, a peer, or an injected value instead.
4. **Block the migration** and report to the user. Never "just pin the npm version".

A runtime peer that is a normal third-party package (`react`) is fine — declare it in
`peerDependencies` and expect to propagate it to consumers that did not declare it themselves.

Two ledger-live conventions must also not follow the library in:

- **`@ledgerhq/test-quarantine`** — private flake-reporter/retry wiring in the jest config. Drop the
  `reporters` and `setupFilesAfterEnv` entries; ts-libs uses plain `jest-sonar` (see step 9).
- **resolving anything through the `@ledgerhq/source` condition that is not a ts-libs package.**
  ts-libs sets `customConditions: ["@ledgerhq/source"]`, so an external `@ledgerhq/*` dependency
  resolves to its raw `src/*.ts`, not its `.d.ts` — `skipLibCheck` stops protecting you and you
  inherit *its* undeclared type deps. The symptom is bogus errors inside `node_modules` (missing
  `@ledgerhq/types-devices`, "Cannot find namespace 'React'") that tempt you into adding type-only
  devDeps to paper over them. Do not: it means rule 1 above was skipped.

Run this audit again at the end of the import — it is the check that proves the repo still stands
alone:

```bash
node -e '
const fs=require("fs");
const libs=fs.readdirSync("libs");
const own=new Set(libs.map(l=>JSON.parse(fs.readFileSync(`libs/${l}/package.json`,"utf8")).name));
let bad=0;
for(const l of libs){
  const m=JSON.parse(fs.readFileSync(`libs/${l}/package.json`,"utf8"));
  for(const f of ["dependencies","peerDependencies","devDependencies"])
    for(const [d,s] of Object.entries(m[f]||{}))
      if(d.startsWith("@ledgerhq/") && !own.has(d)){ console.log(`FOREIGN ${m.name} ${f}: ${d}@${s}`); bad++; }
}
console.log(bad===0 ? "OK: ts-libs depends on no @ledgerhq package outside this repo" : `${bad} foreign deps`);
'
grep -rhoE 'from "@(ledgerhq|domain|shared|support)/[a-z0-9-]+' libs/*/src | sed 's/from "//' | sort -u
```

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

**Add a `files` allowlist — this is mandatory, not optional:**

```json
{
  "files": ["lib", "lib-es", "src", "CHANGELOG.md"]
}
```

The root `.gitignore` lists `lib/` and `lib-es/`. Without a `files` field `pnpm pack` falls back to those rules and drops `lib-es/` from the tarball, while force-keeping `lib/` because `main` and `types` point into it. The package then publishes with a `module` field and an `import` condition aimed at a directory that is not in the tarball — every ESM and bundler consumer breaks on upgrade with `ERR_MODULE_NOT_FOUND`, and CommonJS consumers notice nothing, so it survives smoke tests. This is exactly how `@ledgerhq/logs@6.18.0` shipped broken. Note `npm pack` does *not* reproduce it — only `pnpm pack`, which is what the release uses.

Keep `src` in the list: the `@ledgerhq/source` export condition resolves into it.

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

Before dropping a wildcard, enumerate the sub-paths real consumers import — including the
`@ledgerhq/*` packages **already published to npm**, whose tarballs you cannot edit. Missing
one of those is not caught by `tsc` or by unit tests; it fails at bundle time with
`Package subpath './x' is not defined by "exports"`. Keep a back-compat alias until those
consumers are republished. `/test-lib-with-wallet` does this audit.

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

Rename `jest.config.js` to `jest.config.ts`. If the file imports from a ledger-live base config
(e.g. `../../jest.config.ts`), or wires in `@ledgerhq/test-quarantine` (a `"@ledgerhq/test-quarantine/jest"`
reporter and a `"@ledgerhq/test-quarantine/jest-retries"` entry in `setupFilesAfterEnv`), replace it
with a self-contained config — that package is private to ledger-live and must not be imported here:

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
mise exec -- pnpm build && mise exec -- pnpm verify-pack
```

`verify-pack` packs every library and asserts the tarball actually contains each path declared by `main`, `module`, `types`, `bin` and every `exports` condition. It must pass before the import is considered done — a build that succeeds says nothing about what gets published. It checks every lib, so run the full `pnpm build` first: an unbuilt sibling reports a missing `lib/index.js`.

If pnpm install fails with `ERR_PNPM_IGNORED_BUILDS`, set the new package's build scripts to `true` in `pnpm-workspace.yaml`'s `allowBuilds` section, then re-run.

Fix any other errors that arise (usually tsconfig path issues or missing deps).

### 12. Report

After a successful build, report:

- ✅ Library imported, builds cleanly and passes `verify-pack`
- ✅ The step 2 agnosticism audit passes — no dependency on anything still living in ledger-live
- ⚠️ Any pending changesets found (list them)
- ⚠️ Any open PRs that need redirecting (list them with URLs)
- ⚠️ Any peer dependency now needing propagation to a ledger-live consumer that never declared it
- 📋 Next steps: update ledger-live to drop workspace ref and bump to the version published from ts-libs
