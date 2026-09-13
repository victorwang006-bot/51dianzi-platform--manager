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
  if ((metadata.mode & 0o077) !== 0) throw new Error("管理后台运行环境文件权限过宽，竞品物料清理已中止");
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
    throw new Error("管理后台运行环境文件所有者不可信，竞品物料清理已中止");
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
if (!databaseUrl) throw new Error("未找到管理后台 DATABASE_URL，竞品物料清理已中止");

const terms = ["%立创%", "%szlcsc%", "%lcsc%", "%jlcpcb%", "%jlcsmt%", "%jlc3dp%", "%jlcmc%", "%jlceda%"];
const fields = ["name", "brand", "category", "description"];
const clauses = fields.flatMap(field => terms.map(() => `LOWER(COALESCE(\`${field}\`, '')) LIKE ?`));
const params = fields.flatMap(() => terms);
const unsafeWhere = `(${clauses.join(" OR ")})`;
const connection = await mysql.createConnection(databaseUrl);
const lockName = "dianzi51_competitor_material_policy_v1";
let locked = false;

try {
  const [lockRows] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [lockName]);
  locked = Number(lockRows?.[0]?.acquired ?? 0) === 1;
  if (!locked) throw new Error("无法取得竞品物料清理锁");

  const [beforeRows] = await connection.query(
    `SELECT COUNT(*) AS enabledMatches FROM materials WHERE status = 'enabled' AND ${unsafeWhere}`,
    params,
  );
  const [updateResult] = await connection.query(
    `UPDATE materials SET status = 'disabled', updatedAt = CURRENT_TIMESTAMP
      WHERE status = 'enabled' AND ${unsafeWhere}`,
    params,
  );
  const [afterRows] = await connection.query(
    `SELECT COUNT(*) AS enabledMatches FROM materials WHERE status = 'enabled' AND ${unsafeWhere}`,
    params,
  );
  const remaining = Number(afterRows[0]?.enabledMatches || 0);
  if (remaining !== 0) throw new Error(`竞品物料仍有 ${remaining} 条处于启用状态`);

  console.log("[verify]", JSON.stringify({
    matchedBefore: Number(beforeRows[0]?.enabledMatches || 0),
    disabledNow: Number(updateResult.affectedRows || 0),
    enabledAfter: remaining,
  }));
} finally {
  if (locked) await connection.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => undefined);
  await connection.end();
}
