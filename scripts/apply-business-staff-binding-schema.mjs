#!/usr/bin/env node
import mysql from "mysql2/promise";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL 未设置；拒绝猜测或读取环境文件");
const parsed = new URL(databaseUrl);
const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
if (!new Set(["127.0.0.1", "localhost"]).has(parsed.hostname) || !/^migration_[a-z0-9_]+_test$/i.test(databaseName)) {
  throw new Error("该迁移脚本只允许连接 127.0.0.1/localhost 的 migration_*_test 隔离数据库");
}

const connection = await mysql.createConnection(databaseUrl);
const lockName = "dianzi51_business_staff_binding_schema_v1";
let locked = false;
try {
  const [lockRows] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [lockName]);
  locked = Number(lockRows?.[0]?.acquired ?? 0) === 1;
  if (!locked) throw new Error("无法取得业务员工绑定 schema 迁移锁");

  await connection.query(`
    CREATE TABLE IF NOT EXISTS admin_business_staff_bindings (
      id INT NOT NULL AUTO_INCREMENT,
      adminUserId INT NOT NULL,
      frontUserId INT NULL,
      status ENUM('active', 'revoked') NOT NULL DEFAULT 'revoked',
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
      KEY admin_business_staff_bindings_status_updated_idx (status, updatedAt),
      CONSTRAINT admin_business_staff_bindings_active_front_user_check
        CHECK ((status = 'active' AND frontUserId IS NOT NULL) OR (status = 'revoked' AND frontUserId IS NULL))
    ) ENGINE=InnoDB
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS admin_business_staff_binding_audits (
      id BIGINT NOT NULL AUTO_INCREMENT,
      bindingId INT NOT NULL,
      adminUserId INT NOT NULL,
      frontUserId INT NULL,
      action ENUM('bound', 'rebound', 'revoked', 'unchanged') NOT NULL,
      expectedVersion INT UNSIGNED NOT NULL,
      resultingVersion INT UNSIGNED NOT NULL,
      requestId VARCHAR(64) NOT NULL,
      operatorAdminUserId INT NOT NULL,
      operatorName VARCHAR(128) NOT NULL,
      operatorRole VARCHAR(64) NOT NULL,
      ipAddress VARCHAR(64) NULL,
      userAgent VARCHAR(512) NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY admin_business_staff_binding_audits_request_unique (requestId),
      KEY admin_business_staff_binding_audits_admin_created_idx (adminUserId, createdAt),
      KEY admin_business_staff_binding_audits_front_created_idx (frontUserId, createdAt)
    ) ENGINE=InnoDB
  `);

  const [bindingColumns] = await connection.query(
    `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_business_staff_bindings'`,
  );
  const requiredBindingColumns = new Set([
    "adminUserId", "frontUserId", "status", "bindingVersion", "createdByAdminUserId", "updatedByAdminUserId",
  ]);
  if (![...requiredBindingColumns].every(name => bindingColumns.some(row => row.name === name))) {
    throw new Error("业务员工当前绑定表结构校验失败");
  }
  const [auditIndexes] = await connection.query(
    `SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'admin_business_staff_binding_audits'
        AND INDEX_NAME = 'admin_business_staff_binding_audits_request_unique'`,
  );
  if (!auditIndexes.some(row => Number(row.nonUnique) === 0)) {
    throw new Error("业务员工绑定 requestId 唯一索引校验失败");
  }
  console.log("[verify]", JSON.stringify({
    database: databaseName,
    bindings: "admin_business_staff_bindings",
    audits: "admin_business_staff_binding_audits",
    requestId: "unique",
  }));
} finally {
  if (locked) await connection.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => undefined);
  await connection.end();
}
