import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import {
  CRM_DUPLICATE_OPENING_CODE,
  CRM_DUPLICATE_OPENING_MESSAGE,
  findCrmDuplicateRegistrationConflict,
} from "./services/crmDuplicateRegistration";
import {
  ENTERPRISE_SERVICE_AGREEMENT_HASH,
  ENTERPRISE_SERVICE_AGREEMENT_VERSION,
} from "../shared/enterpriseServiceAgreementSummary";

/**
 * The real db.ts is loaded below, but both its Drizzle entrypoint and the
 * dedicated mysql2/promise lock carrier are local fakes. No socket, database,
 * credential, or production data is ever used by this suite.
 */
const mocked = vi.hoisted(() => ({
  drizzle: vi.fn(),
  createConnection: vi.fn(),
}));
vi.mock("drizzle-orm/mysql2", () => ({ drizzle: mocked.drizzle }));
vi.mock("mysql2/promise", () => ({ default: { createConnection: mocked.createConnection } }));

const dialect = new MySqlDialect();
type Merchant = Record<string, any>;
type State = {
  rows: Merchant[];
  nextId: number;
  writes: number;
  inserts: number;
  auditWrites: number;
  carrierStatements: string[];
};
let state: State;
let lockTail: Promise<void>;
let dbModule: typeof import("./db");

function merchant(overrides: Partial<Merchant> = {}): Merchant {
  return {
    id: 1,
    merchantNo: "M000001",
    companyName: "现有企业有限公司",
    registrationRegion: "CN",
    registrationIdentifier: null,
    businessLicense: "911111111111111111",
    licenseObjectKey: "licenses/user-owner-a-existing-license.pdf",
    licenseImageUrl: null,
    crmOwnerPortalUserId: "owner-a",
    crmStatus: "pending",
    registrationData: null,
    registrationPendingData: null,
    status: "pending",
    ...overrides,
  };
}

function sqlParams(condition: unknown) {
  try {
    return dialect.sqlToQuery(condition as SQL).params;
  } catch {
    return [] as unknown[];
  }
}

function matchingRows(condition: unknown) {
  const params = sqlParams(condition);
  const numeric = params.find(value => typeof value === "number");
  if (typeof numeric === "number") return state.rows.filter(row => row.id === numeric);
  const text = params.find(value => typeof value === "string");
  if (typeof text === "string") {
    return state.rows.filter(row => row.businessLicense === text || row.registrationIdentifier === text);
  }
  return state.rows;
}

