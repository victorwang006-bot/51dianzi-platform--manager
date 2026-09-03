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
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    if (key !== "DATABASE_URL") continue;
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return "";
}

const databaseUrl = process.env.DATABASE_URL || (await databaseUrlFromRuntimeEnv(sourceEnv));
if (!databaseUrl) throw new Error("未找到管理后台 DATABASE_URL，迁移已中止");

const connection = await mysql.createConnection(databaseUrl);
const lockName = "dianzi51_admin_complaint_messages_v1";
let locked = false;

async function scalar(query, params = []) {
  const [rows] = await connection.query(query, params);
  return Number(rows?.[0]?.value ?? 0);
}

async function columnExists(tableName, columnName) {
  return (await scalar(
    `SELECT COUNT(*) AS value FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tableName, columnName],
  )) === 1;
}

async function columnType(tableName, columnName) {
  const [rows] = await connection.query(
    `SELECT COLUMN_TYPE AS value FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [tableName, columnName],
  );
  return String(rows?.[0]?.value ?? "");
}

try {
  const [lockRows] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [lockName]);
  locked = Number(lockRows?.[0]?.acquired ?? 0) === 1;
  if (!locked) throw new Error("无法取得管理后台举报投诉迁移锁");

  const threadType = await columnType("message_threads", "threadType");
  if (!threadType) throw new Error("管理后台 message_threads.threadType 不存在");
  if (!threadType.includes("'complaint'")) {
    await connection.query(`
      ALTER TABLE message_threads
      MODIFY COLUMN threadType
        ENUM('general', 'inquiry', 'service', 'crm_apply', 'complaint')
        NOT NULL DEFAULT 'general'
    `);
  }
  if (!(await columnExists("message_threads", "complaintContext"))) {
    await connection.query(
      "ALTER TABLE message_threads ADD COLUMN complaintContext JSON NULL AFTER companyProfile",
    );
  }

  console.log(JSON.stringify({
    ok: true,
    complaintMessageType: (await columnType("message_threads", "threadType")).includes("'complaint'"),
    complaintContextColumn: await columnExists("message_threads", "complaintContext"),
  }));
} finally {
  if (locked) {
    await connection.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => undefined);
  }
  await connection.end();
}
