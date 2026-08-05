import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../drizzle/0017_crm_owner_rebind_logs.sql", import.meta.url),
  "utf8",
);
const schema = readFileSync(new URL("../drizzle/schema.ts", import.meta.url), "utf8");
const dbSource = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
const routerSource = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");

describe("后台 CRM 专用换绑持久化与审计契约", () => {
  it("0017 只新增换绑账本及索引，不重复历史字段或执行破坏性 DDL", () => {
    expect(migration).toContain("CREATE TABLE `crm_owner_rebind_logs`");
    expect(migration).toContain("UNIQUE(`requestId`)");
    expect(migration).toContain("CREATE INDEX `crm_owner_rebind_logs_merchant_idx`");
    expect(migration).not.toMatch(/ALTER TABLE/i);
    expect(migration).not.toMatch(/DROP\s+(TABLE|COLUMN|INDEX)/i);
    expect(migration).not.toMatch(/RENAME\s+(TABLE|COLUMN)/i);
  });

  it("Schema 固化唯一 requestId、expected owner、新 owner、原因和操作者字段", () => {
    expect(schema).toContain('mysqlTable("crm_owner_rebind_logs"');
    expect(schema).toContain('requestId: varchar("requestId", { length: 128 }).notNull().unique()');
    expect(schema).toContain('expectedOwnerPortalUserId: varchar("expectedOwnerPortalUserId"');
    expect(schema).toContain('nextOwnerPortalUserId: varchar("nextOwnerPortalUserId"');
    expect(schema).toContain('reason: text("reason").notNull()');
    expect(schema).toContain('operatorRole: varchar("operatorRole"');
  });

  it("换绑事务先做 requestId 幂等判定，再锁商户并以 expected-owner + 状态执行 CAS", () => {
    const start = dbSource.indexOf("export async function rebindMerchantCrmOwner");
    const end = dbSource.indexOf("export async function getCrmThreadByMerchant", start);
    const source = dbSource.slice(start, end > start ? end : undefined);
    const idempotencyLookup = source.indexOf("crmOwnerRebindLogs.requestId");
    const rowLock = source.indexOf('.for("update")');
    const expectedOwnerCas = source.indexOf("eq(merchants.crmOwnerPortalUserId, expectedOwner)");
    expect(idempotencyLookup).toBeGreaterThanOrEqual(0);
    expect(rowLock).toBeGreaterThan(idempotencyLookup);
    expect(expectedOwnerCas).toBeGreaterThan(rowLock);
    expect(source).toContain("affectedRows !== 1");
  });

  it("换绑账本与通用不可变审计在同一事务写入且保存 before/after owner", () => {
    const start = dbSource.indexOf("export async function rebindMerchantCrmOwner");
    const source = dbSource.slice(start, dbSource.indexOf("export async function getCrmThreadByMerchant", start));
    const ledgerInsert = source.indexOf("tx.insert(crmOwnerRebindLogs)");
    const auditInsert = source.indexOf("tx.insert(auditLogs)");
    expect(ledgerInsert).toBeGreaterThanOrEqual(0);
    expect(auditInsert).toBeGreaterThan(ledgerInsert);
    expect(source).toContain('action: "merchant.crm.rebind"');
    expect(source).toContain("crmOwnerPortalUserId: oldOwner");
    expect(source).toContain("crmOwnerPortalUserId: newOwner");
  });

  it("路由在数据库换绑前调用前台企业成员预检，失败不会绕过", () => {
    const start = routerSource.indexOf("rebindCrmOwner: crmRebindProcedure");
    const end = routerSource.indexOf("sendMessage:", start);
    const source = routerSource.slice(start, end);
    const preflight = source.indexOf("validatePlatformCrmRebindTarget");
    const rebind = source.indexOf("db.rebindMerchantCrmOwner");
    expect(preflight).toBeGreaterThanOrEqual(0);
    expect(rebind).toBeGreaterThan(preflight);
    expect(source).toContain("merchant.businessLicense.trim()");
  });
});
