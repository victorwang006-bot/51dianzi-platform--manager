#!/usr/bin/env node
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import mysql from "mysql2/promise";

const LOCK_NAME = "dianzi51_external_catalog_activate_v1";

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = argv[index + 1];
    if (!token.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(`invalid argument near ${token}`);
    }
    values.set(token, value);
    index += 1;
  }
  const batchId = Number(values.get("--batch-id"));
  if (!Number.isSafeInteger(batchId) || batchId <= 0) {
    throw new Error("--batch-id must be a positive integer");
  }
  return {
    batchId,
    ecosystemConfig: values.get("--from-ecosystem-config")
      ? resolve(values.get("--from-ecosystem-config"))
      : undefined,
  };
}

function databaseUrlFromEcosystem(configPath) {
  const require = createRequire(import.meta.url);
  const moduleId = require.resolve(configPath);
  delete require.cache[moduleId];
  const config = require(moduleId);
  const apps = Array.isArray(config?.apps) ? config.apps : [];
  const app = apps.find(item => item?.name === "dianzi51-admin") ?? apps[0];
  const databaseUrl = app?.env?.DATABASE_URL;
  return typeof databaseUrl === "string" ? databaseUrl.trim() : "";
}

async function activate(connection, batchId) {
  await connection.beginTransaction();
  try {
    const [[state]] = await connection.query(
      "SELECT activeBatchId FROM external_catalog_state WHERE id = 1 FOR UPDATE",
    );
    if (!state) throw new Error("external catalog state row is missing");
    const previousBatchId = state.activeBatchId === null ? null : Number(state.activeBatchId);

    const [[batch]] = await connection.query(
      `SELECT id, status, expectedRows, importedRows, validPriceRows, uniquePartKeys
         FROM external_catalog_batches
        WHERE id = ? FOR UPDATE`,
      [batchId],
    );
    if (!batch) throw new Error(`batch ${batchId} does not exist`);
    if (!["ready", "active", "archived"].includes(batch.status)) {
      throw new Error(`batch ${batchId} status ${batch.status} cannot be activated`);
    }

    const [[stats]] = await connection.query(
      `SELECT COUNT(*) AS importedRows,
              SUM(priceValue > 0) AS validPriceRows,
              COUNT(DISTINCT partNumberKey) AS uniquePartKeys,
              MIN(rowNo) AS minRowNo,
              MAX(rowNo) AS maxRowNo
         FROM external_catalog_entries
        WHERE batchId = ?`,
      [batchId],
    );
    const importedRows = Number(stats.importedRows);
    const validPriceRows = Number(stats.validPriceRows);
    const uniquePartKeys = Number(stats.uniquePartKeys);
    if (
      importedRows !== Number(batch.expectedRows) ||
      importedRows !== Number(batch.importedRows) ||
      validPriceRows !== Number(batch.validPriceRows) ||
      uniquePartKeys !== Number(batch.uniquePartKeys) ||
      Number(stats.minRowNo) !== 2 ||
      Number(stats.maxRowNo) !== importedRows + 1
    ) {
      throw new Error(`batch ${batchId} failed activation integrity checks`);
    }

    if (previousBatchId && previousBatchId !== batchId) {
      await connection.query(
        "UPDATE external_catalog_batches SET status = 'archived' WHERE id = ? AND status = 'active'",
        [previousBatchId],
      );
    }
    await connection.query(
      "UPDATE external_catalog_batches SET status = 'active', activatedAt = CURRENT_TIMESTAMP WHERE id = ?",
      [batchId],
    );
    await connection.query(
      "UPDATE external_catalog_state SET activeBatchId = ? WHERE id = 1",
      [batchId],
    );
    await connection.commit();
    return { previousBatchId, activeBatchId: batchId, importedRows, validPriceRows, uniquePartKeys };
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl =
    process.env.DATABASE_URL?.trim() ||
    (args.ecosystemConfig ? databaseUrlFromEcosystem(args.ecosystemConfig) : "");
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured");

  const connection = await mysql.createConnection(databaseUrl);
  let lockAcquired = false;
  try {
    const [[lock]] = await connection.query("SELECT GET_LOCK(?, 10) AS acquired", [LOCK_NAME]);
    lockAcquired = Number(lock.acquired) === 1;
    if (!lockAcquired) throw new Error("external catalog activation lock is busy");
    const result = await activate(connection, args.batchId);
    console.log(JSON.stringify({ ok: true, ...result }));
  } finally {
    if (lockAcquired) await connection.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME]);
    await connection.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

export { parseArgs, activate };
