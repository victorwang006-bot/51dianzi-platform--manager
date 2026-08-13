import { lstat } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import mysql from "mysql2/promise";

const require = createRequire(import.meta.url);
const configArgIndex = process.argv.indexOf("--from-ecosystem-config");
const sourceConfig = configArgIndex >= 0 ? process.argv[configArgIndex + 1] : "";

async function databaseUrlFromEcosystem(configPath) {
  if (!configPath) throw new Error("未提供数据库配置来源文件");
  const resolvedPath = resolve(configPath);
  const metadata = await lstat(resolvedPath);
  if (!metadata.isFile()) throw new Error("数据库配置来源不是普通文件");
  if ((metadata.mode & 0o077) !== 0) throw new Error("数据库配置来源文件权限过宽，销售权限迁移已中止");
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
    throw new Error("数据库配置来源文件所有者不可信，销售权限迁移已中止");
  }
  const moduleId = require.resolve(resolvedPath);
  delete require.cache[moduleId];
  const config = require(moduleId);
  const app = config?.apps?.find(item => item?.name === "dianzi51-admin");
  const databaseUrl = app?.env?.DATABASE_URL;
  return typeof databaseUrl === "string" ? databaseUrl.trim() : "";
}

const databaseUrl = process.env.DATABASE_URL
  || (sourceConfig ? await databaseUrlFromEcosystem(sourceConfig) : "");
if (!databaseUrl) throw new Error("未找到 DATABASE_URL，销售权限迁移已中止");

const conn = await mysql.createConnection(databaseUrl);
const lockName = "dianzi51_admin_sales_permissions_schema_v2";
let locked = false;

async function columnExists(tableName, columnName) {
  const [rows] = await conn.query(
    "SELECT COUNT(*) AS count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?",
    [tableName, columnName],
  );
  return Number(rows[0]?.count ?? 0) > 0;
}

async function indexExists(tableName, indexName) {
  const [rows] = await conn.query(
    "SELECT COUNT(*) AS count FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?",
    [tableName, indexName],
  );
  return Number(rows[0]?.count ?? 0) > 0;
}

