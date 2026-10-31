#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import mysql from "mysql2/promise";

const TEST_DATABASE_URL = "mysql://root@127.0.0.1:13307/migration_admin_test";
const CONTROLLED_PRODUCTION_MODE = "controlled-0027-business-merchant-scopes";
const CONTROLLED_PRODUCTION_APPROVAL = "approved-0027-business-merchant-scopes";
const migrationPath = fileURLToPath(
  new URL("../drizzle/0027_business_merchant_scopes.sql", import.meta.url),
);
const migrationSql = await readFile(migrationPath, "utf8");
const migrationHash = createHash("sha256").update(migrationSql).digest("hex");
const statements = migrationSql
  .split(/^\s*--> statement-breakpoint\s*$/m)
  .map(statement => statement.trim())
  .filter(Boolean);

if (statements.length !== 6) {
  throw new Error("BUSINESS_MERCHANT_SCOPE_SOURCE_SQL_BREAKPOINTS_INVALID");
}

const expectedStatementStarts = [
  "CREATE TABLE `admin_business_merchant_scopes`",
  "CREATE INDEX `admin_business_merchant_scopes_admin_status_idx`",
  "CREATE INDEX `admin_business_merchant_scopes_merchant_status_idx`",
  "CREATE TABLE `admin_business_merchant_scope_audits`",
  "CREATE INDEX `admin_business_merchant_scope_audits_admin_created_idx`",
  "CREATE INDEX `admin_business_merchant_scope_audits_merchant_created_idx`",
];
if (statements.some((statement, index) => !statement.startsWith(expectedStatementStarts[index]))) {
  throw new Error("BUSINESS_MERCHANT_SCOPE_SOURCE_SQL_NOT_PURE_CREATE");
}

function exactTestDatabase(url) {
  return url.href === TEST_DATABASE_URL;
}

function approvedControlledProduction(url) {
  return process.env.NODE_ENV === "production"
    && process.env.BUSINESS_MERCHANT_SCOPE_SCHEMA_MODE === CONTROLLED_PRODUCTION_MODE
    && process.env.BUSINESS_MERCHANT_SCOPE_SCHEMA_APPROVAL === CONTROLLED_PRODUCTION_APPROVAL
    && process.env.BUSINESS_MERCHANT_SCOPE_SCHEMA_SQL_SHA256 === migrationHash
    && process.env.BUSINESS_MERCHANT_SCOPE_SCHEMA_DATABASE_URL === url.href;
}

/** Frozen test targets are exact parent-owned URLs, never a permissive DB prefix. */
async function approvedFrozenTest(url) {
  if (process.env.NODE_ENV !== "test" || process.env.MIGRATION_FROZEN_MODE !== "frozen-full") return false;
  if (url.hostname !== "127.0.0.1" || url.port !== "13307" || url.username !== "root" || url.password || url.search || url.hash) return false;
  const root = "/home/ubuntu/51_migration_20261029";
  const sourceRoot = process.env.MIGRATION_FROZEN_SOURCE_ROOT;
  const manifestPath = process.env.MIGRATION_FROZEN_ENV_MANIFEST;
  if (!sourceRoot || !manifestPath) return false;
  const label = path.basename(sourceRoot);
  if (!/^[a-z][a-z0-9-]{0,30}$/.test(label)
    || sourceRoot !== path.join(root, "frozen-candidates", label)
    || manifestPath !== path.join(root, "verification-logs", label, "test-environment-manifest.json")) return false;
  const selfPath = fileURLToPath(import.meta.url);
  if (await realpath(selfPath) !== path.join(sourceRoot, "admin", "scripts", path.basename(selfPath))) return false;
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const fixedPath = path.join(root, "verification-logs", label, "fixed-source-manifest.json");
  if (manifest.mode !== "frozen-full" || manifest.label !== label || manifest.sourceRoot !== sourceRoot
    || manifest.productionCredentials !== false || manifest.fixedSourceManifestPath !== fixedPath) return false;
  const fixedBytes = await readFile(fixedPath);
  if (createHash("sha256").update(fixedBytes).digest("hex") !== manifest.fixedSourceManifestSha256) return false;
  const fixed = JSON.parse(fixedBytes.toString("utf8"));
  if (createHash("sha256").update(JSON.stringify(fixed.admin.source)).digest("hex") !== fixed.admin.aggregateSha256
    || fixed.admin.aggregateSha256 !== manifest.sourceHashes.admin) return false;
  for (const [relative, file] of [["drizzle/0027_business_merchant_scopes.sql", migrationPath], ["scripts/apply-business-merchant-scope-schema.mjs", selfPath]]) {
    const row = fixed.admin.source.find(entry => entry.path === relative);
    const bytes = await readFile(file);
    if (!row || row.bytes !== bytes.length || row.sha256 !== createHash("sha256").update(bytes).digest("hex")) return false;
  }
  const guard = path.join(root, "tests", "local-network-only.so");
  if (process.env.LD_PRELOAD !== guard || manifest.guard.path !== guard
    || createHash("sha256").update(await readFile(guard)).digest("hex") !== manifest.guard.sha256) return false;
  if (url.href === manifest.databaseUrls.ADMIN_DB_URL && manifest.allowedDatabaseUrls.includes(url.href)) return true;
  // Rollback uses two separately owned admin databases, explicitly registered
  // by the parent; platform databases and every other loopback URL stay denied.
  const version = /^migration-(v\d+)$/.exec(label)?.[1];
  if (!version) return false;
  const rollbackUrls = [
    `mysql://root@127.0.0.1:13307/migration_rollback_${version}_r1029rollout_admin_test`,
    `mysql://root@127.0.0.1:13307/migration_rollback_${version}_r1029rollout_admin_restore_test`,
  ];
  if (!rollbackUrls.includes(url.href)) return false;
  const owned = JSON.parse(await readFile(path.join(root, "verification-logs", label, "rollback-rehearsal", "source-owned-schema-targets.json"), "utf8"));
  return owned.mode === "parent_owned_rollback_schema_only" && owned.label === label
    && owned.sourceRoot === sourceRoot && owned.sqlSha256 === migrationHash
    && owned.fixedSourceManifestSha256 === manifest.fixedSourceManifestSha256
    && JSON.stringify(owned.adminDatabaseUrls) === JSON.stringify(rollbackUrls);
}

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error("DATABASE_URL 未设置；拒绝猜测、读取环境文件或连接运行时配置");
}

