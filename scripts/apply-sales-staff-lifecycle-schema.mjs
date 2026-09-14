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
if (!databaseUrl) throw new Error("未找到管理后台 DATABASE_URL，销售身份生命周期迁移已中止");

const connection = await mysql.createConnection(databaseUrl);
const lockName = "dianzi51_admin_sales_staff_lifecycle_v1";
let locked = false;

try {
  const [lockRows] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [lockName]);
  locked = Number(lockRows?.[0]?.acquired ?? 0) === 1;
  if (!locked) throw new Error("无法取得销售身份生命周期迁移锁");

  const [tableRows] = await connection.query(`
    SELECT TABLE_NAME AS tableName
      FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN ('admin_users', 'sales_staff')
  `);
  const tableNames = new Set(tableRows.map(row => String(row.tableName)));
  if (!tableNames.has("admin_users") || !tableNames.has("sales_staff")) {
    throw new Error("销售身份生命周期所需数据表不存在");
  }

  const [result] = await connection.query(`
    UPDATE sales_staff AS staff
    INNER JOIN admin_users AS account ON account.id = staff.adminUserId
       SET staff.status = CASE WHEN account.status = 'active' THEN 'active' ELSE 'inactive' END,
           staff.displayName = COALESCE(NULLIF(TRIM(account.displayName), ''), account.username)
     WHERE staff.status <> CASE WHEN account.status = 'active' THEN 'active' ELSE 'inactive' END
        OR staff.displayName <> COALESCE(NULLIF(TRIM(account.displayName), ''), account.username)
  `);

  const [verificationRows] = await connection.query(`
    SELECT
      COUNT(*) AS linkedStaff,
      SUM(CASE WHEN account.adminRole = 'super_admin' AND account.status = 'active' AND staff.status = 'active' THEN 1 ELSE 0 END) AS activeSuperAdminStaff,
      SUM(CASE WHEN staff.status <> CASE WHEN account.status = 'active' THEN 'active' ELSE 'inactive' END THEN 1 ELSE 0 END) AS mismatchedStatus
    FROM sales_staff AS staff
    INNER JOIN admin_users AS account ON account.id = staff.adminUserId
  `);
  const summary = verificationRows[0] ?? {};
  if (Number(summary.mismatchedStatus ?? 0) !== 0) {
    throw new Error("销售身份状态与后台账号状态仍不一致");
  }
  console.log("[verify]", JSON.stringify({
    changedRows: Number(result.affectedRows ?? 0),
    linkedStaff: Number(summary.linkedStaff ?? 0),
    activeSuperAdminStaff: Number(summary.activeSuperAdminStaff ?? 0),
    mismatchedStatus: Number(summary.mismatchedStatus ?? 0),
  }));
} finally {
  if (locked) await connection.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => undefined);
  await connection.end();
}
