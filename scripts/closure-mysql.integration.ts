/*
 * Test-only real MySQL 8 integration harness.
 *
 * Safety boundary:
 * - accepts only the purpose-built local unit_manager URL below;
 * - verifies the live server datadir before every test run;
 * - creates/deletes only CLOSURE_ synthetic fixtures (IDs 900xxx);
 * - never reads .env, deployment files, or production credentials.
 *
 * Run (from manager/source):
 * PLATFORM_DB_NAME=unit_platform DATABASE_URL=mysql://closure:closure-test-only@127.0.0.1:33317/unit_manager \
 *   /home/ubuntu/source-recovery-20261028/toolchain/node-v22.22.0-linux-arm64/bin/node \
 *   /home/ubuntu/source-recovery-20261028/toolchain/pnpm/node_modules/pnpm/bin/pnpm.cjs exec tsx scripts/closure-mysql.integration.ts
 */

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";

const MANAGER_DB = "unit_manager";
const PLATFORM_DB = "unit_platform";
const HOST = "127.0.0.1";
const PORT = 33317;
const USER = "closure";
const PASSWORD = "closure-test-only";
const REQUIRED_DATADIR = "/home/ubuntu/source-closure-20261028/integration/mysql-data/";
const DEFAULT_DATABASE_URL = `mysql://${USER}:${PASSWORD}@${HOST}:${PORT}/${MANAGER_DB}`;
const DATABASE_URL = process.env.CLOSURE_DATABASE_URL ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
const ROOT = resolve(import.meta.dirname, "../../..");
const OUTPUT_DIR = resolve(ROOT, "native-transactions");
const LOG_DIR = resolve(OUTPUT_DIR, "logs");
const MARKER = "CLOSURE_MYSQL_";
const RUN_ID = `CLOSURE_MYSQL_${Date.now()}_${randomUUID().slice(0, 8)}`;
const EXECUTED_AT = new Date().toISOString();
const MYSQL_OPTIONS = {
  host: HOST,
  port: PORT,
  user: USER,
  password: PASSWORD,
  database: MANAGER_DB,
  // The test must fail, not hang, if the local isolated server is unavailable.
  connectTimeout: 5_000,
  multipleStatements: false,
} as const;

type JsonRecord = Record<string, unknown>;
type Result = {
  name: string;
  status: "pass" | "fail" | "skip";
  durationMs: number;
  evidence?: JsonRecord;
  error?: { name: string; message: string; stack?: string };
};

const results: Result[] = [];
const runLog: string[] = [];
let cleanupConnection: Connection | null = null;
let activeTrigger: string | null = null;

function log(message: string, data?: unknown) {
  const line = `[${new Date().toISOString()}] ${message}${data === undefined ? "" : ` ${JSON.stringify(data)}`}`;
  runLog.push(line);
  console.log(line);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function errorMessages(error: unknown): string {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) messages.push(current.message);
    current = (current as { cause?: unknown }).cause;
  }
  return messages.join("\ncaused by: \n");
}

async function assertRejectsIncluding(action: Promise<unknown>, expected: RegExp) {
  try {
    await action;
  } catch (error) {
    assert.match(errorMessages(error), expected);
    return;
  }
  assert.fail(`expected rejection matching ${expected}`);
}

function strictDatabaseUrl(input: string) {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error("CLOSURE_DATABASE_URL_INVALID");
  }
  const actualDatabase = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  const exact = parsed.protocol === "mysql:"
    && parsed.hostname === HOST
    && Number(parsed.port || "3306") === PORT
    && decodeURIComponent(parsed.username) === USER
    && decodeURIComponent(parsed.password) === PASSWORD
    && actualDatabase === MANAGER_DB
    && !parsed.search
    && !parsed.hash;
  if (!exact) throw new Error("CLOSURE_DATABASE_URL_REFUSED");
  return parsed;
}

function assertSafeRuntimeConfig() {
  strictDatabaseUrl(DATABASE_URL);
  if (process.env.PLATFORM_DB_NAME !== undefined && process.env.PLATFORM_DB_NAME !== PLATFORM_DB) {
    throw new Error("PLATFORM_DB_NAME_REFUSED");
  }
  // Must be set before dynamically importing db.ts/cnRegistrationReview.ts.
  process.env.DATABASE_URL = DATABASE_URL;
  process.env.PLATFORM_DB_NAME = PLATFORM_DB;
}

function syntheticMerchantNo(name: string) {
  const value = `${MARKER}${name}_${RUN_ID.slice(-8)}`;
  assert(value.length <= 32, `merchantNo over 32 characters: ${value}`);
  return value;
}

function syntheticName(name: string) {
  return `${MARKER}${name}_${RUN_ID.slice(-8)}`.slice(0, 120);
}

function cnCredit(seed: string) {
  // Valid GB 32100 character set and exactly 18 characters; per fixture unique.
  const suffix = seed.replace(/[IOSVZ]|[^A-Z0-9]/g, "A").padEnd(5, "A").slice(0, 5);
  return `91310000${suffix}1234A`;
}

function materialKey(namespace: "licenses" | "bank-licenses", userId: number) {
  // Current producer shape: storagePutPrivate adds an 8-hex suffix.
  const millis = String(Date.now()).padStart(13, "0");
  return `${namespace}/user-${userId}-${millis}-${randomUUID()}_deadbeef.pdf`;
}

