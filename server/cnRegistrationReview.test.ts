import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ database: null as any }));
vi.mock("./db", () => ({ getDb: () => state.database }));

import {
  getCnRegistrationReviewDetail,
  reviewCnRegistrationDraft,
} from "./cnRegistrationReview";

const dialect = new MySqlDialect();
const CREDIT = "91310000MA1K3ABCDE";
const VERSION = "a".repeat(64);
const PRODUCER_UUID = "12345678-1234-4abc-8abc-1234567890ab";
const LICENSE_KEY = `licenses/user-7001-1795000000000-${PRODUCER_UUID}_1a2b3c4d.pdf`;
const BANK_LICENSE_KEY = `bank-licenses/user-7001-1795000000001-${PRODUCER_UUID}_5e6f7a8b.png`;

type Plan = {
  selectResults: any[][];
  executeResults: any[];
  updateResults: any[];
  rendered: Array<{ sql: string; params: unknown[] }>;
  merchantSets: Array<Record<string, unknown>>;
  audits: Array<Record<string, unknown>>;
};

let plan: Plan;

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
        plan.merchantSets.push(values);
        return { where: async () => plan.updateResults.shift() ?? [{ affectedRows: 1 }] };
      },
    })),
    insert: vi.fn(() => ({ values: async (values: Record<string, unknown>) => { plan.audits.push(values); return [{ insertId: 1 }]; } })),
  };
}

function install(overrides: Partial<Pick<Plan, "selectResults" | "executeResults" | "updateResults">> = {}) {
  plan = {
    selectResults: overrides.selectResults ?? [],
    executeResults: overrides.executeResults ?? [],
    updateResults: overrides.updateResults ?? [],
    rendered: [], merchantSets: [], audits: [],
  };
  state.database = {
    select: vi.fn(queryRows),
    execute: vi.fn(async (statement: unknown) => {
      plan.rendered.push(render(statement));
      return plan.executeResults.shift() ?? [[], undefined];
    }),
    transaction: async (callback: (tx: any) => Promise<unknown>) => callback(transaction()),
  };
  return plan;
}

function merchant(overrides: Record<string, unknown> = {}) {
  return {
    id: 511, registrationRegion: "CN", businessLicense: CREDIT, status: "approved", crmStatus: "enabled",
    crmOwnerPortalUserId: "7001", salesOwner: "本地销售", salesOwnerCode: "sales-a", companyName: "有效企业", ...overrides,
  };
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
    companyName: "变更后的企业", creditCode: CREDIT, companyType: "有限责任公司", legalPerson: "李四", companyRole: "supplier",
    bankAccountName: "变更后的企业", bankAccountNumber: "6222020202021234", bankName: "示例银行", regAddress: "上海市浦东新区", establishedAt: "2020-02-29",
    ...overrides,
  };
}

