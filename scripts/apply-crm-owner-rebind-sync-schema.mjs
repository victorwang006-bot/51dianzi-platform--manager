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
if (!databaseUrl) throw new Error("未找到管理后台 DATABASE_URL，负责人同步迁移已中止");

const connection = await mysql.createConnection(databaseUrl);
const lockName = "dianzi51_admin_crm_owner_rebind_sync_v1";
let locked = false;

async function columnExists(tableName, columnName) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS value FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tableName, columnName],
  );
  return Number(rows?.[0]?.value ?? 0) === 1;
}

async function columnType(tableName, columnName) {
  const [rows] = await connection.query(
    `SELECT COLUMN_TYPE AS value FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [tableName, columnName],
  );
  return String(rows?.[0]?.value ?? "");
}

async function ensureColumn(columnName, definition) {
  if (!(await columnExists("crm_owner_rebind_logs", columnName))) {
    await connection.query(
      `ALTER TABLE \`crm_owner_rebind_logs\` ADD COLUMN \`${columnName}\` ${definition}`,
    );
    console.log(`[ok] crm_owner_rebind_logs.${columnName} added`);
  } else {
    console.log(`[skip] crm_owner_rebind_logs.${columnName} already exists`);
  }
}

try {
  const [lockRows] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [lockName]);
  locked = Number(lockRows?.[0]?.acquired ?? 0) === 1;
  if (!locked) throw new Error("无法取得负责人同步迁移锁");

  await ensureColumn("creditCode", "varchar(64) NULL AFTER `nextOwnerPortalUserId`");
  await ensureColumn(
    "platformSyncStatus",
    "enum('pending','completed','retryable') NOT NULL DEFAULT 'pending' AFTER `userAgent`",
  );
  await ensureColumn("platformSyncError", "varchar(1000) NULL AFTER `platformSyncStatus`");
  await ensureColumn("platformSyncAttemptCount", "int NOT NULL DEFAULT 0 AFTER `platformSyncError`");
  await ensureColumn("platformSyncedAt", "timestamp NULL AFTER `platformSyncAttemptCount`");

  const statusType = await columnType("crm_owner_rebind_logs", "platformSyncStatus");
  for (const expected of ["'pending'", "'completed'", "'retryable'"]) {
    if (!statusType.includes(expected)) {
      throw new Error(`crm_owner_rebind_logs.platformSyncStatus 缺少状态 ${expected}`);
    }
  }
  for (const column of [
    "creditCode",
    "platformSyncStatus",
    "platformSyncError",
    "platformSyncAttemptCount",
    "platformSyncedAt",
  ]) {
    if (!(await columnExists("crm_owner_rebind_logs", column))) {
      throw new Error(`crm_owner_rebind_logs.${column} 创建失败`);
    }
  }

  console.log(JSON.stringify({
    ok: true,
    crmOwnerRebindPlatformSync: true,
    statusType,
  }));
} finally {
  if (locked) await connection.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => undefined);
  await connection.end();
}
