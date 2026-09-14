#!/usr/bin/env node
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import mysql from "mysql2/promise";

const argIndex = process.argv.indexOf("--from-runtime-env");
const sourceEnv = argIndex >= 0 ? process.argv[argIndex + 1] : "";

async function runtimeEnv(envPath) {
  if (!envPath) throw new Error("未提供管理后台运行环境文件");
  const resolvedPath = resolve(envPath);
  const metadata = await lstat(resolvedPath);
  if (!metadata.isFile()) throw new Error("管理后台运行环境来源不是普通文件");
  if ((metadata.mode & 0o077) !== 0) throw new Error("管理后台运行环境文件权限过宽，营业执照迁移已中止");
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
    throw new Error("管理后台运行环境文件所有者不可信，营业执照迁移已中止");
  }
  const values = {};
  const text = await readFile(resolvedPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

const fileEnv = sourceEnv ? await runtimeEnv(sourceEnv) : {};
const databaseUrl = process.env.DATABASE_URL || fileEnv.DATABASE_URL || "";
const platformDb = process.env.PLATFORM_DB_NAME || fileEnv.PLATFORM_DB_NAME || "dianzi51";
if (!databaseUrl) throw new Error("未找到管理后台 DATABASE_URL，营业执照迁移已中止");
if (!/^[A-Za-z0-9_]+$/.test(platformDb)) throw new Error("PLATFORM_DB_NAME 不合法，营业执照迁移已中止");

const connection = await mysql.createConnection(databaseUrl);
const lockName = "dianzi51_admin_merchant_license_access_v1";
let locked = false;

async function merchantColumn(name) {
  const [rows] = await connection.query(
    `SELECT DATA_TYPE AS dataType, CHARACTER_MAXIMUM_LENGTH AS maxLength, IS_NULLABLE AS isNullable
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'merchants' AND COLUMN_NAME = ?
      LIMIT 1`,
    [name],
  );
  return rows[0] ?? null;
}

try {
  const [lockRows] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [lockName]);
  locked = Number(lockRows?.[0]?.acquired ?? 0) === 1;
  if (!locked) throw new Error("无法取得营业执照访问迁移锁");

  if (!(await merchantColumn("licenseObjectKey"))) {
    await connection.query(
      "ALTER TABLE `merchants` ADD COLUMN `licenseObjectKey` varchar(512) NULL AFTER `licenseExpiry`",
    );
  }
  const column = await merchantColumn("licenseObjectKey");
  if (
    !column
    || String(column.dataType).toLowerCase() !== "varchar"
    || Number(column.maxLength) !== 512
    || String(column.isNullable).toUpperCase() !== "YES"
  ) {
    throw new Error("merchants.licenseObjectKey 结构不符合预期，迁移拒绝继续");
  }

  const [boundResult] = await connection.query(`
    UPDATE merchants m
    INNER JOIN \`${platformDb}\`.companies c
      ON CAST(c.userId AS CHAR) = m.crmOwnerPortalUserId
     AND UPPER(REPLACE(c.creditCode, ' ', '')) = UPPER(REPLACE(m.businessLicense, ' ', ''))
       SET m.licenseObjectKey = c.licenseObjectKey,
           m.licenseImageUrl = NULL
     WHERE c.licenseObjectKey IS NOT NULL
       AND TRIM(c.licenseObjectKey) <> ''
       AND (m.licenseObjectKey IS NULL OR TRIM(m.licenseObjectKey) = '')
  `);

  const [unboundResult] = await connection.query(`
    UPDATE merchants m
    INNER JOIN (
      SELECT UPPER(REPLACE(creditCode, ' ', '')) AS normalizedCreditCode,
             MAX(licenseObjectKey) AS licenseObjectKey
        FROM \`${platformDb}\`.companies
       WHERE creditCode IS NOT NULL
         AND TRIM(creditCode) <> ''
       GROUP BY UPPER(REPLACE(creditCode, ' ', ''))
      HAVING COUNT(*) = 1
         AND SUM(CASE WHEN licenseObjectKey IS NOT NULL AND TRIM(licenseObjectKey) <> '' THEN 1 ELSE 0 END) = 1
    ) c
      ON c.normalizedCreditCode = UPPER(REPLACE(m.businessLicense, ' ', ''))
       SET m.licenseObjectKey = c.licenseObjectKey,
           m.licenseImageUrl = NULL
     WHERE (m.crmOwnerPortalUserId IS NULL OR TRIM(m.crmOwnerPortalUserId) = '')
       AND (m.licenseObjectKey IS NULL OR TRIM(m.licenseObjectKey) = '')
  `);

  await connection.query(`
    UPDATE merchants
       SET licenseImageUrl = NULL
     WHERE licenseObjectKey IS NOT NULL
       AND TRIM(licenseObjectKey) <> ''
       AND licenseImageUrl IS NOT NULL
  `);

  const [summaryRows] = await connection.query(`
    SELECT COUNT(*) AS merchantRows,
           SUM(CASE WHEN licenseObjectKey IS NOT NULL AND TRIM(licenseObjectKey) <> '' THEN 1 ELSE 0 END) AS keyedRows,
           SUM(CASE WHEN licenseObjectKey IS NOT NULL AND TRIM(licenseObjectKey) <> '' AND licenseObjectKey NOT LIKE 'licenses/%' THEN 1 ELSE 0 END) AS invalidPrefixRows,
           SUM(CASE WHEN licenseObjectKey IS NULL AND licenseImageUrl IS NOT NULL AND licenseImageUrl LIKE '%Expires=%' THEN 1 ELSE 0 END) AS remainingSignedUrlRows
      FROM merchants
  `);
  const [bindingRows] = await connection.query(`
    SELECT COUNT(*) AS inconsistentRows
      FROM merchants m
      INNER JOIN \`${platformDb}\`.companies c
        ON CAST(c.userId AS CHAR) = m.crmOwnerPortalUserId
       AND UPPER(REPLACE(c.creditCode, ' ', '')) = UPPER(REPLACE(m.businessLicense, ' ', ''))
     WHERE c.licenseObjectKey IS NOT NULL
       AND TRIM(c.licenseObjectKey) <> ''
       AND (m.licenseObjectKey IS NULL OR m.licenseObjectKey <> c.licenseObjectKey)
  `);
  const [ambiguousRows] = await connection.query(`
    SELECT COUNT(*) AS ambiguousUnboundRows
      FROM merchants m
      INNER JOIN (
        SELECT UPPER(REPLACE(creditCode, ' ', '')) AS normalizedCreditCode
          FROM \`${platformDb}\`.companies
         WHERE creditCode IS NOT NULL AND TRIM(creditCode) <> ''
         GROUP BY UPPER(REPLACE(creditCode, ' ', ''))
        HAVING COUNT(*) > 1
      ) duplicateCompany
        ON duplicateCompany.normalizedCreditCode = UPPER(REPLACE(m.businessLicense, ' ', ''))
     WHERE m.crmOwnerPortalUserId IS NULL OR TRIM(m.crmOwnerPortalUserId) = ''
  `);
  const summary = summaryRows[0] ?? {};
  const inconsistentRows = Number(bindingRows?.[0]?.inconsistentRows ?? 0);
  const ambiguousUnboundRows = Number(ambiguousRows?.[0]?.ambiguousUnboundRows ?? 0);
  if (Number(summary.invalidPrefixRows ?? 0) !== 0) {
    throw new Error("存在不属于 licenses/ 前缀的营业执照对象键，迁移拒绝完成");
  }
  if (inconsistentRows !== 0) {
    throw new Error("后台商户与主站企业的营业执照对象键不一致，迁移拒绝完成");
  }

  console.log("[verify]", JSON.stringify({
    boundBackfilled: Number(boundResult?.affectedRows ?? 0),
    unboundBackfilled: Number(unboundResult?.affectedRows ?? 0),
    merchantRows: Number(summary.merchantRows ?? 0),
    keyedRows: Number(summary.keyedRows ?? 0),
    inconsistentRows,
    ambiguousUnboundRows,
    remainingSignedUrlRows: Number(summary.remainingSignedUrlRows ?? 0),
  }));
} finally {
  if (locked) await connection.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => undefined);
  await connection.end();
}