function hkRegistration(brn: string, companyName: string, salesOwnerCode: string) {
  return {
    companyName,
    chineseName: "",
    businessNature: "Private limited company",
    legalStatus: "Limited company",
    brn,
    registrationNumber: `${brn}-123-45-67-8`,
    brStartDate: "2025-01-01",
    brExpiryDate: "2099-12-31",
    ciNumber: "",
    establishedAt: "2020-01-01",
    regAddress: "Closure Test Address, Hong Kong",
    bankAccountName: companyName,
    bankAccountNumber: "1234-5678-9012",
    bankName: "Closure Bank",
    bankAddress: "Hong Kong",
    swift: "",
    bankCode: "",
    companyRole: "supplier",
    salesOwner: "Closure Sales",
    salesOwnerCode,
  };
}

async function connect() {
  // Validation must happen before each mysql2 createConnection call.
  strictDatabaseUrl(DATABASE_URL);
  return mysql.createConnection(MYSQL_OPTIONS);
}

async function scalar<T = unknown>(connection: Connection, statement: string, values: unknown[] = []) {
  const [rows] = await connection.execute<RowDataPacket[]>(statement, values);
  assert(rows.length > 0, `expected at least one row for: ${statement}`);
  const first = rows[0] as Record<string, T>;
  return Object.values(first)[0] as T;
}

async function one<T extends RowDataPacket = RowDataPacket>(connection: Connection, statement: string, values: unknown[] = []) {
  const [rows] = await connection.execute<T[]>(statement, values);
  assert.equal(rows.length, 1, `expected exactly one row for: ${statement}`);
  return rows[0];
}

async function count(connection: Connection, statement: string, values: unknown[] = []) {
  return Number(await scalar(connection, statement, values));
}

async function assertIsolatedServer(connection: Connection) {
  const row = await one<{ datadir: string; port: number; currentDb: string | null; version: string }>(connection,
    "SELECT @@datadir AS datadir, @@port AS port, DATABASE() AS currentDb, VERSION() AS version");
  assert.equal(row.datadir, REQUIRED_DATADIR, "refusing server outside this run's datadir");
  assert.equal(Number(row.port), PORT, "refusing unexpected MySQL port");
  assert.equal(row.currentDb, MANAGER_DB, "refusing unexpected default database");
  assert.match(row.version, /^8\.0\.46\b/, "expected isolated MySQL 8.0.46");
  const [databases] = await connection.query<RowDataPacket[]>("SHOW DATABASES");
  const names = databases.map(row => String(Object.values(row)[0])).sort();
  assert.deepEqual(names, ["information_schema", "performance_schema", MANAGER_DB, PLATFORM_DB].sort(), "unexpected database visibility");
  return { ...row, databases: names };
}

async function cleanupFixtures(connection: Connection) {
  if (activeTrigger) {
    await connection.query(`DROP TRIGGER IF EXISTS ${MANAGER_DB}.\`${activeTrigger}\``);
    activeTrigger = null;
  }
  // audit rows are generated by fixture merchant IDs only; delete them first.
  await connection.execute(`DELETE FROM ${MANAGER_DB}.audit_logs WHERE targetType = 'merchant' AND targetId LIKE '900%' AND (operatorName = ? OR targetId IN (SELECT id FROM (SELECT id FROM ${MANAGER_DB}.merchants WHERE merchantNo LIKE ?) AS closure_merchants))`, [MARKER, `${MARKER}%`]);
  await connection.execute(`DELETE FROM ${MANAGER_DB}.audit_logs WHERE operatorName = ?`, [MARKER]);
  await connection.execute(`DELETE FROM ${PLATFORM_DB}.enterprise_members WHERE enterpriseId BETWEEN 900000 AND 900999 AND userId BETWEEN 900000 AND 900999`);
  await connection.execute(`DELETE FROM ${PLATFORM_DB}.companies WHERE userId BETWEEN 900000 AND 900999 AND companyName LIKE ?`, [`${MARKER}%`]);
  await connection.execute(`DELETE FROM ${PLATFORM_DB}.enterprises WHERE id BETWEEN 900000 AND 900999 AND companyName LIKE ?`, [`${MARKER}%`]);
  await connection.execute(`DELETE FROM ${PLATFORM_DB}.users WHERE id BETWEEN 900000 AND 900999 AND openId LIKE ?`, [`${MARKER}%`]);
  await connection.execute(`DELETE FROM ${MANAGER_DB}.merchants WHERE id BETWEEN 900000 AND 900999 AND merchantNo LIKE ?`, [`${MARKER}%`]);
}

async function insertMerchant(connection: Connection, input: {
  id: number;
  merchantNo: string;
  companyName: string;
  registrationRegion?: "CN" | "HK";
  registrationIdentifier?: string | null;
  businessLicense?: string | null;
  status?: "pending" | "approved" | "supplement";
  crmStatus?: "none" | "pending" | "enabled" | "disabled" | "rejected";
  crmOwnerPortalUserId?: string | null;
  salesOwnerCode?: string | null;
  salesOwner?: string | null;
  licenseObjectKey?: string | null;
  bankDocumentObjectKey?: string | null;
  registrationData?: unknown;
  hkSubmissionId?: string | null;
  hkPayloadHash?: string | null;
}) {
  await connection.execute(
    `INSERT INTO ${MANAGER_DB}.merchants
      (id, merchantNo, companyName, registrationRegion, registrationIdentifier, businessLicense, status, crmStatus,
       crmOwnerPortalUserId, salesOwner, salesOwnerCode, licenseObjectKey, bankDocumentObjectKey, registrationData,
       hkSubmissionId, hkPayloadHash, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?, 'closure-integration')`,
    [
      input.id, input.merchantNo, input.companyName, input.registrationRegion ?? "CN", input.registrationIdentifier ?? null,
      input.businessLicense ?? null, input.status ?? "pending", input.crmStatus ?? "pending", input.crmOwnerPortalUserId ?? null,
      input.salesOwner ?? (input.salesOwnerCode ? "Closure Sales" : null), input.salesOwnerCode ?? null,
      input.licenseObjectKey ?? null, input.bankDocumentObjectKey ?? null, JSON.stringify(input.registrationData ?? null),
      input.hkSubmissionId ?? null, input.hkPayloadHash ?? null,
    ],
  );
}