let parsed;
try {
  parsed = new URL(databaseUrl);
} catch {
  throw new Error("BUSINESS_MERCHANT_SCOPE_DATABASE_URL_INVALID");
}

if (
  parsed.protocol !== "mysql:"
  || (!exactTestDatabase(parsed) && !approvedControlledProduction(parsed) && !await approvedFrozenTest(parsed))
) {
  throw new Error(
    "BUSINESS_MERCHANT_SCOPE_SCHEMA_TARGET_REJECTED: 仅允许精确本机专库及同冻结清单登记目标；生产仅允许带源 SQL 哈希的显式受控批准模式",
  );
}

const databaseName = decodeURIComponent(parsed.pathname.slice(1));
const connection = await mysql.createConnection(databaseUrl);
let locked = false;

async function tableExists(tableName) {
  const [rows] = await connection.query(
    `SELECT 1 AS present
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName],
  );
  return rows.length === 1;
}

async function indexMetadata(tableName, indexName) {
  const [rows] = await connection.query(
    `SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique, SEQ_IN_INDEX AS sequenceNumber,
            COLUMN_NAME AS columnName
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
      ORDER BY SEQ_IN_INDEX`,
    [tableName, indexName],
  );
  return rows;
}

async function assertIndex(tableName, indexName, unique, columns) {
  const rows = await indexMetadata(tableName, indexName);
  const actualColumns = rows.map(row => row.columnName);
  if (
    rows.length !== columns.length
    || rows.some(row => Number(row.nonUnique) !== (unique ? 0 : 1))
    || JSON.stringify(actualColumns) !== JSON.stringify(columns)
  ) {
    throw new Error(`BUSINESS_MERCHANT_SCOPE_INDEX_INVALID:${tableName}.${indexName}`);
  }
}

async function assertColumns(tableName, requirements) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS columnType, IS_NULLABLE AS nullable,
            COLUMN_DEFAULT AS defaultValue, EXTRA AS extraValue
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName],
  );
  const columns = new Map(rows.map(row => [row.name, row]));
  for (const requirement of requirements) {
    const actual = columns.get(requirement.name);
    if (!actual) {
      throw new Error(`BUSINESS_MERCHANT_SCOPE_COLUMN_MISSING:${tableName}.${requirement.name}`);
    }
    if (String(actual.columnType).toLowerCase() !== requirement.type) {
      throw new Error(`BUSINESS_MERCHANT_SCOPE_COLUMN_TYPE_INVALID:${tableName}.${requirement.name}`);
    }
    if (String(actual.nullable) !== requirement.nullable) {
      throw new Error(`BUSINESS_MERCHANT_SCOPE_COLUMN_NULLABILITY_INVALID:${tableName}.${requirement.name}`);
    }
    if (requirement.defaultValue !== undefined && String(actual.defaultValue) !== requirement.defaultValue) {
      throw new Error(`BUSINESS_MERCHANT_SCOPE_COLUMN_DEFAULT_INVALID:${tableName}.${requirement.name}`);
    }
    if (requirement.autoIncrement && !String(actual.extraValue).toLowerCase().includes("auto_increment")) {
      throw new Error(`BUSINESS_MERCHANT_SCOPE_COLUMN_AUTOINCREMENT_INVALID:${tableName}.${requirement.name}`);
    }
  }
}

async function assertCheckConstraint(tableName, constraintName) {
  const [rows] = await connection.query(
    `SELECT tc.CONSTRAINT_NAME AS name, cc.CHECK_CLAUSE AS checkClause
       FROM information_schema.TABLE_CONSTRAINTS tc
       JOIN information_schema.CHECK_CONSTRAINTS cc
         ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
        AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
      WHERE tc.TABLE_SCHEMA = DATABASE()
        AND tc.TABLE_NAME = ?
        AND tc.CONSTRAINT_TYPE = 'CHECK'
        AND tc.CONSTRAINT_NAME = ?`,
    [tableName, constraintName],
  );
  const clause = rows[0]?.checkClause;
  const normalized = String(clause ?? "")
    .replace(/[\s`()\\]/g, "")
    .replace(/_utf8mb4/gi, "")
    .toLowerCase();
  if (
    rows.length !== 1
    || !normalized.includes("status='active'")
    || !normalized.includes("json_lengthmodulepermissions>0")
    || !normalized.includes("status='revoked'")
  ) {
    throw new Error(`BUSINESS_MERCHANT_SCOPE_CHECK_INVALID:${tableName}.${constraintName}`);
  }
}

