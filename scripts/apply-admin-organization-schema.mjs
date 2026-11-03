#!/usr/bin/env node
import { lstat } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import mysql from "mysql2/promise";

const require = createRequire(import.meta.url);
/** Matches the existing --from-ecosystem-config ownership/mode checks. No dotenv or guessed DSN. */
export async function databaseUrlFromEcosystem(configPath) {
  if (!configPath) throw new Error("未提供后台数据库配置来源");
  const resolved = resolve(configPath);
  const metadata = await lstat(resolved);
  if (!metadata.isFile() || metadata.isSymbolicLink())
    throw new Error("数据库配置来源须为普通文件");
  if ((metadata.mode & 0o077) !== 0) throw new Error("数据库配置来源权限过宽");
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid())
    throw new Error("数据库配置来源所有者不可信");
  const moduleId = require.resolve(resolved);
  delete require.cache[moduleId];
  const config = require(moduleId);
  const apps =
    config?.apps?.filter(app => app?.name === "dianzi51-admin") ?? [];
  if (apps.length !== 1) throw new Error("后台应用配置不唯一或不存在");
  const value = apps[0]?.env?.DATABASE_URL;
  if (typeof value !== "string" || !value.trim())
    throw new Error("后台应用缺少数据库配置");
  return value.trim();
}
export const tableDefinitions = [
  [
    "admin_organization_teams",
    `CREATE TABLE IF NOT EXISTS admin_organization_teams (
    id INT NOT NULL AUTO_INCREMENT, name VARCHAR(128) NOT NULL, notes TEXT NULL,
    status ENUM('active','archived') NOT NULL DEFAULT 'active', revision INT UNSIGNED NOT NULL DEFAULT 1,
    createdByAdminUserId INT NOT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id), KEY admin_org_teams_status_idx (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
  [
    "admin_organization_members",
    `CREATE TABLE IF NOT EXISTS admin_organization_members (
    adminUserId INT NOT NULL, teamId INT NULL, role ENUM('member','leader') NULL,
    revision INT UNSIGNED NOT NULL DEFAULT 1, updatedByAdminUserId INT NOT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (adminUserId), KEY admin_org_members_team_idx (teamId)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
  [
    "admin_organization_audits",
    `CREATE TABLE IF NOT EXISTS admin_organization_audits (
    id BIGINT NOT NULL AUTO_INCREMENT, action VARCHAR(64) NOT NULL,
    targetType ENUM('team','member') NOT NULL, targetId INT NOT NULL, actorAdminUserId INT NOT NULL,
    requestId VARCHAR(64) NOT NULL, payloadHash VARCHAR(64) NOT NULL,
    beforeData JSON NULL, afterData JSON NOT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id), UNIQUE KEY admin_org_audits_request_unique (requestId),
    KEY admin_org_audits_target_idx (targetType,targetId,id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
];
const expectedColumns = {
  admin_organization_teams: [
    "id",
    "name",
    "notes",
    "status",
    "revision",
    "createdByAdminUserId",
    "createdAt",
    "updatedAt",
  ],
  admin_organization_members: [
    "adminUserId",
    "teamId",
    "role",
    "revision",
    "updatedByAdminUserId",
    "createdAt",
    "updatedAt",
  ],
  admin_organization_audits: [
    "id",
    "action",
    "targetType",
    "targetId",
    "actorAdminUserId",
    "requestId",
    "payloadHash",
    "beforeData",
    "afterData",
    "createdAt",
  ],
};
export async function applyAdminOrganizationSchema(connection) {
  const lockName = "dianzi51_admin_organization_schema_v1";
  let locked = false;
  try {
    const [locks] = await connection.query(
      "SELECT GET_LOCK(?, 30) AS acquired",
      [lockName]
    );
    locked = Number(locks[0]?.acquired) === 1;
    if (!locked) throw new Error("无法取得运营组织schema锁");
    const [existing] = await connection.query(
      "SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('admin_users','admin_user_permissions','admin_user_permission_audits')"
    );
    if (
      existing.length !== 3 ||
      existing.some(row => String(row.engine).toLowerCase() !== "innodb")
    )
      throw new Error("后台身份及权限事务表缺失或不是InnoDB");
    for (const [table, ddl] of tableDefinitions) {
      if (!ddl.startsWith(`CREATE TABLE IF NOT EXISTS ${table} (`))
        throw new Error("schema定义不是固定增量CREATE");
      await connection.query(ddl);
      const [columns] = await connection.query(
        "SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION",
        [table]
      );
      if (
        JSON.stringify(columns.map(row => row.name)) !==
        JSON.stringify(expectedColumns[table])
      )
        throw new Error("运营组织表结构与版本不一致，拒绝自动修复");
      const [engines] = await connection.query(
        "SELECT ENGINE AS engine, TABLE_COLLATION AS collation FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?",
        [table]
      );
      if (String(engines[0]?.engine).toLowerCase() !== "innodb")
        throw new Error("运营组织表不支持所需事务");
      if (!String(engines[0]?.collation).startsWith("utf8mb4_"))
        throw new Error("运营组织表字符集不匹配，拒绝自动修复");
    }
    const [indexes] = await connection.query(
      "SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnsCsv FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('admin_organization_teams','admin_organization_members','admin_organization_audits') GROUP BY TABLE_NAME,INDEX_NAME,NON_UNIQUE"
    );
    const expected = [
      ["admin_organization_teams", "PRIMARY", "id", 0],
      ["admin_organization_teams", "admin_org_teams_status_idx", "status", 1],
      ["admin_organization_members", "PRIMARY", "adminUserId", 0],
      ["admin_organization_members", "admin_org_members_team_idx", "teamId", 1],
      ["admin_organization_audits", "PRIMARY", "id", 0],
      [
        "admin_organization_audits",
        "admin_org_audits_request_unique",
        "requestId",
        0,
      ],
      [
        "admin_organization_audits",
        "admin_org_audits_target_idx",
        "targetType,targetId,id",
        1,
      ],
    ];
    if (
      indexes.length !== expected.length ||
      expected.some(
        ([tableName, indexName, columnsCsv, nonUnique]) =>
          !indexes.some(
            row =>
              row.tableName === tableName &&
              row.indexName === indexName &&
              row.columnsCsv === columnsCsv &&
              Number(row.nonUnique) === nonUnique
          )
      )
    )
      throw new Error("运营组织索引不匹配，拒绝自动修复");
    return {
      tables: tableDefinitions.map(([table]) => table),
      existingTablesModified: false,
      grantsCreated: 0,
      membersCreated: 0,
    };
  } finally {
    if (locked)
      await connection
        .query("SELECT RELEASE_LOCK(?)", [lockName])
        .catch(() => undefined);
  }
}
async function main() {
  if (!process.argv.includes("--apply"))
    throw new Error("须显式提供 --apply；未执行任何迁移");
  const flag = process.argv.indexOf("--from-ecosystem-config");
  const databaseUrl =
    flag >= 0
      ? await databaseUrlFromEcosystem(process.argv[flag + 1])
      : process.env.DATABASE_URL?.trim();
  if (!databaseUrl)
    throw new Error("须显式提供DATABASE_URL或安全的--from-ecosystem-config");
  const url = new URL(databaseUrl);
  if (url.protocol !== "mysql:" || !url.pathname || url.pathname === "/")
    throw new Error("数据库配置格式无效");
  const connection = await mysql.createConnection(databaseUrl);
  try {
    console.log(
      "[verify]",
      JSON.stringify(await applyAdminOrganizationSchema(connection))
    );
  } finally {
    await connection.end();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch(() => {
    console.error(
      "运营组织schema执行失败；请核验显式授权、配置来源权限与表结构。未输出任何凭据。"
    );
    process.exitCode = 1;
  });
}