function fakeTransaction() {
  const tx: any = {
    select: vi.fn(() => {
      let condition: unknown;
      const query: any = {
        from: () => query,
        where: (next: unknown) => { condition = next; return query; },
        limit: () => query,
        for: () => query,
        then: (resolve: (rows: Merchant[]) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve(matchingRows(condition)).then(resolve, reject),
      };
      return query;
    }),
    update: vi.fn(() => ({
      set: (values: Record<string, unknown>) => ({
        where: async (condition: unknown) => {
          const rows = matchingRows(condition);
          for (const row of rows) Object.assign(row, values);
          state.writes += 1;
          return [{ affectedRows: rows.length }];
        },
      }),
    })),
    insert: vi.fn(() => ({
      values: async (values: Merchant) => {
        if (values.merchantNo) {
          const row = merchant({ ...values, id: state.nextId++ });
          state.rows.push(row);
          state.inserts += 1;
          return [{ insertId: row.id }];
        }
        state.auditWrites += 1;
        return [{ insertId: 1 }];
      },
    })),
    execute: vi.fn(async () => [[[]], undefined]),
  };
  return tx;
}

function fakeDatabase() {
  return {
    transaction: async <T>(operation: (tx: any) => Promise<T>) => operation(fakeTransaction()),
  };
}

function installCarrier() {
  lockTail = Promise.resolve();
  mocked.createConnection.mockImplementation(async () => {
    let release: (() => void) | null = null;
    return {
      query: async (statement: string) => {
        state.carrierStatements.push(statement);
        if (statement.includes("GET_LOCK")) {
          const before = lockTail;
          lockTail = new Promise(resolve => { release = resolve; });
          await before;
          return [[{ acquired: 1 }], undefined];
        }
        if (statement.includes("RELEASE_LOCK")) release?.();
        return [[{ released: 1 }], undefined];
      },
      end: async () => undefined,
    };
  });
}

function reset(rows: Merchant[] = []) {
  state = { rows, nextId: Math.max(1, ...rows.map(row => row.id + 1)), writes: 0, inserts: 0, auditWrites: 0, carrierStatements: [] };
  mocked.drizzle.mockReturnValue(fakeDatabase());
  mocked.createConnection.mockReset();
  installCarrier();
}

function cnInput(overrides: Record<string, unknown> = {}) {
  return {
    companyName: "新申请企业有限公司",
    creditCode: "922222222222222222",
    companyType: "有限责任公司",
    legalPersonName: "申请人",
    registeredAddress: "深圳市南山区",
    settlementAccountName: "新申请企业有限公司",
    settlementAccount: "6222000000000001",
    settlementBank: "测试银行",
    portalUserId: "owner-b",
    agreementAccepted: true as const,
    agreementVersion: ENTERPRISE_SERVICE_AGREEMENT_VERSION,
    agreementHash: ENTERPRISE_SERVICE_AGREEMENT_HASH,
    licenseObjectKey: "licenses/user-owner-b-new-license.pdf",
    ...overrides,
  };
}

function hkInput(overrides: Record<string, unknown> = {}) {
  const owner = "owner-hk";
  const submissionId = "11111111-1111-4111-8111-111111111111";
  return {
    registrationIdentifier: "HK:12345678",
    registrationData: {
      companyName: "Hong Kong Example Limited",
      chineseName: "香港示例有限公司",
      businessNature: "Electronic components distribution",
      legalStatus: "Limited Company",
      brn: "12345678",
      registrationNumber: "12345678-001-01-01-1",
      brStartDate: "2020-01-01",
      brExpiryDate: "2099-12-31",
      ciNumber: "CI-12345678",
      establishedAt: "2019-01-01",
      regAddress: "Unit 1, Hong Kong",
      bankAccountName: "Hong Kong Example Limited",
      bankAccountNumber: "001-234-567890",
      bankName: "Example Bank",
      bankAddress: "1 Example Street",
      swift: "EXAMPLEHK",
      bankCode: "001",
      companyRole: "supplier",
      salesOwner: "",
      salesOwnerCode: "",
    },
    documents: {
      BR: { objectKey: `hk-registration/user-${owner}/BR/${submissionId}_br-proof.pdf`, fileName: "br.pdf" },
      CI: { objectKey: `hk-registration/user-${owner}/CI/${submissionId}_ci-proof.pdf`, fileName: "ci.pdf" },
      BANK: { objectKey: `hk-registration/user-${owner}/BANK/${submissionId}_bank-proof.pdf`, fileName: "bank.pdf" },
    },
    documentVerification: {
      BR: { documentId: submissionId, ocrStatus: "recognized" as const, recognizedType: "BR", classification: "ocr-assisted" as const },
      CI: { documentId: submissionId, ocrStatus: "recognized" as const, recognizedType: "CI", classification: "ocr-assisted" as const },
      BANK: { documentId: submissionId, ocrStatus: "recognized" as const, recognizedType: "BANK", classification: "ocr-assisted" as const },
    },
    submissionId,
    payloadHash: "a".repeat(64),
    portalUserId: owner,
    agreementAccepted: true as const,
    agreementVersion: ENTERPRISE_SERVICE_AGREEMENT_VERSION,
    agreementHash: ENTERPRISE_SERVICE_AGREEMENT_HASH,
    ...overrides,
  };
}

beforeAll(async () => {
  process.env.DATABASE_URL = "mysql://unit:unit@127.0.0.1:3306/unit_duplicate_registration";
  dbModule = await import("./db");
});

beforeEach(() => reset());

describe("CRM duplicate registration guard — real handlers with mocked transaction/carrier", () => {
  it("normalizes NFKC, whitespace and full/half-width parentheses for name-only duplicates before any write", async () => {
    reset([merchant({
      companyName: "ＡＣＭＥ　（中国）有限公司",
      businessLicense: "911111111111111111",
      crmOwnerPortalUserId: "owner-a",
    })]);

    const result = await dbModule.submitCrmApplication(cnInput({
      companyName: " acme(中国) 有限公司 ",
      creditCode: "922222222222222222",
    }));

    expect(result).toMatchObject({ accepted: false, created: false, code: CRM_DUPLICATE_OPENING_CODE, message: CRM_DUPLICATE_OPENING_MESSAGE });
    expect(state.writes + state.inserts).toBe(0);
  });

  it("returns the generic result for a code-only duplicate without exposing the existing owner", async () => {
    reset([merchant({ businessLicense: "922222222222222222", crmOwnerPortalUserId: "owner-a", companyName: "不同名称" })]);

    const result = await dbModule.submitCrmApplication(cnInput());

    expect(result).toMatchObject({ code: CRM_DUPLICATE_OPENING_CODE, message: CRM_DUPLICATE_OPENING_MESSAGE });
    expect(JSON.stringify(result)).not.toContain("owner-a");
    expect(state.writes + state.inserts).toBe(0);
  });

  it("blocks a changed credit code that reuses another enterprise private license key", async () => {
    reset([merchant({ businessLicense: "911111111111111111", licenseObjectKey: "licenses/shared-proof.pdf", companyName: "第一企业", crmOwnerPortalUserId: "owner-a" })]);

    const result = await dbModule.submitCrmApplication(cnInput({
      companyName: "第二企业",
      licenseObjectKey: "licenses/shared-proof.pdf",
    }));

    expect(result).toMatchObject({ code: CRM_DUPLICATE_OPENING_CODE, message: CRM_DUPLICATE_OPENING_MESSAGE });
    expect(JSON.stringify(result)).not.toContain("shared-proof");
    expect(state.writes + state.inserts).toBe(0);
  });

  it("blocks an account that already owns a different enterprise before insert", async () => {
    reset([merchant({ crmOwnerPortalUserId: "owner-b", companyName: "原企业", businessLicense: "911111111111111111" })]);

    const result = await dbModule.submitCrmApplication(cnInput({ companyName: "另一企业" }));

    expect(result).toMatchObject({ code: CRM_DUPLICATE_OPENING_CODE });
    expect(state.inserts).toBe(0);
  });

  it("blocks CN against an HK effective registered English name", async () => {
    reset([merchant({
      registrationRegion: "HK",
      registrationIdentifier: "HK:87654321",
      businessLicense: null,
      companyName: "无关展示名",
      crmOwnerPortalUserId: "owner-hk",
      registrationData: { registration: { companyName: "Cross Scope Limited", chineseName: "跨域有限公司" } },
    })]);

    const result = await dbModule.submitCrmApplication(cnInput({ companyName: " cross scope limited " }));

    expect(result).toMatchObject({ code: CRM_DUPLICATE_OPENING_CODE });
    expect(state.writes + state.inserts).toBe(0);
  });

  it("blocks HK submit by a Chinese alias found only in another HK pending JSON", async () => {
    reset([merchant({
      registrationRegion: "HK",
      registrationIdentifier: "HK:87654321",
      businessLicense: null,
      companyName: "Other Hong Kong Limited",
      crmOwnerPortalUserId: "owner-other",
      registrationPendingData: { registration: { companyName: "Other Hong Kong Limited", chineseName: "香港示例有限公司" } },
    })]);

    const result = await dbModule.submitHkCrmApplication(hkInput());

    expect(result).toMatchObject({ code: CRM_DUPLICATE_OPENING_CODE, message: CRM_DUPLICATE_OPENING_MESSAGE });
    expect(state.inserts + state.writes).toBe(0);
  });

  it("accepts a first HK submission without CI and does not create CI evidence or OCR data", async () => {
    const input = hkInput({
      registrationData: { ...hkInput().registrationData, ciNumber: "" },
      documents: {
        BR: hkInput().documents.BR,
        BANK: hkInput().documents.BANK,
      },
      documentVerification: {
        BR: hkInput().documentVerification.BR,
        BANK: hkInput().documentVerification.BANK,
      },
    });

    await expect(dbModule.submitHkCrmApplication(input)).resolves.toMatchObject({
      accepted: true,
      created: true,
      code: "HK_CRM_APPLICATION_ACCEPTED",
    });

    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]).toMatchObject({ ciObjectKey: null });
    expect(state.rows[0].registrationPendingData.documents).not.toHaveProperty("CI");
    expect(state.rows[0].registrationPendingData.documentObjectKeys).not.toHaveProperty("CI");
    expect(state.rows[0].registrationPendingData.documentVerification).not.toHaveProperty("CI");
  });

  it("keeps an effective CI key intact while a CI-omitted paused HK resubmission waits for review", async () => {
    const effectiveCiObjectKey = "hk-registration/user-owner-hk/CI/22222222-2222-4222-8222-222222222222_effective-ci.pdf";
    const existing = merchant({
      id: 7,
      merchantNo: "M000007",
      registrationRegion: "HK",
      registrationIdentifier: "HK:12345678",
      businessLicense: null,
      crmOwnerPortalUserId: "owner-hk",
      crmStatus: "disabled",
      status: "approved",
      ciObjectKey: effectiveCiObjectKey,
      registrationData: { registration: hkInput().registrationData },
    });
    reset([existing]);

    const result = await dbModule.submitHkCrmApplication(hkInput({
      registrationData: { ...hkInput().registrationData, ciNumber: "" },
      documents: { BR: hkInput().documents.BR, BANK: hkInput().documents.BANK },
      documentVerification: { BR: hkInput().documentVerification.BR, BANK: hkInput().documentVerification.BANK },
    }));

    expect(result).toMatchObject({ accepted: true, created: false, code: "HK_CRM_PROFILE_REVIEW_PENDING", crmStatus: "disabled" });
    expect(existing.ciObjectKey).toBe(effectiveCiObjectKey);
    expect(existing.registrationPendingData.documents).not.toHaveProperty("CI");
  });

  it.each([
    ["BR", () => ({ CI: hkInput().documents.CI, BANK: hkInput().documents.BANK })],
    ["BANK", () => ({ BR: hkInput().documents.BR, CI: hkInput().documents.CI })],
  ])("rejects an HK submission missing required %s evidence", async (_kind, withoutRequiredDocument) => {
    await expect(dbModule.submitHkCrmApplication(hkInput({ documents: withoutRequiredDocument() })))
      .rejects.toThrow();
    expect(state.writes + state.inserts).toBe(0);
  });

  it.each([
    ["invalid CI object key", "hk-registration/user-owner-hk/CI/11111111-1111-4111-8111-111111111111_ci-proof.exe"],
    ["cross-owner CI object key", "hk-registration/user-other-owner/CI/11111111-1111-4111-8111-111111111111_ci-proof.pdf"],
  ])("rejects %s rather than treating supplied CI as optional", async (_label, ciObjectKey) => {
    await expect(dbModule.submitHkCrmApplication(hkInput({
      documents: { ...hkInput().documents, CI: { ...hkInput().documents.CI, objectKey: ciObjectKey } },
    }))).rejects.toThrow("HK_DOCUMENT_OBJECT_KEY_INVALID");
    expect(state.writes + state.inserts).toBe(0);
  });

  it("rejects a CI OCR record when the optional CI file is absent", async () => {
    await expect(dbModule.submitHkCrmApplication(hkInput({
      registrationData: { ...hkInput().registrationData, ciNumber: "" },
      documents: { BR: hkInput().documents.BR, BANK: hkInput().documents.BANK },
    }))).rejects.toThrow("HK_DOCUMENT_CLASSIFICATION_INVALID");
    expect(state.writes + state.inserts).toBe(0);
  });

  it("permits exact same-owner rejected identity re-submission using its pre-existing private evidence", async () => {
    const existing = merchant({
      id: 7,
      merchantNo: "M000007",
      businessLicense: "922222222222222222",
      crmOwnerPortalUserId: "owner-b",
      crmStatus: "rejected",
      licenseObjectKey: "licenses/rejected-original.pdf",
    });
    reset([existing]);

    const result = await dbModule.submitCrmApplication(cnInput({ licenseObjectKey: null }));

    expect(result).toMatchObject({ accepted: true, created: false, code: "CRM_APPLICATION_REAPPLIED", crmStatus: "pending" });
    expect(state.writes).toBe(1);
    expect(state.inserts).toBe(0);
  });

  it("requires CN private or same-identity legacy evidence before it creates an application", async () => {
    const result = await dbModule.submitCrmApplication(cnInput({ licenseObjectKey: null, licenseImageUrl: null }));

    expect(result).toEqual({
      accepted: false,
      created: false,
      code: "CRM_LICENSE_REQUIRED",
      crmStatus: "none",
      message: "请先上传营业执照后再提交开通申请",
    });
    expect(state.writes + state.inserts).toBe(0);
  });

  it("does not accept a caller-provided legacy URL or another user's private-key shape as CN evidence", async () => {
    const result = await dbModule.submitCrmApplication(cnInput({
      licenseObjectKey: "licenses/user-owner-a-not-owner-b.pdf",
      licenseImageUrl: "https://example.invalid/untrusted-license.pdf",
    }));

    expect(result).toMatchObject({ code: "CRM_LICENSE_REQUIRED", message: "请先上传营业执照后再提交开通申请" });
    expect(state.writes + state.inserts).toBe(0);
  });

  it("serializes parallel same-name different-code submissions through the mocked mysql carrier so only one creates", async () => {
    const [first, second] = await Promise.all([
      dbModule.submitCrmApplication(cnInput({ creditCode: "922222222222222222", companyName: "并发企业有限公司", licenseObjectKey: "licenses/user-owner-b-concurrent-a.pdf" })),
      dbModule.submitCrmApplication(cnInput({ creditCode: "933333333333333333", companyName: "并发企业有限公司", licenseObjectKey: "licenses/user-owner-b-concurrent-b.pdf" })),
    ]);

    const results = [first, second];
    expect(results.filter(result => result.created)).toHaveLength(1);
    expect(results.filter(result => result.code === CRM_DUPLICATE_OPENING_CODE)).toHaveLength(1);
    expect(state.rows).toHaveLength(1);
    expect(state.carrierStatements.filter(statement => statement.includes("GET_LOCK"))).toHaveLength(2);
    expect(state.carrierStatements.filter(statement => statement.includes("RELEASE_LOCK"))).toHaveLength(2);
  });

  it("checks a clean candidate read-only without mutating the supplied transaction", async () => {
    reset([merchant({ companyName: "现有企业", businessLicense: "911111111111111111", crmOwnerPortalUserId: "owner-a" })]);
    const tx = fakeTransaction();

    await expect(findCrmDuplicateRegistrationConflict(tx, {
      identity: "CN:922222222222222222",
      companyNames: ["完全不同企业"],
      crmOwnerPortalUserId: "owner-b",
      licenseObjectKey: "licenses/unique.pdf",
    })).resolves.toBeNull();

    expect(state.writes + state.inserts + state.auditWrites).toBe(0);
  });

  it("denies CRM enablement on an actual historical conflict before merchant or audit writes, while keeping disabled/rejected paths untouched", async () => {
    const target = merchant({
      id: 10,
      merchantNo: "M000010",
      companyName: "东蓝企业",
      businessLicense: "922222222222222222",
      crmOwnerPortalUserId: "owner-shared",
      crmStatus: "disabled",
      licenseObjectKey: "licenses/donglan.pdf",
    });
    const historical = merchant({
      id: 11,
      merchantNo: "M000011",
      companyName: "杜松企业",
      businessLicense: "911111111111111111",
      crmOwnerPortalUserId: "owner-shared",
      crmStatus: "enabled",
      licenseObjectKey: "licenses/dusong.pdf",
    });
    reset([target, historical]);

    const result = await dbModule.setMerchantCrmStatus({ merchantId: 10, crmStatus: "enabled", portalUserId: "owner-shared" });

    expect(result).toEqual({
      success: false,
      code: CRM_DUPLICATE_OPENING_CODE,
      message: CRM_DUPLICATE_OPENING_MESSAGE,
      crmOwnerPortalUserId: "owner-shared",
    });
    expect(state.writes + state.inserts + state.auditWrites).toBe(0);
  });

  it("rejects CN enable/resume without evidence before writes, including an already disabled record", async () => {
    reset([merchant({
      id: 15,
      merchantNo: "M000015",
      crmStatus: "disabled",
      crmOwnerPortalUserId: "owner-a",
      licenseObjectKey: null,
      licenseImageUrl: null,
    })]);

    await expect(dbModule.setMerchantCrmStatus({ merchantId: 15, crmStatus: "enabled", portalUserId: "owner-a" }))
      .rejects.toMatchObject({ code: "CRM_LICENSE_REQUIRED", message: "开通 ERP 前必须上传营业执照" });
    expect(state.writes + state.inserts + state.auditWrites).toBe(0);
  });

  it("accepts a same-owner same-identity pending update without creating another merchant", async () => {
    reset([merchant({ businessLicense: "922222222222222222", crmOwnerPortalUserId: "owner-b", crmStatus: "pending" })]);
    const result = await dbModule.submitCrmApplication(cnInput());
    expect(result).toMatchObject({ accepted: true, created: false, code: "CRM_APPLICATION_UPDATED", crmStatus: "pending" });
    expect(state.writes).toBe(1);
    expect(state.inserts).toBe(0);
  });

  it("rejects malformed stored evidence at enablement, even if it is nonempty", async () => {
    reset([merchant({ id: 15, crmStatus: "disabled", licenseObjectKey: "x", licenseImageUrl: "x" })]);
    await expect(dbModule.setMerchantCrmStatus({ merchantId: 15, crmStatus: "enabled", portalUserId: "owner-a" }))
      .rejects.toMatchObject({ code: "CRM_LICENSE_REQUIRED" });
    expect(state.writes + state.inserts + state.auditWrites).toBe(0);
  });

  it("does not let a valid stored legacy URL authorize an unrelated new private key", async () => {
    reset([merchant({ businessLicense: "922222222222222222", crmOwnerPortalUserId: "owner-b", licenseObjectKey: null, licenseImageUrl: "https://example.invalid/legacy.pdf" })]);
    const result = await dbModule.submitCrmApplication(cnInput({ licenseObjectKey: "licenses/user-owner-a-not-owner-b.pdf" }));
    expect(result).toMatchObject({ accepted: false, code: "CRM_LICENSE_REQUIRED" });
    expect(state.writes + state.inserts).toBe(0);
  });

  it("keeps the exact enabled acknowledgement for profile-review compatibility without changing its merchant", async () => {
    reset([merchant({ businessLicense: "922222222222222222", crmOwnerPortalUserId: "owner-b", crmStatus: "enabled" })]);
    const result = await dbModule.submitCrmApplication(cnInput());
    expect(result).toMatchObject({ accepted: false, created: false, code: "CRM_ALREADY_ENABLED", message: CRM_DUPLICATE_OPENING_MESSAGE });
    expect(state.writes + state.inserts).toBe(0);
  });
});