async function assertScopeTable(indexes = []) {
  await assertColumns("admin_business_merchant_scopes", [
    { name: "id", type: "int", nullable: "NO", autoIncrement: true },
    { name: "adminUserId", type: "int", nullable: "NO" },
    { name: "merchantId", type: "int", nullable: "NO" },
    { name: "status", type: "enum('active','revoked')", nullable: "NO", defaultValue: "revoked" },
    { name: "scopeVersion", type: "int unsigned", nullable: "NO", defaultValue: "1" },
    { name: "modulePermissions", type: "json", nullable: "NO" },
    { name: "createdByAdminUserId", type: "int", nullable: "NO" },
    { name: "updatedByAdminUserId", type: "int", nullable: "NO" },
    { name: "revokedByAdminUserId", type: "int", nullable: "YES" },
    { name: "revokedAt", type: "timestamp", nullable: "YES" },
    { name: "createdAt", type: "timestamp", nullable: "NO", defaultValue: "CURRENT_TIMESTAMP" },
    { name: "updatedAt", type: "timestamp", nullable: "NO", defaultValue: "CURRENT_TIMESTAMP" },
  ]);
  await assertIndex("admin_business_merchant_scopes", "PRIMARY", true, ["id"]);
  await assertIndex(
    "admin_business_merchant_scopes",
    "admin_business_merchant_scopes_admin_merchant_unique",
    true,
    ["adminUserId", "merchantId"],
  );
  if (indexes.includes("adminStatus")) {
    await assertIndex(
      "admin_business_merchant_scopes",
      "admin_business_merchant_scopes_admin_status_idx",
      false,
      ["adminUserId", "status", "updatedAt"],
    );
  }
  if (indexes.includes("merchantStatus")) {
    await assertIndex(
      "admin_business_merchant_scopes",
      "admin_business_merchant_scopes_merchant_status_idx",
      false,
      ["merchantId", "status"],
    );
  }
  await assertCheckConstraint(
    "admin_business_merchant_scopes",
    "admin_business_merchant_scopes_active_modules_check",
  );
}

