import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8")
);
const expectedManager = "pnpm@10.4.1";
assert.equal(
  pkg.packageManager.split("+")[0],
  expectedManager,
  "Review this guard before changing the pinned pnpm version"
);
assert.equal(
  pkg.pnpm?.patchedDependencies?.["wouter@3.7.1"],
  "patches/wouter@3.7.1.patch",
  "Pinned pnpm 10.4.1 must retain the effective root patch configuration"
);
assert.equal(
  pkg.pnpm?.overrides?.["tailwindcss>nanoid"],
  "3.3.7",
  "Existing override must be retained"
);
const lock = fs.readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8");
assert.ok(
  lock.includes("patchedDependencies:"),
  "Lockfile lost its patch metadata"
);
assert.ok(
  lock.includes(
    "patch_hash=4e16e6ff3fde7d6c1024d3e0c8605dc9eb6afb690d0d49958c2f449091813072"
  ),
  "Lockfile no longer selects the expected patched wouter"
);
const installed = fs.readFileSync(
  path.join(root, "node_modules/wouter/esm/index.js"),
  "utf8"
);
assert.ok(
  installed.includes("__WOUTER_ROUTES__"),
  "Installed wouter lacks the existing route collection patch"
);
console.log(
  "Pinned package-manager configuration, lock metadata, and installed wouter patch verified."
);
