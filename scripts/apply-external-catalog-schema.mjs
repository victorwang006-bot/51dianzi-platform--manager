#!/usr/bin/env node
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import mysql from "mysql2/promise";

const LOCK_NAME = "dianzi51_external_catalog_schema_v1";

function parseConfigPath(argv) {
  const index = argv.indexOf("--from-ecosystem-config");
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error("missing ecosystem config path");
  return resolve(value);
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

const statements = [
  `CREATE TABLE IF NOT EXISTS external_catalog_batches (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    sourceFileName VARCHAR(255) NOT NULL,
    sourceSha256 CHAR(64) NOT NULL,
    dataSha256 CHAR(64) NOT NULL,
    expectedRows INT UNSIGNED NOT NULL,
    importedRows INT UNSIGNED NOT NULL DEFAULT 0,
    validPriceRows INT UNSIGNED NOT NULL DEFAULT 0,
    uniquePartKeys INT UNSIGNED NOT NULL DEFAULT 0,
    status ENUM('importing','ready','active','failed','archived') NOT NULL DEFAULT 'importing',
    errorMessage TEXT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completedAt TIMESTAMP NULL DEFAULT NULL,
    activatedAt TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY external_catalog_batches_sourceSha256_unique (sourceSha256),
    KEY external_catalog_batches_status_idx (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
  `CREATE TABLE IF NOT EXISTS external_catalog_entries (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    batchId BIGINT UNSIGNED NOT NULL,
    rowNo INT UNSIGNED NOT NULL,
    sourceSequenceRaw VARCHAR(64) NULL,
    partNumberRaw VARCHAR(128) NOT NULL,
    partNumberKey VARCHAR(128) NOT NULL,
    partNumberCompactKey VARCHAR(128) NOT NULL,
    priceRaw VARCHAR(32) NOT NULL,
    priceValue DECIMAL(20,6) NULL,
    quantityThresholdRaw VARCHAR(32) NOT NULL,
    quantityThresholdValue BIGINT UNSIGNED NOT NULL,
    productNameRaw VARCHAR(256) NULL,
    brandRaw VARCHAR(128) NULL,
    categoryRaw VARCHAR(64) NULL,
    packageRaw VARCHAR(64) NULL,
    parametersRaw TEXT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY external_catalog_entries_batch_row_idx (batchId, rowNo),
    KEY external_catalog_entries_batch_part_idx (batchId, partNumberKey),
    KEY external_catalog_entries_batch_compact_idx (batchId, partNumberCompactKey)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
  `CREATE TABLE IF NOT EXISTS external_catalog_state (
    id INT UNSIGNED NOT NULL,
    activeBatchId BIGINT UNSIGNED NULL,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
  `INSERT INTO external_catalog_state (id, activeBatchId)
   VALUES (1, NULL)
   ON DUPLICATE KEY UPDATE id = VALUES(id)`,
];

async function verify(connection) {
  const requiredTables = ["external_catalog_batches", "external_catalog_entries", "external_catalog_state"];
  const [tables] = await connection.query(
    "SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?,?,?)",
    requiredTables,
  );
  const present = new Set(tables.map(row => row.tableName));
  const missing = requiredTables.filter(name => !present.has(name));
  if (missing.length > 0) throw new Error(`schema verification missing tables: ${missing.join(", ")}`);

  const [indexes] = await connection.query(
    `SELECT INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique,
            GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnsList
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'external_catalog_entries'
      GROUP BY INDEX_NAME, NON_UNIQUE`,
  );
  const indexMap = new Map(indexes.map(row => [row.indexName, {
    nonUnique: Number(row.nonUnique),
    columns: row.columnsList,
  }]));
  const requiredIndexes = {
    external_catalog_entries_batch_row_idx: { nonUnique: 0, columns: "batchId,rowNo" },
    external_catalog_entries_batch_part_idx: { nonUnique: 1, columns: "batchId,partNumberKey" },
    external_catalog_entries_batch_compact_idx: { nonUnique: 1, columns: "batchId,partNumberCompactKey" },
  };
  for (const [name, expected] of Object.entries(requiredIndexes)) {
    const actual = indexMap.get(name);
    if (!actual || actual.nonUnique !== expected.nonUnique || actual.columns !== expected.columns) {
      throw new Error(`schema verification failed for index ${name}`);
    }
  }
  const [[state]] = await connection.query("SELECT COUNT(*) AS count FROM external_catalog_state WHERE id = 1");
  if (Number(state.count) !== 1) throw new Error("external catalog state row is missing");
  return { tables: requiredTables, indexes: Object.keys(requiredIndexes), stateRow: 1 };
}

async function main() {
  const configPath = parseConfigPath(process.argv.slice(2));
  const databaseUrl =
    process.env.DATABASE_URL?.trim() ||
    (configPath ? databaseUrlFromEcosystem(configPath) : "");
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured");

  const connection = await mysql.createConnection(databaseUrl);
  let lockAcquired = false;
  try {
    const [[lock]] = await connection.query("SELECT GET_LOCK(?, 10) AS acquired", [LOCK_NAME]);
    lockAcquired = Number(lock.acquired) === 1;
    if (!lockAcquired) throw new Error("external catalog schema migration lock is busy");
    for (const statement of statements) await connection.query(statement);
    const result = await verify(connection);
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

export { parseConfigPath, verify };