async function insertPlatformCnSubject(connection: Connection, input: {
  userId: number;
  enterpriseId: number;
  companyId: number;
  creditCode: string;
  companyName: string;
  salesOwnerCode: string;
  reviewStatus: "pending" | "approved";
  pendingDraft?: unknown | null;
  licenseObjectKey: string;
  bankLicenseObjectKey: string;
}) {
  await connection.execute(`INSERT INTO ${PLATFORM_DB}.users (id, openId, name, loginDisabled) VALUES (?, ?, ?, 0)`, [
    input.userId, `${MARKER}user_${input.userId}`, MARKER,
  ]);
  await connection.execute(
    `INSERT INTO ${PLATFORM_DB}.enterprises
      (id, creditCode, registrationRegion, companyName, superAdminUserId, crmDataOwnerUserId)
     VALUES (?, ?, 'CN', ?, ?, ?)`,
    [input.enterpriseId, input.creditCode, input.companyName, input.userId, input.userId],
  );
  await connection.execute(
    `INSERT INTO ${PLATFORM_DB}.enterprise_members (enterpriseId, userId, role, status, inventoryDataScope)
     VALUES (?, ?, 'super_admin', 'active', 'enterprise')`,
    [input.enterpriseId, input.userId],
  );
  await connection.execute(
    `INSERT INTO ${PLATFORM_DB}.companies
      (id, userId, enterpriseId, companyName, creditCode, registrationRegion, companyType, legalPerson, companyRole,
       bankAccountName, bankAccountNumber, bankName, regAddress, establishedAt, salesOwner, salesOwnerCode,
       licenseUrl, licenseObjectKey, licenseFileName, bankLicenseUrl, bankLicenseObjectKey, bankLicenseFileName,
       certLevel, reviewStatus, pendingDraft, submittedAt)
     VALUES (?, ?, ?, ?, ?, 'CN', 'closure-type', 'Closure Legal Person', 'supplier',
       'Closure Account', '6222029000000000', 'Closure Bank', 'Closure CN Address', '2020-01-02', 'Closure Sales', ?,
       NULL, ?, 'closure-license.pdf', NULL, ?, 'closure-bank-license.pdf', 'pending', ?, ?, NOW())`,
    [
      input.companyId, input.userId, input.enterpriseId, input.companyName, input.creditCode, input.salesOwnerCode,
      input.licenseObjectKey, input.bankLicenseObjectKey, input.reviewStatus,
      input.pendingDraft === null || input.pendingDraft === undefined ? null : JSON.stringify(input.pendingDraft),
    ],
  );
}

async function insertPlatformHkSubject(connection: Connection, input: {
  userId: number;
  enterpriseId: number;
  companyId: number;
  brn: string;
  companyName: string;
  submissionId: string;
  payloadHash: string;
  registration: ReturnType<typeof hkRegistration>;
  brKey: string;
  bankKey: string;
}) {
  await connection.execute(`INSERT INTO ${PLATFORM_DB}.users (id, openId, name, loginDisabled) VALUES (?, ?, ?, 0)`, [
    input.userId, `${MARKER}user_${input.userId}`, MARKER,
  ]);
  await connection.execute(
    `INSERT INTO ${PLATFORM_DB}.enterprises
      (id, registrationRegion, registrationIdentifier, companyName, superAdminUserId, crmDataOwnerUserId)
     VALUES (?, 'HK', ?, ?, ?, ?)`,
    [input.enterpriseId, `HK:${input.brn}`, input.companyName, input.userId, input.userId],
  );
  await connection.execute(
    `INSERT INTO ${PLATFORM_DB}.enterprise_members (enterpriseId, userId, role, status, inventoryDataScope)
     VALUES (?, ?, 'super_admin', 'active', 'enterprise')`,
    [input.enterpriseId, input.userId],
  );
  await connection.execute(
    `INSERT INTO ${PLATFORM_DB}.companies
      (id, userId, enterpriseId, companyName, registrationRegion, registrationIdentifier, registrationSubmissionId,
       registrationPayloadHash, registrationData, companyType, companyRole, bankAccountName, bankAccountNumber, bankName,
       regAddress, establishedAt, salesOwner, salesOwnerCode, licenseObjectKey, licenseFileName, bankLicenseObjectKey,
       bankLicenseFileName, certLevel, reviewStatus, pendingDraft, submittedAt)
     VALUES (?, ?, ?, ?, 'HK', ?, ?, ?, CAST(? AS JSON), 'Private limited company', 'supplier', ?, ?, ?, ?, '2020-01-01',
       'Closure Sales', ?, ?, 'closure-br.pdf', ?, 'closure-bank.pdf', 'certified', 'approved', NULL, NOW())`,
    [
      input.companyId, input.userId, input.enterpriseId, input.companyName, `HK:${input.brn}`, input.submissionId,
      input.payloadHash, JSON.stringify(input.registration), input.companyName, input.registration.bankAccountNumber,
      input.registration.bankName, input.registration.regAddress, input.registration.salesOwnerCode, input.brKey, input.bankKey,
    ],
  );
}

