import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Load the real db.ts while faking both its Drizzle handle and advisory-lock
 * carrier. This suite never opens a socket or reads a real DATABASE_URL.
 */
const mocked = vi.hoisted(() => ({ drizzle: vi.fn(), createConnection: vi.fn() }));
vi.mock("drizzle-orm/mysql2", () => ({ drizzle: mocked.drizzle }));
vi.mock("mysql2/promise", () => ({ default: { createConnection: mocked.createConnection } }));

const dialect = new MySqlDialect();
const CREDIT = "91310000MA1K3ABCDE";
type Plan = {
  selectResults: any[][];
  executeResults: any[];
  updateResults: unknown[];
  auditError?: Error;
  updates: Array<Record<string, unknown>>;
  audits: Array<Record<string, unknown>>;
  operations: string[];
  rendered: Array<{ sql: string; params: unknown[] }>;
};
let plan: Plan;
let dbModule: typeof import("./db");

function render(statement: unknown) {
  const query = dialect.sqlToQuery(statement as SQL);
  return { sql: query.sql.replace(/\s+/g, " ").trim(), params: [...query.params] };
}

function queryRows() {
  const query: any = {};
  query.from = () => query;
  query.where = () => query;
  query.limit = () => query;
  query.for = () => query;
  query.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(plan.selectResults.shift() ?? []).then(resolve, reject);
  return query;
}

function transaction() {
  return {
    select: vi.fn(queryRows),
    execute: vi.fn(async (statement: unknown) => {
      plan.rendered.push(render(statement));
      return plan.executeResults.shift() ?? [[], undefined];
    }),
    update: vi.fn(() => ({
      set: (values: Record<string, unknown>) => {
        plan.updates.push(values);
        return {
          where: async () => {
            plan.operations.push("update");
            return plan.updateResults.shift() ?? [{ affectedRows: 1 }];
          },
        };
      },
    })),
    insert: vi.fn(() => ({
      values: async (values: Record<string, unknown>) => {
        plan.audits.push(values);
        plan.operations.push("audit");
        if (plan.auditError) throw plan.auditError;
        return [{ insertId: 1 }];
      },
    })),
  };
}

const database = {
  transaction: async <T>(callback: (tx: ReturnType<typeof transaction>) => Promise<T>) => callback(transaction()),
};

function install(overrides: Partial<Pick<Plan, "selectResults" | "executeResults" | "updateResults" | "auditError">> = {}) {
  plan = {
    selectResults: overrides.selectResults ?? [],
    executeResults: overrides.executeResults ?? [],
    updateResults: overrides.updateResults ?? [],
    auditError: overrides.auditError,
    updates: [],
    audits: [],
    operations: [],
    rendered: [],
  };
  mocked.drizzle.mockReturnValue(database);
  mocked.createConnection.mockResolvedValue({
    query: async (statement: string) => statement.includes("GET_LOCK")
      ? [[{ acquired: 1 }], undefined]
      : [[{ released: 1 }], undefined],
    end: async () => undefined,
  });
  return plan;
}

function merchant(overrides: Record<string, unknown> = {}) {
  return {
    id: 511,
    merchantNo: "M00511",
    registrationRegion: "CN",
    registrationIdentifier: null,
    businessLicense: CREDIT,
    status: "approved",
    crmStatus: "pending",
    crmOwnerPortalUserId: "7001",
    crmEnabledAt: null,
    crmNote: null,
    licenseObjectKey: "licenses/user-7001-license.pdf",
    licenseImageUrl: null,
    companyName: "测试企业",
    registrationData: null,
    registrationPendingData: null,
    salesOwnerCode: "sales-a",
    ...overrides,
  };
}

function company(overrides: Record<string, unknown> = {}) {
  return {
    superAdminUserId: "7001",
    dataOwnerUserId: "7001",
    companyUserId: "7001",
    reviewStatus: "approved",
    pendingDraft: null,
    ...overrides,
  };
}

function expectNoLocalOrAuditWrite(active: Plan) {
  expect(active.updates).toEqual([]);
  expect(active.audits).toEqual([]);
}

beforeAll(async () => {
  process.env.DATABASE_URL = "mysql://unit:unit@127.0.0.1:3306/unit_cn_guard";
  process.env.PLATFORM_DB_NAME = "unit_platform";
  dbModule = await import("./db");
});

afterAll(() => {
  delete process.env.DATABASE_URL;
  delete process.env.PLATFORM_DB_NAME;
});