function platform(overrides: Record<string, unknown> = {}) {
  return {
    companyId: 61, enterpriseId: 71, companyRegistrationRegion: "CN", enterpriseRegistrationRegion: "CN", enterpriseCreditCode: CREDIT,
    companyName: "有效企业", creditCode: CREDIT, companyType: "有限责任公司", legalPerson: "张三", companyRole: "supplier",
    bankAccountName: "有效企业", bankAccountNumber: "6222020202020000", bankName: "示例银行", regAddress: "上海市黄浦区", establishedAt: "2019-01-01",
    salesOwner: "销售甲", salesOwnerCode: "sales-a", licenseUrl: null, licenseObjectKey: LICENSE_KEY, licenseFileName: "营业执照.pdf",
    bankLicenseUrl: null, bankLicenseObjectKey: BANK_LICENSE_KEY, bankLicenseFileName: "开户许可证.png",
    pendingDraft: JSON.stringify(draft()), pendingDraftJsonValid: 1, reviewStatus: "pending", certLevel: "certified", enterpriseCrmAccess: "enabled",
    rejectReason: null, reviewedAt: null, submittedAt: "2026-10-28T08:00:00.000Z", expectedVersion: VERSION,
    superAdminUserId: "7001", dataOwnerUserId: "7001", companyUserId: "7001", memberStatus: "active", memberRole: "super_admin", ownerLoginDisabled: 0,
    ...overrides,
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return { merchantId: 511, decision: "approved" as const, expectedVersion: VERSION, confirmed: true, actor: { operatorId: 9, operatorName: "reviewer", operatorRole: "super_admin" }, ...overrides };
}

function expectZeroWrite(active: Plan) {
  expect(active.rendered.some(call => /^UPDATE\b/i.test(call.sql))).toBe(false);
  expect(active.merchantSets).toEqual([]);
  expect(active.audits).toEqual([]);
}

beforeEach(() => install());

describe("CN 注册审核维护源码（离线 mock 事务）", () => {
  it("使用 DATE_FORMAT 日期原值，并将名称、法人同步到主站/后台后写审计", async () => {
    const active = install({ selectResults: [[merchant()]], executeResults: [[[platform()], undefined], [{ affectedRows: 1 }], [{ affectedRows: 1 }]] });
    await expect(reviewCnRegistrationDraft(input())).resolves.toMatchObject({ success: true, idempotent: false, reviewStatus: "approved" });
    expect(active.merchantSets[0]).toMatchObject({ companyName: "变更后的企业", legalPersonName: "李四", establishedDate: expect.any(Date) });
    expect(active.audits[0]).toMatchObject({ action: "merchant.cn-registration.review", afterValue: expect.objectContaining({ decision: "approved", expectedVersion: VERSION }) });
    const select = active.rendered.find(call => /^SELECT/i.test(call.sql));
    expect(select?.sql).toContain("DATE_FORMAT(company.establishedAt, '%Y-%m-%d')");
    expect(select?.sql).toContain("COALESCE(company.licenseObjectKey, '')");
    expect(select?.sql).toContain("COALESCE(company.bankLicenseObjectKey, '')");
    const enterprise = active.rendered.find(call => /UPDATE dianzi51\.enterprises AS enterprise/i.test(call.sql));
    expect(enterprise?.sql).toContain("enterprise.companyName = ?");
  });

  it("B-02/F-01：合法既有 producer 初审在同一资料版本上可批准", async () => {
    const active = install({
      selectResults: [[merchant({ status: "pending" })]],
      executeResults: [[[platform({ pendingDraft: null })], undefined], [{ affectedRows: 1 }], [{ affectedRows: 1 }]],
    });
    await expect(reviewCnRegistrationDraft(input())).resolves.toMatchObject({ success: true, reviewStatus: "approved", retainedEffectiveAccess: false });
    expect(active.merchantSets[0]).toMatchObject({ status: "approved", licenseObjectKey: LICENSE_KEY, bankDocumentObjectKey: BANK_LICENSE_KEY });
    expect(active.audits).toHaveLength(1);
  });

  it("B-02/F-01：合法既有 producer 复审在同一资料版本上可批准", async () => {
    const active = install({
      selectResults: [[merchant()]],
      executeResults: [[[platform()], undefined], [{ affectedRows: 1 }], [{ affectedRows: 1 }]],
    });
    await expect(reviewCnRegistrationDraft(input())).resolves.toMatchObject({ success: true, reviewStatus: "approved", retainedEffectiveAccess: true });
    expect(active.merchantSets[0]).toMatchObject({ licenseObjectKey: LICENSE_KEY, bankDocumentObjectKey: BANK_LICENSE_KEY });
    expect(active.audits).toHaveLength(1);
  });

  it("企业名称变更时企业同步更新零行会在后台写入和审计前失败", async () => {
    const active = install({ selectResults: [[merchant()]], executeResults: [[[platform()], undefined], [{ affectedRows: 1 }], [{ affectedRows: 0 }]] });
    await expect(reviewCnRegistrationDraft(input())).rejects.toThrow("CN_REVIEW_VERSION_CHANGED");
    expect(active.merchantSets).toEqual([]);
    expect(active.audits).toEqual([]);
  });

  it.each([
    ["初审", merchant({ status: "approved" }), platform({ pendingDraft: null })],
    ["初审", merchant({ status: "supplement" }), platform({ pendingDraft: null })],
    ["初审", merchant({ status: "suspended" }), platform({ pendingDraft: null })],
    ["复审", merchant({ status: "pending" }), platform()],
    ["复审", merchant({ status: "supplement" }), platform()],
    ["复审", merchant({ status: "suspended" }), platform()],
  ])("M-01：%s处于错误本地状态时拒绝审核且零写入", async (_kind, localMerchant, row) => {
    const active = install({ selectResults: [[localMerchant]], executeResults: [[[row], undefined]] });
    await expect(reviewCnRegistrationDraft(input())).rejects.toThrow("CN_REVIEW_MERCHANT_STATE_INVALID");
    expectZeroWrite(active);
  });

  it("M-01：detail.canReview 同步反映初审/复审的本地状态机", async () => {
    install({ selectResults: [[merchant({ status: "approved" })]], executeResults: [[[platform({ pendingDraft: null })], undefined]] });
    await expect(getCnRegistrationReviewDetail(511)).resolves.toMatchObject({ reviewKind: "initial", canReview: false });
    install({ selectResults: [[merchant({ status: "pending" })]], executeResults: [[[platform()], undefined]] });
    await expect(getCnRegistrationReviewDetail(511)).resolves.toMatchObject({ reviewKind: "resubmission", canReview: false });
  });

  it.each([
    ["转派", { salesOwner: "其他销售" }],
    ["清空", { salesOwnerCode: null }],
    ["无效工号", { salesOwnerCode: "unknown-sales" }],
    ["停用工号", { salesOwnerCode: "inactive-sales" }],
  ])("M-02：草稿尝试%s销售负责人会失败关闭", async (_label, ownerChange) => {
    const active = install({
      selectResults: [[merchant()]],
      executeResults: [[[platform({ pendingDraft: JSON.stringify(draft(ownerChange)) })], undefined]],
    });
    await expect(reviewCnRegistrationDraft(input())).rejects.toThrow("CN_REVIEW_UNSUPPORTED_DRAFT_FIELD");
    expectZeroWrite(active);
  });

  it("F-02：历史草稿携带与有效值相同的 sales owner 快照可复审，但审核不会写 owner", async () => {
    const active = install({
      selectResults: [[merchant()]],
      executeResults: [[[
        platform({ pendingDraft: JSON.stringify(draft({ salesOwner: "销售甲", salesOwnerCode: "sales-a" })) }),
      ], undefined], [{ affectedRows: 1 }], [{ affectedRows: 1 }]],
    });
    await expect(reviewCnRegistrationDraft(input())).resolves.toMatchObject({ success: true, reviewStatus: "approved" });
    expect(active.merchantSets[0]).not.toHaveProperty("salesOwner");
    expect(active.merchantSets[0]).not.toHaveProperty("salesOwnerCode");
  });

  it("B-02/F-01：任意未知草稿字段在平台、本地和审计写入前失败关闭", async () => {
    const active = install({
      selectResults: [[merchant()]],
      executeResults: [[[platform({ pendingDraft: JSON.stringify({ ...draft(), objectKey: LICENSE_KEY }) })], undefined]],
    });
    await expect(reviewCnRegistrationDraft(input())).rejects.toThrow("CN_REVIEW_UNSUPPORTED_DRAFT_FIELD");
    expectZeroWrite(active);
  });

  it.each(["2026-02-29", "2024-04-31", "2024-00-01", "2024-13-01", "2024-01-00"])("M-03：拒绝不存在的日历日期 %s 且零写入", async establishedAt => {
    const active = install({
      selectResults: [[merchant()]],
      executeResults: [[[platform({ pendingDraft: JSON.stringify(draft({ establishedAt })) })], undefined]],
    });
    await expect(reviewCnRegistrationDraft(input())).rejects.toThrow("CN_REVIEW_CANDIDATE_INVALID");
    expectZeroWrite(active);
  });

  it("拒绝 URL-only 文档变更，不触碰任何更新", async () => {
    const unsafe = platform({ pendingDraft: JSON.stringify(draft({ licenseUrl: "https://untrusted.example/url-only.pdf" })) });
    const active = install({ selectResults: [[merchant()]], executeResults: [[[unsafe], undefined]] });
    await expect(reviewCnRegistrationDraft(input())).rejects.toThrow("CN_REVIEW_CANDIDATE_INVALID");
    expectZeroWrite(active);
  });

  it.each([
    ["错误前缀", { licenseObjectKey: "public/license.pdf", licenseFileName: "license.pdf" }],
    ["外部 owner", { licenseObjectKey: "licenses/user-other-owner-license.pdf", licenseFileName: "license.pdf" }],
    ["路径穿越", { licenseObjectKey: "licenses/user-7001-../license.pdf", licenseFileName: "license.pdf" }],
    ["错误 host", { licenseObjectKey: "licenses/user-7001-new-license.pdf", licenseFileName: "license.pdf", licenseUrl: "https://untrusted.example/license.pdf" }],
  ])("M-04：%s文档引用在平台、本地和审计写入前失败", async (_label, documentChange) => {
    const active = install({
      selectResults: [[merchant()]],
      executeResults: [[[platform({ pendingDraft: JSON.stringify(draft(documentChange)) })], undefined]],
    });
    await expect(reviewCnRegistrationDraft(input())).rejects.toThrow("CN_REVIEW_DOCUMENT_REFERENCE_INVALID");
    expectZeroWrite(active);
  });

  it("M-04：即使为当前 owner 的 storage producer 形状，缺少 CN 提交绑定仍拒绝替换", async () => {
    const key = `licenses/user-7001-1795000000002-${PRODUCER_UUID}_9abcdef0.pdf`;
    const active = install({
      selectResults: [[merchant()]],
      executeResults: [[[platform({ pendingDraft: JSON.stringify(draft({
        licenseObjectKey: key,
        licenseFileName: "license.pdf",
        licenseUrl: null,
      })) })], undefined]],
    });
    await expect(reviewCnRegistrationDraft(input())).rejects.toThrow("CN_REVIEW_DOCUMENT_MIGRATION_REQUIRED");
    expectZeroWrite(active);
  });

  it.each([
    ["foreign owner", { licenseObjectKey: LICENSE_KEY.replace("user-7001", "user-7002") }],
    ["untrusted URL", { bankLicenseUrl: "https://untrusted.example/bank.pdf" }],
    ["bad prefix", { licenseObjectKey: LICENSE_KEY.replace("licenses/", "public/") }],
    ["missing binding", { bankLicenseObjectKey: null }],
  ])("B-02/F-01：初审 %s 在任何平台、本地或审计写入前拒绝", async (_label, documentOverride) => {
    const active = install({
      selectResults: [[merchant({ status: "pending" })]],
      executeResults: [[[platform({ pendingDraft: null, ...documentOverride })], undefined]],
    });
    await expect(reviewCnRegistrationDraft(input())).rejects.toThrow("CN_REVIEW_DOCUMENT_REFERENCE_INVALID");
    expectZeroWrite(active);
  });

  it.each([
    ["foreign owner", { licenseObjectKey: LICENSE_KEY.replace("user-7001", "user-7002") }],
    ["untrusted URL", { bankLicenseUrl: "https://untrusted.example/bank.pdf" }],
    ["bad prefix", { licenseObjectKey: LICENSE_KEY.replace("licenses/", "public/") }],
    ["missing binding", { bankLicenseObjectKey: null }],
  ])("B-02/F-01：复审 %s 在任何平台、本地或审计写入前拒绝", async (_label, documentOverride) => {
    const active = install({
      selectResults: [[merchant()]],
      executeResults: [[[platform(documentOverride)], undefined]],
    });
    await expect(reviewCnRegistrationDraft(input())).rejects.toThrow("CN_REVIEW_DOCUMENT_REFERENCE_INVALID");
    expectZeroWrite(active);
  });

  it("M-09：事务锁住商户后 owner 已转移时拒绝且不读取/写入平台", async () => {
    const active = install({ selectResults: [[merchant({ salesOwnerCode: "sales-b" })]] });
    await expect(reviewCnRegistrationDraft(input({ allowedSalesStaffCodes: ["sales-a"] }))).rejects.toThrow("MERCHANT_NOT_FOUND");
    expect(active.rendered).toEqual([]);
    expect(active.merchantSets).toEqual([]);
    expect(active.audits).toEqual([]);
  });

  it.each([
    ["主体信用代码", platform({ enterpriseCreditCode: "91110000MA1K3ABCDE" })],
    ["企业成员角色", platform({ memberRole: "member" })],
    ["账号已禁用", platform({ ownerLoginDisabled: 1 })],
    ["CRM owner", platform(), merchant({ crmOwnerPortalUserId: "other-owner" })],
  ])("保留 %s 守卫", async (_label, row, merchantRow = merchant()) => {
    const active = install({ selectResults: [[merchantRow]], executeResults: [[[row], undefined]] });
    await expect(reviewCnRegistrationDraft(input())).rejects.toThrow(/CN_REVIEW_(SUBJECT_MISMATCH|OWNER_OR_SUBJECT_INVALID)/);
    expect(active.merchantSets).toEqual([]);
    expect(active.audits).toEqual([]);
  });

  it("版本变化阻止写入；相同已决定版本可幂等重放", async () => {
    const stale = install({ selectResults: [[merchant()]], executeResults: [[[platform({ expectedVersion: "b".repeat(64) })], undefined]] });
    await expect(reviewCnRegistrationDraft(input())).rejects.toThrow("CN_REVIEW_VERSION_CHANGED");
    expect(stale.merchantSets).toEqual([]);

    const decided = platform({ reviewStatus: "approved", pendingDraft: null });
    const replay = install({ selectResults: [[merchant()]], executeResults: [[[decided], undefined], [[{ expectedVersion: VERSION, decision: "approved" }], undefined]] });
    await expect(reviewCnRegistrationDraft(input())).resolves.toMatchObject({ idempotent: true, decision: "approved" });
    expect(replay.merchantSets).toEqual([]);
    expect(replay.audits).toEqual([]);
  });

  it("详情保持成立日期 date-only 并展示名称/法人变更提示，而不是阻断普通人工审核", async () => {
    install({ selectResults: [[merchant()]], executeResults: [[[platform()], undefined]] });
    const detail = await getCnRegistrationReviewDetail(511);
    expect(detail.differences.find(row => row.field === "establishedAt")).toMatchObject({ before: "2019-01-01", after: "2020-02-29" });
    expect(detail.reviewNotice).toContain("企业名称和法人信息有变更");
    expect(detail.canReview).toBe(true);
  });
});
