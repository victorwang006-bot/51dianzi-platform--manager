import { open, mkdir, readFile, rename, copyFile, chmod, writeFile, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { readPlan, SCOPE, TEAM_ID, ACTOR_ID, canonical, fileHash } from "./input";
import { executePlan, errorCode, type Checkpoint } from "./engine";

export async function atomicJson(path: string, value: unknown) {
  const temp = `${path}.tmp-${process.pid}`;
  const file = await open(temp, "w", 0o600);
  try { await file.writeFile(JSON.stringify(value, null, 2) + "\n"); await file.sync(); } finally { await file.close(); }
  await rename(temp, path);
  const directory = await open(dirname(path), "r");
  try { await directory.sync(); } finally { await directory.close(); }
}
async function existsJson(path: string) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch (error) {
    if ((error as any)?.code === "ENOENT") return undefined;
    throw Error("EXISTING_RECEIPT_UNREADABLE_DO_NOT_RECREATE");
  }
}
export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    input: { type: "string", default: "/home/ubuntu/materials/internal/adjusted_products.json" },
    output: { type: "string" },
    validate: { type: "boolean", default: false },
    "preflight-only": { type: "boolean", default: false },
    execute: { type: "boolean", default: false },
    "confirm-live-write": { type: "string" },
    "expected-session-version": { type: "string" },
    "retry-confirmed-not-found": { type: "string" },
  }, strict: true, allowPositionals: false });
  if (values.execute && values["preflight-only"]) throw Error("CHOOSE_ONE_MODE");
  if (values.execute && values["confirm-live-write"] !== SCOPE) throw Error("EXPLICIT_LIVE_WRITE_CONFIRMATION_REQUIRED");
  if (values["retry-confirmed-not-found"] && (!values.execute || !/^[a-f0-9]{64}$/.test(values["retry-confirmed-not-found"]))) throw Error("RETRY_REQUIRES_ONE_EXACT_ORIGINAL_REQUEST_ID");
  const expectedVersion = values["expected-session-version"] === undefined ? undefined : Number(values["expected-session-version"]);
  if (expectedVersion !== undefined && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)) throw Error("EXPECTED_SESSION_VERSION_INVALID");
  // This entire operation completes before importing the MySQL adapter or creating a pool.
  const { plan, sourceHash, bytes } = await readPlan(resolve(values.input!));
  const output = resolve(values.output ?? `${dirname(process.argv[1])}/receipts/${plan.datasetHash}`);
  await mkdir(output, { recursive: true, mode: 0o700 });
  await chmod(output, 0o700);
  const manifestPath = resolve(output, "input-manifest.json");
  const manifest = { scope: SCOPE, sourceHash, datasetHash: plan.datasetHash, products: plan.rows.length, tiers: plan.tierCount, zeroStock: plan.zeroStockCount, actorAdminUserId: ACTOR_ID, teamId: TEAM_ID, importBatchLimit: 500, publishBatchLimit: 100, sourceTable: "official_mall_source_data" };
  const existingManifest = await existsJson(manifestPath);
  if (existingManifest && canonical(existingManifest) !== canonical(manifest)) throw Error("OUTPUT_ALREADY_BOUND_TO_DIFFERENT_SOURCE");
  const privatePath = resolve(output, "private-source-input.json-or-jsonl");
  if (!existingManifest) {
    // Byte-exact source backup retains all original metadata, including numeric lexemes.
    await writeFile(privatePath, bytes, { mode: 0o600, flag: "wx" });
    await chmod(privatePath, 0o600);
    await atomicJson(manifestPath, manifest);
  }
  if (fileHash(await readFile(privatePath)) !== sourceHash) throw Error("PRIVATE_SOURCE_BACKUP_HASH_MISMATCH");
  console.log(JSON.stringify({ mode: values.execute ? "execute-requested" : values["preflight-only"] ? "preflight-requested" : "offline-validation", ...manifest }));
  if (!values.execute && !values["preflight-only"]) return manifest;

  // No dotenv, guessed credentials, JWT, account change, SSH, migration or remote command.
  const { createNativeAdapter } = await import("./native");
  const native = createNativeAdapter(process.env.DATABASE_URL ?? "", plan);
  const checkpointPath = resolve(output, "receipt.json");
  const lockPath = resolve(output, "execution.lock");
  let lock: Awaited<ReturnType<typeof open>> | undefined;
  try {
    if (values.execute) {
      // A crashed process leaves the lock; only an operator may remove it after verification.
      lock = await open(lockPath, "wx", 0o600);
      await lock.writeFile(JSON.stringify({ pid: process.pid, scope: SCOPE, datasetHash: plan.datasetHash }) + "\n");
      await lock.sync();
    }
    const saved = await existsJson(checkpointPath) as Checkpoint | undefined;
    if (saved && (saved.datasetHash !== plan.datasetHash || saved.sourceHash !== sourceHash)) throw Error("CHECKPOINT_INPUT_HASH_MISMATCH");
    const preflight = await native.preflight(saved, expectedVersion);
    await atomicJson(resolve(output, "database-preflight.json"), preflight);
    if (values["preflight-only"]) {
      console.log(JSON.stringify({ mode: "preflight-completed-no-domain-writes", actorAdminUserId: preflight.actor.adminUserId, sessionVersion: preflight.actor.sessionVersion, teamId: TEAM_ID, baselineCount: preflight.baseline.length }));
      return preflight;
    }
    const checkpoint: Checkpoint = saved ?? {
      version: 1, scope: SCOPE, datasetHash: plan.datasetHash, sourceHash,
      actor: preflight.actor, teamId: TEAM_ID, baseline: preflight.baseline,
      imports: [], publications: [], sourceMetadata: [], ids: [], state: "ready",
    };
    await atomicJson(checkpointPath, checkpoint);
    const result = await executePlan(plan, checkpoint, {
      ...native.operations(checkpoint),
      persist: checkpoint => atomicJson(checkpointPath, checkpoint),
      retryConfirmedNotFound: values["retry-confirmed-not-found"],
      progress: (phase, completed, total) => console.log(JSON.stringify({ phase, completed, total })),
    });
    await atomicJson(resolve(output, "final-receipt.json"), result);
    console.log(JSON.stringify({ state: result.state, importedIds: result.ids.length, publishBatches: result.publications.length, verification: result.verification }));
    return result;
  } finally {
    await native.close();
    if (lock) { await lock.close(); await unlink(lockPath); }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    // Print neither driver messages nor stack/SQL/DSN; inspect secure receipts for native results.
    console.error(JSON.stringify({ state: "stopped", code: errorCode(error), reason: error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "SEE_PRIVATE_RECEIPTS_AND_RECONCILE_ORIGINAL_REQUEST" }));
    process.exitCode = 1;
  });
}
