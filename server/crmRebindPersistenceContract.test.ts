import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const originalMigration = read("drizzle/0017_crm_owner_rebind_logs.sql");
const syncMigration = read("drizzle/0020_crm_owner_rebind_platform_sync.sql");
const schema = read("drizzle/schema.ts");
const dbSource = read("server/db.ts");
const routerSource = read("server/routers.ts");
const platformApiSource = read("server/platformCrmApi.ts");
const migrationRunner = read("scripts/apply-crm-owner-rebind-sync-schema.mjs");
const deployScript = read("deploy/deploy-admin.sh");

function rebindDatabaseSource() {
  const start = dbSource.indexOf("export async function rebindMerchantCrmOwner");
  const end = dbSource.indexOf("export async function getCrmThreadByMerchant", start);
  return dbSource.slice(start, end > start ? end : undefined);
}

describe("后台 CRM 专用换绑持久化、审计与平台确认合同", () => {
  it("0017 只新增原始换绑账本，不执行破坏性 DDL", () => {
    expect(originalMigration).toContain("CREATE TABLE `crm_owner_rebind_logs`");
    expect(originalMigration).toContain("UNIQUE(`requestId`)");
    expect(originalMigration).toContain("CREATE INDEX `crm_owner_rebind_logs_merchant_idx`");
    expect(originalMigration).not.toMatch(/ALTER TABLE/i);
    expect(originalMigration).not.toMatch(/DROP\s+(TABLE|COLUMN|INDEX)/i);
    expect(originalMigration).not.toMatch(/RENAME\s+(TABLE|COLUMN)/i);
  });

  it("0020 只增加平台确认所需的可重试状态，不修改商户绑定", () => {
    expect(syncMigration).toContain("ADD COLUMN `creditCode`");
    expect(syncMigration).toContain("ADD COLUMN `platformSyncStatus`");
    expect(syncMigration).toContain("'pending','completed','retryable'");
    expect(syncMigration).toContain("platformSyncError");
    expect(syncMigration).toContain("platformSyncAttemptCount");
    expect(syncMigration).toContain("platformSyncedAt");
    expect(syncMigration).not.toMatch(/DROP|RENAME|UPDATE\s+merchants/i);
  });

  it("生产发布在切换软链前执行并校验幂等负责人同步迁移", () => {
    expect(migrationRunner).toContain("GET_LOCK");
    expect(migrationRunner).toContain("information_schema.COLUMNS");
    expect(migrationRunner).toContain("platformSyncStatus");
    expect(migrationRunner).not.toMatch(/DROP|RENAME/i);
    const migrationStep = deployScript.indexOf("apply-crm-owner-rebind-sync-schema.mjs");
    const linkSwitch = deployScript.indexOf("原子切换软链");
    expect(migrationStep).toBeGreaterThanOrEqual(0);
    expect(linkSwitch).toBeGreaterThan(migrationStep);
  });

  it("Schema 保留原有审计字段并扩展平台同步字段", () => {
    expect(schema).toContain('mysqlTable("crm_owner_rebind_logs"');
    expect(schema).toContain('requestId: varchar("requestId", { length: 128 }).notNull().unique()');
    expect(schema).toContain('expectedOwnerPortalUserId: varchar("expectedOwnerPortalUserId"');
    expect(schema).toContain('nextOwnerPortalUserId: varchar("nextOwnerPortalUserId"');
    expect(schema).toContain('reason: text("reason").notNull()');
    expect(schema).toContain('operatorRole: varchar("operatorRole"');
    expect(schema).toContain('creditCode: varchar("creditCode", { length: 64 })');
    expect(schema).toContain('platformSyncStatus: mysqlEnum("platformSyncStatus", ["pending", "completed", "retryable"])');
    expect(schema).toContain('platformSyncError: varchar("platformSyncError", { length: 1000 })');
    expect(schema).toContain('platformSyncAttemptCount: int("platformSyncAttemptCount")');
    expect(schema).toContain('platformSyncedAt: timestamp("platformSyncedAt")');
  });

  it("换绑事务先做 requestId 幂等判定，再锁商户并以 expected-owner + 状态执行 CAS", () => {
    const source = rebindDatabaseSource();
    const idempotencyLookup = source.indexOf("crmOwnerRebindLogs.requestId");
    const rowLock = source.indexOf('.for("update")');
    const expectedOwnerCas = source.indexOf("eq(merchants.crmOwnerPortalUserId, expectedOwner)");
    expect(idempotencyLookup).toBeGreaterThanOrEqual(0);
    expect(rowLock).toBeGreaterThan(idempotencyLookup);
    expect(expectedOwnerCas).toBeGreaterThan(rowLock);
    expect(source).toContain("affectedRows !== 1");
  });

  it("换绑账本与通用不可变审计在同一事务写入且保存 before/after owner", () => {
    const source = rebindDatabaseSource();
    const ledgerInsert = source.indexOf("tx.insert(crmOwnerRebindLogs)");
    const auditInsert = source.indexOf("tx.insert(auditLogs)");
    expect(ledgerInsert).toBeGreaterThanOrEqual(0);
    expect(auditInsert).toBeGreaterThan(ledgerInsert);
    expect(source).toContain('action: "merchant.crm.rebind"');
    expect(source).toContain("crmOwnerPortalUserId: oldOwner");
    expect(source).toContain("crmOwnerPortalUserId: newOwner");
    expect(source).toContain('platformSyncStatus: "pending"');
  });

  it("本地账本可独立标记平台确认完成或失败可重试", () => {
    expect(dbSource).toContain("export async function completeCrmOwnerRebindPlatformSync");
    expect(dbSource).toContain("export async function markCrmOwnerRebindPlatformSyncRetryable");
    expect(dbSource).toContain('platformSyncStatus: "completed"');
    expect(dbSource).toContain('platformSyncStatus: "retryable"');
  });

  it("新请求先做前台成员预检，再本地落账，最后调用平台原子确认", () => {
    const start = routerSource.indexOf("rebindCrmOwner: crmRebindProcedure");
    const end = routerSource.indexOf("retryCrmOwnerRebind:", start);
    const source = routerSource.slice(start, end);
    const preflight = source.indexOf("validatePlatformCrmRebindTarget");
    const rebind = source.indexOf("db.rebindMerchantCrmOwner");
    const complete = source.indexOf("confirmPlatformCrmOwnerRebind");
    expect(preflight).toBeGreaterThanOrEqual(0);
    expect(rebind).toBeGreaterThan(preflight);
    expect(complete).toBeGreaterThan(rebind);
    expect(source).toContain("merchant.businessLicense.trim()");
    expect(routerSource).toContain("markCrmOwnerRebindPlatformSyncRetryable");
    expect(routerSource).toContain("retryCrmOwnerRebind: crmRebindProcedure");
  });

  it("平台客户端使用同一 requestId 调用受保护的 completeRebind mutation", () => {
    expect(platformApiSource).toContain("internalCrm.completeRebind");
    expect(platformApiSource).toContain('"x-portal-key": key');
    expect(platformApiSource).toContain("requestId: string");
    expect(platformApiSource).toContain('method: "POST"');
  });
});
