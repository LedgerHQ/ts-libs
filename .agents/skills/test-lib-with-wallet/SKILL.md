---
name: test-lib-with-wallet
description: Prove a ts-libs library is compatible with the ledger-live wallet monorepo BEFORE publishing, by packing local tarballs and forcing them into ledger-live via pnpm.overrides. Use after /import-lib-from-live, before releasing, or to validate an open PR against its biggest consumer.
---

# test-lib-with-wallet

A published npm version is immutable, so ledger-live's CI is normally the first thing to
find a broken release. This skill closes that loop early: **pack the candidate libs, force
them into a real ledger-live checkout, run the wallet's own builds.** Nothing is published;
everything is reverted.

Mirror of `/import-lib-from-live` — that one moves code out, this one proves the move
survives the consumer. Works the same for a package *replacement*.

## Usage

```
/test-lib-with-wallet                # everything on the release branch
/test-lib-with-wallet <lib> <lib>    # only these
/test-lib-with-wallet --pr <n>       # include an open PR branch
```

## Steps

### 0. Set up

`$LIVE` = the ledger-live checkout (ask if unknown), on a clean `develop`.
`PACKS=$TMPDIR/tslibs-packs`.

Test **`origin/changeset-release/develop`**, not `develop` — it carries the versions
changesets will actually publish. Cherry-pick any open PR on top.

### 1. Build and pack

```bash
mise exec -- pnpm install && mise exec -- pnpm build && mise exec -- pnpm verify-pack
mkdir -p $PACKS
for l in <libs>; do (cd libs/$l && mise exec -- pnpm pack --pack-destination $PACKS); done
```

`pnpm pack`, never `npm pack` — only pnpm reproduces what the release publishes.
`verify-pack` proves the tarball ships what the manifest declares; it skips `*` patterns
and knows nothing about consumers, which is step 3's job.

### 2. Parity diff

**Matching versions prove nothing** — a release cut from a release branch can post-date a
ledger-live commit and still predate its content, so a "newer" package can carry older code.

```bash
mkdir -p $PACKS/x && tar xzf $PACKS/ledgerhq-<name>-<v>.tgz -C $PACKS/x --strip-components=1 package/src
diff -r -x '*.test.ts' $PACKS/x/src $LIVE/<path-to-lib>/src
```

Name every remaining diff. Diff the manifests too: `dependencies`, `peerDependencies`,
`main`/`module`/`types`.

For a **replacement** package, also diff the two packages' sources and check every name the
wallet imports is exported. Watch shared deps pinned differently in the two catalogs: the
skew adds another copy of that dep — harmless for stateless calls, not for values compared
or composed across instances.

### 3. Subpath audit

`/import-lib-from-live` narrows `exports`, which silently removes subpaths consumers
import. Audit both populations — **they need different fixes**:

```bash
# a) wallet sources → FIXABLE: rewrite the imports
grep -rhoE "@ledgerhq/<name>(/[a-zA-Z0-9_./-]+)?" --include="*.ts" --include="*.tsx" \
  $LIVE/apps $LIVE/libs $LIVE/shared $LIVE/domain $LIVE/features | sort -u

# b) already-published @ledgerhq tarballs → NOT fixable: the lib keeps a back-compat alias
grep -rhoE "@ledgerhq/<name>/[a-zA-Z0-9_./-]+" \
  $LIVE/node_modules/.pnpm/*/node_modules/@ledgerhq/*/lib*/ | sort -u
```

Enumerate everything the old wildcards matched, including the non-obvious: `./index`, and
the `./lib/*` / `./lib-es/*` paths that published `.d.ts` files reference. `tsc` and unit
tests resolve through `@ledgerhq/source` to `src/`, so a missing subpath surfaces only when
a bundler resolves the published package.

### 4. Peer audit

`auto-install-peers=false`, and pnpm satisfies a peer from **the importer's** deps — so the
workspace manifests are not the whole picture, some importers are immutable tarballs.

```bash
grep -rln '"@ledgerhq/<name>"' $LIVE/*/*/package.json $LIVE/*/package.json

for d in node_modules/.pnpm/@ledgerhq+<name>@*/; do
  printf "%s " "$(basename $d)"
  ls $d/node_modules/ | grep -q "^<peer>$" && echo HAS || echo MISSING
done
```

Symptoms are indirect: a type widening to `any`, or `Cannot find module` from a bundler
**or from jest**.

**Nuke `node_modules` first (step 5) — a stale instance raises the same
`Cannot find module` as a real gap.** If the gap survives a clean tree, one
`packageExtensions` entry **per published consumer** is the only recourse, and it is
mandatory, not cosmetic — confirm by A/B on a clean tree. Two traps:

- On **the lib itself it does nothing, silently**: pnpm keeps the existing
  `peerDependencies` entry and discards the `dependencies` you added. Only the consumer
  side works.
- The consumer side rejects `catalog:` (`ERR_PNPM_SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER`) — an
  external package cannot read the workspace catalog. So the version is hand-pinned: the
  one place in the PR diff that cannot use `catalog:` and will silently drift from it.

