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
if (!databaseUrl) throw new Error("未找到管理后台 DATABASE_URL，商户时间筛选迁移已中止");

const connection = await mysql.createConnection(databaseUrl);
const lockName = "dianzi51_admin_merchant_created_at_filter_v1";
const indexName = "merchants_created_at_idx";
let locked = false;

async function readIndex() {
  const [rows] = await connection.query(
    `SELECT INDEX_NAME AS indexName,
            GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnsCsv
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'merchants'
        AND INDEX_NAME = ?
      GROUP BY INDEX_NAME`,
    [indexName],
  );
  return rows[0] ?? null;
}

try {
  const [lockRows] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [lockName]);
  locked = Number(lockRows?.[0]?.acquired ?? 0) === 1;
  if (!locked) throw new Error("无法取得商户时间筛选迁移锁");

  const existing = await readIndex();
  if (existing && String(existing.columnsCsv) !== "createdAt") {
    throw new Error(`${indexName} 已存在但字段不正确，迁移拒绝覆盖`);
  }
  if (!existing) {
    await connection.query("CREATE INDEX `merchants_created_at_idx` ON `merchants` (`createdAt`)");
    console.log(`[ok] ${indexName} created`);
  } else {
    console.log(`[skip] ${indexName} already exists`);
  }

  const verified = await readIndex();
  if (!verified || String(verified.columnsCsv) !== "createdAt") {
    throw new Error("商户时间筛选索引验证失败");
  }
  console.log("[verify]", JSON.stringify({ index: String(verified.columnsCsv) }));
} finally {
  if (locked) await connection.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => undefined);
  await connection.end();
}
