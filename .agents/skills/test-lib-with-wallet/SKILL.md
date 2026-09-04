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
survives the consumer. Works for a package *replacement* too (we validated `@ledgerhq/auth`
against `@ledgerhq/ledger-auth`).

## Usage

```
/test-lib-with-wallet                       # everything on the release branch
/test-lib-with-wallet live-network devices  # only these
/test-lib-with-wallet --pr 43               # include an open PR branch
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
ledger-live commit and still predate its content.

```bash
mkdir -p $PACKS/x && tar xzf $PACKS/ledgerhq-<name>-<v>.tgz -C $PACKS/x --strip-components=1 package/src
diff -r -x '*.test.ts' $PACKS/x/src $LIVE/<path-to-lib>/src
```

Name every remaining diff. Diff the manifests too: `dependencies`, `peerDependencies`,
`main`/`module`/`types`.

> `hw-transport@6.35.7` shipped 4 days *after* ledger-live inlined its error classes and
> still required `@ledgerhq/errors`, splitting `TransportError` identity. Invisible to
> version comparison.

For a **replacement**, also diff the two packages' sources and check every name the wallet
imports is exported. Watch shared-dep drift between the two catalogs: ts-libs pins
`zod@4.4.3` vs ledger-live's `4.3.6`, adding a third zod copy — harmless for `.parse()`,
dangerous once schemas are composed across instances.

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

> (a) `./index` is a legal subpath of `./*` and nobody enumerates it — 6 sites imported
> `@ledgerhq/devices/index`.
> (b) losing `./batcher/index`, `./lib/cache` and `./lib-es/cache` broke published
> `coin-evm`, `coin-tezos`, `coin-xrp`, `ledger-cal-service`. `tsc` was happy; rspack was not.

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
**or from jest**. `live-network`'s `axios` peer was unsatisfied for published
`coin-module-framework`, `coin-tezos` and `ledger-cal-service`.

**Nuke `node_modules` first (step 5) — a stale instance raises the same
`Cannot find module` as a real gap.** If the gap survives a clean tree, one
`packageExtensions` entry **per published consumer** is the only recourse, and it is
mandatory, not cosmetic. Two traps:

- On **the lib itself it does nothing, silently**: pnpm keeps the existing
  `peerDependencies` entry and discards the `dependencies` you added. Only the consumer
  side works.
- The consumer side rejects `catalog:` (`ERR_PNPM_SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER`) — an
  external package cannot read the workspace catalog. So the version is hand-pinned: the
  one place in the PR diff that cannot use `catalog:` and will silently drift from it.

> A/B on a clean tree (`node_modules` deleted between runs): **without** the three `axios`
> entries, two live-network instances, one lacking `axios`, and
> `coin-modules-monitoring:build` fails; **with** them, one instance and a green build.

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
`@ledgerhq/coin-*`. The path cannot go in the catalog — `file:` there fails with
`ERR_PNPM_CATALOG_ENTRY_INVALID_SPEC`. A `catalog:` ref *inside* `overrides` is fine.

> ledger-live pins pnpm 10, which reads `pnpm.overrides`. **pnpm 11 ignores the whole
> `pnpm` field with only a warning**, so the install silently resolves the *published*
> versions and every check below passes for the wrong reason. On pnpm 11 the overrides
> belong in `pnpm-workspace.yaml`.

**Delete `node_modules` between repack cycles.** Neither `pnpm install` nor `--force`
purges stale `.pnpm/` instances or the dead peer symlinks inside them, and every
`pnpm pack` mints a new `file:` hash, hence a new instance.

```bash
cd $LIVE && find . -type d -name node_modules -prune -exec rm -r {} +
CI=true mise exec -- pnpm install --no-frozen-lockfile

grep -c "ledgerhq-<name>-<v>.tgz" pnpm-lock.yaml          # must be > 0
grep -c "@ledgerhq/<name>@<old-version>" pnpm-lock.yaml   # must be 0
```

Match the version **without** a closing quote: pnpm appends peer suffixes to keys
(`'@ledgerhq/live-network@2.4.3(axios@1.13.5)'`) and the same string appears inside other
packages' keys, so an exact `'…@<v>'` reports 0 for a graph that still resolves the old one.

> After a repack, `coin-module-framework@8.2.0`'s live-network symlink still pointed at the
> previous, axios-less instance — though that snapshot in the lockfile declares no
> live-network at all. Nine packages link the bare instance, so rspack walked a path the
> lockfile says does not exist: a phantom `Cannot find module 'axios'`. Nuke + reinstall
> left one instance, and the build passed.

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

Compute the test targets instead of guessing them: every manifest that depends on a packed
lib *and* has a `test` script (80 projects on our run), then
`nx run-many -t test -p <list> --parallel=6`.

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
(`Exceeded timeout of 5000 ms`) under heavy `--parallel` — seen on Contacts, Send,
NotificationsPrompt and GenericAwarenessModal, on both LLD and LLM. Check the suite even
references a migrated lib (`grep -c "@ledgerhq/<name>" <suite>` → `0` means suspect), then
re-run it alone at low parallelism. Unrelated pre-existing failures to recognise rather
than investigate: `dummy-wallet-app:lint` (oxlint `unicorn/consistent-function-scoping`)
and `live-engagement:knip-check` (Re.Pack absent locally).

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
