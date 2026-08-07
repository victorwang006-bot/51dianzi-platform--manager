#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import mysql from "mysql2/promise";

const LOCK_NAME = "dianzi51_external_catalog_import_v1";
const REQUIRED_FIELDS = [
  "rowNo",
  "partNumberRaw",
  "partNumberKey",
  "partNumberCompactKey",
  "priceRaw",
  "quantityThresholdRaw",
  "quantityThresholdValue",
];
const INSERT_COLUMNS = [
  "batchId",
  "rowNo",
  "sourceSequenceRaw",
  "partNumberRaw",
  "partNumberKey",
  "partNumberCompactKey",
  "priceRaw",
  "priceValue",
  "quantityThresholdRaw",
  "quantityThresholdValue",
  "productNameRaw",
  "brandRaw",
  "categoryRaw",
  "packageRaw",
  "parametersRaw",
];

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`unexpected argument: ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${token}`);
    values.set(token, value);
    index += 1;
  }
  const artifact = values.get("--artifact");
  const manifest = values.get("--manifest");
  if (!artifact || !manifest) {
    throw new Error("usage: import-external-catalog.mjs --artifact FILE --manifest FILE [--from-ecosystem-config FILE] [--batch-size N]");
  }
  const batchSize = Number(values.get("--batch-size") ?? "1000");
  if (!Number.isSafeInteger(batchSize) || batchSize < 100 || batchSize > 2000) {
    throw new Error("batch size must be an integer between 100 and 2000");
  }
  return {
    artifact: resolve(artifact),
    manifest: resolve(manifest),
    ecosystemConfig: values.get("--from-ecosystem-config")
      ? resolve(values.get("--from-ecosystem-config"))
      : undefined,
    batchSize,
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

async function sha256File(path) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}

function readManifest(path) {
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  if (manifest.formatVersion !== 1) throw new Error("unsupported manifest formatVersion");
  const integerFields = ["rowCount", "validPriceRows", "uniquePartKeys"];
  for (const field of integerFields) {
    if (!Number.isSafeInteger(manifest[field]) || manifest[field] <= 0) {
      throw new Error(`manifest ${field} must be a positive integer`);
    }
  }
  for (const field of ["sourceSha256", "artifactSha256", "dataSha256"]) {
    if (!/^[a-f0-9]{64}$/.test(manifest[field] ?? "")) {
      throw new Error(`manifest ${field} is invalid`);
    }
  }
  if (typeof manifest.sourceFileName !== "string" || !manifest.sourceFileName.trim()) {
    throw new Error("manifest sourceFileName is invalid");
  }
  if (typeof manifest.artifactFileName !== "string" || !manifest.artifactFileName.trim()) {
    throw new Error("manifest artifactFileName is invalid");
  }
  return manifest;
}

function validateRecord(record, expectedRowNo) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error(`row ${expectedRowNo}: record must be an object`);
  }
  for (const field of REQUIRED_FIELDS) {
    if (record[field] === null || record[field] === undefined || record[field] === "") {
      throw new Error(`row ${expectedRowNo}: ${field} is required`);
    }
  }
  if (record.rowNo !== expectedRowNo) {
    throw new Error(`row sequence mismatch: expected ${expectedRowNo}, got ${record.rowNo}`);
  }
  if (
    record.priceValue !== null &&
    record.priceValue !== undefined &&
    !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(String(record.priceValue))
  ) {
    throw new Error(`row ${expectedRowNo}: priceValue is invalid`);
  }
  if (!/^\d+$/.test(String(record.quantityThresholdValue))) {
    throw new Error(`row ${expectedRowNo}: quantityThresholdValue is invalid`);
  }
}

function valuesForInsert(batchId, record) {
  return [
    batchId,
    record.rowNo,
    record.sourceSequenceRaw ?? null,
    record.partNumberRaw,
    record.partNumberKey,
    record.partNumberCompactKey,
    record.priceRaw,
    record.priceValue,
    record.quantityThresholdRaw,
    record.quantityThresholdValue,
    record.productNameRaw ?? null,
    record.brandRaw ?? null,
    record.categoryRaw ?? null,
    record.packageRaw ?? null,
    record.parametersRaw ?? null,
  ];
}

