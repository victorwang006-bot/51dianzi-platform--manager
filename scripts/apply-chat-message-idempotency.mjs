import { lstat } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import mysql from "mysql2/promise";

const require = createRequire(import.meta.url);
const configIndex = process.argv.indexOf("--from-ecosystem-config");
const sourceConfig = configIndex >= 0 ? process.argv[configIndex + 1] : "";

async function databaseUrlFromEcosystem(configPath) {
  if (!configPath) throw new Error("未提供数据库配置来源文件");
  const resolvedPath = resolve(configPath);
  const metadata = await lstat(resolvedPath);
  if (!metadata.isFile()) throw new Error("数据库配置来源不是普通文件");
  if ((metadata.mode & 0o077) !== 0) throw new Error("数据库配置来源文件权限过宽，消息幂等迁移已中止");
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
    throw new Error("数据库配置来源文件所有者不可信，消息幂等迁移已中止");
  }
  const moduleId = require.resolve(resolvedPath);
  delete require.cache[moduleId];
  const config = require(moduleId);
  const app = config?.apps?.find(item => item?.name === "dianzi51-admin")
    ?? config?.apps?.find(item => typeof item?.env?.DATABASE_URL === "string");
  const databaseUrl = app?.env?.DATABASE_URL;
  return typeof databaseUrl === "string" ? databaseUrl.trim() : "";
}

const databaseUrl = process.env.DATABASE_URL || await databaseUrlFromEcosystem(sourceConfig);
if (!databaseUrl) throw new Error("未找到 DATABASE_URL，消息幂等迁移已中止");

const connection = await mysql.createConnection(databaseUrl);
const lockName = "dianzi51_admin_message_idempotency_v1";
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

async function readIndex(indexName) {
  const [rows] = await connection.query(
    `SELECT INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique,
            SEQ_IN_INDEX AS sequenceNo, COLUMN_NAME AS columnName
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'messages' AND INDEX_NAME = ?
      ORDER BY SEQ_IN_INDEX`,
    [indexName],
  );
  return rows;
}

async function ensureIndex(indexName, columns, unique = false) {
  const existing = await readIndex(indexName);
  if (existing.length === 0) {
    const escapedColumns = columns.map(column => `\`${column}\``).join(", ");
    await connection.query(
      `ALTER TABLE messages ADD ${unique ? "CONSTRAINT" : "INDEX"} \`${indexName}\` ${
        unique ? "UNIQUE" : ""
      } (${escapedColumns})`,
    );
  }
  const verified = await readIndex(indexName);
  const actualColumns = verified.map(row => String(row.columnName)).join(",");
  const uniquenessMatches = verified.every(row => Number(row.nonUnique) === (unique ? 0 : 1));
  if (verified.length !== columns.length || actualColumns !== columns.join(",") || !uniquenessMatches) {
    throw new Error(`messages.${indexName} 索引结构校验失败`);
  }
}

try {
  const [lockRows] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [lockName]);
  locked = Number(lockRows?.[0]?.acquired ?? 0) === 1;
  if (!locked) throw new Error("无法取得后台消息幂等迁移锁");

  if (!(await columnExists("messages", "clientMessageId"))) {
    await connection.query("ALTER TABLE messages ADD COLUMN clientMessageId VARCHAR(64) NULL AFTER threadId");
  }

  const [duplicateRows] = await connection.query(
    `SELECT clientMessageId, COUNT(*) AS rowCount
       FROM messages
      WHERE clientMessageId IS NOT NULL
      GROUP BY clientMessageId
     HAVING COUNT(*) > 1
      LIMIT 1`,
  );
  if (duplicateRows[0]) {
    throw new Error("messages 存在重复 clientMessageId；为避免静默删除后台消息，迁移已中止");
  }

  await ensureIndex("messages_client_message_unique", ["clientMessageId"], true);
  await ensureIndex("messages_thread_created_idx", ["threadId", "createdAt"]);

  console.log(JSON.stringify({
    ok: true,
    messages: await scalar("SELECT COUNT(*) AS value FROM messages"),
    portalMessages: await scalar("SELECT COUNT(*) AS value FROM messages WHERE senderType = 'portal'"),
    clientMessageIds: await scalar("SELECT COUNT(*) AS value FROM messages WHERE clientMessageId IS NOT NULL"),
    clientMessageColumn: await columnExists("messages", "clientMessageId"),
  }));
} finally {
  if (locked) await connection.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => undefined);
  await connection.end();
}