The cost is linear in the number of published modules consuming the lib — which is what
justifies **escalating instead of patching**: is the peer still worth it, or should those
modules be republished declaring it?

### 5. Wire in and install

Tarballs go in the root `package.json`'s **existing** `pnpm.overrides` block; the future
published versions go in the catalog (that is the diff the real PR carries).

```jsonc
"pnpm": { "overrides": { "@ledgerhq/<name>": "file:/abs/path/ledgerhq-<name>-<v>.tgz" } }
```

`overrides` intercepts every instance, including transitive ones from published
`@ledgerhq/*`. The path cannot go in the catalog — `file:` there fails with
`ERR_PNPM_CATALOG_ENTRY_INVALID_SPEC`. A `catalog:` ref *inside* `overrides` is fine.

> **Check pnpm's major version.** pnpm 10 reads `pnpm.overrides` from `package.json`;
> pnpm 11 ignores that whole field with only a warning, so the install silently resolves
> the *published* versions and every check below passes for the wrong reason. On pnpm 11
> the overrides belong in `pnpm-workspace.yaml`.

**Delete `node_modules` between repack cycles.** Neither `pnpm install` nor `--force`
purges stale `.pnpm/` instances or the dead peer symlinks inside them, and every `pnpm pack`
mints a new `file:` hash, hence a new instance. Real packages keep linking the stale one, so
a bundler walks a path the lockfile says does not exist and fails on a dependency that is
genuinely present — a phantom failure.

```bash
cd $LIVE && find . -type d -name node_modules -prune -exec rm -r {} +
CI=true mise exec -- pnpm install --no-frozen-lockfile

grep -c "ledgerhq-<name>-<v>.tgz" pnpm-lock.yaml          # must be > 0
grep -c "@ledgerhq/<name>@<old-version>" pnpm-lock.yaml   # must be 0
```

Match the version **without** a closing quote: pnpm appends peer suffixes to keys
(`'@ledgerhq/<name>@<v>(<peer>@<v>)'`) and the same string appears inside other packages'
keys, so an exact `'…@<v>'` reports 0 for a graph that still resolves the old one.

**The lockfile diagnoses, a clean tree convicts.** If no snapshot depends on the offending
instance, you are looking at residue. Never report an incompatibility from a dirty tree.

### 6. Run the wallet's checks

```bash
CI=true mise exec -- pnpm build:lld:deps --parallel=100%   # desktop
CI=true mise exec -- pnpm build:llm:deps --parallel=100%   # mobile
CI=true mise exec -- pnpm typecheck
```

Run the **builds**, not just `typecheck` — rspack/metro are what catch a broken `exports`
map, an unresolvable peer, or an ESM/CJS mismatch.

Compute the test targets instead of guessing: every manifest that depends on a packed lib
*and* has a `test` script, then `nx run-many -t test -p <list> --parallel=6`.

```bash
cd $LIVE && mise exec -- node -e '
const { execSync } = require("child_process"), fs = require("fs");
const libs = process.argv.slice(1), out = new Set();
for (const f of execSync(`git ls-files "*package.json"`, { encoding: "utf8" }).split("\n").filter(Boolean)) {
  let m; try { m = JSON.parse(fs.readFileSync(f, "utf8")); } catch { continue; }
  if (!m.name || !m.scripts?.test) continue;
  const deps = { ...m.dependencies, ...m.devDependencies, ...m.peerDependencies };
  if (libs.some(l => deps[`@ledgerhq/${l}`])) out.add(m.name);
}
console.log([...out].join(","));
' <libs>
```

**A failing task is not evidence.** App integration suites time out
(`Exceeded timeout of 5000 ms`) under heavy `--parallel`, and the monorepo carries failures
unrelated to your change. Before calling anything a regression: check the suite even
references a packed lib (`grep -c "@ledgerhq/<name>" <suite>` → `0` means suspect), then
re-run it alone at low parallelism.

### 7. Report and revert

Report per lib: parity diff, subpath gaps, peer gaps, each check's result. Fixes land **in
ts-libs, before publishing** — that is the point. Amend the changeset if the public API moved.

Keep the local diff separable: all scaffolding (`file:` paths, temporary
`packageExtensions`) stays inside the root `pnpm.overrides` / `pnpm.packageExtensions`, so
`git checkout -- package.json pnpm-lock.yaml` recovers the real PR diff — catalog entries,
consumer manifests, import rewrites.

## What each step catches

| Step | Catches | Missed by |
|---|---|---|
| 1 `verify-pack` | a declared path the tarball omits | `pnpm build` |
| 2 parity diff | stale build, diverged source | version comparison |
| 3 subpath audit | narrowed `exports` breaking published consumers | `tsc`, tests, `verify-pack` |
| 4 peer audit | peer unsatisfied in a published importer | `pnpm install` |
| 5 lockfile assertion | overrides silently ignored | install exit code |
| 5 `node_modules` nuke | phantom failures from stale `.pnpm/` instances | `pnpm install --force` |
| 6 builds | ESM/CJS mismatch, runtime resolution | `typecheck` |
| 6 computed targets | an untested direct consumer | guessing |
