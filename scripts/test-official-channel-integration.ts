#!/usr/bin/env tsx
/**
 * 官方渠道真实 MySQL 集成测试。
 *
 * 运行方式（连接串只能由调用方安全注入，脚本不会读 .env 或任何运行时配置）：
 *   DATABASE_URL="$OFFICIAL_CHANNEL_FIXTURE_DATABASE_URL" \
 *     ./node_modules/.bin/tsx scripts/test-official-channel-integration.ts
 *
 * 此脚本故意只接受 127.0.0.1:33316/official_channel_fixture，并且仅清理以
 * OCIT-/ocit_ 前缀创建的虚构夹具。它会导入真实 getDb()、officialTeams、
 * officialChannelInventory 与 officialChannelAccess；没有 mock 或静态源码断言。
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const resultsDir = resolve(scriptDir, "../../backend-team-v1");
const resultsJsonPath = resolve(resultsDir, "db-integration-results.json");
const resultsMarkdownPath = resolve(resultsDir, "db-integration-results.md");
const fixtureDatabase = "official_channel_fixture";
const fixturePort = "33316";
const fixturePrefix = "ocit_";
const markerPrefix = "OCIT-";

type TestRecord = {
  id: string;
  title: string;
  status: "passed" | "failed" | "blocked";
  detail: string;
  failureHint?: string;
};

type IntegrationResults = {
  suite: string;
  database: { host: string; port: string; name: string; credentialPrinted: false } | null;
  safety: {
    databaseUrlReadOnlyFromEnvironment: true;
    loopbackAndFixtureGuard: "passed" | "failed";
    cleanupScope: string;
    migration: "passed" | "failed" | "not-run";
  };
  startedAt: string;
  finishedAt: string | null;
  status: "passed" | "failed" | "blocked";
  tests: TestRecord[];
  fatalCode: string | null;
  notes: string[];
};

const results: IntegrationResults = {
  suite: "official-channel real MySQL + Drizzle/getDb integration",
  database: null,
  safety: {
    databaseUrlReadOnlyFromEnvironment: true,
    loopbackAndFixtureGuard: "failed",
    cleanupScope: "仅删除本脚本 OCIT-/ocit_ 前缀创建的官方表及虚构 admin 用户记录",
    migration: "not-run",
  },
  startedAt: new Date().toISOString(),
  finishedAt: null,
  status: "blocked",
  tests: [],
  fatalCode: null,
  notes: [
    "未读取 .env、PM2/ECS 或任何生产运行时配置；仅使用调用方显式传入的 DATABASE_URL。",
    "所有联系人、账号、团队和库存夹具均为本脚本创建的虚构数据；结果不保存凭据或连接串。",
  ],
};

class IntegrationAssertionError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "IntegrationAssertionError";
  }
}

function safeErrorCode(error: unknown): string {
  if (error && typeof error === "object") {
    const candidate = error as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof candidate.code === "string" && /^[A-Z0-9_]+$/.test(candidate.code)) return candidate.code;
    if (typeof candidate.message === "string") {
      const known = candidate.message.match(/(?:OFFICIAL_[A-Z0-9_]+|INTEGRATION_[A-Z0-9_]+)/);
      if (known) return known[0];
    }
    if (candidate.cause) return safeErrorCode(candidate.cause);
  }
  return "UNEXPECTED_ERROR";
}

function safeErrorSummary(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current && typeof current === "object"; depth += 1) {
    const candidate = current as { name?: unknown; message?: unknown; code?: unknown; cause?: unknown };
    const name = typeof candidate.name === "string" ? candidate.name : "Error";
    const code = typeof candidate.code === "string" ? ` [${candidate.code}]` : "";
    const message = typeof candidate.message === "string" ? candidate.message : safeErrorCode(current);
    messages.push(`${name}${code}: ${message}`);
    current = candidate.cause;
  }
  // A driver error should never add an accidental connection string to an artifact.
  return messages.join(" | ")
    .replace(/mysql:\/\/[^\s@/]+@/gi, "mysql://[REDACTED]@")
    .replace(/(?:password|pwd)=([^\s&]+)/gi, "$1=[REDACTED]")
    .slice(0, 360);
}

function requireFixtureUrl(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new IntegrationAssertionError("INTEGRATION_FIXTURE_DATABASE_URL_REQUIRED");
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new IntegrationAssertionError("INTEGRATION_FIXTURE_DATABASE_URL_INVALID");
  }
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (
    url.protocol !== "mysql:"
    || !new Set(["127.0.0.1", "localhost"]).has(url.hostname)
    || url.port !== fixturePort
    || databaseName !== fixtureDatabase
  ) {
    throw new IntegrationAssertionError("INTEGRATION_FIXTURE_TARGET_REFUSED");
  }
  results.database = {
    host: url.hostname,
    port: url.port,
    name: databaseName,
    credentialPrinted: false,
  };
  results.safety.loopbackAndFixtureGuard = "passed";
  return databaseUrl;
}

function requestId(runId: string, ordinal: number, action: string) {
  // The action is intentionally not embedded: each ordinal remains unique, while normal
  // fixture requests stay short enough to exercise all independent paths after DB-08
  // isolates the service's separate 64-character requestId contract defect.
  void action;
  const value = `${fixturePrefix}${runId}_${ordinal}`;
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(value)) throw new IntegrationAssertionError("INTEGRATION_REQUEST_ID_INVALID");
  return value;
}

function parseJson(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  }
  throw new IntegrationAssertionError("INTEGRATION_JSON_ROW_INVALID");
}

async function rows<T extends RowDataPacket = RowDataPacket>(connection: Connection, statement: string, values: unknown[] = []) {
  const [returned] = await connection.execute(statement, values);
  return returned as T[];
}

async function setupNativeFixtureTables(connection: Connection) {
  // These use the exact native table/column names from drizzle/schema.ts. They create
  // only dependencies read or written by the official services, and add no foreign keys.
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
    CREATE TABLE IF NOT EXISTS admin_user_permission_audits (
      id INT NOT NULL AUTO_INCREMENT,
      adminUserId INT NOT NULL,
      operatorAdminUserId INT NULL,
      operatorName VARCHAR(128) NULL,
      beforePermissions JSON NULL,
      afterPermissions JSON NULL,
      ipAddress VARCHAR(64) NULL,
      userAgent VARCHAR(255) NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY admin_user_permission_audits_admin_user_idx (adminUserId),
      KEY admin_user_permission_audits_created_at_idx (createdAt)
    ) ENGINE=InnoDB
  `);
}

async function assertColumns(connection: Connection, table: string, required: string[]) {
  const found = await rows<{ COLUMN_NAME: string }>(connection, `
    SELECT COLUMN_NAME
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
  `, [table]);
  const names = new Set(found.map(row => row.COLUMN_NAME));
  for (const name of required) {
    if (!names.has(name)) throw new IntegrationAssertionError("INTEGRATION_REQUIRED_COLUMN_MISSING");
  }
}

async function cleanupTaggedFixtures(connection: Connection) {
  // The caller has already passed the strict exact fixture target guard. Never clean an
  // unmarked record: this retains other isolated test suites' fixtures even in this DB.
  await connection.execute(`
    DELETE publication
      FROM official_channel_publications AS publication
      INNER JOIN official_channel_stocks AS stock ON stock.id = publication.stockId
     WHERE stock.partNumber LIKE ?
  `, [`${markerPrefix}%`]);
  await connection.execute(`
    DELETE note_row
      FROM official_channel_stock_notes AS note_row
      INNER JOIN official_channel_stocks AS stock ON stock.id = note_row.stockId
     WHERE stock.partNumber LIKE ?
  `, [`${markerPrefix}%`]);
  await connection.execute("DELETE FROM official_channel_stocks WHERE partNumber LIKE ?", [`${markerPrefix}%`]);
  await connection.execute("DELETE FROM official_channel_sources WHERE name LIKE ?", [`${markerPrefix}%`]);
  await connection.execute("DELETE FROM official_channel_audits WHERE requestId LIKE ?", [`${fixturePrefix}%`]);

  const fixtureUsers = await rows<{ id: number }>(connection,
    "SELECT id FROM admin_users WHERE usernameCanonical LIKE ?",
    [`${fixturePrefix}%`],
  );
  for (const { id } of fixtureUsers) {
    await connection.execute("DELETE FROM official_channel_team_members WHERE adminUserId = ?", [id]);
    await connection.execute("DELETE FROM admin_user_permission_audits WHERE adminUserId = ? OR operatorAdminUserId = ?", [id, id]);
    await connection.execute("DELETE FROM admin_user_permissions WHERE adminUserId = ?", [id]);
  }
  if (fixtureUsers.length > 0) {
    await connection.execute("DELETE FROM admin_users WHERE usernameCanonical LIKE ?", [`${fixturePrefix}%`]);
  }
  await connection.execute("DELETE FROM official_channel_teams WHERE name LIKE ?", [`${markerPrefix}%`]);
}

async function createVirtualAdmin(connection: Connection, runId: string, suffix: string, role: "super_admin" | "operation") {
  const username = `${fixturePrefix}${runId}_${suffix}`.slice(0, 64);
  const [result] = await connection.execute(
    `INSERT INTO admin_users (userId, username, usernameCanonical, displayName, adminRole, status, sessionVersion, passwordHash)
     VALUES (?, ?, ?, ?, ?, 'active', 1, NULL)`,
    [900_000_000 + Math.floor(Math.random() * 10_000_000), username, username, `虚构官方测试-${suffix}`, role],
  );
  const id = Number((result as { insertId?: number }).insertId ?? 0);
  if (!Number.isSafeInteger(id) || id <= 0) throw new IntegrationAssertionError("INTEGRATION_ADMIN_CREATE_FAILED");
  return { adminUserId: id, sessionVersion: 1 };
}

async function expectRejected(
  operation: () => Promise<unknown>,
  acceptedCodes: readonly string[],
) {
  try {
    await operation();
  } catch (error) {
    const code = safeErrorCode(error);
    if (acceptedCodes.includes(code)) return;
    throw new IntegrationAssertionError("INTEGRATION_UNEXPECTED_REJECTION_CODE");
  }
  throw new IntegrationAssertionError("INTEGRATION_EXPECTED_REJECTION_MISSING");
}

function recordPassed(id: string, title: string, detail: string) {
  results.tests.push({ id, title, status: "passed", detail });
}

async function check(id: string, title: string, detail: string, callback: () => Promise<void>, failureHint?: string) {
  try {
    await callback();
    recordPassed(id, title, detail);
  } catch (error) {
    results.tests.push({
      id,
      title,
      status: "failed",
      detail: `失败代码：${safeErrorCode(error)}；${safeErrorSummary(error)}`,
      ...(failureHint ? { failureHint } : {}),
    });
    throw error;
  }
}

function markdownReport() {
  const lines = [
    "# 官方渠道真实 MySQL 集成测试结果",
    "",
    `- 状态：**${results.status.toUpperCase()}**`,
    `- 开始：${results.startedAt}`,
    `- 结束：${results.finishedAt ?? "未完成"}`,
    `- 目标：${results.database ? `${results.database.host}:${results.database.port}/${results.database.name}` : "未通过安全前置检查"}`,
    "- 凭据：未写入结果，未输出连接串或口令。",
    `- 安全防护：loopback/fixture guard=${results.safety.loopbackAndFixtureGuard}；清理范围=${results.safety.cleanupScope}。`,
    `- 官方 schema 迁移器：${results.safety.migration}。`,
    "",
    "| 用例 | 状态 | 验证 |",
    "|---|---|---|",
    ...results.tests.map(test => `| ${test.id} ${test.title} | ${test.status} | ${test.detail} |`),
  ];
  const failed = results.tests.filter(test => test.status === "failed");
  if (failed.length > 0) {
    lines.push("", "## 需父代理处理的真实问题");
    for (const test of failed) {
      lines.push(`- **${test.id}**：${test.detail}${test.failureHint ? `；优先检查 \`${test.failureHint}\`` : ""}`);
    }
  }
  if (results.fatalCode) lines.push("", `致命中止代码：\`${results.fatalCode}\`。`);
  lines.push("", "## 执行边界", ...results.notes.map(note => `- ${note}`), "");
  return lines.join("\n");
}

async function writeResults() {
  results.finishedAt = new Date().toISOString();
  await writeFile(resultsJsonPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");
  await writeFile(resultsMarkdownPath, markdownReport(), "utf8");
}

async function main() {
  let fixtureConnection: Connection | null = null;
  let drizzleDb: any = null;
  let shouldCleanup = false;
  try {
    const databaseUrl = requireFixtureUrl();

    // Reuse the controlled official DDL migration. Its own loopback/fixture guard is
    // independently exercised and its output intentionally contains no credential.
    try {
      execFileSync(process.execPath, [resolve(scriptDir, "apply-official-channel-schema.mjs")], {
        cwd: resolve(scriptDir, ".."),
        env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: "test" },
        stdio: "pipe",
      });
      results.safety.migration = "passed";
    } catch {
      results.safety.migration = "failed";
      throw new IntegrationAssertionError("INTEGRATION_OFFICIAL_SCHEMA_MIGRATION_FAILED");
    }

    fixtureConnection = await mysql.createConnection(databaseUrl);
    await setupNativeFixtureTables(fixtureConnection);
    await assertColumns(fixtureConnection, "official_channel_sources", ["contactName", "phone", "wechat", "qq", "notes"]);
    await assertColumns(fixtureConnection, "admin_users", ["id", "userId", "username", "usernameCanonical", "adminRole", "status", "sessionVersion"]);
    await assertColumns(fixtureConnection, "admin_user_permissions", ["id", "adminUserId", "permission"]);
    shouldCleanup = true;
    await cleanupTaggedFixtures(fixtureConnection);

    // Dynamic imports occur after the caller-provided URL has passed the exact target guard.
    const dbModule = await import("../server/db");
    const accessModule = await import("../server/services/officialChannelAccess");
    const teamsModule = await import("../server/services/officialTeams");
    const inventoryModule = await import("../server/services/officialChannelInventory");
    drizzleDb = await dbModule.getDb();
    if (!drizzleDb) throw new IntegrationAssertionError("INTEGRATION_REAL_GET_DB_UNAVAILABLE");

    const runId = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
    const teamAlphaName = `${markerPrefix}${runId}-Alpha`;
    const teamBetaName = `${markerPrefix}${runId}-Beta`;
    const fakeContactName = `OCIT-CONTACT-${runId}`;
    const fakePhone = "13900001234";
    const fakeWechat = `ocit_private_wechat_${runId}`;
    const fakeQq = "80001234";
    const fakePrivateNote = `OCIT-PRIVATE-NOTE-${runId}`;
    let nextRequest = 1;
    const req = (action: string) => requestId(runId, nextRequest++, action);

    const superActor = await createVirtualAdmin(fixtureConnection, runId, "super", "super_admin");
    const leaderInitial = await createVirtualAdmin(fixtureConnection, runId, "leader", "operation");
    const ownerInitial = await createVirtualAdmin(fixtureConnection, runId, "owner", "operation");
    const noteInitial = await createVirtualAdmin(fixtureConnection, runId, "note", "operation");
    const betaInitial = await createVirtualAdmin(fixtureConnection, runId, "beta", "operation");

    let alphaTeamId = 0;
    let betaTeamId = 0;
    let leaderActor = { ...leaderInitial };
    let ownerActor = { ...ownerInitial };
    let noteActor = { ...noteInitial };
    let betaActor = { ...betaInitial };
    let sourceId = 0;
    let stockId = 0;

    await check(
      "DB-01",
      "超管用真实 officialTeams 服务配置两队、一个 leader 与单一成员归属",
      "真实 super_admin 创建两队，四名普通虚构账号各只有一条团队成员记录，且仅 Alpha 有一名 leader。",
      async () => {
        const alphaRequest = req("team_alpha");
        const alpha = await teamsModule.createOfficialTeam(superActor, { name: teamAlphaName, requestId: alphaRequest });
        const alphaReplay = await teamsModule.createOfficialTeam(superActor, { name: teamAlphaName, requestId: alphaRequest });
        assert.equal(alphaReplay.idempotent, true);
        assert.equal(alphaReplay.team.id, alpha.team.id);
        alphaTeamId = alpha.team.id;
        const beta = await teamsModule.createOfficialTeam(superActor, { name: teamBetaName, requestId: req("team_beta") });
        betaTeamId = beta.team.id;

        const leaderMember = await teamsModule.setOfficialTeamMember(superActor, {
          adminUserId: leaderInitial.adminUserId,
          teamId: alphaTeamId,
          role: "leader",
          expectedRevision: 0,
          requestId: req("member_leader"),
          officialPermissions: ["officialInventory.write", "officialInventory.publish"],
        });
        const ownerMember = await teamsModule.setOfficialTeamMember(superActor, {
          adminUserId: ownerInitial.adminUserId,
          teamId: alphaTeamId,
          role: "member",
          expectedRevision: 0,
          requestId: req("member_owner"),
          officialPermissions: ["officialInventory.write", "officialInventory.publish"],
        });
        const noteMember = await teamsModule.setOfficialTeamMember(superActor, {
          adminUserId: noteInitial.adminUserId,
          teamId: alphaTeamId,
          role: "member",
          expectedRevision: 0,
          requestId: req("member_note"),
          officialPermissions: ["officialInventory.write", "officialInventory.note"],
        });
        const betaMember = await teamsModule.setOfficialTeamMember(superActor, {
          adminUserId: betaInitial.adminUserId,
          teamId: betaTeamId,
          role: "member",
          expectedRevision: 0,
          requestId: req("member_beta"),
          officialPermissions: ["officialInventory.read"],
        });
        assert.equal(leaderMember.member?.role, "leader");
        assert.equal(ownerMember.member?.teamId, alphaTeamId);
        assert.equal(noteMember.officialPermissions.includes("officialInventory.note"), true);
        assert.equal(betaMember.officialPermissions.includes("officialInventory.read"), true);
        leaderActor.sessionVersion = 2;
        ownerActor.sessionVersion = 2;
        noteActor.sessionVersion = 2;
        betaActor.sessionVersion = 2;

        const overview = await teamsModule.getOfficialTeamsOverview(superActor);
        assert.equal(overview.teams.filter((team: { id: number }) => [alphaTeamId, betaTeamId].includes(team.id)).length, 2);
        const memberRows = await rows<{ adminUserId: number; teamId: number; role: string }>(fixtureConnection!, `
          SELECT adminUserId, teamId, role
            FROM official_channel_team_members
           WHERE adminUserId IN (?, ?, ?, ?)
        `, [leaderInitial.adminUserId, ownerInitial.adminUserId, noteInitial.adminUserId, betaInitial.adminUserId]);
        assert.equal(memberRows.length, 4);
        assert.equal(new Set(memberRows.map(row => row.adminUserId)).size, 4);
        assert.equal(memberRows.filter(row => row.role === "leader").length, 1);
        assert.equal(memberRows.find(row => row.adminUserId === betaInitial.adminUserId)?.teamId, betaTeamId);
      },
      "server/services/officialTeams.ts:659-889；server/services/officialChannelAccess.ts:88-157",
    );

    await check(
      "DB-02",
      "真实 access 重载原生权限；伪造 ctx 与初始旧 sessionVersion 均失败关闭",
      "通过 loadOfficialAccess(tx, actor, permission) 验证归属/权限；没有 adminAccount 的伪造上下文和成员配置前的旧会话均被拒绝。",
      async () => {
        const loaded = await drizzleDb.transaction((tx: any) => accessModule.loadOfficialAccess(tx, ownerActor, "officialInventory.publish"));
        assert.equal(loaded.teamId, alphaTeamId);
        assert.equal(loaded.permissions.includes("officialInventory.read"), true);
        assert.equal(loaded.permissions.includes("officialInventory.write"), true);
        assert.equal(loaded.permissions.includes("officialInventory.publish"), true);
        await expectRejected(
          async () => accessModule.officialActorFromContext({
            user: { id: ownerInitial.adminUserId, role: "admin" },
            adminAccount: null,
            frontUserId: ownerInitial.adminUserId,
          } as any),
          ["UNAUTHORIZED"],
        );
        await expectRejected(
          () => inventoryModule.listOfficialChannelSources(ownerInitial, {}),
          ["FORBIDDEN"],
        );
        await expectRejected(
          () => teamsModule.getOfficialTeamsOverview(leaderActor),
          ["FORBIDDEN"],
        );
      },
      "server/services/officialChannelAccess.ts:58-80,88-157；server/services/officialTeams.ts:348-417",
    );

    await check(
      "DB-03",
      "来源联系人写入和读取使用真实 phone/wechat/qq 列，requestId 仅同 payload 重放",
      "owner 通过真实库存服务创建/更新来源；服务 DTO 与 MySQL 原生列都保留 contactName、phone、wechat、qq；改 payload 重用 requestId 失败。",
      async () => {
        const sourceRequest = req("source_create");
        const input = {
          requestId: sourceRequest,
          name: `${markerPrefix}${runId} Factory "Quoted", Ltd`,
          type: "factory" as const,
          contactName: fakeContactName,
          phone: fakePhone,
          wechat: fakeWechat,
          qq: fakeQq,
          notes: fakePrivateNote,
        };
        const first = await inventoryModule.createOfficialChannelSource(ownerActor, input);
        const replay = await inventoryModule.createOfficialChannelSource(ownerActor, input);
        assert.equal(replay.idempotent, true);
        assert.equal(replay.source.id, first.source.id);
        sourceId = first.source.id;
        await expectRejected(
          () => inventoryModule.createOfficialChannelSource(ownerActor, { ...input, name: `${markerPrefix}${runId} changed` }),
          ["OFFICIAL_CHANNEL_REQUEST_ID_REUSED"],
        );
        const updated = await inventoryModule.updateOfficialChannelSource(ownerActor, {
          sourceId,
          expectedRevision: first.source.revision,
          requestId: req("source_contacts_update"),
          phone: `${fakePhone}9`,
          wechat: `${fakeWechat}_updated`,
          qq: `${fakeQq}9`,
        });
        assert.equal(updated.source.phone, `${fakePhone}9`);
        assert.equal(updated.source.wechat, `${fakeWechat}_updated`);
        assert.equal(updated.source.qq, `${fakeQq}9`);
        const raw = await rows<{ contactName: string; phone: string; wechat: string; qq: string; notes: string }>(fixtureConnection!, `
          SELECT contactName, phone, wechat, qq, notes
            FROM official_channel_sources
           WHERE id = ?
        `, [sourceId]);
        assert.equal(raw.length, 1);
        assert.deepEqual(raw[0], {
          contactName: fakeContactName,
          phone: `${fakePhone}9`,
          wechat: `${fakeWechat}_updated`,
          qq: `${fakeQq}9`,
          notes: fakePrivateNote,
        });
        const [audit] = await rows<{ total: number }>(fixtureConnection!, "SELECT COUNT(*) AS total FROM official_channel_audits WHERE requestId = ?", [sourceRequest]);
        assert.equal(Number(audit.total), 1);
      },
      "server/services/officialChannelInventory.ts:151-170,583-607,611-653；drizzle/officialChannelSchema.ts:117-150",
    );

    await check(
      "DB-04",
      "同组 owner/leader/note 的原生权限交集真实生效，跨组查询和写入失败关闭",
      "owner 建库存，非 owner 的同组成员可追加内部备注却不能编辑；leader 可编辑；Beta 组不能读取 Alpha 来源/库存。",
      async () => {
        const created = await inventoryModule.createOfficialChannelStock(ownerActor, {
          requestId: req("stock_create"),
          sourceId,
          partNumber: `${markerPrefix}${runId}-PART`,
          brand: "Brand \"Quoted\", Ltd",
          qty: 25,
          dateCode: "2444",
          price: "+10.00",
          currency: "CNY",
          taxIncluded: true,
          leadTime: "=NOW()",
          note: fakePrivateNote,
        });
        stockId = created.stock.id;
        assert.equal(created.stock.teamId, alphaTeamId);
        assert.equal(created.stock.ownerAdminUserId, ownerActor.adminUserId);
        assert.equal(created.stock.createdByAdminUserId, ownerActor.adminUserId);

        const betaList = await inventoryModule.listOfficialChannelStocks(betaActor, {});
        assert.equal(betaList.items.some((stock: { id: number }) => stock.id === stockId), false);
        await expectRejected(() => inventoryModule.getOfficialChannelSource(betaActor, sourceId), ["OFFICIAL_CHANNEL_SOURCE_NOT_FOUND"]);
        await expectRejected(() => inventoryModule.getOfficialChannelStock(betaActor, stockId), ["OFFICIAL_CHANNEL_STOCK_NOT_FOUND"]);
        await expectRejected(
          () => inventoryModule.updateOfficialChannelStock(noteActor, {
            stockId,
            expectedRevision: created.stock.revision,
            requestId: req("same_team_nonowner_edit"),
            brand: "not allowed",
          }),
          ["FORBIDDEN"],
        );
        const note = await inventoryModule.addOfficialChannelStockNote(noteActor, {
          stockId,
          body: fakePrivateNote,
          requestId: req("same_team_note"),
        });
        assert.equal(note.authorAdminUserId, noteActor.adminUserId);
        const notes = await inventoryModule.listOfficialChannelStockNotes(ownerActor, { stockId });
        assert.equal(notes.items.some((item: { body: string }) => item.body === fakePrivateNote), true);
        const leaderUpdate = await inventoryModule.updateOfficialChannelStock(leaderActor, {
          stockId,
          expectedRevision: created.stock.revision,
          requestId: req("leader_edit"),
          brand: "Leader Edited Brand",
        });
        assert.equal(leaderUpdate.stock.revision, created.stock.revision + 1);
        await expectRejected(
          () => inventoryModule.updateOfficialChannelStock(ownerActor, {
            stockId,
            expectedRevision: created.stock.revision,
            requestId: req("stale_stock_cas"),
            brand: "stale change",
          }),
          ["OFFICIAL_CHANNEL_STOCK_REVISION_CONFLICT"],
        );
      },
      "server/services/officialChannelAccess.ts:194-219；server/services/officialChannelInventory.ts:765-850,932-977",
    );

    await check(
      "DB-05",
      "逐条 publish 写入严格白名单的 factory_channel 公开快照，CSV 防公式且不泄漏私有资料",
      "超管批准来源后 owner 发布；publication.snapshot 仅有安全字段；真实 exportStocks 对公式前缀加字面量前缀并 RFC4180 转义。",
      async () => {
        const currentSource = await inventoryModule.getOfficialChannelSource(superActor, sourceId);
        const approval = await inventoryModule.updateOfficialChannelSource(superActor, {
          sourceId,
          expectedRevision: currentSource.source.revision,
          requestId: req("source_approval"),
          publicationApproved: true,
        });
        assert.equal(approval.source.publicationApproved, true);

        const currentStock = await inventoryModule.getOfficialChannelStock(ownerActor, stockId);
        const published = await inventoryModule.publishOfficialChannelStock(ownerActor, {
          stockId,
          expectedRevision: currentStock.stock.revision,
          requestId: req("stock_publish"),
        });
        assert.equal(published.status, "published");
        const publications = await rows<{ stockId: number; publicId: string; snapshot: unknown }>(fixtureConnection!, `
          SELECT stockId, publicId, snapshot
            FROM official_channel_publications
           WHERE stockId = ?
        `, [stockId]);
        assert.equal(publications.length, 1);
        const snapshot = parseJson(publications[0].snapshot);
        const allowed = [
          "assistanceLabel", "brand", "currency", "dateCode", "label", "leadTime",
          "listingKind", "partNumber", "price", "publicId", "qty", "taxIncluded",
        ].sort();
        assert.deepEqual(Object.keys(snapshot).sort(), allowed);
        assert.equal(snapshot.listingKind, "factory_channel");
        assert.equal(snapshot.label, "工厂渠道");
        assert.equal(snapshot.assistanceLabel, "平台协助询价");
        assert.equal(snapshot.publicId, published.publicId);
        const serializedSnapshot = JSON.stringify(snapshot);
        for (const forbiddenKey of [
          "contactName", "phone", "wechat", "qq", "notes", "note", "teamId",
          "ownerAdminUserId", "createdByAdminUserId", "responsibleName", "createdByName", "supplierId",
        ]) {
          assert.equal(Object.prototype.hasOwnProperty.call(snapshot, forbiddenKey), false);
        }
        for (const privateValue of [fakeContactName, `${fakePhone}9`, `${fakeWechat}_updated`, `${fakeQq}9`, fakePrivateNote]) {
          assert.equal(serializedSnapshot.includes(privateValue), false);
        }

        const exported = await inventoryModule.exportOfficialChannelStocks(ownerActor, { stockIds: [stockId] });
        assert.equal(exported.count, 1);
        assert.equal(exported.csv.startsWith("\uFEFF"), true);
        assert.equal(exported.csv.includes("\"'+10.00\""), true);
        assert.equal(exported.csv.includes("\"'=NOW()\""), true);
        assert.equal(exported.csv.includes('""Quoted""'), true);
        for (const privateValue of [fakeContactName, `${fakePhone}9`, `${fakeWechat}_updated`, `${fakeQq}9`, fakePrivateNote]) {
          assert.equal(exported.csv.includes(privateValue), false);
        }
      },
      "server/services/officialChannelInventory.ts:457-482,853-903,980-1016",
    );

    await check(
      "DB-06",
      "下架删除独立公开投影；来源停用后无激活投影且不触碰普通库存",
      "真实 offshelf 将 stock 置 offshelf 并删除 official_channel_publications 行；随后真实 source active=false 成功。",
      async () => {
        const publishedStock = await inventoryModule.getOfficialChannelStock(ownerActor, stockId);
        const offshelf = await inventoryModule.offshelfOfficialChannelStock(ownerActor, {
          stockId,
          expectedRevision: publishedStock.stock.revision,
          requestId: req("stock_offshelf"),
        });
        assert.equal(offshelf.status, "offshelf");
        const [publicationCount] = await rows<{ total: number }>(fixtureConnection!, "SELECT COUNT(*) AS total FROM official_channel_publications WHERE stockId = ?", [stockId]);
        assert.equal(Number(publicationCount.total), 0);
        const [stock] = await rows<{ status: string }>(fixtureConnection!, "SELECT status FROM official_channel_stocks WHERE id = ?", [stockId]);
        assert.equal(stock.status, "offshelf");

        const source = await inventoryModule.getOfficialChannelSource(ownerActor, sourceId);
        const deactivated = await inventoryModule.setOfficialChannelSourceActive(ownerActor, {
          sourceId,
          active: false,
          expectedRevision: source.source.revision,
          requestId: req("source_inactive"),
        });
        assert.equal(deactivated.source.active, false);
        const [noProjection] = await rows<{ total: number }>(fixtureConnection!, `
          SELECT COUNT(*) AS total
            FROM official_channel_publications AS publication
            INNER JOIN official_channel_sources AS source ON source.id = ?
           WHERE publication.stockId = ? AND source.active = 1 AND source.publicationApproved = 1
        `, [sourceId, stockId]);
        assert.equal(Number(noProjection.total), 0);
      },
      "server/services/officialChannelInventory.ts:905-930,657-684",
    );

    await check(
      "DB-07",
      "调组不迁移历史库存 team 快照，旧 sessionVersion 与原生停用实时失效",
      "super 将 owner 从 Alpha 调到 Beta；原 stock/source teamId 保持 Alpha，旧 session 和新跨组身份均无权访问；直接原生 sessionVersion/status 变化同样立即拒绝。",
      async () => {
        const moved = await teamsModule.setOfficialTeamMember(superActor, {
          adminUserId: ownerActor.adminUserId,
          teamId: betaTeamId,
          role: "member",
          expectedRevision: 1,
          requestId: req("owner_move_beta"),
        });
        assert.equal(moved.member?.teamId, betaTeamId);
        const [history] = await rows<{ stockTeamId: number; sourceTeamId: number }>(fixtureConnection!, `
          SELECT stock.teamId AS stockTeamId, source.teamId AS sourceTeamId
            FROM official_channel_stocks AS stock
            INNER JOIN official_channel_sources AS source ON source.id = stock.sourceId
           WHERE stock.id = ?
        `, [stockId]);
        assert.equal(history.stockTeamId, alphaTeamId);
        assert.equal(history.sourceTeamId, alphaTeamId);
        await expectRejected(() => inventoryModule.getOfficialChannelStock(ownerActor, stockId), ["FORBIDDEN"]);
        const movedOwnerActor = { adminUserId: ownerActor.adminUserId, sessionVersion: ownerActor.sessionVersion + 1 };
        await expectRejected(() => inventoryModule.getOfficialChannelStock(movedOwnerActor, stockId), ["OFFICIAL_CHANNEL_STOCK_NOT_FOUND"]);

        await fixtureConnection!.execute("UPDATE admin_users SET sessionVersion = sessionVersion + 1 WHERE id = ?", [betaActor.adminUserId]);
        await expectRejected(() => inventoryModule.listOfficialChannelSources(betaActor, {}), ["FORBIDDEN"]);
        const betaCurrentActor = { adminUserId: betaActor.adminUserId, sessionVersion: betaActor.sessionVersion + 1 };
        await fixtureConnection!.execute("UPDATE admin_users SET status = 'disabled' WHERE id = ?", [betaActor.adminUserId]);
        await expectRejected(() => inventoryModule.listOfficialChannelSources(betaCurrentActor, {}), ["FORBIDDEN"]);
      },
      "server/services/officialTeams.ts:654-889；server/services/officialChannelAccess.ts:100-157；server/services/officialChannelInventory.ts:396-415",
    );

    await check(
      "DB-08",
      "合同允许的 64 字符 requestId 可完成真实库存写事务",
      "以路由合同允许的最大 64 字符 requestId 调用真实 updateSource；任何拒绝均为服务端 request lock 实现与合同不一致。",
      async () => {
        const maxLengthRequestId = `${fixturePrefix}${"x".repeat(59)}`;
        assert.equal(maxLengthRequestId.length, 64);
        const currentSource = await inventoryModule.getOfficialChannelSource(superActor, sourceId);
        const updated = await inventoryModule.updateOfficialChannelSource(superActor, {
          sourceId,
          expectedRevision: currentSource.source.revision,
          requestId: maxLengthRequestId,
          notes: `${fakePrivateNote}-contract-64-char-request-id`,
        });
        assert.equal(updated.source.notes, `${fakePrivateNote}-contract-64-char-request-id`);
      },
      "server/services/officialChannelInventory.ts:257-268,305-330；server/routers/officialChannelInventory.ts（requestId 上限 64）",
    );

    results.status = "passed";
  } catch (error) {
    results.fatalCode = safeErrorCode(error);
    if (results.safety.loopbackAndFixtureGuard === "failed" && results.fatalCode.startsWith("INTEGRATION_FIXTURE_")) {
      results.status = "blocked";
    } else {
      results.status = "failed";
    }
  } finally {
    if (fixtureConnection && shouldCleanup) {
      try {
        await cleanupTaggedFixtures(fixtureConnection);
      } catch {
        results.notes.push("夹具清理未完成；仅可能残留 OCIT-/ocit_ 前缀虚构记录，未清理其它记录。");
        if (results.status === "passed") results.status = "failed";
        if (!results.fatalCode) results.fatalCode = "INTEGRATION_FIXTURE_CLEANUP_FAILED";
      }
    }
    if (fixtureConnection) await fixtureConnection.end().catch(() => undefined);
    if (drizzleDb?.$client?.end) {
      try {
        await Promise.resolve(drizzleDb.$client.end());
      } catch {
        // A connection-close failure must not prevent the credential-free test report.
      }
    }
    await writeResults();
  }

  if (results.status !== "passed") process.exitCode = 1;
}

await main();
