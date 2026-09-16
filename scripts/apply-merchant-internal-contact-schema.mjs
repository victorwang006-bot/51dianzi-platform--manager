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
if (!databaseUrl) throw new Error("未找到管理后台 DATABASE_URL，后台联系人迁移已中止");

const connection = await mysql.createConnection(databaseUrl);
const lockName = "dianzi51_admin_merchant_internal_contact_v1";
const columnName = "internalContactName";
let locked = false;

async function readColumn() {
  const [rows] = await connection.query(
    `SELECT DATA_TYPE AS dataType,
            CHARACTER_MAXIMUM_LENGTH AS maxLength,
            IS_NULLABLE AS nullable
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'merchants'
        AND COLUMN_NAME = ?
      LIMIT 1`,
    [columnName],
  );
  return rows[0] ?? null;
}

try {
  const [lockRows] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [lockName]);
  locked = Number(lockRows?.[0]?.acquired ?? 0) === 1;
  if (!locked) throw new Error("无法取得后台联系人迁移锁");

  const existing = await readColumn();
  if (existing) {
    const valid = String(existing.dataType).toLowerCase() === "varchar"
      && Number(existing.maxLength) === 64
      && String(existing.nullable).toUpperCase() === "YES";
    if (!valid) throw new Error("merchants.internalContactName 已存在但结构不符合预期，迁移拒绝覆盖");
    console.log("[skip] merchants.internalContactName already exists");
  } else {
    await connection.query(
      "ALTER TABLE `merchants` ADD COLUMN `internalContactName` varchar(64) NULL AFTER `contactName`",
    );
    console.log("[ok] merchants.internalContactName created");
  }

  const verified = await readColumn();
  if (
    !verified
    || String(verified.dataType).toLowerCase() !== "varchar"
    || Number(verified.maxLength) !== 64
    || String(verified.nullable).toUpperCase() !== "YES"
  ) {
    throw new Error("后台联系人字段验证失败");
  }
  console.log("[verify] merchants.internalContactName varchar(64) NULL");
} finally {
  if (locked) await connection.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => undefined);
  await connection.end();
}
