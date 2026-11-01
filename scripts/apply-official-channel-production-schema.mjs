#!/usr/bin/env node
/**
 * ECS-only official-channel schema launcher.
 *
 * This file never loads dotenv files automatically and never accepts DATABASE_URL
 * from its process environment.  It permits only seven fixed CREATE TABLE IF NOT
 * EXISTS statements after an explicit --apply and must be installed as a root-only
 * file at the fixed OPS path below.  It does not deploy the API or static files.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RELEASE = "20261101-admin-official-channel-v1";
const TASK = "MlqjMnID8OKDK47XXrJwIM";
const OPS = "/opt/ops/20261101-admin-official-channel-v1";
const OPS_SCRIPT = `${OPS}/apply-official-channel-production-schema.mjs`;
const OPS_MANIFEST = `${OPS}/manifest.json`;
const OPS_CONTRACT = `${OPS}/schema-contract.json`;
const COORDINATION = "/opt/ops/51-project-release-coordination-20261027.json";
const DEPLOY_LOCK = "/var/lock/dianzi51-public-deploy.lock";
const OLD_ADMIN = "/opt/releases/20261031-wechat-chat-entry-v33/admin";
const OLD_API =
  "/opt/releases/20261101-admin-navigation-availability-r2/admin/dist/index.js";
const EXPECTED_OLD_API_SHA256 =
  "2fc0aaf5d70cee5225ac63dfeb3123758854b021e99962f9615e905225b07208";
const APPROVED_DEPENDENCY_TARGET =
  "/opt/releases/20261030-migration-v14/admin/node_modules";
const PRIVATE_RUNTIME_ENV = "/opt/config/dianzi51-admin/runtime.env";
const ADMIN_NAME = "dianzi51-admin";
const NODE = "/usr/bin/node-22";
const DATABASE = "dianzi51_admin";
const LOCK_NAME = "dianzi51_official_channel_schema_v1";
const EXPECTED_CONTRACT_SOURCE_SHA256 =
  "15a2a28676ff7aec78213402747d8f2e143413aa315ebd11ff431119630a0dfd";
const SHA256 = /^[a-f0-9]{64}$/;
const TABLES = [
  "official_channel_teams",
  "official_channel_team_members",
  "official_channel_sources",
  "official_channel_stocks",
  "official_channel_stock_notes",
  "official_channel_publications",
  "official_channel_audits",
];
const DDL_SHA256 = {
  official_channel_teams:
    "7cceedb3c632e7deed96428c64d9e346d9cbbc0bd2f2b776a80f037f345ef4f4",
  official_channel_team_members:
    "bc144b6d0ac1866d216baeb5ef21ba1f0e630a842b286a60201d3c9ea98cf82d",
  official_channel_sources:
    "1838ad25f7b6d86116557d094729ffefb198352e84ab65f7733afb15f4054781",
  official_channel_stocks:
    "c8dace52e8c4b954084e396159ce69890af586b0e559c5e3e881eec7530842df",
  official_channel_stock_notes:
    "3e65fd47cf45b25689c0eacda574e4e7cfb71e4754686a6be4fe7e889c18b329",
  official_channel_publications:
    "7d6d7bb9100107f9db0cdc733d4697d40d8a64b9a10ad7daf05d1b1bdc7499b1",
  official_channel_audits:
    "efb5670bc37b15a33b900eaa3f760afe34552679625e2eaaaa0fd57b67a55280",
};
const EXPECTED_COLUMNS = {
  official_channel_teams: [
    "id",
    "name",
    "status",
    "revision",
    "createdByAdminUserId",
    "createdAt",
    "updatedAt",
  ],
  official_channel_team_members: [
    "id",
    "adminUserId",
    "teamId",
    "role",
    "leaderTeamId",
    "revision",
    "updatedByAdminUserId",
    "createdAt",
    "updatedAt",
  ],
  official_channel_sources: [
    "id",
    "teamId",
    "name",
    "type",
    "contactName",
    "phone",
    "wechat",
    "qq",
    "notes",
    "active",
    "publicationApproved",
    "everPublished",
    "createdByAdminUserId",
    "revision",
    "legacySourceId",
    "createdAt",
    "updatedAt",
  ],
  official_channel_stocks: [
    "id",
    "sourceId",
    "teamId",
    "createdByAdminUserId",
    "ownerAdminUserId",
    "partNumber",
    "brand",
    "qty",
    "dateCode",
    "price",
    "currency",
    "taxIncluded",
    "leadTime",
    "note",
    "status",
    "revision",
    "createRequestId",
    "createPayloadHash",
    "publishedAt",
    "legacyMaterialId",
    "createdAt",
    "updatedAt",
  ],
  official_channel_stock_notes: [
    "id",
    "stockId",
    "authorAdminUserId",
    "body",
    "requestId",
    "payloadHash",
    "createdAt",
  ],
  official_channel_publications: [
    "id",
    "stockId",
    "publicId",
    "snapshot",
    "batchId",
    "revision",
    "publishedAt",
    "updatedAt",
  ],
  official_channel_audits: [
    "id",
    "action",
    "targetId",
    "actorAdminUserId",
    "requestId",
    "payloadHash",
    "beforeData",
    "afterData",
    "createdAt",
  ],
};
const EXPECTED_INDEXES = {
  official_channel_teams: {
    PRIMARY: ["id", true],
    official_channel_teams_status_updated_idx: ["status,updatedAt", false],
  },
  official_channel_team_members: {
    PRIMARY: ["id", true],
    official_channel_team_members_admin_user_unique: ["adminUserId", true],
    official_channel_team_members_team_idx: ["teamId", false],
    official_channel_team_members_leader_team_unique: ["leaderTeamId", true],
  },
  official_channel_sources: {
    PRIMARY: ["id", true],
    official_channel_sources_team_active_idx: ["teamId,active", false],
    official_channel_sources_legacy_source_unique: ["legacySourceId", true],
  },
  official_channel_stocks: {
    PRIMARY: ["id", true],
    official_channel_stocks_source_idx: ["sourceId", false],
    official_channel_stocks_team_status_idx: ["teamId,status,updatedAt", false],
    official_channel_stocks_team_owner_idx: [
      "teamId,ownerAdminUserId,updatedAt",
      false,
    ],
    official_channel_stocks_create_request_unique: ["createRequestId", true],
    official_channel_stocks_legacy_material_unique: ["legacyMaterialId", true],
  },
  official_channel_stock_notes: {
    PRIMARY: ["id", true],
    official_channel_stock_notes_stock_created_idx: [
      "stockId,createdAt",
      false,
    ],
    official_channel_stock_notes_request_unique: ["requestId", true],
  },
  official_channel_publications: {
    PRIMARY: ["id", true],
    official_channel_publications_stock_unique: ["stockId", true],
    official_channel_publications_public_id_unique: ["publicId", true],
    official_channel_publications_published_idx: ["publishedAt", false],
  },
  official_channel_audits: {
    PRIMARY: ["id", true],
    official_channel_audits_request_unique: ["requestId", true],
    official_channel_audits_target_created_idx: ["targetId,createdAt", false],
    official_channel_audits_actor_created_idx: [
      "actorAdminUserId,createdAt",
      false,
    ],
  },
};
const REQUIRED_ADMIN_COLUMNS = [
  "id",
  "userId",
  "username",
  "adminRole",
  "status",
  "sessionVersion",
];
const REQUIRED_PERMISSION_COLUMNS = ["id", "adminUserId", "permission"];

class SafetyError extends Error {}
const require = (condition, message) => {
  if (!condition) throw new SafetyError(message);
};
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const stableValue = value => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, stableValue(value[key])])
    );
  return value;
};
const canonicalJson = value => JSON.stringify(stableValue(value));
const same = (left, right) => canonicalJson(left) === canonicalJson(right);
const nowId = () =>
  new Date().toISOString().replace(/[-:.TZ]/g, "") +
  "-" +
  crypto.randomBytes(6).toString("hex");

function lstatRegularPrivate(target) {
  const info = fs.lstatSync(target);
  require(info.isFile() &&
    !info.isSymbolicLink(), "root private regular file required");
  require(info.uid === 0 &&
    (info.mode & 0o077) === 0, "root private file mode/owner required");
  return info;
}

function requireSafeRootDirectory(target) {
  const info = fs.lstatSync(target);
  require(info.isDirectory() &&
    !info.isSymbolicLink(), "safe root-owned OPS directory required");
  require(info.uid === 0 &&
    (info.mode & 0o022) ===
      0, "OPS directory must not be writable by group/other");
}

function assertNoSymlinkAncestors(target) {
  require(path.isAbsolute(target), "absolute path required");
  let current = path.parse(target).root;
  for (const part of path.relative(current, target).split(path.sep)) {
    if (!part) continue;
    current = path.join(current, part);
    if (
      !fs.existsSync(current) &&
      !fs.lstatSync(current, { throwIfNoEntry: false })
    )
      break;
    const info = fs.lstatSync(current);
    require(!info.isSymbolicLink(), "symlink path refused");
  }
}

function readPrivateJson(target, maxBytes = 2 * 1024 * 1024) {
  lstatRegularPrivate(target);
  const raw = fs.readFileSync(target);
  require(raw.length > 0 &&
    raw.length <= maxBytes, "private JSON input size is invalid");
  try {
    return { raw, value: JSON.parse(raw.toString("utf8")) };
  } catch {
    throw new SafetyError("private JSON input is invalid");
  }
}

function writePrivateJson(target, value) {
  assertNoSymlinkAncestors(path.dirname(target));
  require(!fs.existsSync(target), "refuse to overwrite a prior schema receipt");
  const raw = Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8");
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${crypto.randomUUID()}.tmp`
  );
  const fd = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.writeFileSync(fd, raw);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.renameSync(temporary, target);
    fs.chmodSync(target, 0o600);
    const directory = fs.openSync(path.dirname(target), "r");
    try {
      fs.fsyncSync(directory);
    } finally {
      fs.closeSync(directory);
    }
  } catch (error) {
    try {
      fs.closeSync(fd);
    } catch {}
    try {
      fs.unlinkSync(temporary);
    } catch {}
    throw error;
  }
}

function coordinatorIsInactive() {
  const info = fs.lstatSync(COORDINATION);
  require(info.isFile() &&
    !info.isSymbolicLink() &&
    info.uid === 0 &&
    (info.mode & 0o022) === 0, "release coordination file is unsafe");
  let value;
  try {
    value = JSON.parse(fs.readFileSync(COORDINATION, "utf8"));
  } catch {
    throw new SafetyError("release coordination file is invalid");
  }
  require(value &&
    value.shared_release_active ===
      false, "another coordinated release window is active");
}

function parseArgs(argv) {
  const values = {
    apply: false,
    fromPm2: false,
    dotenv: null,
    manifestSha256: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--apply") {
      require(!values.apply, "duplicate --apply");
      values.apply = true;
    } else if (item === "--from-pm2") {
      require(!values.fromPm2, "duplicate --from-pm2");
      values.fromPm2 = true;
    } else if (item === "--from-private-dotenv") {
      require(values.dotenv === null &&
        index + 1 < argv.length, "invalid --from-private-dotenv");
      values.dotenv = argv[++index];
    } else if (item === "--manifest-sha256") {
      require(values.manifestSha256 === null &&
        index + 1 < argv.length, "invalid --manifest-sha256");
      values.manifestSha256 = argv[++index];
    } else throw new SafetyError("unrecognized argument");
  }
  require(values.apply, "--apply is required; this launcher does not have an implicit write mode");
  require(SHA256.test(
    values.manifestSha256 ?? ""
  ), "--manifest-sha256 must be a lower-case SHA-256");
  require(Number(values.fromPm2) + Number(values.dotenv !== null) ===
    1, "choose exactly one database source: --from-pm2 or --from-private-dotenv");
  return values;
}

function reexecUnderSharedDeployLock() {
  if (process.env.D51_OFFICIAL_SCHEMA_UNDER_DEPLOY_LOCK === "1") {
    const lockInode = String(fs.statSync(DEPLOY_LOCK).ino);
    const heldByParent = fs
      .readFileSync("/proc/locks", "utf8")
      .split("\n")
      .some(line => {
        const parts = line.trim().split(/\s+/);
        return (
          parts[1] === "FLOCK" &&
          parts[4] === String(process.ppid) &&
          parts[5]?.split(":").at(-1) === lockInode
        );
      });
    require(heldByParent, "shared deploy flock is not actually held by the launcher parent");
    return false;
  }
  const executable = process.execPath;
  require(executable === NODE, "must execute with the approved Node runtime");
  const script = fileURLToPath(import.meta.url);
  const result = spawnSync(
    "/usr/bin/flock",
    ["-n", DEPLOY_LOCK, executable, script, ...process.argv.slice(2)],
    {
      encoding: "utf8",
      env: { ...process.env, D51_OFFICIAL_SCHEMA_UNDER_DEPLOY_LOCK: "1" },
      maxBuffer: 64 * 1024,
    }
  );
  if (result.status === 0 && result.stdout) process.stdout.write(result.stdout);
  else
    process.stdout.write(
      JSON.stringify({ ok: false, error: "SafetyError" }) + "\n"
    );
  process.exitCode = result.status === 0 ? 0 : 1;
  return true;
}

function findPm2() {
  for (const candidate of ["/usr/local/bin/pm2", "/usr/bin/pm2"]) {
    try {
      const info = fs.statSync(candidate);
      if (info.isFile() && info.mode & 0o111) return fs.realpathSync(candidate);
    } catch {}
  }
  throw new SafetyError("PM2 executable unavailable");
}

function pm2Apps() {
  const pm2 = findPm2();
  const result = spawnSync(pm2, ["jlist"], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    env: {
      HOME: "/root",
      LANG: "C.UTF-8",
      PATH: `${path.dirname(pm2)}:/usr/local/bin:/usr/bin:/bin`,
      PM2_HOME: "/root/.pm2",
    },
  });
  require(result.status === 0 &&
    typeof result.stdout === "string", "unable to obtain PM2 runtime topology");
  try {
    const apps = JSON.parse(result.stdout);
    require(Array.isArray(apps), "PM2 topology was not a list");
    return apps;
  } catch {
    throw new SafetyError("PM2 topology was not JSON");
  }
}

function appEnv(pm2Env) {
  const result = { ...(pm2Env.env ?? {}) };
  for (const [key, value] of Object.entries(pm2Env))
    if (/^[A-Z_]+$/.test(key)) result[key] = value;
  return result;
}

function verifiedAdminRuntime() {
  const candidates = pm2Apps().filter(app => app?.name === ADMIN_NAME);
  require(candidates.length ===
    2, "exactly two existing admin PM2 instances are required");
  const urls = [];
  for (const app of candidates) {
    const env = app.pm2_env;
    require(env &&
      env.status === "online" &&
      env.exec_mode === "cluster_mode" &&
      Number(env.instances) === 2 &&
      env.exec_interpreter === NODE &&
      env.pm_cwd === OLD_ADMIN &&
      env.pm_exec_path ===
        OLD_API, "existing admin PM2 topology differs from reviewed r2 deployment");
    const values = appEnv(env);
    require(String(values.PORT) ===
      "3001", "admin PM2 port differs from reviewed topology");
    require(typeof values.DATABASE_URL === "string" &&
      values.DATABASE_URL.length > 0, "admin PM2 DATABASE_URL is absent");
    urls.push(values.DATABASE_URL);
  }
  require(urls[0] ===
    urls[1], "two admin instances have different DATABASE_URL values");
  return { databaseUrl: urls[0] };
}

function databaseUrlFromPrivateEnv(supplied) {
  const resolved = path.resolve(supplied);
  require(resolved ===
    PRIVATE_RUNTIME_ENV, "only the reviewed original admin runtime.env is accepted");
  lstatRegularPrivate(resolved);
  const raw = fs.readFileSync(resolved, "utf8");
  require(Buffer.byteLength(raw, "utf8") <=
    1024 * 1024, "runtime.env is unexpectedly large");
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*DATABASE_URL\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    let value = match[1];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    require(value.length >
      0, "original private dotenv has an empty DATABASE_URL");
    return value;
  }
  throw new SafetyError("original private dotenv has no DATABASE_URL");
}

function validateDatabaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new SafetyError("DATABASE_URL is invalid");
  }
  require(["mysql:", "mysql2:"].includes(
    parsed.protocol
  ), "DATABASE_URL protocol is not MySQL");
  require(decodeURIComponent(parsed.pathname.replace(/^\//, "")) ===
    DATABASE, "DATABASE_URL must select native dianzi51_admin only");
}

function validateManifestAndContract(manifestSha256) {
  requireSafeRootDirectory(OPS);
  assertNoSymlinkAncestors(OPS);
  const script = fileURLToPath(import.meta.url);
  require(script ===
    OPS_SCRIPT, "production launcher must run from its fixed root-private OPS path");
  lstatRegularPrivate(script);
  const manifestInput = readPrivateJson(OPS_MANIFEST);
  require(sha256(manifestInput.raw) ===
    manifestSha256, "manifest is not the explicitly approved candidate");
  const manifest = manifestInput.value;
  require(manifest &&
    manifest.version === RELEASE &&
    manifest.task === TASK &&
    typeof manifest.sourceCommit === "string" &&
    /^[a-f0-9]{40}$/.test(manifest.sourceCommit) &&
    typeof manifest.sourceTreeSha256 === "string" &&
    SHA256.test(manifest.sourceTreeSha256) &&
    manifest.sourceTreeAlgorithm === "git-ls-files-stage0-json-sha256-v1" &&
    manifest.baselineAdminApiPath === OLD_API &&
    manifest.baselineAdminApiSha256 === EXPECTED_OLD_API_SHA256 &&
    manifest.approvedDependencyTarget === APPROVED_DEPENDENCY_TARGET &&
    manifest.adminPort ===
      3001, "manifest does not bind the reviewed release/source/runtime constants");
  require(Array.isArray(manifest.files) &&
    manifest.files.some(item => item?.path === "api/index.js") &&
    manifest.files.some(
      item => item?.path === "static/index.html"
    ), "manifest lacks required API/static file bindings");
  for (const item of manifest.files)
    require(item &&
      typeof item.path === "string" &&
      SHA256.test(item.sha256) &&
      Number.isInteger(item.bytes) &&
      item.bytes >= 0, "manifest file binding is invalid");
  const launcher = manifest.productionSchemaLauncher;
  require(launcher &&
    launcher.path === "scripts/apply-official-channel-production-schema.mjs" &&
    launcher.sha256 === sha256(fs.readFileSync(script)) &&
    launcher.bytes ===
      fs.statSync(script)
        .size, "manifest does not bind this exact production schema launcher");

  const contractInput = readPrivateJson(OPS_CONTRACT);
  const contract = contractInput.value;
  const schema = manifest.officialChannelSchema;
  require(schema &&
    schema.contractPath === "deploy/official-channel/schema-contract.json" &&
    schema.contractSha256 === sha256(contractInput.raw) &&
    contract.contractSourceSha256 === EXPECTED_CONTRACT_SOURCE_SHA256 &&
    schema.contractSourceSha256 ===
      EXPECTED_CONTRACT_SOURCE_SHA256, "manifest/schema contract binding is invalid");
  require(Array.isArray(contract.tableDefinitions) &&
    contract.tableDefinitions.length === TABLES.length &&
    Array.isArray(schema.tables) &&
    schema.tables.length ===
      TABLES.length, "schema contract must contain exactly seven tables");
  const definitions = [];
  for (let index = 0; index < TABLES.length; index += 1) {
    const pair = contract.tableDefinitions[index];
    const expectedName = TABLES[index];
    require(Array.isArray(pair) &&
      pair.length === 2 &&
      pair[0] === expectedName &&
      typeof pair[1] === "string", "schema table name/order differs");
    const [name, ddl] = pair;
    require(sha256(ddl) === DDL_SHA256[name] &&
      schema.tables[index]?.name === name &&
      schema.tables[index]?.ddlSha256 ===
        DDL_SHA256[name], "schema DDL digest differs from fixed contract");
    const ddlWithoutTimestampUpdate = ddl.replace(
      /\bON\s+UPDATE\s+CURRENT_TIMESTAMP(?:\(\))?/gi,
      ""
    );
    require(/^\s*CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+official_channel_[a-z_]+\s*\(/i.test(
      ddl
    ) &&
      !/[;]/.test(ddl) &&
      !/\b(?:ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE|REPLACE|GRANT|REVOKE)\b/i.test(
        ddlWithoutTimestampUpdate
      ), "schema statement is not a single permitted CREATE TABLE IF NOT EXISTS");
    definitions.push([name, ddl]);
  }
  return { manifest, definitions };
}

async function mysqlClient() {
  const requireFromAdmin = createRequire(
    pathToFileURL(`${OLD_ADMIN}/package.json`)
  );
  try {
    return requireFromAdmin("mysql2/promise");
  } catch {
    throw new SafetyError("reviewed admin mysql2 dependency is unavailable");
  }
}

async function requireMysql8(connection) {
  const [rows] = await connection.query("SELECT VERSION() AS version");
  const version = String(rows?.[0]?.version ?? "");
  require(/^8\.0\./.test(version) &&
    !/MariaDB/i.test(
      version
    ), "MySQL 8.0 is required for generated columns, JSON and CHECK constraints");
  const [databaseRows] = await connection.query(
    "SELECT DATABASE() AS databaseName"
  );
  require(databaseRows?.[0]?.databaseName ===
    DATABASE, "connection is not using native dianzi51_admin");
  return version;
}

async function tableColumns(connection, table) {
  const [rows] = await connection.execute(
    "SELECT COLUMN_NAME AS name, EXTRA AS extra, GENERATION_EXPRESSION AS generationExpression FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
    [table]
  );
  return rows;
}

async function requireColumns(connection, table, expected) {
  const rows = await tableColumns(connection, table);
  const found = rows.map(row => row.name);
  require(same(
    found,
    expected
  ), `${table} columns differ from reviewed native structure`);
  return rows;
}

async function requireRequiredColumns(connection, table, expected) {
  const rows = await tableColumns(connection, table);
  const found = new Set(rows.map(row => row.name));
  require(expected.every(column =>
    found.has(column)
  ), `${table} lacks a required native column`);
  return expected;
}

async function showCreate(connection, database, table) {
  const qualifier =
    database === DATABASE ? `\`${table}\`` : `\`${database}\`.\`${table}\``;
  const [rows] = await connection.query(`SHOW CREATE TABLE ${qualifier}`);
  const row = rows?.[0] ?? {};
  const ddl = row["Create Table"];
  require(typeof ddl === "string" &&
    ddl.length > 0, "unable to preserve preflight schema definition");
  return ddl;
}

async function nativeSchemaDefinitions(connection, existingOfficial) {
  const definitions = {
    admin_users: await showCreate(connection, DATABASE, "admin_users"),
    admin_user_permissions: await showCreate(
      connection,
      DATABASE,
      "admin_user_permissions"
    ),
    channel_inventory_channels: await showCreate(
      connection,
      "dianzi51",
      "channel_inventory_channels"
    ),
    channel_inventory_materials: await showCreate(
      connection,
      "dianzi51",
      "channel_inventory_materials"
    ),
  };
  for (const table of existingOfficial)
    definitions[table] = await showCreate(connection, DATABASE, table);
  return definitions;
}

async function officialTables(connection) {
  const [rows] = await connection.query(
    "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME REGEXP '^official_channel_'"
  );
  const names = rows.map(row => row.name).sort();
  require(names.every(name =>
    TABLES.includes(name)
  ), "unexpected official_channel_ table exists; manual inspection required");
  return names;
}

async function officialDataSummary(connection, existing) {
  const result = {};
  for (const table of existing) {
    const [rows] = await connection.query(
      `SELECT COUNT(*) AS rowCount FROM \`${table}\``
    );
    result[table] = Number(rows?.[0]?.rowCount ?? -1);
  }
  return result;
}

async function orderedRowDigest(connection, sql, params = []) {
  const [rows] = await connection.execute(sql, params);
  // Query results contain only per-row SHA-256 values.  The receipt retains
  // only this aggregate digest, never identifiers, names, contacts or notes.
  return sha256(rows.map(row => String(row.rowDigest ?? "")).join("\n"));
}

async function accountAndPermissionSummary(connection) {
  const [accounts] = await connection.query(
    "SELECT adminRole, status, COUNT(*) AS count FROM admin_users GROUP BY adminRole, status ORDER BY adminRole, status"
  );
  const [permissions] = await connection.query(
    "SELECT permission, COUNT(*) AS count FROM admin_user_permissions GROUP BY permission ORDER BY permission"
  );
  return {
    accountRoleStatusCounts: accounts.map(row => ({
      adminRole: String(row.adminRole),
      status: String(row.status),
      count: Number(row.count),
    })),
    nativePermissionCounts: permissions.map(row => ({
      permission: String(row.permission),
      count: Number(row.count),
    })),
    accountRowSetSha256: await orderedRowDigest(
      connection,
      "SELECT SHA2(CAST(JSON_OBJECT('id', id, 'userId', userId, 'adminRole', adminRole, 'status', status, 'sessionVersion', sessionVersion) AS CHAR), 256) AS rowDigest FROM admin_users ORDER BY id"
    ),
    permissionRowSetSha256: await orderedRowDigest(
      connection,
      "SELECT SHA2(CAST(JSON_OBJECT('adminUserId', adminUserId, 'permission', permission) AS CHAR), 256) AS rowDigest FROM admin_user_permissions ORDER BY adminUserId, permission"
    ),
  };
}

async function legacySummary(connection) {
  const [merchantRows] = await connection.execute(
    "SELECT crmOwnerPortalUserId AS portalUserId FROM merchants WHERE id = 30061 LIMIT 1"
  );
  require(merchantRows.length === 1 &&
    /^[1-9][0-9]*$/.test(
      String(merchantRows[0].portalUserId ?? "")
    ), "reviewed legacy official source locator is unavailable");
  const portalUserId = String(merchantRows[0].portalUserId);
  const [legacyTables] = await connection.query(
    "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'dianzi51' AND TABLE_NAME IN ('channel_inventory_channels', 'channel_inventory_materials') ORDER BY TABLE_NAME"
  );
  require(legacyTables.map(row => row.name).join(",") ===
    "channel_inventory_channels,channel_inventory_materials", "legacy source tables are unavailable");
  const [sources] = await connection.execute(
    "SELECT COUNT(*) AS count FROM dianzi51.channel_inventory_channels WHERE data_owner_user_id = ?",
    [portalUserId]
  );
  const [stocks] = await connection.execute(
    "SELECT COUNT(*) AS count FROM dianzi51.channel_inventory_materials WHERE data_owner_user_id = ?",
    [portalUserId]
  );
  const [mapping] = await connection.execute(
    "SELECT COUNT(DISTINCT s.responsible_user_id) AS distinctResponsibles, COUNT(DISTINCT CASE WHEN b.adminUserId IS NOT NULL THEN s.responsible_user_id END) AS mappedResponsibles FROM dianzi51.channel_inventory_materials s LEFT JOIN admin_business_staff_bindings b ON b.frontUserId = s.responsible_user_id AND b.status = 'active' WHERE s.data_owner_user_id = ?",
    [portalUserId]
  );
  const summary = {
    legacySourceCount: Number(sources?.[0]?.count ?? -1),
    legacyStockCount: Number(stocks?.[0]?.count ?? -1),
    distinctResponsibles: Number(mapping?.[0]?.distinctResponsibles ?? -1),
    mappedResponsibles: Number(mapping?.[0]?.mappedResponsibles ?? -1),
    sourceRowSetSha256: await orderedRowDigest(
      connection,
      "SELECT SHA2(CAST(JSON_OBJECT('id', id, 'enterpriseId', enterprise_id, 'dataOwnerUserId', data_owner_user_id, 'responsibleUserId', responsible_user_id, 'name', name, 'channelType', channel_type, 'contactName', contact_name, 'phone', phone, 'wechat', wechat, 'qq', qq, 'notes', notes, 'active', active, 'revision', revision, 'createRequestId', create_request_id, 'createPayloadHash', create_payload_hash, 'createdAt', created_at, 'updatedAt', updated_at) AS CHAR), 256) AS rowDigest FROM dianzi51.channel_inventory_channels WHERE data_owner_user_id = ? ORDER BY id",
      [portalUserId]
    ),
    stockRowSetSha256: await orderedRowDigest(
      connection,
      "SELECT SHA2(CAST(JSON_OBJECT('id', id, 'channelId', channel_id, 'enterpriseId', enterprise_id, 'dataOwnerUserId', data_owner_user_id, 'responsibleUserId', responsible_user_id, 'partNumber', part_number, 'brand', brand, 'qty', qty, 'dateCode', date_code, 'price', price, 'currency', currency, 'taxIncluded', tax_included, 'leadTime', lead_time, 'note', note, 'revision', revision, 'createRequestId', create_request_id, 'createPayloadHash', create_payload_hash, 'createdAt', created_at, 'updatedAt', updated_at) AS CHAR), 256) AS rowDigest FROM dianzi51.channel_inventory_materials WHERE data_owner_user_id = ? ORDER BY id",
      [portalUserId]
    ),
  };
  require(summary.legacySourceCount === 5 &&
    summary.legacyStockCount === 33 &&
    summary.distinctResponsibles === 1 &&
    summary.mappedResponsibles ===
      1, "legacy 5-source/33-stock preservation baseline differs; do not run schema DDL");
  return summary;
}

async function verifyOfficialTable(connection, table) {
  const columns = await requireColumns(
    connection,
    table,
    EXPECTED_COLUMNS[table]
  );
  const [engineRows] = await connection.execute(
    "SELECT ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    [table]
  );
  require(engineRows?.[0]?.engine === "InnoDB", `${table} must use InnoDB`);
  const [indexRows] = await connection.execute(
    "SELECT INDEX_NAME AS name, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnsCsv, MIN(NON_UNIQUE) AS nonUnique FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? GROUP BY INDEX_NAME",
    [table]
  );
  const actual = Object.fromEntries(
    indexRows.map(row => [
      row.name,
      [String(row.columnsCsv), Number(row.nonUnique) === 0],
    ])
  );
  require(same(
    actual,
    EXPECTED_INDEXES[table]
  ), `${table} indexes differ from fixed schema contract`);
  if (table === "official_channel_team_members") {
    const leader = columns.find(column => column.name === "leaderTeamId");
    require(leader &&
      /GENERATED/i.test(String(leader.extra ?? "")) &&
      /role/i.test(String(leader.generationExpression ?? "")) &&
      /teamId/i.test(
        String(leader.generationExpression ?? "")
      ), "leaderTeamId generated-column verification failed");
  }
  if (table === "official_channel_stocks") {
    const [checks] = await connection.query(
      "SELECT cc.CHECK_CLAUSE AS clauseText FROM information_schema.TABLE_CONSTRAINTS tc JOIN information_schema.CHECK_CONSTRAINTS cc ON tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME WHERE tc.CONSTRAINT_SCHEMA = DATABASE() AND tc.TABLE_NAME = 'official_channel_stocks' AND tc.CONSTRAINT_TYPE = 'CHECK'"
    );
    require(checks.some(
      row =>
        /qty/i.test(String(row.clauseText ?? "")) &&
        />=\s*0/.test(String(row.clauseText ?? ""))
    ), "official_channel_stocks quantity CHECK verification failed");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  require(process.getuid?.() === 0, "must run as root on ECS");
  require(process.execPath ===
    NODE, "must execute with the approved Node runtime");
  require(!Object.prototype.hasOwnProperty.call(
    process.env,
    "DATABASE_URL"
  ), "launcher refuses a caller-supplied DATABASE_URL");
  const { manifest, definitions } = validateManifestAndContract(
    args.manifestSha256
  );
  coordinatorIsInactive();
  const runtime = verifiedAdminRuntime();
  const databaseUrl = args.fromPm2
    ? runtime.databaseUrl
    : databaseUrlFromPrivateEnv(args.dotenv);
  if (!args.fromPm2)
    require(sha256(databaseUrl) ===
      sha256(
        runtime.databaseUrl
      ), "private dotenv DATABASE_URL differs from existing admin PM2");
  validateDatabaseUrl(databaseUrl);
  const mysql = await mysqlClient();
  // mysql2's URI entry point keeps the existing reviewed connection semantics;
  // this launcher never accepts SQL input and therefore never enables multiple statements.
  const connection = await mysql.createConnection(databaseUrl);
  const run = nowId();
  let locked = false;
  let preflight = null;
  try {
    const version = await requireMysql8(connection);
    const [lockRows] = await connection.execute(
      "SELECT GET_LOCK(?, 0) AS acquired",
      [LOCK_NAME]
    );
    locked = Number(lockRows?.[0]?.acquired ?? 0) === 1;
    require(locked, "official schema lock is busy; no competing migration is permitted");
    coordinatorIsInactive();
    await connection.query("START TRANSACTION READ ONLY");
    const adminColumns = await requireRequiredColumns(
      connection,
      "admin_users",
      REQUIRED_ADMIN_COLUMNS
    );
    const permissionColumns = await requireRequiredColumns(
      connection,
      "admin_user_permissions",
      REQUIRED_PERMISSION_COLUMNS
    );
    const existing = await officialTables(connection);
    const before = {
      nativeDefinitions: await nativeSchemaDefinitions(connection, existing),
      nativeAccountAndPermissionSummary:
        await accountAndPermissionSummary(connection),
      legacyReadOnlySummary: await legacySummary(connection),
      officialDataRows: await officialDataSummary(connection, existing),
      existingOfficialTables: existing,
    };
    await connection.rollback();
    preflight = {
      status: "preflight-complete",
      run,
      release: RELEASE,
      task: TASK,
      manifestSha256: args.manifestSha256,
      sourceCommit: manifest.sourceCommit,
      sourceTreeSha256: manifest.sourceTreeSha256,
      mysqlVersion: version,
      database: DATABASE,
      databaseUrlExported: false,
      adminColumnsVerified: adminColumns,
      permissionColumnsVerified: permissionColumns,
      ...before,
      permittedDdl: TABLES.map(name => ({
        table: name,
        ddlSha256: DDL_SHA256[name],
        operation: "CREATE TABLE IF NOT EXISTS only",
      })),
      dataManipulationStatements: 0,
    };
    writePrivateJson(`${OPS}/schema-preflight-${run}.json`, preflight);

    for (const [, ddl] of definitions) await connection.query(ddl);
    const afterTables = await officialTables(connection);
    require(same(
      afterTables,
      [...TABLES].sort()
    ), "post-DDL official table set is not exactly the fixed seven tables");
    for (const table of TABLES) await verifyOfficialTable(connection, table);
    const afterAccountPermissions =
      await accountAndPermissionSummary(connection);
    const afterLegacy = await legacySummary(connection);
    const afterOfficialData = await officialDataSummary(connection, TABLES);
    const afterNativeDefinitions = await nativeSchemaDefinitions(
      connection,
      before.existingOfficialTables
    );
    require(same(
      afterNativeDefinitions,
      before.nativeDefinitions
    ), "native/legacy preflight schema definition changed");
    require(same(
      afterAccountPermissions,
      before.nativeAccountAndPermissionSummary
    ), "native admin account/permission summary changed");
    require(same(
      afterLegacy,
      before.legacyReadOnlySummary
    ), "legacy source/stock summary changed");
    for (const table of before.existingOfficialTables)
      require(afterOfficialData[table] ===
        before.officialDataRows[table], "pre-existing official data changed");
    const added = TABLES.filter(
      table => !before.existingOfficialTables.includes(table)
    );
    for (const table of added)
      require(afterOfficialData[table] ===
        0, "new official table is not empty after DDL-only migration");
    coordinatorIsInactive();
    const receipt = {
      status: "applied-and-verified",
      run,
      release: RELEASE,
      task: TASK,
      manifestSha256: args.manifestSha256,
      sourceCommit: manifest.sourceCommit,
      sourceTreeSha256: manifest.sourceTreeSha256,
      mysqlVersion: version,
      database: DATABASE,
      databaseUrlExported: false,
      databaseTablesAdded: added,
      officialTablesVerified: TABLES,
      schemaDdlStatementsIssued: TABLES.length,
      dataManipulationStatements: 0,
      nativeSchemaDefinitionsUnchanged: true,
      nativeAccountAndPermissionSummaryUnchanged: true,
      legacyFiveSourceThirtyThreeStockSummaryUnchanged: true,
      preExistingOfficialDataUnchanged: true,
      newTablesHaveZeroRows: true,
      note: "此回执仅表示该 schema 工具无 DML；不代表整个上线没有数据库写入。",
    };
    writePrivateJson(`${OPS}/schema-applied-${run}.json`, receipt);
    process.stdout.write(
      JSON.stringify({
        ok: true,
        status: receipt.status,
        database: DATABASE,
        databaseTablesAdded: added,
        dataManipulationStatements: 0,
        manifestSha256: args.manifestSha256,
      }) + "\n"
    );
  } catch (error) {
    const failure = {
      status: "failed",
      run,
      release: RELEASE,
      task: TASK,
      manifestSha256: args.manifestSha256,
      error: error?.constructor?.name ?? "Error",
      rollbackAttempted: false,
      note: "MySQL DDL 非事务；可能已保留加性的空官方表，未自动 DROP 或回滚。",
    };
    try {
      writePrivateJson(`${OPS}/schema-failed-${run}.json`, failure);
    } catch {}
    throw error;
  } finally {
    if (locked)
      await connection
        .execute("SELECT RELEASE_LOCK(?)", [LOCK_NAME])
        .catch(() => undefined);
    await connection.end().catch(() => undefined);
  }
}

try {
  parseArgs(process.argv.slice(2));
  if (!reexecUnderSharedDeployLock()) await main();
} catch (error) {
  process.stdout.write(
    JSON.stringify({ ok: false, error: error?.constructor?.name ?? "Error" }) +
      "\n"
  );
  process.exitCode = 1;
}
