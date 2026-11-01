#!/usr/bin/env node
import mysql from "mysql2/promise";

/**
 * This migration intentionally never reads .env/runtime configuration files and only
 * admits an explicitly supplied loopback migration_*_test URL. Deployment integration
 * must provide its own reviewed launcher; this script cannot be pointed at production.
 */
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL 未设置；拒绝读取环境文件或猜测数据库");
const parsed = new URL(databaseUrl);
const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
const isAllowedIsolatedDatabase = /^migration_[a-z0-9_]+_test$/i.test(databaseName)
  || databaseName === "official_channel_fixture";
if (
  !new Set(["127.0.0.1", "localhost"]).has(parsed.hostname)
  || !isAllowedIsolatedDatabase
) {
  throw new Error("官方渠道 schema 迁移只允许 127.0.0.1/localhost 的 migration_*_test 或 official_channel_fixture 隔离数据库");
}

const connection = await mysql.createConnection(databaseUrl);
const lockName = "dianzi51_official_channel_schema_v1";
let locked = false;

const tableDefinitions = [
  ["official_channel_teams", `
    CREATE TABLE IF NOT EXISTS official_channel_teams (
      id INT NOT NULL AUTO_INCREMENT,
      name VARCHAR(128) NOT NULL,
      status ENUM('active', 'archived') NOT NULL DEFAULT 'active',
      revision INT UNSIGNED NOT NULL DEFAULT 1,
      createdByAdminUserId INT NOT NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY official_channel_teams_status_updated_idx (status, updatedAt)
    ) ENGINE=InnoDB
  `],
  ["official_channel_team_members", `
    CREATE TABLE IF NOT EXISTS official_channel_team_members (
      id INT NOT NULL AUTO_INCREMENT,
      adminUserId INT NOT NULL,
      teamId INT NOT NULL,
      role ENUM('member', 'leader') NOT NULL DEFAULT 'member',
      leaderTeamId INT GENERATED ALWAYS AS (CASE WHEN role = 'leader' THEN teamId ELSE NULL END) STORED,
      revision INT UNSIGNED NOT NULL DEFAULT 1,
      updatedByAdminUserId INT NOT NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY official_channel_team_members_admin_user_unique (adminUserId),
      KEY official_channel_team_members_team_idx (teamId),
      UNIQUE KEY official_channel_team_members_leader_team_unique (leaderTeamId)
    ) ENGINE=InnoDB
  `],
  ["official_channel_sources", `
    CREATE TABLE IF NOT EXISTS official_channel_sources (
      id INT NOT NULL AUTO_INCREMENT,
      teamId INT NULL,
      name VARCHAR(128) NOT NULL,
      type ENUM('factory', 'agent', 'trade', 'other') NOT NULL,
      contactName VARCHAR(128) NULL,
      phone VARCHAR(64) NULL,
      wechat VARCHAR(128) NULL,
      qq VARCHAR(64) NULL,
      notes TEXT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      publicationApproved BOOLEAN NOT NULL DEFAULT FALSE,
      everPublished BOOLEAN NOT NULL DEFAULT FALSE,
      createdByAdminUserId INT NOT NULL,
      revision INT UNSIGNED NOT NULL DEFAULT 1,
      legacySourceId VARCHAR(64) NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY official_channel_sources_team_active_idx (teamId, active),
      UNIQUE KEY official_channel_sources_legacy_source_unique (legacySourceId)
    ) ENGINE=InnoDB
  `],
  ["official_channel_stocks", `
    CREATE TABLE IF NOT EXISTS official_channel_stocks (
      id INT NOT NULL AUTO_INCREMENT,
      sourceId INT NOT NULL,
      teamId INT NULL,
      createdByAdminUserId INT NOT NULL,
      ownerAdminUserId INT NOT NULL,
      partNumber VARCHAR(256) NOT NULL,
      brand VARCHAR(128) NULL,
      qty INT UNSIGNED NULL,
      dateCode VARCHAR(64) NULL,
      price VARCHAR(64) NULL,
      currency VARCHAR(8) NOT NULL DEFAULT 'CNY',
      taxIncluded BOOLEAN NULL,
      leadTime VARCHAR(128) NULL,
      note TEXT NULL,
      status ENUM('draft', 'published', 'offshelf') NOT NULL DEFAULT 'draft',
      revision INT UNSIGNED NOT NULL DEFAULT 1,
      createRequestId VARCHAR(64) NOT NULL,
      createPayloadHash VARCHAR(64) NOT NULL,
      publishedAt TIMESTAMP NULL,
      legacyMaterialId VARCHAR(64) NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY official_channel_stocks_source_idx (sourceId),
      KEY official_channel_stocks_team_status_idx (teamId, status, updatedAt),
      KEY official_channel_stocks_team_owner_idx (teamId, ownerAdminUserId, updatedAt),
      UNIQUE KEY official_channel_stocks_create_request_unique (createRequestId),
      UNIQUE KEY official_channel_stocks_legacy_material_unique (legacyMaterialId),
      CONSTRAINT official_channel_stocks_qty_nonnegative CHECK (qty IS NULL OR qty >= 0)
    ) ENGINE=InnoDB
  `],
  ["official_channel_stock_notes", `
    CREATE TABLE IF NOT EXISTS official_channel_stock_notes (
      id BIGINT NOT NULL AUTO_INCREMENT,
      stockId INT NOT NULL,
      authorAdminUserId INT NOT NULL,
      body TEXT NOT NULL,
      requestId VARCHAR(64) NOT NULL,
      payloadHash VARCHAR(64) NOT NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY official_channel_stock_notes_stock_created_idx (stockId, createdAt),
      UNIQUE KEY official_channel_stock_notes_request_unique (requestId)
    ) ENGINE=InnoDB
  `],
  ["official_channel_publications", `
    CREATE TABLE IF NOT EXISTS official_channel_publications (
      id INT NOT NULL AUTO_INCREMENT,
      stockId INT NOT NULL,
      publicId VARCHAR(64) NOT NULL,
      snapshot JSON NOT NULL,
      batchId VARCHAR(64) NOT NULL,
      revision INT UNSIGNED NOT NULL DEFAULT 1,
      publishedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY official_channel_publications_stock_unique (stockId),
      UNIQUE KEY official_channel_publications_public_id_unique (publicId),
      KEY official_channel_publications_published_idx (publishedAt)
    ) ENGINE=InnoDB
  `],
  ["official_channel_audits", `
    CREATE TABLE IF NOT EXISTS official_channel_audits (
      id BIGINT NOT NULL AUTO_INCREMENT,
      action VARCHAR(64) NOT NULL,
      targetId VARCHAR(64) NOT NULL,
      actorAdminUserId INT NOT NULL,
      requestId VARCHAR(64) NOT NULL,
      payloadHash VARCHAR(64) NOT NULL,
      beforeData JSON NULL,
      afterData JSON NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY official_channel_audits_request_unique (requestId),
      KEY official_channel_audits_target_created_idx (targetId, createdAt),
      KEY official_channel_audits_actor_created_idx (actorAdminUserId, createdAt)
    ) ENGINE=InnoDB
  `],
];

