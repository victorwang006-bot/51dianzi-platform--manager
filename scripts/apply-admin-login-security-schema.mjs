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
  if ((metadata.mode & 0o077) !== 0) throw new Error("管理后台运行环境文件权限过宽，登录安全迁移已中止");
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
    throw new Error("管理后台运行环境文件所有者不可信，登录安全迁移已中止");
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
if (!databaseUrl) throw new Error("未找到管理后台 DATABASE_URL，登录安全迁移已中止");

const connection = await mysql.createConnection(databaseUrl);
const lockName = "dianzi51_admin_login_security_v1";
let locked = false;

async function column(name) {
  const [rows] = await connection.query(
    `SELECT DATA_TYPE AS dataType, CHARACTER_MAXIMUM_LENGTH AS maxLength, IS_NULLABLE AS isNullable
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_users' AND COLUMN_NAME = ?
      LIMIT 1`,
    [name],
  );
  return rows[0] ?? null;
}

async function addColumn(name, definition) {
  if (!(await column(name))) {
    await connection.query(`ALTER TABLE \`admin_users\` ADD COLUMN \`${name}\` ${definition}`);
  }
}

async function tableIndex(tableName, indexName) {
  const [rows] = await connection.query(
    `SELECT INDEX_NAME AS indexName,
            GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnsCsv
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
      GROUP BY INDEX_NAME`,
    [tableName, indexName],
  );
  return rows[0] ?? null;
}

async function ensureIndex(tableName, indexName, columnsSql, expectedColumns) {
  const existing = await tableIndex(tableName, indexName);
  if (existing && String(existing.columnsCsv) !== expectedColumns) {
    throw new Error(`${indexName} 已存在但列定义不符，迁移拒绝覆盖`);
  }
  if (!existing) {
    await connection.query(`CREATE INDEX \`${indexName}\` ON \`${tableName}\` (${columnsSql})`);
  }
}

try {
  const [lockRows] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [lockName]);
  locked = Number(lockRows?.[0]?.acquired ?? 0) === 1;
  if (!locked) throw new Error("无法取得后台登录安全迁移锁");

  await addColumn("lastLoginIpAddress", "varchar(64) NULL AFTER `lastLoginAt`");
  await addColumn("lastLoginIpHash", "varchar(64) NULL AFTER `lastLoginIpAddress`");
  await addColumn("lastLoginLocation", "varchar(128) NULL AFTER `lastLoginIpHash`");
  await addColumn("lastLoginDevice", "varchar(160) NULL AFTER `lastLoginLocation`");
  await addColumn("lastLoginDeviceHash", "varchar(64) NULL AFTER `lastLoginDevice`");
  await addColumn("lastLoginMethod", "varchar(32) NULL AFTER `lastLoginDeviceHash`");
  await addColumn("securityRiskLevel", "varchar(16) NULL AFTER `lastLoginMethod`");
  await addColumn("securityRiskReason", "varchar(255) NULL AFTER `securityRiskLevel`");
  await addColumn("securityRiskAt", "timestamp NULL AFTER `securityRiskReason`");

  await connection.query(`
    CREATE TABLE IF NOT EXISTS admin_login_events (
      id bigint NOT NULL AUTO_INCREMENT,
      adminUserId int NULL,
      accountHash varchar(64) NOT NULL,
      success tinyint(1) NOT NULL,
      authMethod varchar(32) NOT NULL,
      ipAddress varchar(64) NOT NULL,
      ipHash varchar(64) NOT NULL,
      countryCode varchar(8) NULL,
      location varchar(128) NULL,
      deviceHash varchar(64) NOT NULL,
      deviceType varchar(24) NOT NULL,
      browser varchar(48) NOT NULL,
      operatingSystem varchar(48) NOT NULL,
      riskLevel varchar(16) NOT NULL,
      riskReason varchar(255) NULL,
      occurredAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await ensureIndex("admin_login_events", "admin_login_events_user_occurred_idx", "`adminUserId`, `occurredAt`", "adminUserId,occurredAt");
  await ensureIndex("admin_login_events", "admin_login_events_account_occurred_idx", "`accountHash`, `occurredAt`", "accountHash,occurredAt");
  await ensureIndex("admin_login_events", "admin_login_events_ip_occurred_idx", "`ipHash`, `occurredAt`", "ipHash,occurredAt");

  const requiredColumns = [
    "lastLoginIpAddress", "lastLoginIpHash", "lastLoginLocation", "lastLoginDevice",
    "lastLoginDeviceHash", "lastLoginMethod", "securityRiskLevel", "securityRiskReason", "securityRiskAt",
  ];
  for (const name of requiredColumns) {
    if (!(await column(name))) throw new Error(`admin_users.${name} 结构校验失败`);
  }
  const [summaryRows] = await connection.query(
    "SELECT COUNT(*) AS events, COUNT(DISTINCT adminUserId) AS usersWithEvents FROM admin_login_events",
  );
  console.log("[verify]", JSON.stringify(summaryRows[0]));
} finally {
  if (locked) await connection.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => undefined);
  await connection.end();
}
