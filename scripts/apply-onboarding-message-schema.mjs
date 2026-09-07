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
    if (line.slice(0, separator).trim() !== "DATABASE_URL") continue;
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
const lockName = "dianzi51_admin_onboarding_messages_v1";
let locked = false;

async function columnType(tableName, columnName) {
  const [rows] = await connection.query(
    `SELECT COLUMN_TYPE AS value FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [tableName, columnName],
  );
  return String(rows?.[0]?.value ?? "");
}

async function tableExists(tableName) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS value FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName],
  );
  return Number(rows?.[0]?.value ?? 0) === 1;
}

async function columnExists(tableName, columnName) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS value FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tableName, columnName],
  );
  return Number(rows?.[0]?.value ?? 0) === 1;
}

async function hasUniqueColumnIndex(tableName, columnName) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS value FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
       AND COLUMN_NAME = ? AND NON_UNIQUE = 0`,
    [tableName, columnName],
  );
  return Number(rows?.[0]?.value ?? 0) >= 1;
}

try {
  const [lockRows] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [lockName]);
  locked = Number(lockRows?.[0]?.acquired ?? 0) === 1;
  if (!locked) throw new Error("无法取得管理后台开通消息迁移锁");

  if (!(await tableExists("message_threads")) || !(await tableExists("messages"))) {
    throw new Error("后台消息基础表未建立，请先恢复基线数据库");
  }
  if (!(await columnExists("messages", "clientMessageId"))) {
    throw new Error("后台消息基线缺少 messages.clientMessageId");
  }
  if (!(await hasUniqueColumnIndex("messages", "clientMessageId"))) {
    throw new Error("后台消息基线缺少 clientMessageId 唯一索引");
  }
  const currentType = await columnType("message_threads", "threadType");
  if (!currentType) throw new Error("管理后台 message_threads.threadType 不存在");
  if (!currentType.includes("'onboarding'")) {
    await connection.query(`
      ALTER TABLE message_threads
      MODIFY COLUMN threadType
        ENUM('general', 'inquiry', 'service', 'onboarding', 'crm_apply', 'complaint')
        NOT NULL DEFAULT 'general'
    `);
  }
  await connection.query(`
    CREATE TABLE IF NOT EXISTS onboarding_lead_guards (
      portalUserId VARCHAR(64) NOT NULL,
      lastOnboardingLeadAt TIMESTAMP NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (portalUserId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  if (!(await columnExists("onboarding_lead_guards", "lastOnboardingLeadAt"))) {
    await connection.query(
      "ALTER TABLE onboarding_lead_guards ADD COLUMN lastOnboardingLeadAt TIMESTAMP NULL AFTER portalUserId",
    );
  }

  const migratedType = await columnType("message_threads", "threadType");
  const expectedValues = ["general", "inquiry", "service", "onboarding", "crm_apply", "complaint"];
  if (!expectedValues.every(value => migratedType.includes(`'${value}'`))) {
    throw new Error(`开通消息枚举迁移校验失败：${migratedType}`);
  }
  if (!(await tableExists("onboarding_lead_guards"))) {
    throw new Error("开通消息事务锁表创建失败");
  }
  if (!(await columnExists("onboarding_lead_guards", "lastOnboardingLeadAt"))) {
    throw new Error("开通消息去重时间字段创建失败");
  }

  console.log(JSON.stringify({
    ok: true,
    onboardingMessageType: migratedType.includes("'onboarding'"),
    onboardingLeadGuardTable: true,
    onboardingLeadTimestamp: true,
    preservedMessageTypes: expectedValues.filter(value => migratedType.includes(`'${value}'`)),
  }));
} finally {
  if (locked) await connection.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => undefined);
  await connection.end();
}