try {
  const [lockRows] = await conn.query("SELECT GET_LOCK(?, 30) AS acquired", [lockName]);
  locked = Number(lockRows?.[0]?.acquired ?? 0) === 1;
  if (!locked) throw new Error("无法取得销售权限迁移锁");

  await conn.query(`
    CREATE TABLE IF NOT EXISTS sales_staff (
      id int NOT NULL AUTO_INCREMENT,
      adminUserId int NULL,
      staffCode varchar(64) NOT NULL,
      displayName varchar(128) NOT NULL,
      status enum('active','inactive') NOT NULL DEFAULT 'active',
      sortOrder int NOT NULL DEFAULT 0,
      createdAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY sales_staff_staff_code_unique (staffCode),
      UNIQUE KEY sales_staff_admin_user_unique (adminUserId),
      KEY sales_staff_status_sort_idx (status, sortOrder)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log("[ok] sales_staff ready");
  if (!(await columnExists("sales_staff", "adminUserId"))) {
    await conn.query("ALTER TABLE sales_staff ADD COLUMN adminUserId int NULL AFTER id");
    console.log("[ok] sales_staff.adminUserId added");
  } else {
    console.log("[skip] sales_staff.adminUserId already exists");
  }
  if (!(await indexExists("sales_staff", "sales_staff_admin_user_unique"))) {
    await conn.query("CREATE UNIQUE INDEX sales_staff_admin_user_unique ON sales_staff (adminUserId)");
    console.log("[ok] sales_staff_admin_user_unique added");
  } else {
    console.log("[skip] sales_staff_admin_user_unique already exists");
  }

  await conn.query(`
    CREATE TABLE IF NOT EXISTS admin_user_sales_scopes (
      id int NOT NULL AUTO_INCREMENT,
      adminUserId int NOT NULL,
      staffCode varchar(64) NOT NULL,
      createdAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY admin_user_sales_scopes_admin_staff_unique (adminUserId, staffCode),
      KEY admin_user_sales_scopes_staff_admin_idx (staffCode, adminUserId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log("[ok] admin_user_sales_scopes ready");

  if (!(await columnExists("merchants", "salesOwnerCode"))) {
    await conn.query("ALTER TABLE merchants ADD COLUMN salesOwnerCode varchar(64) NULL AFTER salesOwner");
    console.log("[ok] merchants.salesOwnerCode added");
  } else {
    console.log("[skip] merchants.salesOwnerCode already exists");
  }
  if (!(await indexExists("merchants", "merchants_sales_owner_code_idx"))) {
    await conn.query("CREATE INDEX merchants_sales_owner_code_idx ON merchants (salesOwnerCode)");
    console.log("[ok] merchants_sales_owner_code_idx added");
  } else {
    console.log("[skip] merchants_sales_owner_code_idx already exists");
  }

  const initialStaff = [
    ["victor", "Victor", 10],
    ["ocean", "Ocean", 20],
    ["bella", "Bella", 30],
    ["doomi", "Doomi", 40],
    ["mark", "Mark", 50],
    ["jean", "Jean", 60],
  ];
  for (const [staffCode, displayName, sortOrder] of initialStaff) {
    await conn.query(
      "INSERT IGNORE INTO sales_staff (staffCode, displayName, status, sortOrder) VALUES (?, ?, 'active', ?)",
      [staffCode, displayName, sortOrder],
    );
  }
  console.log("[ok] initial sales staff ensured");

  await conn.query(`
    UPDATE merchants
    SET salesOwnerCode = CASE LOWER(TRIM(salesOwner))
      WHEN 'victor' THEN 'victor'
      WHEN 'ocean' THEN 'ocean'
      WHEN 'bella' THEN 'bella'
      WHEN 'doomi' THEN 'doomi'
      WHEN 'mark' THEN 'mark'
      WHEN 'jean' THEN 'jean'
      ELSE salesOwnerCode
    END
    WHERE (salesOwnerCode IS NULL OR TRIM(salesOwnerCode)='')
      AND LOWER(TRIM(salesOwner)) IN ('victor','ocean','bella','doomi','mark','jean')
  `);
  await conn.query("UPDATE admin_users SET adminRole='merchant_mgr' WHERE adminRole<>'super_admin'");

  await conn.query(`
    UPDATE sales_staff staff
    INNER JOIN admin_users account
      ON staff.adminUserId IS NULL
     AND account.adminRole='merchant_mgr'
     AND staff.staffCode=LOWER(TRIM(account.username))
       SET staff.adminUserId=account.id,
           staff.displayName=COALESCE(NULLIF(TRIM(account.displayName), ''), account.username),
           staff.status=IF(account.status='active', 'active', 'inactive')
  `);
  await conn.query(`
    INSERT INTO sales_staff (adminUserId, staffCode, displayName, status, sortOrder)
    SELECT account.id,
           CONCAT('user-', account.id),
           COALESCE(NULLIF(TRIM(account.displayName), ''), account.username),
           IF(account.status='active', 'active', 'inactive'),
           1000 + account.id
      FROM admin_users account
      LEFT JOIN sales_staff staff ON staff.adminUserId=account.id
     WHERE account.adminRole='merchant_mgr'
       AND staff.id IS NULL
  `);
  await conn.query(`
    UPDATE sales_staff staff
    INNER JOIN admin_users account ON account.id=staff.adminUserId
       SET staff.displayName=COALESCE(NULLIF(TRIM(account.displayName), ''), account.username),
           staff.status=IF(account.adminRole='merchant_mgr' AND account.status='active', 'active', 'inactive')
  `);
  await conn.query(`
    INSERT IGNORE INTO admin_user_sales_scopes (adminUserId, staffCode)
    SELECT staff.adminUserId, staff.staffCode
      FROM sales_staff staff
      INNER JOIN admin_users account ON account.id=staff.adminUserId AND account.adminRole='merchant_mgr'
     WHERE staff.adminUserId IS NOT NULL
  `);

  const [verifyStaff] = await conn.query("SELECT status, COUNT(*) AS count FROM sales_staff GROUP BY status ORDER BY status");
  const [verifyRoles] = await conn.query("SELECT adminRole, COUNT(*) AS count FROM admin_users GROUP BY adminRole ORDER BY adminRole");
  const [verifyScopes] = await conn.query("SELECT COUNT(*) AS count FROM admin_user_sales_scopes");
  const [verifyIdentity] = await conn.query(`
    SELECT
      SUM(account.adminRole='merchant_mgr' AND staff.id IS NULL) AS ordinaryWithoutIdentity,
      SUM(account.adminRole='merchant_mgr' AND scope.id IS NULL) AS ordinaryWithoutOwnScope
    FROM admin_users account
    LEFT JOIN sales_staff staff ON staff.adminUserId=account.id
    LEFT JOIN admin_user_sales_scopes scope
      ON scope.adminUserId=account.id AND scope.staffCode=staff.staffCode
  `);
  if (Number(verifyIdentity[0]?.ordinaryWithoutIdentity ?? 0) !== 0
      || Number(verifyIdentity[0]?.ordinaryWithoutOwnScope ?? 0) !== 0) {
    throw new Error("普通用户销售身份或本人销售范围回填不完整");
  }
  console.log("[verify] staff", JSON.stringify(verifyStaff));
  console.log("[verify] roles", JSON.stringify(verifyRoles));
  console.log("[verify] scopes", JSON.stringify(verifyScopes[0]));
  console.log("[verify] user identities", JSON.stringify(verifyIdentity[0]));
} finally {
  if (locked) await conn.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => undefined);
  await conn.end();
}
