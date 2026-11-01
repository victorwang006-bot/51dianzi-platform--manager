#!/usr/bin/env tsx
/**
 * 官方渠道 legacy 真实 MySQL + Drizzle 集成测试。
 *
 * 只接受启动器显式注入的 DATABASE_URL，且严格限定为：
 *   mysql://…@127.0.0.1:33316/official_channel_fixture
 *
 * 运行方式（不要直接读取 private 凭据文件）：
 *   ../backend-team-v1/run-fixture-tests.py scripts/test-official-channel-legacy-integration.ts
 *
 * 本脚本不读取 .env、不连接生产，也不 DROP/ALTER 任何表。它只删除自身
 * OCLEG-/ocleg_ 前缀的虚构数据。若 merchant 30061 已存在，或已有 legacy
 * 表含非本脚本前缀的行，会阻断而不会覆盖或清理别人的 fixture。
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const resultsDir = resolve(scriptDir, "../../backend-team-v1");
const resultsJsonPath = resolve(resultsDir, "legacy-db-integration.json");
const resultsMarkdownPath = resolve(resultsDir, "legacy-db-integration.md");
const fixtureDatabase = "official_channel_fixture";
const fixtureHost = "127.0.0.1";
const fixturePort = "33316";
const fixturePrefix = "ocleg_";
const markerPrefix = "OCLEG-";

type TestRecord = {
  id: string;
  title: string;
  status: "passed" | "failed" | "blocked";
  detail: string;
  failureHint?: string;
};

type IntegrationResults = {
  suite: string;
  database: {
    host: string;
    port: string;
    name: string;
    credentialPrinted: false;
  } | null;
  safety: {
    databaseUrlReadOnlyFromEnvironment: true;
    loopbackAndFixtureGuard: "passed" | "failed";
    platformDatabaseGuard: "passed" | "failed";
    cleanupScope: string;
    schemaMigration: "passed" | "failed" | "not-run";
    noDropOrAlter: true;
  };
  startedAt: string;
  finishedAt: string | null;
  status: "passed" | "failed" | "blocked";
  tests: TestRecord[];
  fatalCode: string | null;
  notes: string[];
};

const results: IntegrationResults = {
  suite: "official-channel legacy real MySQL + Drizzle/getDb integration",
  database: null,
  safety: {
    databaseUrlReadOnlyFromEnvironment: true,
    loopbackAndFixtureGuard: "failed",
    platformDatabaseGuard: "failed",
    cleanupScope:
      "仅删除本脚本 OCLEG-/ocleg_ 前缀的虚构官方、后台、merchant 和 legacy 行；不删除表或别的夹具。",
    schemaMigration: "not-run",
    noDropOrAlter: true,
  },
  startedAt: new Date().toISOString(),
  finishedAt: null,
  status: "blocked",
  tests: [],
  fatalCode: null,
  notes: [
    "未读取 .env、PM2/ECS 或生产运行时配置；连接串仅由受控启动器注入且不写入报告。",
    "merchant 30061 仅在隔离 fixture 中临时创建为虚构契约定位记录；若该 ID 已有数据立即阻断，绝不覆盖。",
    "旧表只由测试直接插入/删除 OCLEG- 虚构行；每次服务调用前后均校验 legacy 原始行散列未变。",
  ],
};

class IntegrationAssertionError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

class IntegrationBlockedError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

type DbRow = RowDataPacket & Record<string, unknown>;
type Actor = { adminUserId: number; sessionVersion: number };
type LegacyFixture = {
  sources: Array<{
    id: number;
    label: string;
    responsibleFrontUserId: number;
    enterpriseId: number;
  }>;
  materials: Array<{
    id: number;
    sourceId: number;
    label: string;
    responsibleFrontUserId: number;
    enterpriseId: number;
  }>;
};

function safeErrorCode(error: unknown): string {
  if (error && typeof error === "object") {
    const candidate = error as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (
      typeof candidate.code === "string" &&
      /^[A-Z0-9_]+$/.test(candidate.code)
    )
      return candidate.code;
    if (typeof candidate.message === "string") {
      const matched = candidate.message.match(
        /(?:OFFICIAL_LEGACY_[A-Z0-9_]+|LEGACY_FIXTURE_[A-Z0-9_]+|INTEGRATION_[A-Z0-9_]+|FORBIDDEN|UNAUTHORIZED)/
      );
      if (matched) return matched[0];
    }
    if (candidate.cause) return safeErrorCode(candidate.cause);
  }
  return "UNEXPECTED_ERROR";
}

function safeErrorSummary(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;
  for (
    let depth = 0;
    depth < 3 && current && typeof current === "object";
    depth += 1
  ) {
    const candidate = current as {
      name?: unknown;
      message?: unknown;
      code?: unknown;
      cause?: unknown;
    };
    const name = typeof candidate.name === "string" ? candidate.name : "Error";
    const code =
      typeof candidate.code === "string" ? ` [${candidate.code}]` : "";
    const message =
      typeof candidate.message === "string"
        ? candidate.message
        : safeErrorCode(current);
    messages.push(`${name}${code}: ${message}`);
    current = candidate.cause;
  }
  return messages
    .join(" | ")
    .replace(/mysql:\/\/[^\s@/]+@/gi, "mysql://[REDACTED]@")
    .replace(/(?:password|pwd)=([^\s&]+)/gi, "$1=[REDACTED]")
    .slice(0, 360);
}

function requireFixtureUrl(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl)
    throw new IntegrationAssertionError(
      "INTEGRATION_FIXTURE_DATABASE_URL_REQUIRED"
    );
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new IntegrationAssertionError(
      "INTEGRATION_FIXTURE_DATABASE_URL_INVALID"
    );
  }
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (
    url.protocol !== "mysql:" ||
    url.hostname !== fixtureHost ||
    url.port !== fixturePort ||
    databaseName !== fixtureDatabase
  ) {
    throw new IntegrationAssertionError("INTEGRATION_FIXTURE_TARGET_REFUSED");
  }
  if (process.env.PLATFORM_DB_NAME !== fixtureDatabase) {
    throw new IntegrationAssertionError(
      "INTEGRATION_PLATFORM_DATABASE_TARGET_REFUSED"
    );
  }
  results.database = {
    host: url.hostname,
    port: url.port,
    name: databaseName,
    credentialPrinted: false,
  };
  results.safety.loopbackAndFixtureGuard = "passed";
  results.safety.platformDatabaseGuard = "passed";
  return databaseUrl;
}

function requestId(runId: string, ordinal: number) {
  const value = `${fixturePrefix}${runId}_${ordinal}`;
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(value))
    throw new IntegrationAssertionError("INTEGRATION_REQUEST_ID_INVALID");
  return value;
}

function hashRows(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function rows<T extends DbRow = DbRow>(
  connection: Connection,
  statement: string,
  values: unknown[] = []
) {
  const [returned] = await connection.execute(statement, values);
  return returned as T[];
}

function insertId(result: unknown, code: string): number {
  const id = Number((result as { insertId?: number })?.insertId ?? 0);
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new IntegrationAssertionError(code);
  return id;
}

async function tableExists(
  connection: Connection,
  tableName: string
): Promise<boolean> {
  const found = await rows<{ tableName: string }>(
    connection,
    `
    SELECT table_name AS tableName
      FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ?
  `,
    [tableName]
  );
  return found.length === 1;
}

async function assertColumns(
  connection: Connection,
  table: string,
  required: readonly string[]
) {
  const found = await rows<{ columnName: string }>(
    connection,
    `
    SELECT column_name AS columnName
      FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ?
  `,
    [table]
  );
  const names = new Set(found.map(row => row.columnName));
  for (const name of required) {
    if (!names.has(name))
      throw new IntegrationAssertionError(
        "INTEGRATION_REQUIRED_COLUMN_MISSING"
      );
  }
}

async function setupNativeFixtureTables(connection: Connection) {
  // Exact native names/fields touched by the legacy service. CREATE IF NOT EXISTS only;
  // an existing table is never altered, and required columns are checked separately.
  await connection.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INT NOT NULL AUTO_INCREMENT,
      userId INT NOT NULL,
      username VARCHAR(64) NOT NULL,
      usernameCanonical VARCHAR(64) NOT NULL,
      displayName VARCHAR(128) NULL,
      email VARCHAR(320) NULL,
      phone VARCHAR(20) NULL,
      passwordHash VARCHAR(128) NULL,
      adminRole ENUM('super_admin','operation','merchant_mgr','customer_svc','risk_control','finance','auditor') NOT NULL DEFAULT 'operation',
      status ENUM('active','disabled','locked') NOT NULL DEFAULT 'active',
      sessionVersion INT NOT NULL DEFAULT 1,
      mfaEnabled BOOLEAN NULL,
      lastLoginAt TIMESTAMP NULL,
      lastLoginIpAddress VARCHAR(64) NULL,
      lastLoginIpHash VARCHAR(64) NULL,
      lastLoginLocation VARCHAR(128) NULL,
      lastLoginDevice VARCHAR(160) NULL,
      lastLoginDeviceHash VARCHAR(64) NULL,
      lastLoginMethod VARCHAR(32) NULL,
      securityRiskLevel VARCHAR(16) NULL,
      securityRiskReason VARCHAR(255) NULL,
      securityRiskAt TIMESTAMP NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY admin_users_username_unique (username),
      UNIQUE KEY admin_users_username_canonical_unique (usernameCanonical)
    ) ENGINE=InnoDB
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS admin_user_permissions (
      id INT NOT NULL AUTO_INCREMENT,
      adminUserId INT NOT NULL,
      permission VARCHAR(64) NOT NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY admin_user_permissions_admin_permission_unique (adminUserId, permission),
      KEY admin_user_permissions_admin_user_idx (adminUserId)
    ) ENGINE=InnoDB
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS admin_business_staff_bindings (
      id INT NOT NULL AUTO_INCREMENT,
      adminUserId INT NOT NULL,
      frontUserId INT NULL,
      status ENUM('active','revoked') NOT NULL DEFAULT 'revoked',
      bindingVersion INT UNSIGNED NOT NULL DEFAULT 1,
      createdByAdminUserId INT NOT NULL,
      updatedByAdminUserId INT NOT NULL,
      revokedByAdminUserId INT NULL,
      revokedAt TIMESTAMP NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY admin_business_staff_bindings_admin_user_unique (adminUserId),
      UNIQUE KEY admin_business_staff_bindings_front_user_unique (frontUserId),
      KEY admin_business_staff_bindings_status_updated_idx (status, updatedAt)
    ) ENGINE=InnoDB
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS merchants (
      id INT NOT NULL AUTO_INCREMENT,
      merchantNo VARCHAR(32) NOT NULL,
      companyName VARCHAR(256) NOT NULL,
      crmOwnerPortalUserId VARCHAR(64) NULL,
      PRIMARY KEY (id),
      UNIQUE KEY merchants_merchant_no_unique (merchantNo)
    ) ENGINE=InnoDB
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS channel_inventory_channels (
      id INT NOT NULL AUTO_INCREMENT,
      enterprise_id INT NOT NULL,
      data_owner_user_id INT NOT NULL,
      responsible_user_id INT NOT NULL,
      name VARCHAR(128) NOT NULL,
      channel_type ENUM('factory','agent','trade','other') NOT NULL,
      contact_name VARCHAR(128) NULL,
      phone VARCHAR(64) NULL,
      wechat VARCHAR(128) NULL,
      qq VARCHAR(64) NULL,
      notes TEXT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY channel_inventory_channels_owner_idx (data_owner_user_id, id)
    ) ENGINE=InnoDB
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS channel_inventory_materials (
      id INT NOT NULL AUTO_INCREMENT,
      channel_id INT NOT NULL,
      enterprise_id INT NOT NULL,
      data_owner_user_id INT NOT NULL,
      responsible_user_id INT NOT NULL,
      part_number VARCHAR(256) NOT NULL,
      brand VARCHAR(128) NOT NULL,
      qty INT NULL,
      date_code VARCHAR(64) NULL,
      price VARCHAR(64) NULL,
      currency VARCHAR(8) NOT NULL DEFAULT 'CNY',
      tax_included BOOLEAN NULL,
      lead_time VARCHAR(128) NULL,
      note TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY channel_inventory_materials_channel_idx (channel_id, id)
    ) ENGINE=InnoDB
  `);

  await Promise.all([
    assertColumns(connection, "admin_users", [
      "id",
      "userId",
      "username",
      "usernameCanonical",
      "adminRole",
      "status",
      "sessionVersion",
    ]),
    assertColumns(connection, "admin_user_permissions", [
      "id",
      "adminUserId",
      "permission",
    ]),
    assertColumns(connection, "admin_business_staff_bindings", [
      "id",
      "adminUserId",
      "frontUserId",
      "status",
      "bindingVersion",
    ]),
    assertColumns(connection, "merchants", [
      "id",
      "merchantNo",
      "companyName",
      "crmOwnerPortalUserId",
    ]),
    assertColumns(connection, "channel_inventory_channels", [
      "id",
      "enterprise_id",
      "data_owner_user_id",
      "responsible_user_id",
      "name",
      "channel_type",
      "contact_name",
      "phone",
      "wechat",
      "qq",
      "notes",
      "active",
      "created_at",
      "updated_at",
    ]),
    assertColumns(connection, "channel_inventory_materials", [
      "id",
      "channel_id",
      "enterprise_id",
      "data_owner_user_id",
      "responsible_user_id",
      "part_number",
      "brand",
      "qty",
      "date_code",
      "price",
      "currency",
      "tax_included",
      "lead_time",
      "note",
      "created_at",
      "updated_at",
    ]),
  ]);
}

async function assertLegacyTablesAreEmptyOrOurs(connection: Connection) {
  for (const [table, markerColumn] of [
    ["channel_inventory_channels", "name"],
    ["channel_inventory_materials", "part_number"],
  ] as const) {
    if (!(await tableExists(connection, table))) continue;
    const [count] = await rows<{
      total: number | string;
      tagged: number | string | null;
    }>(
      connection,
      `
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN ${markerColumn} LIKE ? THEN 1 ELSE 0 END) AS tagged
        FROM ${table}
    `,
      [`${markerPrefix}%`]
    );
    const total = Number(count?.total ?? 0);
    const tagged = Number(count?.tagged ?? 0);
    if (total !== tagged)
      throw new IntegrationBlockedError(
        "LEGACY_FIXTURE_FOREIGN_LEGACY_ROWS_PRESENT"
      );
  }
}

async function assertMerchant30061Absent(connection: Connection) {
  const [merchant] = await rows<{ total: number | string }>(
    connection,
    "SELECT COUNT(*) AS total FROM merchants WHERE id = 30061"
  );
  if (Number(merchant?.total ?? 0) > 0) {
    throw new IntegrationBlockedError(
      "LEGACY_FIXTURE_MERCHANT_30061_ALREADY_PRESENT"
    );
  }
}

async function cleanupTaggedFixtures(connection: Connection) {
  // Every delete has a local, stable prefix predicate. This never deletes structures or
  // unmarked data, even inside the isolated fixture database.
  await connection.execute(
    `
    DELETE publication
      FROM official_channel_publications AS publication
      INNER JOIN official_channel_stocks AS stock ON stock.id = publication.stockId
     WHERE stock.partNumber LIKE ?
  `,
    [`${markerPrefix}%`]
  );
  await connection.execute(
    `
    DELETE stock
      FROM official_channel_stocks AS stock
      INNER JOIN official_channel_sources AS source ON source.id = stock.sourceId
     WHERE source.name LIKE ?
  `,
    [`${markerPrefix}%`]
  );
  await connection.execute(
    "DELETE FROM official_channel_stocks WHERE partNumber LIKE ?",
    [`${markerPrefix}%`]
  );
  await connection.execute(
    "DELETE FROM official_channel_sources WHERE name LIKE ?",
    [`${markerPrefix}%`]
  );
  await connection.execute(
    "DELETE FROM official_channel_audits WHERE requestId LIKE ?",
    [`${fixturePrefix}%`]
  );

  const fixtureUsers = await rows<{ id: number }>(
    connection,
    "SELECT id FROM admin_users WHERE usernameCanonical LIKE ?",
    [`${fixturePrefix}%`]
  );
  for (const user of fixtureUsers) {
    await connection.execute(
      "DELETE FROM official_channel_team_members WHERE adminUserId = ?",
      [user.id]
    );
    await connection.execute(
      "DELETE FROM admin_business_staff_bindings WHERE adminUserId = ?",
      [user.id]
    );
    await connection.execute(
      "DELETE FROM admin_user_permissions WHERE adminUserId = ?",
      [user.id]
    );
  }
  if (fixtureUsers.length > 0) {
    await connection.execute(
      "DELETE FROM admin_users WHERE usernameCanonical LIKE ?",
      [`${fixturePrefix}%`]
    );
  }
  await connection.execute(
    "DELETE FROM official_channel_teams WHERE name LIKE ?",
    [`${markerPrefix}%`]
  );

  await connection.execute(
    "DELETE FROM channel_inventory_materials WHERE part_number LIKE ?",
    [`${markerPrefix}%`]
  );
  await connection.execute(
    "DELETE FROM channel_inventory_channels WHERE name LIKE ?",
    [`${markerPrefix}%`]
  );
  await connection.execute(
    "DELETE FROM merchants WHERE id = 30061 AND merchantNo LIKE ?",
    [`${markerPrefix}%`]
  );
}

async function clearLegacyRows(connection: Connection) {
  await connection.execute(
    "DELETE FROM channel_inventory_materials WHERE part_number LIKE ?",
    [`${markerPrefix}%`]
  );
  await connection.execute(
    "DELETE FROM channel_inventory_channels WHERE name LIKE ?",
    [`${markerPrefix}%`]
  );
}

async function createVirtualAdmin(
  connection: Connection,
  runId: string,
  suffix: string,
  role: "super_admin" | "operation"
): Promise<Actor> {
  const username = `${fixturePrefix}${runId}_${suffix}`.slice(0, 64);
  const [result] = await connection.execute(
    `INSERT INTO admin_users (userId, username, usernameCanonical, displayName, adminRole, status, sessionVersion, passwordHash)
     VALUES (?, ?, ?, ?, ?, 'active', 1, NULL)`,
    [
      900_000_000 + Math.floor(Math.random() * 10_000_000),
      username,
      username,
      `虚构 legacy 夹具-${suffix}`,
      role,
    ]
  );
  return {
    adminUserId: insertId(result, "INTEGRATION_ADMIN_CREATE_FAILED"),
    sessionVersion: 1,
  };
}

async function createActiveBinding(
  connection: Connection,
  adminUserId: number,
  frontUserId: number,
  operatorAdminUserId: number
) {
  await connection.execute(
    `INSERT INTO admin_business_staff_bindings
       (adminUserId, frontUserId, status, bindingVersion, createdByAdminUserId, updatedByAdminUserId)
     VALUES (?, ?, 'active', 1, ?, ?)`,
    [adminUserId, frontUserId, operatorAdminUserId, operatorAdminUserId]
  );
}

async function seedFixtureMerchant(
  connection: Connection,
  runId: string,
  legacyOwnerFrontUserId: number
) {
  await connection.execute(
    "INSERT INTO merchants (id, merchantNo, companyName, crmOwnerPortalUserId) VALUES (30061, ?, ?, ?)",
    [
      `${markerPrefix}${runId}-M30061`,
      `OCLEG 虚构企业 ${runId}`,
      String(legacyOwnerFrontUserId),
    ]
  );
}

async function seedLegacyScenario(
  connection: Connection,
  input: {
    runId: string;
    legacyOwnerFrontUserId: number;
    sources: Array<{
      label: string;
      enterpriseId: number;
      responsibleFrontUserId: number;
      type?: "factory" | "agent" | "trade" | "other";
    }>;
    materialEnterpriseId?: (
      source: { enterpriseId: number; label: string },
      index: number
    ) => number;
    materialResponsibleFrontUserId?: (
      source: { responsibleFrontUserId: number },
      index: number
    ) => number;
  }
): Promise<LegacyFixture> {
  const sources: LegacyFixture["sources"] = [];
  const materials: LegacyFixture["materials"] = [];
  for (let index = 0; index < input.sources.length; index += 1) {
    const source = input.sources[index]!;
    const sourceName = `${markerPrefix}${input.runId}-${source.label}-SOURCE`;
    const [sourceResult] = await connection.execute(
      `INSERT INTO channel_inventory_channels
        (enterprise_id, data_owner_user_id, responsible_user_id, name, channel_type, contact_name, phone, wechat, qq, notes, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, '2025-01-02 03:04:05', '2025-02-03 04:05:06')`,
      [
        source.enterpriseId,
        input.legacyOwnerFrontUserId,
        source.responsibleFrontUserId,
        sourceName,
        source.type ?? "factory",
        `${markerPrefix}${input.runId}-${source.label}-CONTACT`,
        `139${String(10000000 + index).slice(-8)}`,
        `${fixturePrefix}${input.runId}_${source.label}_wechat`,
        `8000${100 + index}`,
        `${markerPrefix}${input.runId}-${source.label}-PRIVATE-SOURCE-NOTE`,
      ]
    );
    const sourceId = insertId(
      sourceResult,
      "INTEGRATION_LEGACY_SOURCE_CREATE_FAILED"
    );
    const materialEnterpriseId =
      input.materialEnterpriseId?.(source, index) ?? source.enterpriseId;
    const materialResponsibleFrontUserId =
      input.materialResponsibleFrontUserId?.(source, index) ??
      source.responsibleFrontUserId;
    const partNumber = `${markerPrefix}${input.runId}-${source.label}-PART`;
    const [materialResult] = await connection.execute(
      `INSERT INTO channel_inventory_materials
        (channel_id, enterprise_id, data_owner_user_id, responsible_user_id, part_number, brand, qty, date_code, price, currency, tax_included, lead_time, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'CNY', 1, ?, ?, '2025-01-03 05:06:07', '2025-02-04 06:07:08')`,
      [
        sourceId,
        materialEnterpriseId,
        input.legacyOwnerFrontUserId,
        materialResponsibleFrontUserId,
        partNumber,
        `${markerPrefix}${input.runId}-${source.label}-BRAND`,
        17 + index,
        `24${40 + index}`,
        index === 0 ? "+12.3400" : "18.5000",
        index === 0 ? "现货" : "7天",
        `${markerPrefix}${input.runId}-${source.label}-PRIVATE-STOCK-NOTE`,
      ]
    );
    sources.push({
      id: sourceId,
      label: source.label,
      responsibleFrontUserId: source.responsibleFrontUserId,
      enterpriseId: source.enterpriseId,
    });
    materials.push({
      id: insertId(materialResult, "INTEGRATION_LEGACY_MATERIAL_CREATE_FAILED"),
      sourceId,
      label: source.label,
      responsibleFrontUserId: materialResponsibleFrontUserId,
      enterpriseId: materialEnterpriseId,
    });
  }
  return { sources, materials };
}

async function snapshotLegacyRows(connection: Connection) {
  const [channels, materials] = await Promise.all([
    rows(
      connection,
      `
      SELECT id, enterprise_id, data_owner_user_id, responsible_user_id, name, channel_type,
             contact_name, phone, wechat, qq, notes, active,
             DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
             DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
        FROM channel_inventory_channels
       WHERE name LIKE ?
       ORDER BY id ASC
    `,
      [`${markerPrefix}%`]
    ),
    rows(
      connection,
      `
      SELECT id, channel_id, enterprise_id, data_owner_user_id, responsible_user_id,
             part_number, brand, qty, date_code, price, currency, tax_included, lead_time, note,
             DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
             DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
        FROM channel_inventory_materials
       WHERE part_number LIKE ?
       ORDER BY id ASC
    `,
      [`${markerPrefix}%`]
    ),
  ]);
  return hashRows({ channels, materials });
}

async function snapshotMerchant(connection: Connection) {
  const merchant = await rows(
    connection,
    `
    SELECT id, merchantNo, companyName, crmOwnerPortalUserId
      FROM merchants
     WHERE id = 30061
  `
  );
  return hashRows(merchant);
}

async function snapshotImportedImmutableRows(
  connection: Connection,
  sourceIds: readonly number[]
) {
  const placeholders = sourceIds.map(() => "?").join(",");
  const [sources, stocks] = await Promise.all([
    rows(
      connection,
      `
      SELECT id, name, type, contactName, phone, wechat, qq, notes, active,
             publicationApproved, everPublished, createdByAdminUserId, legacySourceId,
             DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i:%s') AS createdAt
        FROM official_channel_sources
       WHERE id IN (${placeholders})
       ORDER BY id ASC
    `,
      [...sourceIds]
    ),
    rows(
      connection,
      `
      SELECT id, sourceId, createdByAdminUserId, ownerAdminUserId, partNumber, brand, qty,
             dateCode, price, currency, taxIncluded, leadTime, note, status, createRequestId,
             createPayloadHash, publishedAt, legacyMaterialId,
             DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i:%s') AS createdAt
        FROM official_channel_stocks
       WHERE sourceId IN (${placeholders})
       ORDER BY id ASC
    `,
      [...sourceIds]
    ),
  ]);
  return hashRows({ sources, stocks });
}

async function snapshotTeamAndGrants(
  connection: Connection,
  teamIds: readonly number[],
  admins: readonly number[]
) {
  const teamPlaceholders = teamIds.map(() => "?").join(",");
  const adminPlaceholders = admins.map(() => "?").join(",");
  const [teams, members, permissions] = await Promise.all([
    rows(
      connection,
      `
      SELECT id, name, status, revision, createdByAdminUserId,
             DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i:%s') AS createdAt,
             DATE_FORMAT(updatedAt, '%Y-%m-%d %H:%i:%s') AS updatedAt
        FROM official_channel_teams WHERE id IN (${teamPlaceholders}) ORDER BY id ASC
    `,
      [...teamIds]
    ),
    rows(
      connection,
      `
      SELECT id, adminUserId, teamId, role, leaderTeamId, revision, updatedByAdminUserId,
             DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i:%s') AS createdAt,
             DATE_FORMAT(updatedAt, '%Y-%m-%d %H:%i:%s') AS updatedAt
        FROM official_channel_team_members WHERE adminUserId IN (${adminPlaceholders}) ORDER BY id ASC
    `,
      [...admins]
    ),
    rows(
      connection,
      `
      SELECT id, adminUserId, permission
        FROM admin_user_permissions WHERE adminUserId IN (${adminPlaceholders}) ORDER BY id ASC
    `,
      [...admins]
    ),
  ]);
  return hashRows({ teams, members, permissions });
}

async function taggedOfficialCounts(connection: Connection) {
  const [sources, stocks, publications, audits] = await Promise.all([
    rows<{ total: number | string }>(
      connection,
      "SELECT COUNT(*) AS total FROM official_channel_sources WHERE name LIKE ?",
      [`${markerPrefix}%`]
    ),
    rows<{ total: number | string }>(
      connection,
      "SELECT COUNT(*) AS total FROM official_channel_stocks WHERE partNumber LIKE ?",
      [`${markerPrefix}%`]
    ),
    rows<{ total: number | string }>(
      connection,
      `
      SELECT COUNT(*) AS total
        FROM official_channel_publications AS publication
        INNER JOIN official_channel_stocks AS stock ON stock.id = publication.stockId
       WHERE stock.partNumber LIKE ?
    `,
      [`${markerPrefix}%`]
    ),
    rows<{ total: number | string }>(
      connection,
      "SELECT COUNT(*) AS total FROM official_channel_audits WHERE requestId LIKE ?",
      [`${fixturePrefix}%`]
    ),
  ]);
  return {
    sources: Number(sources[0]?.total ?? 0),
    stocks: Number(stocks[0]?.total ?? 0),
    publications: Number(publications[0]?.total ?? 0),
    audits: Number(audits[0]?.total ?? 0),
  };
}

async function expectRejected(
  operation: () => Promise<unknown>,
  acceptedCodes: readonly string[]
) {
  try {
    await operation();
  } catch (error) {
    const code = safeErrorCode(error);
    if (acceptedCodes.includes(code)) return code;
    throw new IntegrationAssertionError(
      "INTEGRATION_UNEXPECTED_REJECTION_CODE"
    );
  }
  throw new IntegrationAssertionError("INTEGRATION_EXPECTED_REJECTION_MISSING");
}

function recordPassed(id: string, title: string, detail: string) {
  results.tests.push({ id, title, status: "passed", detail });
}

async function check(
  id: string,
  title: string,
  detail: string,
  callback: () => Promise<void>,
  failureHint?: string
) {
  try {
    await callback();
    recordPassed(id, title, detail);
  } catch (error) {
    results.tests.push({
      id,
      title,
      status: error instanceof IntegrationBlockedError ? "blocked" : "failed",
      detail: `失败代码：${safeErrorCode(error)}；${safeErrorSummary(error)}`,
      ...(failureHint ? { failureHint } : {}),
    });
    throw error;
  }
}

function markdownReport() {
  const lines = [
    "# 官方渠道 legacy 真实 MySQL 集成测试结果",
    "",
    `- 状态：**${results.status.toUpperCase()}**`,
    `- 开始：${results.startedAt}`,
    `- 结束：${results.finishedAt ?? "未完成"}`,
    `- 目标：${results.database ? `${results.database.host}:${results.database.port}/${results.database.name}` : "未通过安全前置检查"}`,
    "- 凭据：未写入结果，未输出连接串或口令。",
    `- 安全前置：loopback/fixture=${results.safety.loopbackAndFixtureGuard}；PLATFORM_DB_NAME=${results.safety.platformDatabaseGuard}；不使用 DROP/ALTER=${results.safety.noDropOrAlter}。`,
    `- 官方 schema 迁移器：${results.safety.schemaMigration}。`,
    `- 清理范围：${results.safety.cleanupScope}`,
    "",
    "| 用例 | 状态 | 验证 |",
    "|---|---|---|",
    ...results.tests.map(
      test => `| ${test.id} ${test.title} | ${test.status} | ${test.detail} |`
    ),
  ];
  const nonPassed = results.tests.filter(test => test.status !== "passed");
  if (nonPassed.length > 0) {
    lines.push("", "## 阻断项或需父代理处理的真实问题");
    for (const test of nonPassed) {
      lines.push(
        `- **${test.id}**：${test.detail}${test.failureHint ? `；优先检查 \`${test.failureHint}\`` : ""}`
      );
    }
  }
  if (results.fatalCode)
    lines.push("", `致命中止代码：\`${results.fatalCode}\`。`);
  lines.push("", "## 执行边界", ...results.notes.map(note => `- ${note}`), "");
  return lines.join("\n");
}

async function writeResults() {
  results.finishedAt = new Date().toISOString();
  await writeFile(
    resultsJsonPath,
    `${JSON.stringify(results, null, 2)}\n`,
    "utf8"
  );
  await writeFile(resultsMarkdownPath, markdownReport(), "utf8");
}

async function main() {
  let fixtureConnection: Connection | null = null;
  let drizzleDb: any = null;
  let shouldCleanup = false;
  try {
    const databaseUrl = requireFixtureUrl();
    try {
      execFileSync(
        process.execPath,
        [resolve(scriptDir, "apply-official-channel-schema.mjs")],
        {
          cwd: resolve(scriptDir, ".."),
          env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: "test" },
          stdio: "pipe",
        }
      );
      results.safety.schemaMigration = "passed";
    } catch {
      results.safety.schemaMigration = "failed";
      throw new IntegrationAssertionError(
        "INTEGRATION_OFFICIAL_SCHEMA_MIGRATION_FAILED"
      );
    }

    fixtureConnection = await mysql.createConnection(databaseUrl);
    await setupNativeFixtureTables(fixtureConnection);
    await assertLegacyTablesAreEmptyOrOurs(fixtureConnection);
    // This check is deliberately before any cleanup: 30061 is a fixed contract marker,
    // not an ownership key for a previous suite or an invitation to overwrite fixture data.
    await assertMerchant30061Absent(fixtureConnection);
    shouldCleanup = true;
    await cleanupTaggedFixtures(fixtureConnection);
    recordPassed(
      "LDB-01",
      "严格隔离目标、原生最小 schema 与前缀清理已验证",
      "仅接受 127.0.0.1:33316/official_channel_fixture 且 PLATFORM_DB_NAME 一致；无 DROP/ALTER；merchant 30061 预先不存在。"
    );

    // Dynamic imports occur only after the caller-provided fixture target passed all guards.
    const dbModule = await import("../server/db");
    const legacyModule = await import(
      "../server/services/officialChannelLegacy"
    );
    drizzleDb = await dbModule.getDb();
    if (!drizzleDb)
      throw new IntegrationAssertionError(
        "INTEGRATION_REAL_GET_DB_UNAVAILABLE"
      );

    const runId = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
    let nextRequest = 1;
    const req = () => requestId(runId, nextRequest++);
    const legacyOwnerFrontUserId = 880_000_001;
    const ownerAFrontUserId = 880_000_101;
    const ownerBFrontUserId = 880_000_102;
    const missingBindingFrontUserId = 880_000_199;

    const superActor = await createVirtualAdmin(
      fixtureConnection,
      runId,
      "super",
      "super_admin"
    );
    const regularActor = await createVirtualAdmin(
      fixtureConnection,
      runId,
      "regular",
      "operation"
    );
    const ownerA = await createVirtualAdmin(
      fixtureConnection,
      runId,
      "owner_a",
      "operation"
    );
    const ownerB = await createVirtualAdmin(
      fixtureConnection,
      runId,
      "owner_b",
      "operation"
    );
    await createActiveBinding(
      fixtureConnection,
      ownerA.adminUserId,
      ownerAFrontUserId,
      superActor.adminUserId
    );
    await createActiveBinding(
      fixtureConnection,
      ownerB.adminUserId,
      ownerBFrontUserId,
      superActor.adminUserId
    );
    await seedFixtureMerchant(fixtureConnection, runId, legacyOwnerFrontUserId);

    await check(
      "LDB-02",
      "普通原生后台 actor 在读取旧表前被拒绝",
      "真实 active operation 账号调用 overviewLegacy 返回 FORBIDDEN；其后 legacy 夹具行散列保持不变。",
      async () => {
        await seedLegacyScenario(fixtureConnection!, {
          runId,
          legacyOwnerFrontUserId,
          sources: [
            {
              label: "REGULAR",
              enterpriseId: 771_001,
              responsibleFrontUserId: ownerAFrontUserId,
            },
          ],
        });
        const before = await snapshotLegacyRows(fixtureConnection!);
        await expectRejected(
          () => legacyModule.overviewLegacy(regularActor),
          ["FORBIDDEN"]
        );
        assert.equal(await snapshotLegacyRows(fixtureConnection!), before);
        await clearLegacyRows(fixtureConnection!);
      },
      "server/services/officialChannelLegacy.ts:800-810；server/services/officialChannelAccess.ts:100-157"
    );

    await check(
      "LDB-03",
      "缺 active 负责人绑定时真实导入整体回滚、零官方写入",
      "历史来源/库存使用无绑定的虚构前台负责人；importLegacy 拒绝且官方来源、库存、publication、审计均为零，旧表散列未变。",
      async () => {
        await seedLegacyScenario(fixtureConnection!, {
          runId,
          legacyOwnerFrontUserId,
          sources: [
            {
              label: "NO_BINDING",
              enterpriseId: 771_010,
              responsibleFrontUserId: missingBindingFrontUserId,
            },
          ],
        });
        const before = await snapshotLegacyRows(fixtureConnection!);
        await expectRejected(
          () => legacyModule.importLegacy(superActor, { requestId: req() }),
          ["OFFICIAL_LEGACY_RESPONSIBLE_BINDING_UNVERIFIED"]
        );
        assert.equal(await snapshotLegacyRows(fixtureConnection!), before);
        assert.deepEqual(await taggedOfficialCounts(fixtureConnection!), {
          sources: 0,
          stocks: 0,
          publications: 0,
          audits: 0,
        });
        await clearLegacyRows(fixtureConnection!);
      },
      "server/services/officialChannelLegacy.ts:575-617,942-950"
    );

    await check(
      "LDB-04",
      "来源/库存 enterprise 不一致时真实导入整体回滚、零官方写入",
      "两行都有 active 绑定，但库存 enterprise 与来源不一致；importLegacy 在写入前拒绝，旧表散列不变且没有部分导入。",
      async () => {
        await seedLegacyScenario(fixtureConnection!, {
          runId,
          legacyOwnerFrontUserId,
          sources: [
            {
              label: "ENTERPRISE_MISMATCH",
              enterpriseId: 771_020,
              responsibleFrontUserId: ownerAFrontUserId,
            },
          ],
          materialEnterpriseId: source => source.enterpriseId + 1,
        });
        const before = await snapshotLegacyRows(fixtureConnection!);
        await expectRejected(
          () => legacyModule.importLegacy(superActor, { requestId: req() }),
          ["OFFICIAL_LEGACY_MATERIAL_OWNER_OR_ENTERPRISE_MISMATCH"]
        );
        assert.equal(await snapshotLegacyRows(fixtureConnection!), before);
        assert.deepEqual(await taggedOfficialCounts(fixtureConnection!), {
          sources: 0,
          stocks: 0,
          publications: 0,
          audits: 0,
        });
        await clearLegacyRows(fixtureConnection!);
      },
      "server/services/officialChannelLegacy.ts:524-572,942-950"
    );

    let validFixture: LegacyFixture | null = null;
    let importedSourceIdByLabel = new Map<string, number>();
    let importedStockIdByLabel = new Map<string, number>();
    let legacyBeforeImportHash = "";
    let merchantBeforeImportHash = "";

    await check(
      "LDB-05",
      "overviewLegacy → importLegacy 使用真实 Drizzle 写入，字段保留且重放不重复",
      "两条虚构 legacy 来源/库存先由真实 overview 计数，再导入为 teamId=null、来源未批准/未发布、库存 draft/未发布；价格、联系人、私有备注和导入人正确保留，无 publication；同 requestId 重放不重复。",
      async () => {
        validFixture = await seedLegacyScenario(fixtureConnection!, {
          runId,
          legacyOwnerFrontUserId,
          sources: [
            {
              label: "ALPHA",
              enterpriseId: 771_101,
              responsibleFrontUserId: ownerAFrontUserId,
            },
            {
              label: "BETA",
              enterpriseId: 771_102,
              responsibleFrontUserId: ownerBFrontUserId,
              type: "agent",
            },
          ],
        });
        legacyBeforeImportHash = await snapshotLegacyRows(fixtureConnection!);
        merchantBeforeImportHash = await snapshotMerchant(fixtureConnection!);
        const overview = await legacyModule.overviewLegacy(superActor);
        assert.equal(overview.isSuperAdmin, true);
        assert.equal(overview.legacyMerchantId, 30061);
        assert.equal(overview.legacyDatabase, fixtureDatabase);
        assert.equal(overview.legacyTablesPresent, true);
        assert.equal(overview.officialOwnerVerified, true);
        assert.equal(overview.legacySourceCount, 2);
        assert.equal(overview.legacyStockCount, 2);
        assert.equal(overview.canImport, true);
        assert.equal(overview.state, "ready");

        const importRequest = req();
        const first = await legacyModule.importLegacy(superActor, {
          requestId: importRequest,
        });
        assert.equal(first.importedSources.length, 2);
        assert.equal(first.importedStocks.length, 2);
        assert.equal(first.initialTeamId, null);
        assert.equal(first.sourcePublicationApproved, false);
        assert.equal(first.stockStatus, "draft");
        assert.equal(first.historicalCreator, "unknown");
        assert.equal(first.idempotent, false);

        for (const legacySource of validFixture!.sources) {
          const item = first.importedSources.find(
            (candidate: { legacySourceId: string }) =>
              candidate.legacySourceId === String(legacySource.id)
          );
          assert.ok(item);
          importedSourceIdByLabel.set(
            legacySource.label,
            Number(item.sourceId)
          );
        }
        for (const legacyMaterial of validFixture!.materials) {
          const item = first.importedStocks.find(
            (candidate: { legacyMaterialId: string }) =>
              candidate.legacyMaterialId === String(legacyMaterial.id)
          );
          assert.ok(item);
          importedStockIdByLabel.set(
            legacyMaterial.label,
            Number(item.stockId)
          );
          const expectedOwner =
            legacyMaterial.label === "ALPHA"
              ? ownerA.adminUserId
              : ownerB.adminUserId;
          assert.equal(Number(item.ownerAdminUserId), expectedOwner);
        }

        const importedRows = await rows<{
          sourceId: number;
          sourceName: string;
          sourceType: string;
          sourceTeamId: number | null;
          publicationApproved: number;
          everPublished: number;
          sourceCreator: number;
          legacySourceId: string;
          contactName: string;
          phone: string;
          sourceNotes: string;
          stockId: number;
          stockTeamId: number | null;
          stockOwner: number;
          stockCreator: number;
          partNumber: string;
          price: string;
          stockNote: string;
          status: string;
          publishedAt: Date | null;
          legacyMaterialId: string;
        }>(
          fixtureConnection!,
          `
          SELECT source.id AS sourceId, source.name AS sourceName, source.type AS sourceType,
                 source.teamId AS sourceTeamId, source.publicationApproved, source.everPublished,
                 source.createdByAdminUserId AS sourceCreator, source.legacySourceId,
                 source.contactName, source.phone, source.notes AS sourceNotes,
                 stock.id AS stockId, stock.teamId AS stockTeamId, stock.ownerAdminUserId AS stockOwner,
                 stock.createdByAdminUserId AS stockCreator, stock.partNumber, stock.price,
                 stock.note AS stockNote, stock.status, stock.publishedAt, stock.legacyMaterialId
            FROM official_channel_sources AS source
            INNER JOIN official_channel_stocks AS stock ON stock.sourceId = source.id
           WHERE source.name LIKE ?
           ORDER BY source.id ASC
        `,
          [`${markerPrefix}%`]
        );
        assert.equal(importedRows.length, 2);
        for (const row of importedRows) {
          assert.equal(row.sourceTeamId, null);
          assert.equal(Number(row.publicationApproved), 0);
          assert.equal(Number(row.everPublished), 0);
          assert.equal(Number(row.sourceCreator), superActor.adminUserId);
          assert.equal(row.stockTeamId, null);
          assert.equal(Number(row.stockCreator), superActor.adminUserId);
          assert.equal(row.status, "draft");
          assert.equal(row.publishedAt, null);
          assert.match(row.contactName, /^OCLEG-/);
          assert.match(row.phone, /^139/);
          assert.match(row.sourceNotes, /^OCLEG-/);
          assert.match(row.partNumber, /^OCLEG-/);
          assert.match(row.stockNote, /^OCLEG-/);
          assert.match(row.legacySourceId, /^\d+$/);
          assert.match(row.legacyMaterialId, /^\d+$/);
          assert.equal(
            row.price === "+12.3400" || row.price === "18.5000",
            true
          );
        }
        assert.deepEqual(await taggedOfficialCounts(fixtureConnection!), {
          sources: 2,
          stocks: 2,
          publications: 0,
          audits: 1,
        });

        const [audit] = await rows<{
          action: string;
          actorAdminUserId: number;
          afterData: unknown;
        }>(
          fixtureConnection!,
          `
          SELECT action, actorAdminUserId, afterData FROM official_channel_audits WHERE requestId = ?
        `,
          [importRequest]
        );
        assert.equal(audit.action, "official.legacy.import");
        assert.equal(Number(audit.actorAdminUserId), superActor.adminUserId);
        const afterData =
          typeof audit.afterData === "string"
            ? JSON.parse(audit.afterData)
            : (audit.afterData as Record<string, unknown>);
        const provenance = (
          afterData as {
            provenance?: {
              originalCreator?: string;
              sources?: unknown[];
              materials?: unknown[];
            };
          }
        ).provenance;
        assert.match(String(provenance?.originalCreator), /unknown/);
        assert.equal(provenance?.sources?.length, 2);
        assert.equal(provenance?.materials?.length, 2);

        const replay = await legacyModule.importLegacy(superActor, {
          requestId: importRequest,
        });
        assert.equal(replay.idempotent, true);
        assert.equal(replay.importedSources.length, 2);
        assert.equal(replay.importedStocks.length, 2);
        assert.deepEqual(await taggedOfficialCounts(fixtureConnection!), {
          sources: 2,
          stocks: 2,
          publications: 0,
          audits: 1,
        });
        assert.equal(
          await snapshotLegacyRows(fixtureConnection!),
          legacyBeforeImportHash
        );
        assert.equal(
          await snapshotMerchant(fixtureConnection!),
          merchantBeforeImportHash
        );
      },
      "server/services/officialChannelLegacy.ts:800-1092（真实导入、审计及重放）"
    );

    await check(
      "LDB-06",
      "首次分类以真实 active 团队/成员 CAS 更新快照并写入审计",
      "直接 DDL 创建虚构官方团队及 owner 成员（不使用 setMember 的 session 变更）；expectedRevision=1 时仅 Alpha 来源和库存 teamId/revision 变化，所有业务字段、创建人、负责人、merchant、旧表、团队、成员与原生 grants 均不变。",
      async () => {
        assert.ok(validFixture);
        const [alphaTeamResult] = await fixtureConnection!.execute(
          "INSERT INTO official_channel_teams (name, status, revision, createdByAdminUserId) VALUES (?, 'active', 1, ?)",
          [`${markerPrefix}${runId}-TEAM-ALPHA`, superActor.adminUserId]
        );
        const alphaTeamId = insertId(
          alphaTeamResult,
          "INTEGRATION_TEAM_ALPHA_CREATE_FAILED"
        );
        const [betaTeamResult] = await fixtureConnection!.execute(
          "INSERT INTO official_channel_teams (name, status, revision, createdByAdminUserId) VALUES (?, 'active', 1, ?)",
          [`${markerPrefix}${runId}-TEAM-BETA`, superActor.adminUserId]
        );
        const betaTeamId = insertId(
          betaTeamResult,
          "INTEGRATION_TEAM_BETA_CREATE_FAILED"
        );
        for (const owner of [ownerA, ownerB]) {
          await fixtureConnection!.execute(
            `INSERT INTO official_channel_team_members
              (adminUserId, teamId, role, revision, updatedByAdminUserId)
             VALUES (?, ?, 'member', 1, ?)`,
            [owner.adminUserId, alphaTeamId, superActor.adminUserId]
          );
        }

        const alphaSourceId = importedSourceIdByLabel.get("ALPHA");
        const alphaStockId = importedStockIdByLabel.get("ALPHA");
        assert.ok(alphaSourceId && alphaStockId);
        const immutableBefore = await snapshotImportedImmutableRows(
          fixtureConnection!,
          [alphaSourceId!]
        );
        const teamAndGrantsBefore = await snapshotTeamAndGrants(
          fixtureConnection!,
          [alphaTeamId, betaTeamId],
          [ownerA.adminUserId, ownerB.adminUserId]
        );
        const classified = await legacyModule.classifyLegacySource(superActor, {
          sourceId: alphaSourceId!,
          teamId: alphaTeamId,
          expectedRevision: 1,
          requestId: req(),
          reason: "虚构 legacy 资料核验后的首次官方团队归类",
        });
        assert.equal(classified.sourceId, alphaSourceId);
        assert.equal(classified.teamId, alphaTeamId);
        assert.equal(classified.sourceRevision, 2);
        assert.deepEqual(classified.stocks, [
          { stockId: alphaStockId, revision: 2 },
        ]);
        assert.equal(classified.idempotent, false);

        const [classifiedSource] = await rows<{
          teamId: number;
          revision: number;
        }>(
          fixtureConnection!,
          "SELECT teamId, revision FROM official_channel_sources WHERE id = ?",
          [alphaSourceId]
        );
        const [classifiedStock] = await rows<{
          teamId: number;
          revision: number;
        }>(
          fixtureConnection!,
          "SELECT teamId, revision FROM official_channel_stocks WHERE id = ?",
          [alphaStockId]
        );
        assert.deepEqual(classifiedSource, {
          teamId: alphaTeamId,
          revision: 2,
        });
        assert.deepEqual(classifiedStock, { teamId: alphaTeamId, revision: 2 });
        assert.equal(
          await snapshotImportedImmutableRows(fixtureConnection!, [
            alphaSourceId!,
          ]),
          immutableBefore
        );
        assert.equal(
          await snapshotTeamAndGrants(
            fixtureConnection!,
            [alphaTeamId, betaTeamId],
            [ownerA.adminUserId, ownerB.adminUserId]
          ),
          teamAndGrantsBefore
        );
        assert.equal(
          await snapshotLegacyRows(fixtureConnection!),
          legacyBeforeImportHash
        );
        assert.equal(
          await snapshotMerchant(fixtureConnection!),
          merchantBeforeImportHash
        );
        const [publication] = await rows<{ total: number | string }>(
          fixtureConnection!,
          "SELECT COUNT(*) AS total FROM official_channel_publications WHERE stockId = ?",
          [alphaStockId]
        );
        assert.equal(Number(publication.total), 0);
        const [classificationAudit] = await rows<{ total: number | string }>(
          fixtureConnection!,
          "SELECT COUNT(*) AS total FROM official_channel_audits WHERE action = 'official.legacy.classify' AND targetId = ?",
          [`source:${alphaSourceId}`]
        );
        assert.equal(Number(classificationAudit.total), 1);
        // Expose beta ID only via a harmless local property used in the next actual check.
        (
          validFixture as LegacyFixture & {
            alphaTeamId?: number;
            betaTeamId?: number;
          }
        ).alphaTeamId = alphaTeamId;
        (
          validFixture as LegacyFixture & {
            alphaTeamId?: number;
            betaTeamId?: number;
          }
        ).betaTeamId = betaTeamId;
      },
      "server/services/officialChannelLegacy.ts:1166-1349（source/stock 逐行 CAS 与原生 audit）"
    );

    await check(
      "LDB-07",
      "二次分类、陈旧 revision 与跨队 owner 均失败关闭且无自动授权/调组",
      "已归类 Alpha 再次分类被拒绝；未归类 Beta 用错误 expectedRevision 被拒绝；再指向一个 active 但 owner 不属于的 Beta 团队同样拒绝。来源/库存、团队成员和原生权限散列均不变。",
      async () => {
        const teamInfo = validFixture as LegacyFixture & {
          alphaTeamId?: number;
          betaTeamId?: number;
        };
        const alphaSourceId = importedSourceIdByLabel.get("ALPHA");
        const betaSourceId = importedSourceIdByLabel.get("BETA");
        assert.ok(
          alphaSourceId &&
            betaSourceId &&
            teamInfo.alphaTeamId &&
            teamInfo.betaTeamId
        );
        const beforeRows = await snapshotImportedImmutableRows(
          fixtureConnection!,
          [alphaSourceId!, betaSourceId!]
        );
        const beforeTeamAndGrants = await snapshotTeamAndGrants(
          fixtureConnection!,
          [teamInfo.alphaTeamId!, teamInfo.betaTeamId!],
          [ownerA.adminUserId, ownerB.adminUserId]
        );
        await expectRejected(
          () =>
            legacyModule.classifyLegacySource(superActor, {
              sourceId: alphaSourceId!,
              teamId: teamInfo.alphaTeamId!,
              expectedRevision: 2,
              requestId: req(),
              reason: "虚构二次归类应被拒绝",
            }),
          ["OFFICIAL_LEGACY_SOURCE_NOT_UNCLASSIFIED_LEGACY"]
        );
        await expectRejected(
          () =>
            legacyModule.classifyLegacySource(superActor, {
              sourceId: betaSourceId!,
              teamId: teamInfo.alphaTeamId!,
              expectedRevision: 9,
              requestId: req(),
              reason: "虚构陈旧 revision 应被拒绝",
            }),
          ["OFFICIAL_LEGACY_SOURCE_REVISION_CONFLICT"]
        );
        await expectRejected(
          () =>
            legacyModule.classifyLegacySource(superActor, {
              sourceId: betaSourceId!,
              teamId: teamInfo.betaTeamId!,
              expectedRevision: 1,
              requestId: req(),
              reason: "虚构跨队且 owner 未在目标团队应被拒绝",
            }),
          ["OFFICIAL_LEGACY_OWNER_NOT_ACTIVE_IN_TARGET_TEAM"]
        );
        assert.equal(
          await snapshotImportedImmutableRows(fixtureConnection!, [
            alphaSourceId!,
            betaSourceId!,
          ]),
          beforeRows
        );
        assert.equal(
          await snapshotTeamAndGrants(
            fixtureConnection!,
            [teamInfo.alphaTeamId!, teamInfo.betaTeamId!],
            [ownerA.adminUserId, ownerB.adminUserId]
          ),
          beforeTeamAndGrants
        );
        assert.equal(
          await snapshotLegacyRows(fixtureConnection!),
          legacyBeforeImportHash
        );
        assert.equal(
          await snapshotMerchant(fixtureConnection!),
          merchantBeforeImportHash
        );
      },
      "server/services/officialChannelLegacy.ts:1203-1249；禁止自动 permission grants 或团队成员调整"
    );

    results.status = "passed";
  } catch (error) {
    results.fatalCode = safeErrorCode(error);
    results.status =
      error instanceof IntegrationBlockedError ||
      (results.safety.loopbackAndFixtureGuard === "failed" &&
        results.fatalCode.startsWith("INTEGRATION_FIXTURE_")) ||
      results.fatalCode === "INTEGRATION_PLATFORM_DATABASE_TARGET_REFUSED"
        ? "blocked"
        : "failed";
  } finally {
    if (fixtureConnection && shouldCleanup) {
      try {
        await cleanupTaggedFixtures(fixtureConnection);
      } catch {
        results.notes.push(
          "夹具清理未完成；仅可能残留 OCLEG-/ocleg_ 前缀虚构记录，未删除别的 fixture 或结构。"
        );
        if (results.status === "passed") results.status = "failed";
        if (!results.fatalCode)
          results.fatalCode = "INTEGRATION_FIXTURE_CLEANUP_FAILED";
      }
    }
    if (fixtureConnection) await fixtureConnection.end().catch(() => undefined);
    if (drizzleDb?.$client?.end) {
      try {
        await Promise.resolve(drizzleDb.$client.end());
      } catch {
        // Pool close must not prevent the credential-free report from being emitted.
      }
    }
    await writeResults();
  }
  if (results.status !== "passed") process.exitCode = 1;
}

await main();
