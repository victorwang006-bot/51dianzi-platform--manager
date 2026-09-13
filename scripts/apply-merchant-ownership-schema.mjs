#!/usr/bin/env node
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import mysql from "mysql2/promise";

const argIndex = process.argv.indexOf("--from-runtime-env");
const sourceEnv = argIndex >= 0 ? process.argv[argIndex + 1] : "";

async function databaseUrlFromRuntimeEnv(envPath) {
  if (!envPath) throw new Error("未提供管理后台运行环境文件");
  const resolvedPath = resolve(envPath);
  const metadata = await lstat(resolvedPath);
  if (!metadata.isFile()) throw new Error("管理后台运行环境来源不是普通文件");
  if ((metadata.mode & 0o077) !== 0) throw new Error("管理后台运行环境文件权限过宽，迁移已中止");
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
    throw new Error("管理后台运行环境文件所有者不可信，迁移已中止");
  }
  const text = await readFile(resolvedPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1 || line.slice(0, separator).trim() !== "DATABASE_URL") continue;
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return "";
}

const databaseUrl = process.env.DATABASE_URL || (await databaseUrlFromRuntimeEnv(sourceEnv));
if (!databaseUrl) throw new Error("未找到管理后台 DATABASE_URL，客户归属迁移已中止");

const connection = await mysql.createConnection(databaseUrl);
const lockName = "dianzi51_admin_merchant_ownership_v1";
let locked = false;

async function tableIndex(tableName, indexName) {
  const [rows] = await connection.query(
    `SELECT INDEX_NAME AS indexName,
            MIN(NON_UNIQUE) AS nonUnique,
            GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnsCsv
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
      GROUP BY INDEX_NAME`,
    [tableName, indexName],
  );
  return rows[0] ?? null;
}

async function ensureIndex({ tableName, indexName, columnsSql, expectedColumns, unique = false }) {
  const existing = await tableIndex(tableName, indexName);
  if (existing) {
    if (String(existing.columnsCsv) !== expectedColumns || Number(existing.nonUnique) !== (unique ? 0 : 1)) {
      throw new Error(`${tableName}.${indexName} 已存在但定义不符，迁移拒绝覆盖`);
    }
    return;
  }
  const kind = unique ? "UNIQUE INDEX" : "INDEX";
  await connection.query(`ALTER TABLE \`${tableName}\` ADD ${kind} \`${indexName}\` (${columnsSql})`);
}

async function assertColumn({ tableName, columnName, columnType, nullable, autoIncrement = false }) {
  const [rows] = await connection.query(
    `SELECT COLUMN_TYPE AS columnType, IS_NULLABLE AS isNullable, EXTRA AS extra
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
      LIMIT 1`,
    [tableName, columnName],
  );
  const column = rows[0];
  if (!column) throw new Error(`${tableName}.${columnName} 缺失，迁移拒绝切换`);
  if (String(column.columnType).toLowerCase() !== columnType.toLowerCase()) {
    throw new Error(`${tableName}.${columnName} 类型不符：${column.columnType}`);
  }
  if (String(column.isNullable) !== nullable) {
    throw new Error(`${tableName}.${columnName} 可空定义不符`);
  }
  if (autoIncrement && !String(column.extra).toLowerCase().includes("auto_increment")) {
    throw new Error(`${tableName}.${columnName} 缺少 AUTO_INCREMENT`);
  }
}