async function assertAuditTable(indexes = []) {
  await assertColumns("admin_business_merchant_scope_audits", [
    { name: "id", type: "bigint", nullable: "NO", autoIncrement: true },
    { name: "scopeId", type: "int", nullable: "NO" },
    { name: "adminUserId", type: "int", nullable: "NO" },
    { name: "merchantId", type: "int", nullable: "NO" },
    { name: "action", type: "enum('granted','updated','revoked','unchanged')", nullable: "NO" },
    { name: "expectedVersion", type: "int unsigned", nullable: "NO" },
    { name: "resultingVersion", type: "int unsigned", nullable: "NO" },
    { name: "beforeModulePermissions", type: "json", nullable: "YES" },
    { name: "afterModulePermissions", type: "json", nullable: "YES" },
    { name: "requestId", type: "varchar(64)", nullable: "NO" },
    { name: "operatorAdminUserId", type: "int", nullable: "NO" },
    { name: "operatorName", type: "varchar(128)", nullable: "NO" },
    { name: "operatorRole", type: "varchar(64)", nullable: "NO" },
    { name: "ipAddress", type: "varchar(64)", nullable: "YES" },
    { name: "userAgent", type: "varchar(512)", nullable: "YES" },
    { name: "createdAt", type: "timestamp", nullable: "NO", defaultValue: "CURRENT_TIMESTAMP" },
  ]);
  await assertIndex("admin_business_merchant_scope_audits", "PRIMARY", true, ["id"]);
  await assertIndex(
    "admin_business_merchant_scope_audits",
    "admin_business_merchant_scope_audits_request_unique",
    true,
    ["requestId"],
  );
  if (indexes.includes("adminCreated")) {
    await assertIndex(
      "admin_business_merchant_scope_audits",
      "admin_business_merchant_scope_audits_admin_created_idx",
      false,
      ["adminUserId", "createdAt"],
    );
  }
  if (indexes.includes("merchantCreated")) {
    await assertIndex(
      "admin_business_merchant_scope_audits",
      "admin_business_merchant_scope_audits_merchant_created_idx",
      false,
      ["merchantId", "createdAt"],
    );
  }
}

async function ensureStatement(index) {
  if (index === 0) {
    if (!(await tableExists("admin_business_merchant_scopes"))) await connection.query(statements[index]);
    await assertScopeTable();
    return;
  }
  if (index === 1) {
    if ((await indexMetadata("admin_business_merchant_scopes", "admin_business_merchant_scopes_admin_status_idx")).length === 0) {
      await connection.query(statements[index]);
    }
    await assertScopeTable(["adminStatus"]);
    return;
  }
  if (index === 2) {
    if ((await indexMetadata("admin_business_merchant_scopes", "admin_business_merchant_scopes_merchant_status_idx")).length === 0) {
      await connection.query(statements[index]);
    }
    await assertScopeTable(["adminStatus", "merchantStatus"]);
    return;
  }
  if (index === 3) {
    if (!(await tableExists("admin_business_merchant_scope_audits"))) await connection.query(statements[index]);
    await assertAuditTable();
    return;
  }
  if (index === 4) {
    if ((await indexMetadata("admin_business_merchant_scope_audits", "admin_business_merchant_scope_audits_admin_created_idx")).length === 0) {
      await connection.query(statements[index]);
    }
    await assertAuditTable(["adminCreated"]);
    return;
  }
  if (index === 5) {
    if ((await indexMetadata("admin_business_merchant_scope_audits", "admin_business_merchant_scope_audits_merchant_created_idx")).length === 0) {
      await connection.query(statements[index]);
    }
    await assertAuditTable(["adminCreated", "merchantCreated"]);
    return;
  }
  throw new Error("BUSINESS_MERCHANT_SCOPE_SOURCE_SQL_STATEMENT_INVALID");
}

try {
  const [lockRows] = await connection.query(
    "SELECT GET_LOCK(?, 30) AS acquired",
    ["dianzi51_business_merchant_scope_schema_v1"],
  );
  locked = Number(lockRows?.[0]?.acquired ?? 0) === 1;
  if (!locked) throw new Error("无法取得业务商户范围 schema 迁移锁");

  for (let index = 0; index < statements.length; index += 1) {
    await ensureStatement(index);
  }

  console.log("[verify]", JSON.stringify({
    database: databaseName,
    source: "drizzle/0027_business_merchant_scopes.sql",
    sourceSqlSha256: migrationHash,
    scopes: "admin_business_merchant_scopes",
    audits: "admin_business_merchant_scope_audits",
    defaultStatus: "revoked",
    requestId: "unique",
  }));
} finally {
  if (locked) await connection.query("SELECT RELEASE_LOCK(?)", ["dianzi51_business_merchant_scope_schema_v1"]).catch(() => undefined);
  await connection.end();
}
