import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import mysql from "mysql2/promise";

const AGREEMENT_VERSION = "V1.0";
const AGREEMENT_HASH = "8d51034dbe6cc097cf92fedbec0fd5c720f63d1e01b08c1d9b2d05b5b82dc289";
const apply = process.argv.includes("--apply");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

async function databaseUrlFromRuntimeEnv(envPath, label) {
  if (!envPath) throw new Error(`未提供${label}运行环境文件`);
  const resolvedPath = resolve(envPath);
  const metadata = await lstat(resolvedPath);
  if (!metadata.isFile()) throw new Error(`${label}运行环境来源不是普通文件`);
  if ((metadata.mode & 0o077) !== 0) throw new Error(`${label}运行环境文件权限过宽，回填已中止`);
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
    throw new Error(`${label}运行环境文件所有者不可信，回填已中止`);
  }
  const text = await readFile(resolvedPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1 || line.slice(0, separator).trim() !== "DATABASE_URL") continue;
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return value;
  }
  throw new Error(`${label}运行环境未配置 DATABASE_URL`);
}

function normalizedCreditCode(value) {
  return String(value ?? "").replace(/\s+/g, "").toUpperCase();
}

const frontUrl = await databaseUrlFromRuntimeEnv(argument("--front-runtime-env"), "前台");
const adminUrl = await databaseUrlFromRuntimeEnv(argument("--admin-runtime-env"), "后台");
const front = await mysql.createConnection(frontUrl);
const admin = await mysql.createConnection(adminUrl);
let locked = false;

try {
  const [acceptanceRows] = await front.query(
    `SELECT userId, creditCodeSnapshot, acceptedAt
       FROM enterprise_service_agreement_acceptances
      WHERE agreementVersion = ? AND agreementHash = ?`,
    [AGREEMENT_VERSION, AGREEMENT_HASH],
  );
  const evidence = new Map(
    acceptanceRows.map(row => [
      `${String(row.userId)}:${normalizedCreditCode(row.creditCodeSnapshot)}`,
      row.acceptedAt,
    ]),
  );

  const [merchantRows] = await admin.query(
    `SELECT id, crmOwnerPortalUserId, businessLicense, agreementStatus
       FROM merchants
      WHERE agreementStatus = 'unsigned'
        AND crmOwnerPortalUserId IS NOT NULL
        AND crmOwnerPortalUserId <> ''`,
  );
  const matchedIds = merchantRows
    .filter(row => evidence.has(`${String(row.crmOwnerPortalUserId).trim()}:${normalizedCreditCode(row.businessLicense)}`))
    .map(row => Number(row.id))
    .filter(Number.isInteger);

  console.log("[preview]", JSON.stringify({
    agreementVersion: AGREEMENT_VERSION,
    acceptanceRecords: acceptanceRows.length,
    unsignedBoundMerchants: merchantRows.length,
    exactEvidenceMatches: matchedIds.length,
    apply,
  }));

  if (!apply || matchedIds.length === 0) {
    console.log(apply ? "[skip] no exact evidence matches" : "[dry-run] no rows changed; rerun with --apply");
    process.exitCode = 0;
  } else {
    const [lockRows] = await admin.query("SELECT GET_LOCK(?, 30) AS acquired", ["dianzi51_enterprise_agreement_backfill_v1"]);
    locked = Number(lockRows?.[0]?.acquired ?? 0) === 1;
    if (!locked) throw new Error("无法取得协议状态回填锁");

    await admin.beginTransaction();
    try {
      const placeholders = matchedIds.map(() => "?").join(",");
      const [result] = await admin.query(
        `UPDATE merchants
            SET agreementStatus = 'signed'
          WHERE agreementStatus = 'unsigned'
            AND id IN (${placeholders})`,
        matchedIds,
      );
      const [verifiedRows] = await admin.query(
        `SELECT COUNT(*) AS remaining
           FROM merchants
          WHERE agreementStatus <> 'signed'
            AND id IN (${placeholders})`,
        matchedIds,
      );
      const remaining = Number(verifiedRows?.[0]?.remaining ?? -1);
      if (remaining !== 0) throw new Error("协议状态回填后校验失败");
      await admin.commit();
      console.log("[applied]", JSON.stringify({ matched: matchedIds.length, changed: Number(result.affectedRows ?? 0), verified: true }));
    } catch (error) {
      await admin.rollback();
      throw error;
    }
  }
} finally {
  if (locked) await admin.query("SELECT RELEASE_LOCK(?)", ["dianzi51_enterprise_agreement_backfill_v1"]).catch(() => undefined);
  await Promise.all([front.end(), admin.end()]);
}