describe("HK same-owner pending sales update acknowledgement", () => {
  function existingHk(overrides: Record<string, unknown> = {}) {
    return merchant({ id: 7, merchantNo: "M000007", registrationRegion: "HK", registrationIdentifier: "HK:12345678", businessLicense: null, crmOwnerPortalUserId: "owner-hk", crmStatus: "pending", status: "pending", hkSubmissionId: "22222222-2222-4222-8222-222222222222", hkPayloadHash: "b".repeat(64), licenseObjectKey: hkInput().documents.BR.objectKey, salesOwner: null, salesOwnerCode: null, ...overrides });
  }
  it("同所有者新payload补交更新原商户并返回成功，随后相同提交回放零写入", async () => {
    const existing = existingHk(); reset([existing]);
    const input = hkInput({ salesOwner: "SYNTHETIC SALES", salesOwnerCode: "synthetic-sales", registrationData: { ...hkInput().registrationData, salesOwner: "SYNTHETIC SALES", salesOwnerCode: "synthetic-sales" } });
    const first = await dbModule.submitHkCrmApplication(input);
    expect(first).toMatchObject({ accepted: true, created: false, code: "HK_CRM_APPLICATION_UPDATED", merchantId: 7 });
    expect(existing).toMatchObject({ salesOwner: "SYNTHETIC SALES", salesOwnerCode: "synthetic-sales", hkSubmissionId: input.submissionId, hkPayloadHash: input.payloadHash });
    expect(state.rows).toHaveLength(1); expect(state.inserts).toBe(0); expect(state.writes).toBe(1);
    const replay = await dbModule.submitHkCrmApplication(input);
    expect(replay).toMatchObject({ accepted: true, created: false, code: "HK_CRM_APPLICATION_IDEMPOTENT", merchantId: 7 });
    expect(state.writes).toBe(1); expect(state.inserts).toBe(0);
  });
  it("未选择负责人时待审补交不清除后台手动设置的销售", async () => {
    const existing = existingHk({ salesOwner: "MANUALLY ASSIGNED", salesOwnerCode: "manual-sales" }); reset([existing]);
    await expect(dbModule.submitHkCrmApplication(hkInput())).resolves.toMatchObject({ accepted: true, code: "HK_CRM_APPLICATION_UPDATED" });
    expect(existing).toMatchObject({ salesOwner: "MANUALLY ASSIGNED", salesOwnerCode: "manual-sales" }); expect(state.inserts).toBe(0);
  });
  it.each(["other-owner", "enabled"])("真正的%s重复仍失败且不修改现有记录", async reason => {
    const existing = existingHk(reason === "other-owner" ? { crmOwnerPortalUserId: "other-owner" } : { crmStatus: "enabled", status: "approved" }); reset([existing]);
    await expect(dbModule.submitHkCrmApplication(hkInput({ salesOwner: "SYNTHETIC SALES", salesOwnerCode: "synthetic-sales" }))).resolves.toMatchObject({ accepted: false, created: false, code: CRM_DUPLICATE_OPENING_CODE });
    expect(state.writes + state.inserts).toBe(0);
  });
  it("同一提交号但hash不同仍拒绝且零写入", async () => {
    reset([existingHk({ hkSubmissionId: hkInput().submissionId, hkPayloadHash: "b".repeat(64) })]);
    await expect(dbModule.submitHkCrmApplication(hkInput())).rejects.toThrow("HK_SUBMISSION_PAYLOAD_CONFLICT"); expect(state.writes + state.inserts).toBe(0);
  });
});