const expectedColumns = {
  official_channel_teams: ["id", "name", "status", "revision", "createdByAdminUserId", "createdAt", "updatedAt"],
  official_channel_team_members: ["id", "adminUserId", "teamId", "role", "leaderTeamId", "revision", "updatedByAdminUserId", "createdAt", "updatedAt"],
  official_channel_sources: ["id", "teamId", "name", "type", "contactName", "phone", "wechat", "qq", "notes", "active", "publicationApproved", "everPublished", "createdByAdminUserId", "revision", "legacySourceId", "createdAt", "updatedAt"],
  official_channel_stocks: ["id", "sourceId", "teamId", "createdByAdminUserId", "ownerAdminUserId", "partNumber", "brand", "qty", "dateCode", "price", "currency", "taxIncluded", "leadTime", "note", "status", "revision", "createRequestId", "createPayloadHash", "publishedAt", "legacyMaterialId", "createdAt", "updatedAt"],
  official_channel_stock_notes: ["id", "stockId", "authorAdminUserId", "body", "requestId", "payloadHash", "createdAt"],
  official_channel_publications: ["id", "stockId", "publicId", "snapshot", "batchId", "revision", "publishedAt", "updatedAt"],
  official_channel_audits: ["id", "action", "targetId", "actorAdminUserId", "requestId", "payloadHash", "beforeData", "afterData", "createdAt"],
};

