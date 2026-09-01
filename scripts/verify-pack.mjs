#!/usr/bin/env node
// Packs every library and asserts the tarball actually contains what package.json
// declares. Guards the class of bug that shipped @ledgerhq/logs 6.18.0 without
// lib-es/ while `module` and the `import` condition still pointed at it.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const libsDir = join(root, "libs");

const isFile = path => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const libs = readdirSync(libsDir).filter(name => isFile(join(libsDir, name, "package.json")));

/** Every relative path package.json promises to ship. */
function declaredPaths(manifest) {
  const found = new Set();

  const add = value => {
    // `exports` values are always "./"-prefixed; main/module/types/bin accept a bare
    // relative path too. Absolute paths and URLs are not ours to check.
    if (typeof value !== "string" || value === "" || value.startsWith("/") || value.includes(":"))
      return;
    const path = posix.normalize(value.replace(/^\.?\//, ""));
    if (path.startsWith("..") || path.includes("*")) return; // patterns are not enumerable
    found.add(path);
  };

  add(manifest.main);
  add(manifest.module);
  add(manifest.types);
  add(manifest.typings);
  if (typeof manifest.browser === "string") add(manifest.browser);
  if (typeof manifest.bin === "string") add(manifest.bin);
  else for (const bin of Object.values(manifest.bin ?? {})) add(bin);

  const walkExports = node => {
    if (typeof node === "string") return add(node);
    if (!node || typeof node !== "object") return;
    for (const child of Object.values(node)) walkExports(child);
  };
  walkExports(manifest.exports);

  return found;
}

const failures = [];

for (const lib of libs) {
  const cwd = join(libsDir, lib);
  const manifest = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
  if (manifest.private) continue;

  const before = failures.length;
  const dest = mkdtempSync(join(tmpdir(), "verify-pack-"));
  try {
    let tarball;
    try {
      execFileSync("pnpm", ["pack", "--pack-destination", dest], { cwd, stdio: "pipe" });
      tarball = readdirSync(dest).find(f => f.endsWith(".tgz"));
    } catch (error) {
      const detail = String(error.stderr ?? error.message)
        .trim()
        .split("\n")
        .slice(-5)
        .join("\n");
      failures.push(`${manifest.name}: pnpm pack failed\n${detail}`);
      continue;
    }
    if (!tarball) {
      failures.push(`${manifest.name}: pnpm pack produced no tarball`);
      continue;
    }

    const shipped = new Set(
      execFileSync("tar", ["-tzf", join(dest, tarball)], { encoding: "utf8" })
        .split("\n")
        .filter(Boolean)
        .map(entry => entry.replace(/^package\//, "").replace(/\/$/, "")),
    );

    for (const path of declaredPaths(manifest)) {
      if (!shipped.has(path)) {
        failures.push(`${manifest.name}: declares "${path}" but the tarball does not contain it`);
      }
    }

    const status = failures.length === before ? "✓" : "✗";
    console.log(`${status} ${manifest.name} (${shipped.size} files)`);
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} packaging problem(s):`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log(`\nAll ${libs.length} package(s) ship what they declare.`);
