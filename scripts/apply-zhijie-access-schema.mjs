#!/usr/bin/env node
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import mysql from "mysql2/promise";
import {
  ACCESS_COLUMNS,
  ACCESS_INDEXES,
  AUDIT_COLUMNS,
  AUDIT_INDEXES,
  CREATE_ACCESS_TABLE,
  CREATE_AUDIT_TABLE,
  ZHIJIE_ACCESS_TABLE,
  ZHIJIE_AUDIT_TABLE,
} from "./zhijie-access-schema.mjs";

const argIndex = process.argv.indexOf("--from-runtime-env");
const sourceEnv = argIndex >= 0 ? process.argv[argIndex + 1] : "";

async function databaseUrlFromRuntimeEnv(envPath) {
  if (!envPath) throw new Error("未提供管理后台运行环境文件");
  const resolvedPath = resolve(envPath);
  const metadata = await lstat(resolvedPath);
  if (!metadata.isFile()) throw new Error("管理后台运行环境来源不是普通文件");
  if ((metadata.mode & 0o077) !== 0) throw new Error("管理后台运行环境文件权限过宽，智捷授权建表已中止");
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
    throw new Error("管理后台运行环境文件所有者不可信，智捷授权建表已中止");
  }
  const text = await readFile(resolvedPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1 || line.slice(0, separator).trim() !== "DATABASE_URL") continue;
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    return value;
  }
  return "";
}

const databaseUrl = process.env.DATABASE_URL || (await databaseUrlFromRuntimeEnv(sourceEnv));
if (!databaseUrl) throw new Error("未找到管理后台 DATABASE_URL，智捷授权建表已中止");
const databaseName = new URL(databaseUrl).pathname.slice(1);
if (databaseName !== "dianzi51_admin") throw new Error("授权表只允许建立在 dianzi51_admin 后台库，已拒绝其他数据库");
const connection = await mysql.createConnection(databaseUrl);
const lockName = "dianzi51_zhijie_access_v1";
let locked = false;

async function tableExists(table) {
  const [rows] = await connection.execute(
    `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`, [table],
  );
  return rows.length > 0;
}

async function assertTable(table, expectedColumns, expectedIndexes) {
  const [columns] = await connection.execute(
    `SELECT COLUMN_NAME AS columnName, DATA_TYPE AS dataType, IS_NULLABLE AS isNullable
       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [table],
  );
  const byName = new Map(columns.map(column => [String(column.columnName), column]));
  for (const [name, expected] of Object.entries(expectedColumns)) {
    const actual = byName.get(name);
    if (!actual || String(actual.dataType).toLowerCase() !== expected.type || String(actual.isNullable).toUpperCase() !== expected.nullable) {
      throw new Error(`${table}.${name} 结构冲突或缺失；为避免破坏既有数据，未执行修复`);
    }
  }
  const [indexes] = await connection.execute(
    `SELECT INDEX_NAME AS indexName, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnsCsv, MIN(NON_UNIQUE) AS nonUnique
       FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? GROUP BY INDEX_NAME`, [table],
  );
  const byIndex = new Map(indexes.map(index => [String(index.indexName), index]));
  for (const [name, expected] of Object.entries(expectedIndexes)) {
    const actual = byIndex.get(name);
    if (!actual || String(actual.columnsCsv) !== expected.columns || Number(actual.nonUnique) !== expected.unique) {
      throw new Error(`${table}.${name} 索引冲突或缺失；为避免破坏既有数据，未执行修复`);
    }
  }
  const [statusRows] = await connection.execute(
    `SELECT ENGINE AS Engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [table],
  );
  if (String(statusRows[0]?.Engine || "").toLowerCase() !== "innodb") {
    throw new Error(`${table} 必须使用 InnoDB；未执行修复`);
  }
}

try {
  const [lockRows] = await connection.execute("SELECT GET_LOCK(?, 30) AS acquired", [lockName]);
  locked = Number(lockRows?.[0]?.acquired ?? 0) === 1;
  if (!locked) throw new Error("无法取得智捷授权建表锁");

  if (!(await tableExists(ZHIJIE_ACCESS_TABLE))) await connection.query(CREATE_ACCESS_TABLE);
  if (!(await tableExists(ZHIJIE_AUDIT_TABLE))) await connection.query(CREATE_AUDIT_TABLE);
  await assertTable(ZHIJIE_ACCESS_TABLE, ACCESS_COLUMNS, ACCESS_INDEXES);
  await assertTable(ZHIJIE_AUDIT_TABLE, AUDIT_COLUMNS, AUDIT_INDEXES);
  const [[staff]] = await connection.query(`SELECT COUNT(*) AS staffAccesses FROM \`${ZHIJIE_ACCESS_TABLE}\``);
  const [[audits]] = await connection.query(`SELECT COUNT(*) AS audits FROM \`${ZHIJIE_AUDIT_TABLE}\``);
  console.log("[verify]", JSON.stringify({ table: ZHIJIE_ACCESS_TABLE, ...staff, auditTable: ZHIJIE_AUDIT_TABLE, ...audits }));
} finally {
  if (locked) await connection.execute("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => undefined);
  await connection.end();
}
