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
  if ((metadata.mode & 0o077) !== 0) throw new Error("管理后台运行环境文件权限过宽，账号安全迁移已中止");
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
    throw new Error("管理后台运行环境文件所有者不可信，账号安全迁移已中止");
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
if (!databaseUrl) throw new Error("未找到管理后台 DATABASE_URL，账号安全迁移已中止");

const connection = await mysql.createConnection(databaseUrl);
const lockName = "dianzi51_admin_account_security_v1";
const canonicalIndex = "admin_users_username_canonical_unique";
let locked = false;

async function column(name) {
  const [rows] = await connection.query(
    `SELECT DATA_TYPE AS dataType,
            CHARACTER_MAXIMUM_LENGTH AS maxLength,
            IS_NULLABLE AS isNullable,
            COLUMN_DEFAULT AS columnDefault
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'admin_users'
        AND COLUMN_NAME = ?
      LIMIT 1`,
    [name],
  );
  return rows[0] ?? null;
}

async function index(name) {
  const [rows] = await connection.query(
    `SELECT INDEX_NAME AS indexName,
            GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnsCsv,
            MIN(NON_UNIQUE) AS nonUnique
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'admin_users'
        AND INDEX_NAME = ?
      GROUP BY INDEX_NAME`,
    [name],
  );
  return rows[0] ?? null;
}

try {
  const [lockRows] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [lockName]);
  locked = Number(lockRows?.[0]?.acquired ?? 0) === 1;
  if (!locked) throw new Error("无法取得后台账号安全迁移锁");

  const [invalidNames] = await connection.query(
    `SELECT id
       FROM admin_users
      WHERE TRIM(username) = ''
         OR CHAR_LENGTH(TRIM(username)) > 64
      LIMIT 1`,
  );
  if (invalidNames.length) throw new Error("存在无法规范化的后台用户名，请先人工修复");

  const [collisions] = await connection.query(
    `SELECT LOWER(TRIM(username)) AS canonicalName, COUNT(*) AS duplicateCount
       FROM admin_users
      GROUP BY LOWER(TRIM(username))
     HAVING COUNT(*) > 1
      LIMIT 1`,
  );
  if (collisions.length) {
    throw new Error("后台用户名去空格/忽略大小写后存在冲突，迁移拒绝覆盖，请先人工消歧");
  }

  if (!(await column("usernameCanonical"))) {
    await connection.query(
      "ALTER TABLE `admin_users` ADD COLUMN `usernameCanonical` varchar(64) NULL AFTER `username`",
    );
  }
  if (!(await column("sessionVersion"))) {
    await connection.query(
      "ALTER TABLE `admin_users` ADD COLUMN `sessionVersion` int NOT NULL DEFAULT 1 AFTER `status`",
    );
  }

  await connection.query(
    `UPDATE admin_users
        SET username = TRIM(username),
            usernameCanonical = LOWER(TRIM(username)),
            sessionVersion = CASE WHEN sessionVersion IS NULL OR sessionVersion < 1 THEN 1 ELSE sessionVersion END`,
  );
  await connection.query(
    "ALTER TABLE `admin_users` MODIFY COLUMN `usernameCanonical` varchar(64) NOT NULL",
  );
  await connection.query(
    "ALTER TABLE `admin_users` MODIFY COLUMN `sessionVersion` int NOT NULL DEFAULT 1",
  );

  const existingIndex = await index(canonicalIndex);
  if (existingIndex && (String(existingIndex.columnsCsv) !== "usernameCanonical" || Number(existingIndex.nonUnique) !== 0)) {
    throw new Error(`${canonicalIndex} 已存在但不是 usernameCanonical 唯一索引，迁移拒绝覆盖`);
  }
  if (!existingIndex) {
    await connection.query(
      "CREATE UNIQUE INDEX `admin_users_username_canonical_unique` ON `admin_users` (`usernameCanonical`)",
    );
  }

  const usernameCanonical = await column("usernameCanonical");
  const sessionVersion = await column("sessionVersion");
  const verifiedIndex = await index(canonicalIndex);
  if (
    !usernameCanonical
    || String(usernameCanonical.dataType).toLowerCase() !== "varchar"
    || Number(usernameCanonical.maxLength) !== 64
    || String(usernameCanonical.isNullable).toUpperCase() !== "NO"
  ) throw new Error("admin_users.usernameCanonical 结构校验失败");
  if (
    !sessionVersion
    || String(sessionVersion.dataType).toLowerCase() !== "int"
    || String(sessionVersion.isNullable).toUpperCase() !== "NO"
    || Number(sessionVersion.columnDefault) !== 1
  ) throw new Error("admin_users.sessionVersion 结构校验失败");
  if (!verifiedIndex || String(verifiedIndex.columnsCsv) !== "usernameCanonical" || Number(verifiedIndex.nonUnique) !== 0) {
    throw new Error("后台用户名规范化唯一索引校验失败");
  }

  const [summaryRows] = await connection.query(
    "SELECT COUNT(*) AS accounts, MIN(sessionVersion) AS minSessionVersion FROM admin_users",
  );
  console.log("[verify]", JSON.stringify({
    ...summaryRows[0],
    usernameCanonical: "varchar(64) not null unique",
    sessionVersion: "int not null default 1",
  }));
} finally {
  if (locked) await connection.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => undefined);
  await connection.end();
}