async function createAuditFailureTrigger(connection: Connection, trigger: string, action: string, merchantId: number) {
  assert.match(trigger, /^closure_audit_fail_[a-z0-9_]+$/);
  activeTrigger = trigger;
  await connection.query(`DROP TRIGGER IF EXISTS ${MANAGER_DB}.\`${trigger}\``);
  // Values are hard-coded test constants; only unit_manager is affected.
  await connection.query(`
    CREATE TRIGGER ${MANAGER_DB}.\`${trigger}\`
    BEFORE INSERT ON ${MANAGER_DB}.audit_logs
    FOR EACH ROW
    BEGIN
      IF NEW.action = '${action}' AND NEW.targetType = 'merchant' AND NEW.targetId = '${merchantId}' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CLOSURE_AUDIT_INSERT_FORCED_FAILURE';
      END IF;
    END
  `);
}

async function dropActiveTrigger(connection: Connection) {
  if (!activeTrigger) return;
  await connection.query(`DROP TRIGGER IF EXISTS ${MANAGER_DB}.\`${activeTrigger}\``);
  activeTrigger = null;
}

async function settleOrTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return Promise.race([
    promise.then(value => ({ settled: true as const, value }), error => ({ settled: true as const, error })),
    new Promise<{ settled: false }>(resolveTimeout => setTimeout(() => resolveTimeout({ settled: false }), timeoutMs)),
  ]);
}

async function test(name: string, body: () => Promise<JsonRecord | void>) {
  const started = Date.now();
  try {
    const evidence = await body();
    results.push({ name, status: "pass", durationMs: Date.now() - started, evidence });
    log(`PASS ${name}`, evidence);
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    results.push({
      name,
      status: "fail",
      durationMs: Date.now() - started,
      error: { name: normalized.name, message: errorMessages(normalized), stack: normalized.stack },
    });
    log(`FAIL ${name}`, { error: normalized.message });
  }
}