try {
  const [lockRows] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [lockName]);
  locked = Number(lockRows?.[0]?.acquired ?? 0) === 1;
  if (!locked) throw new Error("无法取得客户归属迁移锁");

  await connection.query(`
    CREATE TABLE IF NOT EXISTS merchant_sales_collaborators (
      id int NOT NULL AUTO_INCREMENT,
      merchantId int NOT NULL,
      staffCode varchar(64) NOT NULL,
      grantedByAdminUserId int NULL,
      sourceRequestId bigint NULL,
      createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      revokedAt timestamp NULL DEFAULT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY merchant_sales_collaborators_merchant_staff_unique (merchantId, staffCode),
      KEY merchant_sales_collaborators_staff_merchant_idx (staffCode, merchantId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS merchant_ownership_requests (
      id bigint NOT NULL AUTO_INCREMENT,
      merchantId int NOT NULL,
      requestType enum('claim','collaborate','transfer') NOT NULL,
      requesterAdminUserId int NOT NULL,
      requesterStaffCode varchar(64) NOT NULL,
      requesterName varchar(128) NOT NULL,
      expectedOwnerCode varchar(64) NULL,
      reason varchar(500) NOT NULL,
      status enum('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
      reviewerAdminUserId int NULL,
      reviewerName varchar(128) NULL,
      reviewNote varchar(500) NULL,
      reviewedAt timestamp NULL DEFAULT NULL,
      createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY merchant_ownership_requests_requester_created_idx (requesterAdminUserId, createdAt),
      KEY merchant_ownership_requests_status_created_idx (status, createdAt),
      KEY merchant_ownership_requests_merchant_status_idx (merchantId, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS merchant_ownership_query_audits (
      id bigint NOT NULL AUTO_INCREMENT,
      adminUserId int NOT NULL,
      queryHash varchar(64) NOT NULL,
      queryKind varchar(24) NOT NULL,
      resultCount int NOT NULL DEFAULT 0,
      ipAddress varchar(64) NULL,
      createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY merchant_ownership_query_audits_admin_created_idx (adminUserId, createdAt)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const requiredColumns = [
    { tableName: "merchant_sales_collaborators", columnName: "id", columnType: "int", nullable: "NO", autoIncrement: true },
    { tableName: "merchant_sales_collaborators", columnName: "merchantId", columnType: "int", nullable: "NO" },
    { tableName: "merchant_sales_collaborators", columnName: "staffCode", columnType: "varchar(64)", nullable: "NO" },
    { tableName: "merchant_sales_collaborators", columnName: "grantedByAdminUserId", columnType: "int", nullable: "YES" },
    { tableName: "merchant_sales_collaborators", columnName: "sourceRequestId", columnType: "bigint", nullable: "YES" },
    { tableName: "merchant_sales_collaborators", columnName: "createdAt", columnType: "timestamp", nullable: "NO" },
    { tableName: "merchant_sales_collaborators", columnName: "revokedAt", columnType: "timestamp", nullable: "YES" },
    { tableName: "merchant_ownership_requests", columnName: "id", columnType: "bigint", nullable: "NO", autoIncrement: true },
    { tableName: "merchant_ownership_requests", columnName: "merchantId", columnType: "int", nullable: "NO" },
    { tableName: "merchant_ownership_requests", columnName: "requestType", columnType: "enum('claim','collaborate','transfer')", nullable: "NO" },
    { tableName: "merchant_ownership_requests", columnName: "requesterAdminUserId", columnType: "int", nullable: "NO" },
    { tableName: "merchant_ownership_requests", columnName: "requesterStaffCode", columnType: "varchar(64)", nullable: "NO" },
    { tableName: "merchant_ownership_requests", columnName: "requesterName", columnType: "varchar(128)", nullable: "NO" },
    { tableName: "merchant_ownership_requests", columnName: "expectedOwnerCode", columnType: "varchar(64)", nullable: "YES" },
    { tableName: "merchant_ownership_requests", columnName: "reason", columnType: "varchar(500)", nullable: "NO" },
    { tableName: "merchant_ownership_requests", columnName: "status", columnType: "enum('pending','approved','rejected','cancelled')", nullable: "NO" },
    { tableName: "merchant_ownership_requests", columnName: "reviewerAdminUserId", columnType: "int", nullable: "YES" },
    { tableName: "merchant_ownership_requests", columnName: "reviewerName", columnType: "varchar(128)", nullable: "YES" },
    { tableName: "merchant_ownership_requests", columnName: "reviewNote", columnType: "varchar(500)", nullable: "YES" },
    { tableName: "merchant_ownership_requests", columnName: "reviewedAt", columnType: "timestamp", nullable: "YES" },
    { tableName: "merchant_ownership_requests", columnName: "createdAt", columnType: "timestamp", nullable: "NO" },
    { tableName: "merchant_ownership_requests", columnName: "updatedAt", columnType: "timestamp", nullable: "NO" },
    { tableName: "merchant_ownership_query_audits", columnName: "id", columnType: "bigint", nullable: "NO", autoIncrement: true },
    { tableName: "merchant_ownership_query_audits", columnName: "adminUserId", columnType: "int", nullable: "NO" },
    { tableName: "merchant_ownership_query_audits", columnName: "queryHash", columnType: "varchar(64)", nullable: "NO" },
    { tableName: "merchant_ownership_query_audits", columnName: "queryKind", columnType: "varchar(24)", nullable: "NO" },
    { tableName: "merchant_ownership_query_audits", columnName: "resultCount", columnType: "int", nullable: "NO" },
    { tableName: "merchant_ownership_query_audits", columnName: "ipAddress", columnType: "varchar(64)", nullable: "YES" },
    { tableName: "merchant_ownership_query_audits", columnName: "createdAt", columnType: "timestamp", nullable: "NO" },
  ];
  for (const column of requiredColumns) await assertColumn(column);

  const requiredIndexes = [
    { tableName: "merchants", indexName: "merchants_contact_phone_idx", columnsSql: "`contactPhone`", expectedColumns: "contactPhone" },
    { tableName: "merchant_sales_collaborators", indexName: "merchant_sales_collaborators_merchant_staff_unique", columnsSql: "`merchantId`, `staffCode`", expectedColumns: "merchantId,staffCode", unique: true },
    { tableName: "merchant_sales_collaborators", indexName: "merchant_sales_collaborators_staff_merchant_idx", columnsSql: "`staffCode`, `merchantId`", expectedColumns: "staffCode,merchantId" },
    { tableName: "merchant_ownership_requests", indexName: "merchant_ownership_requests_requester_created_idx", columnsSql: "`requesterAdminUserId`, `createdAt`", expectedColumns: "requesterAdminUserId,createdAt" },
    { tableName: "merchant_ownership_requests", indexName: "merchant_ownership_requests_status_created_idx", columnsSql: "`status`, `createdAt`", expectedColumns: "status,createdAt" },
    { tableName: "merchant_ownership_requests", indexName: "merchant_ownership_requests_merchant_status_idx", columnsSql: "`merchantId`, `status`", expectedColumns: "merchantId,status" },
    { tableName: "merchant_ownership_query_audits", indexName: "merchant_ownership_query_audits_admin_created_idx", columnsSql: "`adminUserId`, `createdAt`", expectedColumns: "adminUserId,createdAt" },
  ];
  for (const index of requiredIndexes) await ensureIndex(index);

  for (const tableName of [
    "merchant_sales_collaborators",
    "merchant_ownership_requests",
    "merchant_ownership_query_audits",
  ]) {
    const primary = await tableIndex(tableName, "PRIMARY");
    if (!primary || String(primary.columnsCsv) !== "id" || Number(primary.nonUnique) !== 0) {
      throw new Error(`${tableName} 主键结构校验失败`);
    }
  }

  console.log("[verify]", JSON.stringify({
    columns: requiredColumns.length,
    indexes: requiredIndexes.map(index => index.indexName).sort(),
  }));
} finally {
  if (locked) await connection.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => undefined);
  await connection.end();
}
