import { accessSync, constants, readFileSync, realpathSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

const MIGRATION_ROOT = "/home/ubuntu/51_migration_20261029";
const NETWORK_GUARD = resolve(MIGRATION_ROOT, "tests/local-network-only.so");

type FrozenEnvironmentManifest = {
  mode: "frozen-full";
  sourceRoot: string;
  label: string;
  allowedDatabaseUrls: string[];
  productionCredentials: false;
};

/** Only a parent-created, explicit frozen source/environment pair can use this path. */
export function isAllowedFrozenTestDatabase(value: string): boolean {
  if (process.env.MIGRATION_FROZEN_MODE !== "frozen-full") return false;
  if (process.env.NODE_ENV !== "test" || process.env.LD_PRELOAD !== NETWORK_GUARD) return false;
  const sourceRoot = process.env.MIGRATION_FROZEN_SOURCE_ROOT;
  const manifestPath = process.env.MIGRATION_FROZEN_ENV_MANIFEST;
  if (!sourceRoot || !manifestPath) return false;
  try {
    accessSync(NETWORK_GUARD, constants.R_OK);
    const absoluteSourceRoot = realpathSync(sourceRoot);
    const absoluteCurrentDirectory = realpathSync(process.cwd());
    const snapshotDirectory = resolve(MIGRATION_ROOT, "frozen-candidates");
    if (!absoluteSourceRoot.startsWith(snapshotDirectory + sep)) return false;
    if (!/^[a-z][a-z0-9-]{0,30}$/.test(absoluteSourceRoot.slice(snapshotDirectory.length + 1))) return false;
    if (![resolve(absoluteSourceRoot, "front"), resolve(absoluteSourceRoot, "admin")].includes(absoluteCurrentDirectory)) return false;
    const absoluteManifest = realpathSync(manifestPath);
    const expectedManifest = resolve(MIGRATION_ROOT, "verification-logs", absoluteSourceRoot.slice(snapshotDirectory.length + 1), "test-environment-manifest.json");
    if (absoluteManifest !== expectedManifest) return false;
    const manifest = JSON.parse(readFileSync(absoluteManifest, "utf8")) as FrozenEnvironmentManifest;
    if (manifest.mode !== "frozen-full" || manifest.sourceRoot !== absoluteSourceRoot || manifest.productionCredentials !== false) return false;
    if (manifest.label !== absoluteSourceRoot.slice(snapshotDirectory.length + 1)) return false;
    const url = new URL(value);
    if (url.protocol !== "mysql:" || url.hostname !== "127.0.0.1" || url.port !== "13307" || url.username !== "root" || url.password !== "") return false;
    if (!/^\/migration_frozen_[a-z0-9_]+_test$/.test(url.pathname)) return false;
    return Array.isArray(manifest.allowedDatabaseUrls) && manifest.allowedDatabaseUrls.includes(url.href);
  } catch {
    return false;
  }
}

/** Common test guard: caller-specific normal schema, or exact frozen manifest only. */
export function assertGuardedTestDatabase(value: string, normalDatabasePattern: RegExp): string {
  if (process.env.NODE_ENV !== "test") throw new Error("TEST_DATABASE_REQUIRES_NODE_ENV_TEST");
  if (process.env.LD_PRELOAD !== NETWORK_GUARD) throw new Error("TEST_DATABASE_REQUIRES_EXACT_NETWORK_GUARD");
  accessSync(NETWORK_GUARD, constants.R_OK);
  const url = new URL(value);
  if (url.protocol !== "mysql:" || url.hostname !== "127.0.0.1" || url.port !== "13307" || url.username !== "root" || url.password !== "") {
    throw new Error("TEST_DATABASE_LOOPBACK_CREDENTIALS_REJECTED");
  }
  if (!normalDatabasePattern.test(url.pathname) && !isAllowedFrozenTestDatabase(url.href)) {
    throw new Error("TEST_DATABASE_NOT_IN_EXPLICIT_ALLOWLIST");
  }
  return url.href;
}