async function writeOutputs(serverEvidence: JsonRecord | null, fatal?: unknown) {
  await mkdir(LOG_DIR, { recursive: true });
  const passed = results.filter(result => result.status === "pass").length;
  const failed = results.filter(result => result.status === "fail").length;
  const result = {
    suite: "closure-mysql.integration",
    executedAt: EXECUTED_AT,
    runId: RUN_ID,
    target: { host: HOST, port: PORT, managerDatabase: MANAGER_DB, platformDatabase: PLATFORM_DB, datadir: REQUIRED_DATADIR },
    serverEvidence,
    summary: { passed, failed, total: results.length, status: failed === 0 && !fatal ? "pass" : "fail" },
    results,
    fatal: fatal ? { message: errorMessage(fatal), stack: fatal instanceof Error ? fatal.stack : undefined } : undefined,
    rerun: "PLATFORM_DB_NAME=unit_platform DATABASE_URL=mysql://closure:closure-test-only@127.0.0.1:33317/unit_manager /home/ubuntu/source-recovery-20261028/toolchain/node-v22.22.0-linux-arm64/bin/node /home/ubuntu/source-recovery-20261028/toolchain/pnpm/node_modules/pnpm/bin/pnpm.cjs exec tsx scripts/closure-mysql.integration.ts",
  };
  await writeFile(resolve(OUTPUT_DIR, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(resolve(LOG_DIR, `closure-mysql-${RUN_ID}.log`), `${runLog.join("\n")}\n`);
  const review = `# 真实 MySQL 8 隔离集成测试审阅\n\n`
    + `- 执行时间：${EXECUTED_AT}\n- Run ID：\`${RUN_ID}\`\n- 目标：\`${HOST}:${PORT}/${MANAGER_DB}\`，跨 schema：\`${PLATFORM_DB}\`\n- 已核验 datadir：\`${REQUIRED_DATADIR}\`\n- 测试资产：\`manager/source/scripts/closure-mysql.integration.ts\`（未改动业务源码）\n- 状态：**${result.summary.status.toUpperCase()}**（${passed} pass / ${failed} fail）\n\n`
    + `## SQL 一致性证据\n\n`
    + `1. harness 在运行前严格验证 mysql URL 的 host、port、用户名、密码和 dbname；连接后再断言 \`@@datadir\`、\`@@port\`、默认 schema、MySQL 版本和可见数据库集合。\n`
    + `2. 每个业务断言调用真实 \`server/db.ts\` / \`server/cnRegistrationReview.ts\` 导出。没有 mock、替身 SQL 或吞错成功路径。\n`
    + `3. 审计失败由仅限 \`${MANAGER_DB}.audit_logs\` 的临时 \`BEFORE INSERT\` trigger 发出 \`SIGNAL\`；每项后置断言检查本地、平台及审计状态，trigger 在 finally 清理。\n`
    + `4. CN/HK 并发用独立 MySQL 连接 A 的 \`SELECT ... FOR UPDATE\` 锁住合成商户，再启动真实服务 B；B 在提交前不得 settle，提交转移归属后必须按锁内新归属拒绝旧 scope。\n\n`
    + `## 结果\n\n`
    + results.map(item => `- **${item.status.toUpperCase()}** \`${item.name}\`（${item.durationMs} ms）${item.error ? `：\`${item.error.message}\`` : ""}`).join("\n")
    + `\n\n## 重跑命令\n\n\`\`\`bash\n${result.rerun}\n\`\`\`\n`;
  await writeFile(resolve(OUTPUT_DIR, "review.md"), review);
}

async function main() {
  assertSafeRuntimeConfig();
  const preflight = await connect();
  cleanupConnection = preflight;
  let serverEvidence: JsonRecord | null = null;
  let dbModule: typeof import("../server/db") | null = null;
  let cnReviewModule: typeof import("../server/cnRegistrationReview") | null = null;
  try {
    serverEvidence = await assertIsolatedServer(preflight) as JsonRecord;
    await cleanupFixtures(preflight);
    log("isolated MySQL preflight passed", serverEvidence);

    // Dynamic imports happen only after the target variables were safety-validated and assigned.
    dbModule = await import("../server/db");
    cnReviewModule = await import("../server/cnRegistrationReview");

    await test("generic_review_updates_exactly_one_row_and_same_transaction_audit", async () => {
      const merchantId = 900001;
      await insertMerchant(preflight, {
        id: merchantId, merchantNo: syntheticMerchantNo("GENOK"), companyName: syntheticName("generic-ok"),
        registrationRegion: "HK", registrationIdentifier: "HK:90000001", status: "pending", crmStatus: "none", salesOwnerCode: "closure-old",
      });
      const beforeAudit = await count(preflight, `SELECT COUNT(*) FROM ${MANAGER_DB}.audit_logs WHERE targetId = ? AND action = 'merchant.review.approved'`, [String(merchantId)]);
      await dbModule!.reviewMerchantStatus({
        merchantId, status: "approved", reviewNote: "closure generic approval", reviewedBy: 900001,
        allowedSalesStaffCodes: ["closure-old"], actor: { operatorId: 900001, operatorName: MARKER, operatorRole: "auditor" },
      });
      const merchant = await one<{ status: string; reviewNote: string; reviewedBy: number }>(preflight,
        `SELECT status, reviewNote, reviewedBy FROM ${MANAGER_DB}.merchants WHERE id = ?`, [merchantId]);
      const afterAudit = await count(preflight, `SELECT COUNT(*) FROM ${MANAGER_DB}.audit_logs WHERE targetId = ? AND action = 'merchant.review.approved'`, [String(merchantId)]);
      assert.equal(merchant.status, "approved");
      assert.equal(merchant.reviewNote, "closure generic approval");
      assert.equal(merchant.reviewedBy, 900001);
      assert.equal(afterAudit - beforeAudit, 1, "exactly one audit row must accompany the guarded update");
      return { merchantId, affectedRowsCheckedByService: 1, auditRowsInserted: afterAudit - beforeAudit, merchantStatus: merchant.status };
    });

    await test("generic_review_audit_signal_rolls_back_merchant_update", async () => {
      const merchantId = 900002;
      await insertMerchant(preflight, {
        id: merchantId, merchantNo: syntheticMerchantNo("GENROLL"), companyName: syntheticName("generic-rollback"),
        registrationRegion: "HK", registrationIdentifier: "HK:90000002", status: "pending", crmStatus: "none", salesOwnerCode: "closure-old",
      });
      await createAuditFailureTrigger(preflight, "closure_audit_fail_generic", "merchant.review.approved", merchantId);
      await assertRejectsIncluding(
        dbModule!.reviewMerchantStatus({
          merchantId, status: "approved", reviewNote: "must rollback", reviewedBy: 900002,
          actor: { operatorId: 900002, operatorName: MARKER, operatorRole: "auditor" },
        }),
        /CLOSURE_AUDIT_INSERT_FORCED_FAILURE/,
      );
      const merchant = await one<{ status: string; reviewNote: string | null; reviewedBy: number | null }>(preflight,
        `SELECT status, reviewNote, reviewedBy FROM ${MANAGER_DB}.merchants WHERE id = ?`, [merchantId]);
      const audits = await count(preflight, `SELECT COUNT(*) FROM ${MANAGER_DB}.audit_logs WHERE targetId = ?`, [String(merchantId)]);
      assert.deepEqual(merchant, { status: "pending", reviewNote: null, reviewedBy: null });
      assert.equal(audits, 0);
      await dropActiveTrigger(preflight);
      return { merchantId, forcedAuditSignal: true, merchantStatusAfterRollback: merchant.status, auditRows: audits };
    });

    await test("cn_generic_review_pending_platform_candidate_is_rejected_without_writes", async () => {
      const merchantId = 900101;
      const userId = 900102;
      const enterpriseId = 900103;
      const companyId = 900104;
      const credit = cnCredit("CNGENA");
      const licenseKey = materialKey("licenses", userId);
      const bankKey = materialKey("bank-licenses", userId);
      await insertPlatformCnSubject(preflight, {
        userId, enterpriseId, companyId, creditCode: credit, companyName: syntheticName("cn-generic-pending"),
        salesOwnerCode: "closure-cn-old", reviewStatus: "pending", licenseObjectKey: licenseKey, bankLicenseObjectKey: bankKey,
      });
      await insertMerchant(preflight, {
        id: merchantId, merchantNo: syntheticMerchantNo("CNPEND"), companyName: syntheticName("cn-generic-pending"), businessLicense: credit,
        registrationRegion: "CN", status: "pending", crmStatus: "pending", crmOwnerPortalUserId: String(userId), salesOwnerCode: "closure-cn-old",
      });
      await assert.rejects(
        dbModule!.reviewMerchantStatus({ merchantId, status: "approved", allowedSalesStaffCodes: ["closure-cn-old"] }),
        /CN_REGISTRATION_REVIEW_PENDING/,
      );
      const merchant = await one<{ status: string }>(preflight, `SELECT status FROM ${MANAGER_DB}.merchants WHERE id = ?`, [merchantId]);
      const audits = await count(preflight, `SELECT COUNT(*) FROM ${MANAGER_DB}.audit_logs WHERE targetId = ?`, [String(merchantId)]);
      assert.equal(merchant.status, "pending");
      assert.equal(audits, 0);
      return { merchantId, platformReviewStatus: "pending", rejectedCode: "CN_REGISTRATION_REVIEW_PENDING", auditRows: audits };
    });

    await test("cn_review_pending_initial_candidate_promotes_platform_enterprise_local_and_audit", async () => {
      const merchantId = 900201;
      const userId = 900202;
      const enterpriseId = 900203;
      const companyId = 900204;
      const credit = cnCredit("CNAPPRA");
      const companyName = syntheticName("cn-approved");
      const licenseKey = materialKey("licenses", userId);
      const bankKey = materialKey("bank-licenses", userId);
      await insertPlatformCnSubject(preflight, {
        userId, enterpriseId, companyId, creditCode: credit, companyName, salesOwnerCode: "closure-cn-owner",
        reviewStatus: "pending", licenseObjectKey: licenseKey, bankLicenseObjectKey: bankKey,
      });
      await insertMerchant(preflight, {
        id: merchantId, merchantNo: syntheticMerchantNo("CNAPP"), companyName: syntheticName("cn-local-before"), businessLicense: credit,
        registrationRegion: "CN", status: "pending", crmStatus: "pending", crmOwnerPortalUserId: String(userId), salesOwnerCode: "closure-cn-owner",
      });
      const detail = await cnReviewModule!.getCnRegistrationReviewDetail(merchantId);
      assert.equal(detail.reviewKind, "initial");
      assert.equal(detail.canReview, true);
      assert(detail.candidate?.expectedVersion, "real detail must supply an in-lock version");
      const result = await cnReviewModule!.reviewCnRegistrationDraft({
        merchantId, decision: "approved", expectedVersion: detail.candidate.expectedVersion, confirmed: true,
        note: "closure CN approval", allowedSalesStaffCodes: ["closure-cn-owner"],
        actor: { operatorId: 900201, operatorName: MARKER, operatorRole: "auditor" },
      });
      assert.equal(result.success, true);
      assert.equal(result.idempotent, false);
      const company = await one<{ reviewStatus: string; pendingDraft: string | null; certLevel: string; companyName: string }>(preflight,
        `SELECT reviewStatus, pendingDraft, certLevel, companyName FROM ${PLATFORM_DB}.companies WHERE id = ?`, [companyId]);
      const enterprise = await one<{ companyName: string }>(preflight, `SELECT companyName FROM ${PLATFORM_DB}.enterprises WHERE id = ?`, [enterpriseId]);
      const merchant = await one<{ status: string; companyName: string; licenseObjectKey: string; bankDocumentObjectKey: string }>(preflight,
        `SELECT status, companyName, licenseObjectKey, bankDocumentObjectKey FROM ${MANAGER_DB}.merchants WHERE id = ?`, [merchantId]);
      const audits = await count(preflight, `SELECT COUNT(*) FROM ${MANAGER_DB}.audit_logs WHERE targetId = ? AND action = 'merchant.cn-registration.review'`, [String(merchantId)]);
      assert.deepEqual(company, { reviewStatus: "approved", pendingDraft: null, certLevel: "certified", companyName });
      assert.equal(enterprise.companyName, companyName);
      assert.equal(merchant.status, "approved");
      assert.equal(merchant.companyName, companyName);
      assert.equal(merchant.licenseObjectKey, licenseKey);
      assert.equal(merchant.bankDocumentObjectKey, bankKey);
      assert.equal(audits, 1);
      return { merchantId, expectedVersion: detail.candidate.expectedVersion, companyReviewStatus: company.reviewStatus, enterpriseCompanyName: enterprise.companyName, localStatus: merchant.status, auditRows: audits };
    });

    await test("cn_review_audit_signal_rolls_back_cross_schema_platform_and_local_updates", async () => {
      const merchantId = 900301;
      const userId = 900302;
      const enterpriseId = 900303;
      const companyId = 900304;
      const credit = cnCredit("CNROLLA");
      const originalName = syntheticName("cn-rollback-before");
      const licenseKey = materialKey("licenses", userId);
      const bankKey = materialKey("bank-licenses", userId);
      await insertPlatformCnSubject(preflight, {
        userId, enterpriseId, companyId, creditCode: credit, companyName: originalName, salesOwnerCode: "closure-cn-owner",
        reviewStatus: "pending", licenseObjectKey: licenseKey, bankLicenseObjectKey: bankKey,
      });
      await insertMerchant(preflight, {
        id: merchantId, merchantNo: syntheticMerchantNo("CNROLL"), companyName: syntheticName("cn-local-before"), businessLicense: credit,
        registrationRegion: "CN", status: "pending", crmStatus: "pending", crmOwnerPortalUserId: String(userId), salesOwnerCode: "closure-cn-owner",
      });
      const detail = await cnReviewModule!.getCnRegistrationReviewDetail(merchantId);
      assert(detail.candidate?.expectedVersion);
      await createAuditFailureTrigger(preflight, "closure_audit_fail_cn", "merchant.cn-registration.review", merchantId);
      await assertRejectsIncluding(
        cnReviewModule!.reviewCnRegistrationDraft({
          merchantId, decision: "approved", expectedVersion: detail.candidate.expectedVersion, confirmed: true,
          actor: { operatorId: 900301, operatorName: MARKER, operatorRole: "auditor" },
        }),
        /CLOSURE_AUDIT_INSERT_FORCED_FAILURE/,
      );
      const company = await one<{ reviewStatus: string; pendingDraft: string | null; certLevel: string; companyName: string }>(preflight,
        `SELECT reviewStatus, pendingDraft, certLevel, companyName FROM ${PLATFORM_DB}.companies WHERE id = ?`, [companyId]);
      const enterprise = await one<{ companyName: string }>(preflight, `SELECT companyName FROM ${PLATFORM_DB}.enterprises WHERE id = ?`, [enterpriseId]);
      const merchant = await one<{ status: string; companyName: string; licenseObjectKey: string | null }>(preflight,
        `SELECT status, companyName, licenseObjectKey FROM ${MANAGER_DB}.merchants WHERE id = ?`, [merchantId]);
      const audits = await count(preflight, `SELECT COUNT(*) FROM ${MANAGER_DB}.audit_logs WHERE targetId = ?`, [String(merchantId)]);
      assert.deepEqual(company, { reviewStatus: "pending", pendingDraft: null, certLevel: "pending", companyName: originalName });
      assert.equal(enterprise.companyName, originalName);
      assert.equal(merchant.status, "pending");
      assert.equal(merchant.companyName, syntheticName("cn-local-before"));
      assert.equal(merchant.licenseObjectKey, null);
      assert.equal(audits, 0);
      await dropActiveTrigger(preflight);
      return { merchantId, forcedAuditSignal: true, platformReviewStatusAfterRollback: company.reviewStatus, localStatusAfterRollback: merchant.status, auditRows: audits };
    });

    async function crmRaceAndScope(input: { region: "CN" | "HK"; merchantId: number; userId: number; enterpriseId: number; companyId: number; creditOrBrn: string }) {
      const oldScope = `closure-${input.region.toLowerCase()}-old`;
      const newScope = `closure-${input.region.toLowerCase()}-new`;
      const companyName = syntheticName(`${input.region.toLowerCase()}-crm-race`);
      const licenseKey = input.region === "CN" ? materialKey("licenses", input.userId) : `hk-registration/user-${input.userId}/BR/${randomUUID()}_br.pdf`;
      const bankKey = input.region === "CN" ? materialKey("bank-licenses", input.userId) : `hk-registration/user-${input.userId}/BANK/${randomUUID()}_bank.pdf`;
      let merchantRegistration: unknown = null;
      let merchantIdentifier: string | null = null;
      let businessLicense: string | null = null;
      if (input.region === "CN") {
        businessLicense = input.creditOrBrn;
        await insertPlatformCnSubject(preflight, {
          userId: input.userId, enterpriseId: input.enterpriseId, companyId: input.companyId, creditCode: input.creditOrBrn,
          companyName, salesOwnerCode: oldScope, reviewStatus: "approved", licenseObjectKey: licenseKey, bankLicenseObjectKey: bankKey,
        });
      } else {
        merchantIdentifier = `HK:${input.creditOrBrn}`;
        const submissionId = randomUUID();
        const payloadHash = "a".repeat(64);
        const registration = hkRegistration(input.creditOrBrn, companyName, oldScope);
        merchantRegistration = {
          registration,
          documents: { BR: { fileName: "closure-br.pdf" }, BANK: { fileName: "closure-bank.pdf" } },
          submittedAt: "2026-01-01T00:00:00.000Z",
          submissionId,
          payloadHash,
        };
        await insertPlatformHkSubject(preflight, {
          userId: input.userId, enterpriseId: input.enterpriseId, companyId: input.companyId, brn: input.creditOrBrn,
          companyName, submissionId, payloadHash, registration, brKey: licenseKey, bankKey,
        });
      }
      await insertMerchant(preflight, {
        id: input.merchantId, merchantNo: syntheticMerchantNo(`${input.region}RACE`), companyName,
        registrationRegion: input.region, registrationIdentifier: merchantIdentifier, businessLicense,
        status: "approved", crmStatus: "pending", crmOwnerPortalUserId: null, salesOwnerCode: oldScope,
        licenseObjectKey: licenseKey, bankDocumentObjectKey: bankKey, registrationData: merchantRegistration,
        hkSubmissionId: input.region === "HK" ? (merchantRegistration as { submissionId: string }).submissionId : null,
        hkPayloadHash: input.region === "HK" ? (merchantRegistration as { payloadHash: string }).payloadHash : null,
      });

      const lockA = await connect();
      try {
        await lockA.beginTransaction();
        await lockA.execute(`SELECT id FROM ${MANAGER_DB}.merchants WHERE id = ? FOR UPDATE`, [input.merchantId]);
        const racePromise = dbModule!.setMerchantCrmStatus({
          merchantId: input.merchantId, crmStatus: "enabled", portalUserId: String(input.userId), allowedSalesStaffCodes: [oldScope],
          actor: { operatorId: input.merchantId, operatorName: MARKER, operatorRole: "merchant_mgr" },
        });
        const preCommit = await settleOrTimeout(racePromise, 150);
        assert.equal(preCommit.settled, false, "service B must wait behind connection A row lock");
        await lockA.execute(`UPDATE ${MANAGER_DB}.merchants SET salesOwner = ?, salesOwnerCode = ? WHERE id = ?`, ["Closure New Sales", newScope, input.merchantId]);
        await lockA.commit();
        await assert.rejects(racePromise, /MERCHANT_NOT_FOUND/);
      } finally {
        try { await lockA.rollback(); } catch { /* transaction was committed */ }
        await lockA.end();
      }

      const afterRaceMerchant = await one<{ crmStatus: string; crmOwnerPortalUserId: string | null; salesOwnerCode: string }>(preflight,
        `SELECT crmStatus, crmOwnerPortalUserId, salesOwnerCode FROM ${MANAGER_DB}.merchants WHERE id = ?`, [input.merchantId]);
      const afterRaceCompany = await one<{ reviewStatus: string; pendingDraft: string | null }>(preflight,
        `SELECT reviewStatus, pendingDraft FROM ${PLATFORM_DB}.companies WHERE id = ?`, [input.companyId]);
      const auditAfterRace = await count(preflight, `SELECT COUNT(*) FROM ${MANAGER_DB}.audit_logs WHERE targetId = ?`, [String(input.merchantId)]);
      assert.deepEqual(afterRaceMerchant, { crmStatus: "pending", crmOwnerPortalUserId: null, salesOwnerCode: newScope });
      assert.equal(afterRaceCompany.reviewStatus, "approved");
      assert.equal(afterRaceCompany.pendingDraft, null);
      assert.equal(auditAfterRace, 0, "old scope rejection must cause zero service audit writes");

      await assert.rejects(
        dbModule!.setMerchantCrmStatus({ merchantId: input.merchantId, crmStatus: "enabled", portalUserId: String(input.userId), allowedSalesStaffCodes: [] }),
        /MERCHANT_NOT_FOUND/,
      );
      const afterEmptyScope = await one<{ crmStatus: string; crmOwnerPortalUserId: string | null }>(preflight,
        `SELECT crmStatus, crmOwnerPortalUserId FROM ${MANAGER_DB}.merchants WHERE id = ?`, [input.merchantId]);
      const auditAfterEmptyScope = await count(preflight, `SELECT COUNT(*) FROM ${MANAGER_DB}.audit_logs WHERE targetId = ?`, [String(input.merchantId)]);
      assert.deepEqual(afterEmptyScope, { crmStatus: "pending", crmOwnerPortalUserId: null });
      assert.equal(auditAfterEmptyScope, 0);

      const enabled = await dbModule!.setMerchantCrmStatus({
        merchantId: input.merchantId, crmStatus: "enabled", portalUserId: String(input.userId), allowedSalesStaffCodes: [newScope],
        actor: { operatorId: input.merchantId, operatorName: MARKER, operatorRole: "merchant_mgr" },
      });
      assert.equal(enabled.success, true);
      const finalMerchant = await one<{ crmStatus: string; crmOwnerPortalUserId: string }>(preflight,
        `SELECT crmStatus, crmOwnerPortalUserId FROM ${MANAGER_DB}.merchants WHERE id = ?`, [input.merchantId]);
      const finalAuditCount = await count(preflight, `SELECT COUNT(*) FROM ${MANAGER_DB}.audit_logs WHERE targetId = ? AND action = 'merchant.crm.enable'`, [String(input.merchantId)]);
      assert.deepEqual(finalMerchant, { crmStatus: "enabled", crmOwnerPortalUserId: String(input.userId) });
      assert.equal(finalAuditCount, 1);
      return { region: input.region, merchantId: input.merchantId, waitedOnRowLock: true, oldScopeServiceWrites: 0, emptyScopeServiceWrites: 0, finalCrmStatus: finalMerchant.crmStatus, crmEnableAuditRows: finalAuditCount };
    }

    await test("cn_crm_enable_owner_transfer_race_rejects_old_scope_then_correct_scope_enables", async () =>
      crmRaceAndScope({ region: "CN", merchantId: 900401, userId: 900402, enterpriseId: 900403, companyId: 900404, creditOrBrn: cnCredit("CNRACEA") }));

    await test("hk_crm_enable_owner_transfer_race_rejects_old_scope_then_correct_scope_enables", async () =>
      crmRaceAndScope({ region: "HK", merchantId: 900501, userId: 900502, enterpriseId: 900503, companyId: 900504, creditOrBrn: "90000504" }));
  } finally {
    try { await dropActiveTrigger(preflight); } catch (error) { log("trigger cleanup failure", { error: errorMessage(error) }); }
    try { await cleanupFixtures(preflight); } catch (error) { log("fixture cleanup failure", { error: errorMessage(error) }); }
    // db.ts owns this mysql2 pool. It has no application-level close export, but
    // Drizzle exposes the mysql2 client for orderly test-process shutdown.
    try {
      const serviceDb = await dbModule?.getDb();
      const client = (serviceDb as unknown as { $client?: { end?: () => Promise<void> } } | undefined)?.$client;
      if (client?.end) await client.end();
    } catch (error) {
      log("service database pool close failure", { error: errorMessage(error) });
    }
    try { await preflight.end(); } catch (error) { log("preflight connection close failure", { error: errorMessage(error) }); }
    cleanupConnection = null;
  }
  return serverEvidence;
}

let fatal: unknown;
let serverEvidence: JsonRecord | null = null;
try {
  serverEvidence = await main();
} catch (error) {
  fatal = error;
  log("FATAL", { error: errorMessage(error) });
  if (cleanupConnection) {
    try { await dropActiveTrigger(cleanupConnection); } catch { /* best-effort isolated trigger cleanup */ }
    try { await cleanupFixtures(cleanupConnection); } catch { /* preserve primary failure */ }
    try { await cleanupConnection.end(); } catch { /* preserve primary failure */ }
  }
} finally {
  await writeOutputs(serverEvidence, fatal);
}

const failed = results.some(result => result.status === "fail") || fatal;
// Every direct connection and the app-owned mysql2 pool are closed above.
process.exitCode = failed ? 1 : 0;