async function insertChunk(connection, rows) {
  if (rows.length === 0) return;
  const rowPlaceholder = `(${INSERT_COLUMNS.map(() => "?").join(",")})`;
  const sql = `INSERT INTO external_catalog_entries (${INSERT_COLUMNS.map(column => `\`${column}\``).join(",")}) VALUES ${rows.map(() => rowPlaceholder).join(",")}`;
  await connection.query(sql, rows.flat());
}

async function ensureTables(connection) {
  const required = ["external_catalog_batches", "external_catalog_entries", "external_catalog_state"];
  const [rows] = await connection.query(
    "SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?,?,?)",
    required,
  );
  const present = new Set(rows.map(row => row.tableName));
  const missing = required.filter(name => !present.has(name));
  if (missing.length > 0) throw new Error(`external catalog schema is missing: ${missing.join(", ")}`);
}

async function createOrResetBatch(connection, manifest) {
  const [existingRows] = await connection.query(
    "SELECT id, status, importedRows, validPriceRows, uniquePartKeys, dataSha256 FROM external_catalog_batches WHERE sourceSha256 = ? LIMIT 1",
    [manifest.sourceSha256],
  );
  const existing = existingRows[0];
  if (existing && ["ready", "active", "archived"].includes(existing.status)) {
    const complete =
      Number(existing.importedRows) === manifest.rowCount &&
      Number(existing.validPriceRows) === manifest.validPriceRows &&
      Number(existing.uniquePartKeys) === manifest.uniquePartKeys &&
      existing.dataSha256 === manifest.dataSha256;
    if (!complete) throw new Error("existing completed batch conflicts with manifest");
    return { batchId: Number(existing.id), alreadyComplete: true, status: existing.status };
  }

  if (existing) {
    const batchId = Number(existing.id);
    await connection.beginTransaction();
    try {
      await connection.query("DELETE FROM external_catalog_entries WHERE batchId = ?", [batchId]);
      await connection.query(
        `UPDATE external_catalog_batches
            SET sourceFileName = ?, dataSha256 = ?, expectedRows = ?, importedRows = 0,
                validPriceRows = 0, uniquePartKeys = 0, status = 'importing',
                errorMessage = NULL, completedAt = NULL, activatedAt = NULL
          WHERE id = ?`,
        [manifest.sourceFileName, manifest.dataSha256, manifest.rowCount, batchId],
      );
      await connection.commit();
      return { batchId, alreadyComplete: false, status: "importing" };
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  }

  const [result] = await connection.query(
    `INSERT INTO external_catalog_batches
      (sourceFileName, sourceSha256, dataSha256, expectedRows, status)
     VALUES (?, ?, ?, ?, 'importing')`,
    [manifest.sourceFileName, manifest.sourceSha256, manifest.dataSha256, manifest.rowCount],
  );
  return { batchId: Number(result.insertId), alreadyComplete: false, status: "importing" };
}

async function importArtifact(connection, artifactPath, manifest, batchId, batchSize) {
  const input = createReadStream(artifactPath).pipe(createGunzip());
  const lines = createInterface({ input, crlfDelay: Infinity });
  const dataHash = createHash("sha256");
  const chunk = [];
  let count = 0;
  let expectedRowNo = 2;

  for await (const line of lines) {
    if (!line) continue;
    const canonicalLine = `${line}\n`;
    dataHash.update(canonicalLine, "utf8");
    const record = JSON.parse(line);
    validateRecord(record, expectedRowNo);
    chunk.push(valuesForInsert(batchId, record));
    count += 1;
    expectedRowNo += 1;
    if (chunk.length >= batchSize) {
      await insertChunk(connection, chunk);
      chunk.length = 0;
    }
  }
  await insertChunk(connection, chunk);

  const calculatedHash = dataHash.digest("hex");
  if (calculatedHash !== manifest.dataSha256) throw new Error("canonical data SHA-256 mismatch");
  if (count !== manifest.rowCount) {
    throw new Error(`row count mismatch: expected ${manifest.rowCount}, got ${count}`);
  }
}

async function verifyAndComplete(connection, batchId, manifest) {
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
  const actual = {
    importedRows: Number(stats.importedRows),
    validPriceRows: Number(stats.validPriceRows),
    uniquePartKeys: Number(stats.uniquePartKeys),
    minRowNo: Number(stats.minRowNo),
    maxRowNo: Number(stats.maxRowNo),
  };
  const expectedMaxRowNo = manifest.rowCount + 1;
  if (
    actual.importedRows !== manifest.rowCount ||
    actual.validPriceRows !== manifest.validPriceRows ||
    actual.uniquePartKeys !== manifest.uniquePartKeys ||
    actual.minRowNo !== 2 ||
    actual.maxRowNo !== expectedMaxRowNo
  ) {
    throw new Error(`database verification failed: ${JSON.stringify(actual)}`);
  }
  await connection.query(
    `UPDATE external_catalog_batches
        SET importedRows = ?, validPriceRows = ?, uniquePartKeys = ?,
            status = 'ready', completedAt = CURRENT_TIMESTAMP, errorMessage = NULL
      WHERE id = ? AND status = 'importing'`,
    [actual.importedRows, actual.validPriceRows, actual.uniquePartKeys, batchId],
  );
  return actual;
}

async function markFailed(connection, batchId, error) {
  const message = error instanceof Error ? error.message : String(error);
  await connection.query(
    "UPDATE external_catalog_batches SET status = 'failed', errorMessage = ? WHERE id = ? AND status = 'importing'",
    [message.slice(0, 4000), batchId],
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = readManifest(args.manifest);
  if (basename(args.artifact) !== manifest.artifactFileName) {
    throw new Error("artifact file name does not match manifest");
  }
  const artifactHash = await sha256File(args.artifact);
  if (artifactHash !== manifest.artifactSha256) throw new Error("artifact SHA-256 mismatch");

  const databaseUrl =
    process.env.DATABASE_URL?.trim() ||
    (args.ecosystemConfig ? databaseUrlFromEcosystem(args.ecosystemConfig) : "");
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured");

  const connection = await mysql.createConnection(databaseUrl);
  let lockAcquired = false;
  let batchId;
  try {
    await ensureTables(connection);
    const [[lock]] = await connection.query("SELECT GET_LOCK(?, 10) AS acquired", [LOCK_NAME]);
    lockAcquired = Number(lock.acquired) === 1;
    if (!lockAcquired) throw new Error("another external catalog import is running");

    const batch = await createOrResetBatch(connection, manifest);
    batchId = batch.batchId;
    if (batch.alreadyComplete) {
      console.log(JSON.stringify({ batchId, status: batch.status, idempotent: true }));
      return;
    }

    await importArtifact(connection, args.artifact, manifest, batchId, args.batchSize);
    const stats = await verifyAndComplete(connection, batchId, manifest);
    console.log(JSON.stringify({ batchId, status: "ready", idempotent: false, ...stats }));
  } catch (error) {
    if (batchId) {
      try {
        await markFailed(connection, batchId, error);
      } catch {
        // Preserve the original failure; incomplete batches are never activated.
      }
    }
    throw error;
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

export {
  parseArgs,
  readManifest,
  validateRecord,
  valuesForInsert,
};