const expectedIndexes = {
  official_channel_teams: { PRIMARY: { columns: "id", unique: true }, official_channel_teams_status_updated_idx: { columns: "status,updatedAt", unique: false } },
  official_channel_team_members: {
    PRIMARY: { columns: "id", unique: true },
    official_channel_team_members_admin_user_unique: { columns: "adminUserId", unique: true },
    official_channel_team_members_team_idx: { columns: "teamId", unique: false },
    official_channel_team_members_leader_team_unique: { columns: "leaderTeamId", unique: true },
  },
  official_channel_sources: {
    PRIMARY: { columns: "id", unique: true },
    official_channel_sources_team_active_idx: { columns: "teamId,active", unique: false },
    official_channel_sources_legacy_source_unique: { columns: "legacySourceId", unique: true },
  },
  official_channel_stocks: {
    PRIMARY: { columns: "id", unique: true },
    official_channel_stocks_source_idx: { columns: "sourceId", unique: false },
    official_channel_stocks_team_status_idx: { columns: "teamId,status,updatedAt", unique: false },
    official_channel_stocks_team_owner_idx: { columns: "teamId,ownerAdminUserId,updatedAt", unique: false },
    official_channel_stocks_create_request_unique: { columns: "createRequestId", unique: true },
    official_channel_stocks_legacy_material_unique: { columns: "legacyMaterialId", unique: true },
  },
  official_channel_stock_notes: {
    PRIMARY: { columns: "id", unique: true },
    official_channel_stock_notes_stock_created_idx: { columns: "stockId,createdAt", unique: false },
    official_channel_stock_notes_request_unique: { columns: "requestId", unique: true },
  },
  official_channel_publications: {
    PRIMARY: { columns: "id", unique: true },
    official_channel_publications_stock_unique: { columns: "stockId", unique: true },
    official_channel_publications_public_id_unique: { columns: "publicId", unique: true },
    official_channel_publications_published_idx: { columns: "publishedAt", unique: false },
  },
  official_channel_audits: {
    PRIMARY: { columns: "id", unique: true },
    official_channel_audits_request_unique: { columns: "requestId", unique: true },
    official_channel_audits_target_created_idx: { columns: "targetId,createdAt", unique: false },
    official_channel_audits_actor_created_idx: { columns: "actorAdminUserId,createdAt", unique: false },
  },
};

async function verifyTable(table) {
  const [columns] = await connection.query(
    `SELECT COLUMN_NAME AS name, EXTRA AS extra
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table],
  );
  const names = new Set(columns.map(row => row.name));
  const missing = expectedColumns[table].filter(name => !names.has(name));
  if (missing.length) throw new Error(`${table} 缺少列: ${missing.join(",")}`);
  if (table === "official_channel_team_members") {
    const leaderTeamId = columns.find(row => row.name === "leaderTeamId");
    if (!leaderTeamId || !/GENERATED/i.test(String(leaderTeamId.extra ?? ""))) {
      throw new Error("official_channel_team_members.leaderTeamId 必须为生成列");
    }
  }

  const [indexRows] = await connection.query(
    `SELECT INDEX_NAME AS name,
            GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnsCsv,
            MIN(NON_UNIQUE) AS nonUnique
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      GROUP BY INDEX_NAME`,
    [table],
  );
  const indexMap = new Map(indexRows.map(row => [row.name, row]));
  for (const [name, expected] of Object.entries(expectedIndexes[table])) {
    const found = indexMap.get(name);
    if (!found || String(found.columnsCsv) !== expected.columns || (Number(found.nonUnique) === 0) !== expected.unique) {
      throw new Error(`${table}.${name} 索引校验失败`);
    }
  }
}

try {
  const [lockRows] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [lockName]);
  locked = Number(lockRows?.[0]?.acquired ?? 0) === 1;
  if (!locked) throw new Error("无法取得官方渠道 schema 迁移锁");

  for (const [, definition] of tableDefinitions) await connection.query(definition);
  for (const [table] of tableDefinitions) await verifyTable(table);
  console.log("[verify]", JSON.stringify({
    database: databaseName,
    tables: tableDefinitions.map(([name]) => name),
    officialTeamLeader: "generated leaderTeamId unique",
    migrationScope: "new official_channel_* tables only",
  }));
} finally {
  if (locked) await connection.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => undefined);
  await connection.end();
}
