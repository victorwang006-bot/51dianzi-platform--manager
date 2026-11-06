import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Both the Drizzle handle and advisory carrier are synthetic: no sockets or production credentials.
const mocked = vi.hoisted(() => ({ drizzle: vi.fn(), createConnection: vi.fn() }));
vi.mock("drizzle-orm/mysql2", () => ({ drizzle: mocked.drizzle }));
vi.mock("mysql2/promise", () => ({ default: { createConnection: mocked.createConnection } }));
const dialect = new MySqlDialect();
const CREDIT = "91310000MA1K3ABCDE";
const VERSION = "a".repeat(64);
const OWNER = "7001";
const UUID = "12345678-1234-4abc-8abc-1234567890ab";
let service: typeof import("./cnRegistrationReview");
let state: { merchant: any; company: any; audits: any[]; duplicates: any[] };
let operations: string[];
let statements: string[];
let fail: "crm-update" | "crm-audit" | "review-audit" | null;

function reset() {
  state = {
    merchant: {
      id: 511, merchantNo: "SYNTHETIC-511", registrationRegion: "CN", businessLicense: CREDIT,
      status: "pending", crmStatus: "pending", crmOwnerPortalUserId: OWNER, crmEnabledAt: null, crmNote: null,
      salesOwnerCode: "sales-a", companyName: "合成企业", registrationData: null, registrationPendingData: null,
      licenseObjectKey: null, licenseImageUrl: null,
    },
    company: {
      companyId: 61, enterpriseId: 71, companyRegistrationRegion: "CN", enterpriseRegistrationRegion: "CN", enterpriseCreditCode: CREDIT,
      companyName: "合成企业", creditCode: CREDIT, companyType: "有限责任公司", legalPerson: "合成人",
      companyRole: "supplier", bankAccountName: "合成企业", bankAccountNumber: "6222020202020000", bankName: "合成银行",
      regAddress: "合成地址", establishedAt: "2019-01-01", salesOwner: "合成销售", salesOwnerCode: "sales-a",
      licenseUrl: null, licenseObjectKey: `licenses/user-${OWNER}-1795000000000-${UUID}_1a2b3c4d.pdf`, licenseFileName: "合成执照.pdf",
      bankLicenseUrl: null, bankLicenseObjectKey: `bank-licenses/user-${OWNER}-1795000000001-${UUID}_5e6f7a8b.png`, bankLicenseFileName: "合成银行.png",
      pendingDraft: null, pendingDraftJsonValid: null, reviewStatus: "pending", certLevel: "pending", rejectReason: null,
      reviewedAt: null, submittedAt: "2026-10-28T08:00:00.000Z", expectedVersion: VERSION,
      superAdminUserId: OWNER, dataOwnerUserId: OWNER, companyUserId: OWNER,
      memberStatus: "active", memberRole: "super_admin", ownerLoginDisabled: 0,
    }, audits: [], duplicates: [],
  };
  operations = []; statements = []; fail = null;
}
function rows(fields?: unknown) {
  const chain: any = {};
  for (const name of ["from", "where", "limit", "for"]) chain[name] = () => chain;
  chain.then = (resolve: any, reject: any) => Promise.resolve(fields
    ? [structuredClone(state.merchant), ...structuredClone(state.duplicates)]
    : [structuredClone(state.merchant)]).then(resolve, reject);
  return chain;
}
function tx() {
  return {
    select: rows,
    execute: async (statement: unknown) => {
      const query = dialect.sqlToQuery(statement as SQL);
      const sql = query.sql.replace(/\s+/g, " ").trim();
      statements.push(sql);
      if (/^SELECT company.id AS companyId/.test(sql) || /^SELECT CAST\(enterprise.superAdminUserId/.test(sql)) return [[structuredClone(state.company)], undefined];
      if (/^SELECT JSON_UNQUOTE/.test(sql)) return [[...state.audits].reverse().filter(a => a.action === "merchant.cn-registration.review").slice(0, 3).map(a => ({
        expectedVersion: a.afterValue.expectedVersion, decision: a.afterValue.decision,
        erpGranted: a.afterValue.erpGranted === true ? "true" : null, crmOwnerPortalUserId: a.afterValue.crmOwnerPortalUserId ?? null,
      })), undefined];
      if (/^UPDATE .*\.companies/.test(sql)) {
        operations.push("company-review");
        state.company.reviewStatus = "approved"; state.company.pendingDraft = null; state.company.certLevel = "certified";
        return [{ affectedRows: 1 }, undefined];
      }
      if (/^UPDATE .*\.enterprises/.test(sql)) { operations.push("enterprise-sync"); return [{ affectedRows: 0 }, undefined]; }
      throw new Error(`UNEXPECTED_SYNTHETIC_SQL: ${sql}`);
    },
    update: () => ({ set: (values: any) => ({ where: async () => {
      operations.push(values.crmStatus ? "crm-update" : "merchant-review");
      if (values.crmStatus && fail === "crm-update") return [{ affectedRows: 0 }];
      Object.assign(state.merchant, values); return [{ affectedRows: 1 }];
    } }) }),
    insert: () => ({ values: async (values: any) => {
      const action = values.action.startsWith("merchant.crm.") ? "crm-audit" : "review-audit";
      operations.push(action);
      if (fail === action) throw new Error("SYNTHETIC_AUDIT_FAILURE");
      state.audits.push(structuredClone(values)); return [{ insertId: state.audits.length }];
    } }),
  };
}
const database = {
  transaction: async (callback: (handle: any) => Promise<unknown>) => {
    const snapshot = structuredClone(state);
    operations.push("BEGIN");
    try { const result = await callback(tx()); operations.push("COMMIT"); return result; }
    catch (error) { state = snapshot; operations.push("ROLLBACK"); throw error; }
  },
};
const input = (overrides: any = {}) => ({
  merchantId: 511, expectedVersion: VERSION, confirmed: true, portalUserId: OWNER,
  allowedSalesStaffCodes: ["sales-a"], actor: { operatorId: 9, operatorName: "合成审核员", operatorRole: "merchant_mgr" }, ...overrides,
});
beforeAll(async () => {
  // This URI is passed only into mocked constructors; network blocking is also enabled by the runner.
  process.env.DATABASE_URL = "mysql://synthetic:synthetic@127.0.0.1:1/unit_cn_one_click";
  process.env.PLATFORM_DB_NAME = "unit_cn_one_click_platform";
  mocked.drizzle.mockReturnValue(database);
  mocked.createConnection.mockImplementation(async () => ({
    query: async (sql: string) => { operations.push(sql.includes("GET_LOCK") ? "GET_LOCK" : "RELEASE_LOCK"); return [[{ acquired: 1, released: 1 }], undefined]; },
    end: async () => { operations.push("CARRIER_END"); },
  }));
  service = await import("./cnRegistrationReview");
});
afterAll(() => { delete process.env.DATABASE_URL; delete process.env.PLATFORM_DB_NAME; });
beforeEach(reset);

describe("CN one-click review + real ERP grant in a rollback-capable synthetic transaction", () => {
  it("initial pending with no draft commits platform approval, local approval, ERP and both existing audits once", async () => {
    await expect(service.approveCnRegistrationAndEnableCrm(input())).resolves.toMatchObject({ success: true, idempotent: false });
    expect(state.company.reviewStatus).toBe("approved");
    expect(state.merchant).toMatchObject({ status: "approved", crmStatus: "enabled", crmOwnerPortalUserId: OWNER, salesOwnerCode: "sales-a" });
    expect(state.audits.map(a => a.action)).toEqual(["merchant.crm.enable", "merchant.cn-registration.review"]);
    expect(state.audits[1].afterValue).toMatchObject({ erpGranted: true, expectedVersion: VERSION, manualConfirmation: true });
    expect(operations).toEqual(["GET_LOCK", "BEGIN", "company-review", "enterprise-sync", "merchant-review", "crm-update", "crm-audit", "review-audit", "COMMIT", "RELEASE_LOCK", "CARRIER_END"]);
    expect(statements.some(sql => sql.includes("company.reviewStatus") && sql.includes("FOR UPDATE"))).toBe(true);
  });
  it("grant business success:false (duplicate) throws and rolls back every review write", async () => {
    state.duplicates = [{ ...state.merchant, id: 999, crmStatus: "enabled" }];
    const before = structuredClone(state);
    await expect(service.approveCnRegistrationAndEnableCrm(input())).rejects.toThrow("CRM_DUPLICATE_OPENING");
    expect(state).toEqual(before); expect(operations).toContain("merchant-review"); expect(operations).toContain("ROLLBACK"); expect(operations).not.toContain("COMMIT");
    expect(operations.slice(-3)).toEqual(["ROLLBACK", "RELEASE_LOCK", "CARRIER_END"]);
  });
  it.each(["crm-update", "crm-audit", "review-audit"] as const)("%s failure rolls back both approvals, ERP and both audits", async failure => {
    fail = failure; const before = structuredClone(state);
    await expect(service.approveCnRegistrationAndEnableCrm(input())).rejects.toThrow();
    expect(state).toEqual(before); expect(operations).toContain("ROLLBACK"); expect(operations).not.toContain("COMMIT");
  });
  it("stale expectedVersion causes zero review/grant writes", async () => {
    await expect(service.approveCnRegistrationAndEnableCrm(input({ expectedVersion: "b".repeat(64) }))).rejects.toThrow("CN_REVIEW_VERSION_CHANGED");
    expect(operations).not.toContain("company-review"); expect(state.audits).toEqual([]);
  });
  it.each(["superAdminUserId", "dataOwnerUserId", "companyUserId"])("platform %s mismatch cannot approve or change ownership", async field => {
    state.company[field] = "7002"; const before = structuredClone(state);
    await expect(service.approveCnRegistrationAndEnableCrm(input())).rejects.toThrow();
    expect(state).toEqual(before); expect(operations).not.toContain("company-review");
  });
  it("requested owner cannot rebind and failure after review still rolls it back", async () => {
    const before = structuredClone(state);
    await expect(service.approveCnRegistrationAndEnableCrm(input({ portalUserId: "7002" }))).rejects.toThrow("不能通过开通操作直接换绑");
    expect(state).toEqual(before); expect(operations).toContain("merchant-review");
  });
  it("unbound merchant accepts only the explicitly supplied formally matched platform owner", async () => {
    state.merchant.crmOwnerPortalUserId = null;
    await expect(service.approveCnRegistrationAndEnableCrm(input())).resolves.toMatchObject({ success: true });
    expect(state.merchant.crmOwnerPortalUserId).toBe(OWNER);
  });
  it("unbound mismatched applicant rolls back promotion instead of guessing a platform owner", async () => {
    state.merchant.crmOwnerPortalUserId = null; const before = structuredClone(state);
    await expect(service.approveCnRegistrationAndEnableCrm(input({ portalUserId: "7002" }))).rejects.toThrow("CN_PLATFORM_REVIEW_OR_OWNER_INVALID");
    expect(state).toEqual(before);
  });
  it.each([{ codes: [] }, { codes: ["sales-b"] }])("formal owner scope $codes cannot write", async ({ codes }) => {
    await expect(service.approveCnRegistrationAndEnableCrm(input({ allowedSalesStaffCodes: codes }))).rejects.toThrow("MERCHANT_NOT_FOUND");
    expect(statements).toEqual([]); expect(state.audits).toEqual([]);
  });
  it("an absent human confirmation cannot write", async () => {
    await expect(service.approveCnRegistrationAndEnableCrm(input({ confirmed: false }))).rejects.toThrow("CN_REVIEW_CONFIRMATION_REQUIRED");
    expect(statements).toEqual([]); expect(state.merchant.crmStatus).toBe("pending");
  });
  it("HK is not expanded to the CN joint approval path", async () => {
    state.merchant.registrationRegion = "HK";
    await expect(service.approveCnRegistrationAndEnableCrm(input())).rejects.toThrow("CN_REGISTRATION_REQUIRED");
    expect(statements).toEqual([]);
  });
  it("same completed version replays idempotently without another grant or audit", async () => {
    await service.approveCnRegistrationAndEnableCrm(input()); const before = structuredClone(state); operations = [];
    await expect(service.approveCnRegistrationAndEnableCrm(input())).resolves.toMatchObject({ success: true, idempotent: true });
    expect(state).toEqual(before); expect(operations).toEqual(["GET_LOCK", "BEGIN", "COMMIT", "RELEASE_LOCK", "CARRIER_END"]);
  });
  it("old joint request never resumes a subsequently paused ERP", async () => {
    await service.approveCnRegistrationAndEnableCrm(input()); state.merchant.crmStatus = "disabled"; const before = structuredClone(state);
    await expect(service.approveCnRegistrationAndEnableCrm(input())).rejects.toThrow("CN_REVIEW_COMPLETION_CHANGED"); expect(state).toEqual(before);
  });
  it("an independently approved version is not falsely reported as completed review plus grant", async () => {
    await service.reviewCnRegistrationDraft({ ...input(), decision: "approved" }); const before = structuredClone(state);
    await expect(service.approveCnRegistrationAndEnableCrm(input())).rejects.toThrow("CN_REVIEW_COMPLETION_CHANGED"); expect(state).toEqual(before);
  });
});
