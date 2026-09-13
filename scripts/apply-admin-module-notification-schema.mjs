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
  if ((metadata.mode & 0o077) !== 0) throw new Error("管理后台运行环境文件权限过宽，模块提醒迁移已中止");
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
    throw new Error("管理后台运行环境文件所有者不可信，模块提醒迁移已中止");
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
if (!databaseUrl) throw new Error("未找到管理后台 DATABASE_URL，模块提醒迁移已中止");

const connection = await mysql.createConnection(databaseUrl);
const tableName = "admin_module_notification_cursors";
const uniqueIndex = "admin_module_notification_viewer_module_unique";
const seenIndex = "admin_module_notification_module_seen_idx";
const lockName = "dianzi51_admin_module_notification_v1";
let locked = false;

async function tableExists() {
  const [rows] = await connection.query(
    `SELECT 1 FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [tableName],
  );
  return rows.length > 0;
}

async function indexDefinition(name) {
  const [rows] = await connection.query(
    `SELECT INDEX_NAME AS indexName,
            GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnsCsv,
            MIN(NON_UNIQUE) AS nonUnique
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
      GROUP BY INDEX_NAME`,
    [tableName, name],
  );
  return rows[0] ?? null;
}

try {
  const [lockRows] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [lockName]);
  locked = Number(lockRows?.[0]?.acquired ?? 0) === 1;
  if (!locked) throw new Error("无法取得模块提醒迁移锁");

  if (!(await tableExists())) {
    await connection.query(`
      CREATE TABLE \`${tableName}\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`viewerKey\` varchar(80) NOT NULL,
        \`module\` varchar(32) NOT NULL,
        \`lastSeenId\` bigint NOT NULL DEFAULT 0,
        \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`${uniqueIndex}\` (\`viewerKey\`, \`module\`),
        KEY \`${seenIndex}\` (\`module\`, \`lastSeenId\`)
      )
    `);
  }

  const [columns] = await connection.query(
    `SELECT COLUMN_NAME AS columnName, DATA_TYPE AS dataType, IS_NULLABLE AS isNullable
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName],
  );
  const byName = new Map(columns.map(column => [String(column.columnName), column]));
  for (const name of ["id", "viewerKey", "module", "lastSeenId", "createdAt", "updatedAt"]) {
    if (!byName.has(name)) throw new Error(`${tableName}.${name} 缺失`);
  }
  if (String(byName.get("viewerKey")?.dataType).toLowerCase() !== "varchar"
      || String(byName.get("viewerKey")?.isNullable).toUpperCase() !== "NO") {
    throw new Error("模块提醒 viewerKey 结构校验失败");
  }
  if (String(byName.get("lastSeenId")?.dataType).toLowerCase() !== "bigint"
      || String(byName.get("lastSeenId")?.isNullable).toUpperCase() !== "NO") {
    throw new Error("模块提醒 lastSeenId 结构校验失败");
  }

  const verifiedUnique = await indexDefinition(uniqueIndex);
  const verifiedSeen = await indexDefinition(seenIndex);
  if (!verifiedUnique || String(verifiedUnique.columnsCsv) !== "viewerKey,module" || Number(verifiedUnique.nonUnique) !== 0) {
    throw new Error("模块提醒账号/模块唯一索引校验失败");
  }
  if (!verifiedSeen || String(verifiedSeen.columnsCsv) !== "module,lastSeenId") {
    throw new Error("模块提醒查询索引校验失败");
  }

  const [summaryRows] = await connection.query(`SELECT COUNT(*) AS cursors FROM \`${tableName}\``);
  console.log("[verify]", JSON.stringify({
    ...summaryRows[0],
    table: tableName,
    unique: "viewerKey,module",
    modules: ["merchants", "orders", "reviews", "portalUsers"],
  }));
} finally {
  if (locked) await connection.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => undefined);
  await connection.end();
}