beforeEach(() => {
  vi.clearAllMocks();
  install();
});

describe("CN generic review and ERP guards — real db.ts with offline transaction", () => {
  it.each([
    ["initial", "pending", null, "approve"],
    ["initial", "pending", null, "supplement"],
    ["initial", "pending", null, "suspend"],
    ["initial", "pending", null, "reactivate"],
    ["resubmission", "approved", JSON.stringify({ revision: 1 }), "approve"],
    ["resubmission", "approved", JSON.stringify({ revision: 1 }), "supplement"],
    ["resubmission", "approved", JSON.stringify({ revision: 1 }), "suspend"],
    ["resubmission", "approved", JSON.stringify({ revision: 1 }), "reactivate"],
  ])("M-06：%s CN 待审时 generic %s 不能改变本地状态", async (_kind, localStatus, pendingDraft, action) => {
    const active = install({
      selectResults: [[merchant({ status: localStatus })]],
      executeResults: [[[{ id: 61, pendingDraft }], undefined]],
    });
    await expect(dbModule.reviewMerchantStatus({
      merchantId: 511,
      status: action === "approve" || action === "reactivate" ? "approved" : action === "suspend" ? "suspended" : "supplement",
      allowedSalesStaffCodes: ["sales-a"],
    })).rejects.toThrow("CN_REGISTRATION_REVIEW_PENDING");
    expectNoLocalOrAuditWrite(active);
    expect(active.rendered[0]?.sql).toContain("company.reviewStatus = 'pending'");
  });

  it("M-06：锁内范围复核会阻断 owner 已转移的 generic 审核，且不查询平台", async () => {
    const active = install({ selectResults: [[merchant({ salesOwnerCode: "sales-b" })]] });
    await expect(dbModule.reviewMerchantStatus({
      merchantId: 511,
      status: "approved",
      allowedSalesStaffCodes: ["sales-a"],
    })).rejects.toThrow("MERCHANT_NOT_FOUND");
    expect(active.rendered).toEqual([]);
    expectNoLocalOrAuditWrite(active);
  });

  it.each([
    ["owner 已转移", merchant({ salesOwnerCode: "sales-b" }), ["sales-a"]],
    ["普通账号无销售范围", merchant(), []],
  ])("B-01：CN ERP enable 在锁内因%s被拒绝，平台/本地/审计均零写入", async (_label, lockedMerchant, allowedSalesStaffCodes) => {
    const active = install({ selectResults: [[lockedMerchant]] });
    await expect(dbModule.setMerchantCrmStatus({
      merchantId: 511,
      crmStatus: "enabled",
      portalUserId: "7001",
      allowedSalesStaffCodes,
    })).rejects.toThrow("MERCHANT_NOT_FOUND");
    expect(active.rendered).toEqual([]);
    expectNoLocalOrAuditWrite(active);
  });

  it.each([
    ["initial", merchant({ status: "pending" }), company({ reviewStatus: "pending", pendingDraft: null })],
    ["resubmission", merchant({ status: "approved" }), company({ reviewStatus: "pending", pendingDraft: JSON.stringify({ revision: 1 }) })],
  ])("M-07：%s 待审 CN 不能启用 ERP，CRM/local/audit 均零写入", async (_kind, localMerchant, platformCompany) => {
    const active = install({
      selectResults: [[localMerchant]],
      executeResults: [[[platformCompany], undefined]],
    });
    await expect(dbModule.setMerchantCrmStatus({
      merchantId: 511,
      crmStatus: "enabled",
      portalUserId: "7001",
    })).rejects.toThrow("CN_PLATFORM_REVIEW_OR_OWNER_INVALID");
    expectNoLocalOrAuditWrite(active);
  });

  it("M-07：仅已审批、无 pendingDraft、匹配当前 owner 的 CN 企业可沿用既有 ERP enable 事务", async () => {
    const target = merchant({ crmStatus: "pending", status: "approved" });
    const active = install({
      selectResults: [[target], [], [{ ...target, crmStatus: "enabled" }]],
      executeResults: [[[company()], undefined]],
    });
    await expect(dbModule.setMerchantCrmStatus({
      merchantId: 511,
      crmStatus: "enabled",
      portalUserId: "7001",
      actor: { operatorId: 9, operatorName: "reviewer", operatorRole: "super_admin" },
      allowedSalesStaffCodes: ["sales-a"],
    })).resolves.toMatchObject({ success: true, crmOwnerPortalUserId: "7001" });
    expect(active.updates).toHaveLength(1);
    expect(active.audits).toHaveLength(1);
    expect(active.rendered[0]?.sql).toContain("company.reviewStatus");
  });

  it("B-01：超级管理员以 undefined 范围在锁内保留跨负责人 ERP enable 权限", async () => {
    const target = merchant({ salesOwnerCode: "sales-b", crmStatus: "pending", status: "approved" });
    const active = install({
      selectResults: [[target], [], [{ ...target, crmStatus: "enabled" }]],
      executeResults: [[[company()], undefined]],
    });
    await expect(dbModule.setMerchantCrmStatus({
      merchantId: 511,
      crmStatus: "enabled",
      portalUserId: "7001",
      allowedSalesStaffCodes: undefined,
    })).resolves.toMatchObject({ success: true, crmOwnerPortalUserId: "7001" });
    expect(active.updates).toHaveLength(1);
    expect(active.audits).toHaveLength(1);
  });

  it("M-07：disabled 保持既有状态语义，不新增跨库审核前置条件", async () => {
    const target = merchant({ crmStatus: "enabled", status: "pending" });
    const active = install({ selectResults: [[target], [{ ...target, crmStatus: "disabled" }]] });
    await expect(dbModule.setMerchantCrmStatus({ merchantId: 511, crmStatus: "disabled", note: "运营暂停" }))
      .resolves.toMatchObject({ success: true, crmOwnerPortalUserId: "7001" });
    expect(active.rendered).toEqual([]);
    expect(active.updates).toHaveLength(1);
  });

  it.each([
    ["无待审平台记录的 CN", merchant({ status: "approved" }), [[[], undefined]]],
    ["非 CN", merchant({ registrationRegion: "HK", businessLicense: null, status: "pending" }), []],
  ])("B-03：%s 的保留通用审核以同一事务更新并留下最小状态审计", async (_label, lockedMerchant, executeResults) => {
    const active = install({
      selectResults: [[lockedMerchant]],
      executeResults,
    });
    await expect(dbModule.reviewMerchantStatus({
      merchantId: 511,
      status: "approved",
      reviewNote: "审核完成",
      allowedSalesStaffCodes: ["sales-a"],
      actor: { operatorId: 9, operatorName: "reviewer", operatorRole: "merchant_mgr", ipAddress: "127.0.0.1" },
    })).resolves.toBeUndefined();
    expect(active.operations).toEqual(["update", "audit"]);
    expect(active.updates).toHaveLength(1);
    expect(active.audits).toHaveLength(1);
    expect(active.audits[0]).toMatchObject({
      operatorId: 9,
      operatorName: "reviewer",
      operatorRole: "merchant_mgr",
      action: "merchant.review.approved",
      targetId: "511",
      beforeValue: { merchantId: 511, status: lockedMerchant.status },
      afterValue: { merchantId: 511, status: "approved" },
    });
    expect(JSON.stringify(active.audits[0])).not.toContain("registrationData");
  });

  it("B-03：条件状态更新零行时抛冲突且不插入审计", async () => {
    const active = install({
      selectResults: [[merchant({ status: "pending" })]],
      executeResults: [[[], undefined]],
      updateResults: [[{ affectedRows: 0 }]],
    });
    await expect(dbModule.reviewMerchantStatus({
      merchantId: 511,
      status: "approved",
      allowedSalesStaffCodes: ["sales-a"],
      actor: { operatorId: 9 },
    })).rejects.toThrow("MERCHANT_STATUS_CONFLICT");
    expect(active.operations).toEqual(["update"]);
    expect(active.audits).toEqual([]);
  });

  it("B-03：同一事务中的审计写失败会使通用审核失败", async () => {
    const active = install({
      selectResults: [[merchant({ registrationRegion: "HK", businessLicense: null, status: "pending" })]],
      auditError: new Error("AUDIT_WRITE_FAILED"),
    });
    await expect(dbModule.reviewMerchantStatus({
      merchantId: 511,
      status: "approved",
      allowedSalesStaffCodes: ["sales-a"],
      actor: { operatorId: 9 },
    })).rejects.toThrow("AUDIT_WRITE_FAILED");
    expect(active.operations).toEqual(["update", "audit"]);
    expect(active.audits).toHaveLength(1);
  });
});
