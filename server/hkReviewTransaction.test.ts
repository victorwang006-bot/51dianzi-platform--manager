import fs from "node:fs";
import path from "node:path";
import * as ts from "typescript";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * This suite deliberately loads the real db.ts implementation. The mysql2
 * Drizzle entrypoint is replaced before db.ts is imported, so the synthetic
 * DATABASE_URL below can never open a socket or access production credentials.
 */
const drizzleMock = vi.hoisted(() => vi.fn());
const createLockConnectionMock = vi.hoisted(() => vi.fn());
vi.mock("drizzle-orm/mysql2", () => ({ drizzle: drizzleMock }));
vi.mock("mysql2/promise", () => ({ default: { createConnection: createLockConnectionMock } }));

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");
const DB_SOURCE_PATH = path.join(PROJECT_ROOT, "server", "db.ts");
const MAIN_SCHEMA_PATH = "/home/ubuntu/51-sticky-production/drizzle/schema.ts";
const dialect = new MySqlDialect();

const REGISTRATION_IDENTIFIER = "HK:12345678";
const CURRENT_ENTERPRISE_SUPER_ADMIN = "current-enterprise-superadmin";
const ORIGINAL_COMPANY_USER = "original-company-user";
const SUBMISSION_ID = "11111111-1111-4111-8111-111111111111";
const PAYLOAD_HASH = "a".repeat(64);
const OLD_SUBMISSION_ID = "22222222-2222-4222-8222-222222222222";
const OLD_PAYLOAD_HASH = "b".repeat(64);

const documents = {
  BR: {
    objectKey: "hk-registration/user-original-company-user/BR/11111111-1111-4111-8111-111111111111_br-proof.pdf",
    fileName: "business-registration.pdf",
  },
  CI: {
    objectKey: "hk-registration/user-original-company-user/CI/11111111-1111-4111-8111-111111111111_ci-proof.pdf",
    fileName: "company-incorporation.pdf",
  },
  BANK: {
    objectKey: "hk-registration/user-original-company-user/BANK/11111111-1111-4111-8111-111111111111_bank-proof.pdf",
    fileName: "bank-account-proof.pdf",
  },
};

const registration = {
  companyName: "Example Hong Kong Limited",
  chineseName: "示例香港有限公司",
  businessNature: "Electronic components distribution",
  legalStatus: "Limited Company",
  brn: "12345678",
  registrationNumber: "12345678-001-01-01-1",
  brStartDate: "2020-01-01",
  brExpiryDate: "2099-12-31",
  ciNumber: "CI-EXAMPLE-001",
  establishedAt: "2019-12-12",
  regAddress: "Unit 1201, Example Tower, Hong Kong",
  bankAccountName: "Example Hong Kong Limited",
  bankAccountNumber: "001-234-567890",
  bankName: "Example Bank Hong Kong",
  bankAddress: "1 Example Road, Hong Kong",
  swift: "EXAMPLHK",
  bankCode: "001",
  companyRole: "supplier",
  salesOwner: "Ada Sales",
  salesOwnerCode: "S-001",
};

type RenderedSql = { sql: string; params: unknown[] };
type TransactionPlan = {
  selectResults: unknown[][];
  executeResults: unknown[];
  updateResults: unknown[];
  rendered: RenderedSql[];
  merchantSets: Record<string, unknown>[];
  auditValues: Record<string, unknown>[];
};

type FakeTransaction = {
  select: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
};

let dbModule: typeof import("./db");
let activePlan: TransactionPlan;
let activeTransaction: FakeTransaction;

const fakeDatabase = {
  transaction: async <T>(callback: (tx: FakeTransaction) => Promise<T>) => callback(activeTransaction),
};

function render(statement: unknown): RenderedSql {
  // sqlToQuery only serializes the Drizzle SQL object. It does not use mysql2.
  const query = dialect.sqlToQuery(statement as SQL);
  return { sql: query.sql.replace(/\s+/g, " ").trim(), params: [...query.params] };
}

function newTransaction(plan: TransactionPlan): FakeTransaction {
  const transaction = {
    select: vi.fn(),
    execute: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
  } as unknown as FakeTransaction;

  transaction.select.mockImplementation(() => {
    const query: Record<string, unknown> = {};
    query.from = () => query;
    query.where = () => query;
    query.limit = () => query;
    query.for = () => query;
    query.then = (onfulfilled: (value: unknown[]) => unknown, onrejected?: (reason: unknown) => unknown) =>
      Promise.resolve(plan.selectResults.shift() ?? []).then(onfulfilled, onrejected);
    return query;
  });

  transaction.execute.mockImplementation(async (statement: unknown) => {
    plan.rendered.push(render(statement));
    return plan.executeResults.shift() ?? [[], undefined];
  });

  transaction.update.mockImplementation(() => ({
    set: (values: Record<string, unknown>) => {
      plan.merchantSets.push(values);
      return {
        where: async () => plan.updateResults.shift() ?? [{ affectedRows: 1 }],
      };
    },
  }));

  transaction.insert.mockImplementation(() => ({
    values: async (values: Record<string, unknown>) => {
      plan.auditValues.push(values);
      return [{ insertId: 1 }];
    },
  }));

  return transaction;
}

function installPlan(overrides: Partial<Pick<TransactionPlan, "selectResults" | "executeResults" | "updateResults">> = {}) {
  activePlan = {
    selectResults: overrides.selectResults ?? [],
    executeResults: overrides.executeResults ?? [],
    updateResults: overrides.updateResults ?? [],
    rendered: [],
    merchantSets: [],
    auditValues: [],
  };
  activeTransaction = newTransaction(activePlan);
  return activePlan;
}

function pendingRegistration(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    registration: { ...registration },
    documents: {
      BR: { fileName: documents.BR.fileName },
      CI: { fileName: documents.CI.fileName },
      BANK: { fileName: documents.BANK.fileName },
    },
    submittedAt: "2026-01-01T00:00:00.000Z",
    submissionId: SUBMISSION_ID,
    payloadHash: PAYLOAD_HASH,
    documentObjectKeys: {
      BR: documents.BR.objectKey,
      CI: documents.CI.objectKey,
      BANK: documents.BANK.objectKey,
    },
    ...overrides,
  };
}

function storedEffectiveRegistration(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    registration: { ...registration },
    documents: {
      BR: { fileName: documents.BR.fileName },
      CI: { fileName: documents.CI.fileName },
      BANK: { fileName: documents.BANK.fileName },
    },
    submittedAt: "2025-12-01T00:00:00.000Z",
    submissionId: OLD_SUBMISSION_ID,
    payloadHash: OLD_PAYLOAD_HASH,
    ...overrides,
  };
}

function hkMerchant(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 30004,
    merchantNo: "M30004",
    registrationRegion: "HK",
    registrationIdentifier: REGISTRATION_IDENTIFIER,
    businessLicense: null,
    companyName: registration.companyName,
    crmStatus: "pending",
    crmOwnerPortalUserId: CURRENT_ENTERPRISE_SUPER_ADMIN,
    crmEnabledAt: null,
    crmNote: null,
    status: "pending",
    registrationData: null,
    registrationPendingData: pendingRegistration(),
    hkSubmissionId: SUBMISSION_ID,
    hkPayloadHash: PAYLOAD_HASH,
    licenseObjectKey: documents.BR.objectKey,
    ciObjectKey: documents.CI.objectKey,
    bankDocumentObjectKey: documents.BANK.objectKey,
    ...overrides,
  };
}

function reviewInput(overrides: Partial<{
  merchantId: number;
  decision: "approved" | "rejected";
  note: string;
  expectedSubmissionId: string;
  expectedPayloadHash: string;
  confirmed: boolean;
}> = {}) {
  return {
    merchantId: 30004,
    decision: "approved" as const,
    expectedSubmissionId: SUBMISSION_ID,
    expectedPayloadHash: PAYLOAD_HASH,
    confirmed: true,
    ...overrides,
  };
}

function firstDraftPlatformCompany(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 51,
    enterpriseId: 71,
    // Deliberately distinct from enterpriseOwnerUserId: companies.userId is the
    // original data owner and must not decide a review or an ERP enablement.
    userId: ORIGINAL_COMPANY_USER,
    enterpriseOwnerUserId: CURRENT_ENTERPRISE_SUPER_ADMIN,
    registrationData: { ...registration },
    pendingDraft: null,
    licenseObjectKey: documents.BR.objectKey,
    licenseFileName: documents.BR.fileName,
    bankLicenseObjectKey: documents.BANK.objectKey,
    bankLicenseFileName: documents.BANK.fileName,
    certLevel: "pending",
    reviewStatus: "pending",
    registrationSubmissionId: SUBMISSION_ID,
    registrationPayloadHash: PAYLOAD_HASH,
    ...overrides,
  };
}

function resubmissionPlatformCompany(overrides: Partial<Record<string, unknown>> = {}) {
  return firstDraftPlatformCompany({
    pendingDraft: JSON.stringify({
      registrationData: { ...registration },
      licenseObjectKey: documents.BR.objectKey,
      licenseFileName: documents.BR.fileName,
      bankLicenseObjectKey: documents.BANK.objectKey,
      bankLicenseFileName: documents.BANK.fileName,
    }),
    ...overrides,
  });
}

function crmPlatformCompany(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ownerUserId: CURRENT_ENTERPRISE_SUPER_ADMIN,
    reviewStatus: "approved",
    pendingDraft: null,
    registrationSubmissionId: SUBMISSION_ID,
    registrationPayloadHash: PAYLOAD_HASH,
    ...overrides,
  };
}

function platformUpdate(plan: TransactionPlan) {
  const statement = plan.rendered.find(call => /^UPDATE\b/i.test(call.sql));
  expect(statement).toBeDefined();
  return statement!;
}

function platformSelect(plan: TransactionPlan) {
  const statement = plan.rendered.find(call => /^SELECT\b/i.test(call.sql));
  expect(statement).toBeDefined();
  return statement!;
}

beforeAll(async () => {
  // These are deliberately synthetic unit-test values, never read from a file.
  process.env.DATABASE_URL = "mysql://unit:unit@127.0.0.1:3306/unit_hk_review";
  process.env.PLATFORM_DB_NAME = "unit_platform";
  dbModule = await import("./db");
});

beforeEach(() => {
  drizzleMock.mockClear();
  drizzleMock.mockReturnValue(fakeDatabase);
  createLockConnectionMock.mockReset();
  createLockConnectionMock.mockResolvedValue({
    query: async (statement: string) => statement.includes("GET_LOCK")
      ? [[{ acquired: 1 }], undefined]
      : [[{ released: 1 }], undefined],
    end: async () => undefined,
  });
  installPlan();
});

afterAll(() => {
  delete process.env.DATABASE_URL;
  delete process.env.PLATFORM_DB_NAME;
});

describe("reviewHkRegistrationDraft — real transaction with offline mysql/drizzle", () => {
  it("atomically promotes a first HK draft only when main registration, ledger, BR/BANK evidence, and current enterprise owner all match", async () => {
    const plan = installPlan({
      selectResults: [[hkMerchant()]],
      executeResults: [
        [[firstDraftPlatformCompany()], undefined],
        [{ affectedRows: 1 }, undefined],
      ],
    });

    await expect(dbModule.reviewHkRegistrationDraft({
      ...reviewInput(),
      note: "All HK documents verified",
      actor: { operatorId: 9, operatorName: "reviewer", operatorRole: "super_admin" },
    })).resolves.toEqual({ success: true, decision: "approved", crmStatus: "pending" });

    expect(drizzleMock).toHaveBeenCalledWith("mysql://unit:unit@127.0.0.1:3306/unit_hk_review");
    expect(activeTransaction.execute).toHaveBeenCalledTimes(3);
    expect(activeTransaction.update).toHaveBeenCalledTimes(1);
    expect(activePlan.merchantSets[0]).toMatchObject({
      registrationPendingData: null,
      licenseObjectKey: documents.BR.objectKey,
      ciObjectKey: documents.CI.objectKey,
      bankDocumentObjectKey: documents.BANK.objectKey,
      status: "approved",
    });
    expect(activePlan.auditValues).toHaveLength(1);
    expect(activePlan.auditValues[0]).toMatchObject({
      afterValue: expect.objectContaining({ submissionId: SUBMISSION_ID, payloadHash: PAYLOAD_HASH }),
    });
    expect(JSON.stringify(activePlan.auditValues[0])).not.toContain("bankAccountNumber");
    expect(JSON.stringify(activePlan.auditValues[0])).not.toContain("documentObjectKeys");

    const read = platformSelect(plan);
    expect(read.sql).toContain("enterprise.superAdminUserId");
    expect(read.sql).not.toContain("company.userId");
    // The fixture's original companies.userId is intentionally different; the
    // current enterprise super administrator is the only accepted owner.
    expect(read.params).toContain(CURRENT_ENTERPRISE_SUPER_ADMIN);

    const update = platformUpdate(plan);
    expect(update.sql).toMatch(/UPDATE unit_platform\.companies AS company/i);
    expect(update.sql).toContain("company.registrationSubmissionId = ?");
    expect(update.sql).toContain("company.registrationPayloadHash = ?");
    expect(update.sql).toContain("company.reviewStatus = 'pending'");
    expect(update.sql).toContain("company.pendingDraft IS NULL");
    expect(update.params).toContain(SUBMISSION_ID);
    expect(update.params).toContain(PAYLOAD_HASH);
    const enterpriseUpdate = plan.rendered.find(call => /UPDATE unit_platform\.enterprises AS enterprise/i.test(call.sql));
    expect(enterpriseUpdate?.sql).toContain("enterprise.companyName = ?");
    expect(enterpriseUpdate?.sql).toContain("enterprise.superAdminUserId");
  });

  it.each([
    ["submission revision", (company: Record<string, unknown>) => { company.registrationSubmissionId = "33333333-3333-4333-8333-333333333333"; }],
    ["payload hash", (company: Record<string, unknown>) => { company.registrationPayloadHash = "c".repeat(64); }],
    ["BR object key", (company: Record<string, unknown>) => { company.licenseObjectKey = documents.BR.objectKey.replace("br-proof", "other-br-proof"); }],
    ["BANK object key", (company: Record<string, unknown>) => { company.bankLicenseObjectKey = documents.BANK.objectKey.replace("bank-proof", "other-bank-proof"); }],
    ["BANK file name", (company: Record<string, unknown>) => { company.bankLicenseFileName = "other-bank-proof.pdf"; }],
  ])("rejects a mismatched %s before its platform or merchant UPDATE", async (_label, mutate) => {
    const company = firstDraftPlatformCompany();
    mutate(company);
    const plan = installPlan({
      selectResults: [[hkMerchant()]],
      executeResults: [[[company], undefined]],
    });

    await expect(dbModule.reviewHkRegistrationDraft(reviewInput()))
      .rejects.toThrow("HK_PLATFORM_DRAFT_PROMOTION_FAILED");

    expect(activeTransaction.execute).toHaveBeenCalledTimes(1); // SELECT FOR UPDATE only
    expect(activeTransaction.update).not.toHaveBeenCalled();
    expect(plan.rendered.some(call => /^UPDATE\b/i.test(call.sql))).toBe(false);
  });

  it("rejects a stale reviewer version before any platform SELECT or promotion", async () => {
    const merchant = hkMerchant({
      registrationPendingData: pendingRegistration({
        submissionId: "33333333-3333-4333-8333-333333333333",
        payloadHash: "c".repeat(64),
      }),
      hkSubmissionId: "33333333-3333-4333-8333-333333333333",
      hkPayloadHash: "c".repeat(64),
    });
    const plan = installPlan({
      selectResults: [[merchant]],
    });

    await expect(dbModule.reviewHkRegistrationDraft(reviewInput()))
      .rejects.toThrow("HK_REVIEW_VERSION_CHANGED");

    expect(activeTransaction.execute).not.toHaveBeenCalled();
    expect(activeTransaction.update).not.toHaveBeenCalled();
    expect(plan.rendered.some(call => /^UPDATE\b/i.test(call.sql))).toBe(false);
  });

  it("rejects a malformed CI private object key before it even reads the main platform company", async () => {
    const merchant = hkMerchant({
      registrationPendingData: pendingRegistration({
        documentObjectKeys: { ...pendingRegistration().documentObjectKeys, CI: "public/ci-proof.pdf" },
      }),
    });
    const plan = installPlan({ selectResults: [[merchant]] });

    await expect(dbModule.reviewHkRegistrationDraft(reviewInput()))
      .rejects.toThrow("HK_PENDING_REGISTRATION_NOT_FOUND");

    expect(activeTransaction.execute).not.toHaveBeenCalled();
    expect(activeTransaction.update).not.toHaveBeenCalled();
    expect(plan.merchantSets).toEqual([]);
  });

  it("requires exactly one affected platform row from the first-draft ledger CAS before changing the admin record", async () => {
    const plan = installPlan({
      selectResults: [[hkMerchant()]],
      executeResults: [
        [[firstDraftPlatformCompany()], undefined],
        [{ affectedRows: 0 }, undefined],
      ],
    });

    await expect(dbModule.reviewHkRegistrationDraft(reviewInput()))
      .rejects.toThrow("HK_PLATFORM_DRAFT_PROMOTION_FAILED");

    expect(activeTransaction.execute).toHaveBeenCalledTimes(2);
    expect(activeTransaction.update).not.toHaveBeenCalled();
    expect(platformUpdate(plan).sql).toContain("company.pendingDraft IS NULL");
  });

  it("rejects a resubmission without touching effective ERP data or the already-approved registration", async () => {
    const merchant = hkMerchant({
      crmStatus: "enabled",
      status: "approved",
      registrationData: storedEffectiveRegistration(),
      registrationPendingData: pendingRegistration(),
      // Existing effective private objects intentionally differ from the pending set.
      licenseObjectKey: "hk-registration/user-original-company-user/BR/22222222-2222-4222-8222-222222222222_effective-br.pdf",
      ciObjectKey: "hk-registration/user-original-company-user/CI/22222222-2222-4222-8222-222222222222_effective-ci.pdf",
      bankDocumentObjectKey: "hk-registration/user-original-company-user/BANK/22222222-2222-4222-8222-222222222222_effective-bank.pdf",
    });
    const plan = installPlan({
      selectResults: [[merchant]],
      executeResults: [
        [[resubmissionPlatformCompany()], undefined],
        [{ affectedRows: 1 }, undefined],
      ],
    });

    await expect(dbModule.reviewHkRegistrationDraft({
      ...reviewInput({ decision: "rejected", confirmed: false }),
      note: "Please replace the new bank proof",
    })).resolves.toEqual({ success: true, decision: "rejected", crmStatus: "enabled" });

    const merchantWrite = plan.merchantSets[0];
    expect(merchantWrite).toMatchObject({ registrationPendingData: null, reviewNote: "Please replace the new bank proof" });
    expect(merchantWrite).not.toHaveProperty("crmStatus");
    expect(merchantWrite).not.toHaveProperty("status");
    expect(merchantWrite).not.toHaveProperty("registrationData");
    expect(merchantWrite).not.toHaveProperty("licenseObjectKey");
    expect(merchantWrite).not.toHaveProperty("ciObjectKey");
    expect(merchantWrite).not.toHaveProperty("bankDocumentObjectKey");

    const update = platformUpdate(plan);
    expect(update.sql).toContain("company.pendingDraft = NULL");
    expect(update.params).toContain("approved"); // an effective registration remains approved
  });

  it("rejects pending document signing when its local submission ledger has drifted", async () => {
    const merchant = hkMerchant({ hkPayloadHash: OLD_PAYLOAD_HASH });

    await expect(dbModule.getMerchantHkDocumentSource(
      merchant,
      "BR",
      "pending",
      { expectedSubmissionId: SUBMISSION_ID, expectedPayloadHash: PAYLOAD_HASH },
    )).rejects.toThrow("HK_REVIEW_VERSION_CHANGED");
  });
});

describe("setMerchantCrmStatus — real HK enablement gate with offline mysql/drizzle", () => {
  it("enables only a reviewed, non-pending platform registration with matching submission ledger IDs", async () => {
    const merchant = hkMerchant({
      status: "approved",
      registrationData: storedEffectiveRegistration({ submissionId: SUBMISSION_ID, payloadHash: PAYLOAD_HASH }),
      registrationPendingData: null,
    });
    const plan = installPlan({
      selectResults: [
        [merchant],
        [], // read-only duplicate detector under the advisory carrier lock
        [{ crmStatus: "enabled", crmOwnerPortalUserId: CURRENT_ENTERPRISE_SUPER_ADMIN, crmNote: null }],
      ],
      executeResults: [[[crmPlatformCompany()], undefined]],
      updateResults: [[{ affectedRows: 1 }]],
    });

    await expect(dbModule.setMerchantCrmStatus({
      merchantId: 30004,
      crmStatus: "enabled",
      portalUserId: CURRENT_ENTERPRISE_SUPER_ADMIN,
    })).resolves.toEqual({ success: true, crmOwnerPortalUserId: CURRENT_ENTERPRISE_SUPER_ADMIN });

    expect(activeTransaction.update).toHaveBeenCalledTimes(1);
    expect(plan.merchantSets[0]).toMatchObject({
      crmStatus: "enabled",
      crmOwnerPortalUserId: CURRENT_ENTERPRISE_SUPER_ADMIN,
    });
    const read = platformSelect(plan);
    expect(read.sql).toContain("company.reviewStatus");
    expect(read.sql).toContain("company.pendingDraft");
    expect(read.sql).toContain("company.registrationSubmissionId");
    expect(read.sql).toContain("company.registrationPayloadHash");
  });

  it.each([
    ["platform review is still pending", (company: Record<string, unknown>) => { company.reviewStatus = "pending"; }],
    ["platform has a pending draft", (company: Record<string, unknown>) => { company.pendingDraft = "{}"; }],
    ["platform submission revision changed", (company: Record<string, unknown>) => { company.registrationSubmissionId = "33333333-3333-4333-8333-333333333333"; }],
    ["platform payload hash changed", (company: Record<string, unknown>) => { company.registrationPayloadHash = "d".repeat(64); }],
  ])("does not enable when %s", async (_label, mutate) => {
    const merchant = hkMerchant({
      status: "approved",
      registrationData: storedEffectiveRegistration({ submissionId: SUBMISSION_ID, payloadHash: PAYLOAD_HASH }),
      registrationPendingData: null,
    });
    const company = crmPlatformCompany();
    mutate(company);
    const plan = installPlan({
      selectResults: [[merchant]],
      executeResults: [[[company], undefined]],
    });

    await expect(dbModule.setMerchantCrmStatus({
      merchantId: 30004,
      crmStatus: "enabled",
      portalUserId: CURRENT_ENTERPRISE_SUPER_ADMIN,
    })).rejects.toThrow("HK_PLATFORM_REVIEW_OR_OWNER_INVALID");

    expect(activeTransaction.update).not.toHaveBeenCalled();
    expect(plan.merchantSets).toEqual([]);
  });

  it("does not let an already-enabled HK merchant implicitly approve a pending platform draft", async () => {
    const merchant = hkMerchant({
      crmStatus: "enabled",
      status: "approved",
      registrationData: storedEffectiveRegistration({ submissionId: SUBMISSION_ID, payloadHash: PAYLOAD_HASH }),
      registrationPendingData: null,
    });
    const plan = installPlan({
      selectResults: [[merchant]],
      executeResults: [[[crmPlatformCompany({ reviewStatus: "pending" })], undefined]],
    });

    await expect(dbModule.setMerchantCrmStatus({ merchantId: 30004, crmStatus: "enabled" }))
      .rejects.toThrow("HK_PLATFORM_REVIEW_OR_OWNER_INVALID");

    expect(activeTransaction.update).not.toHaveBeenCalled();
    expect(plan.merchantSets).toEqual([]);
  });
});

describe("HK cross-database SQL source guard", () => {
  function findMysqlTableColumns(sourceFile: ts.SourceFile, tableName: string) {
    let columns: string[] | undefined;
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === tableName
        && node.initializer && ts.isCallExpression(node.initializer)) {
        const objectArgument = node.initializer.arguments[1];
        if (objectArgument && ts.isObjectLiteralExpression(objectArgument)) {
          columns = objectArgument.properties.flatMap(property => {
            if (!ts.isPropertyAssignment(property)) return [];
            if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) return [property.name.text];
            return [];
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    expect(columns, `unable to locate ${tableName} mysqlTable in main schema`).toBeDefined();
    return new Set(columns!);
  }

  function platformStatements(sourceFile: ts.SourceFile, functionName: string) {
    const statements: Array<{ kind: "SELECT" | "UPDATE"; text: string }> = [];
    const visitFunction = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) {
        const visitSql = (child: ts.Node): void => {
          if (ts.isTaggedTemplateExpression(child) && ts.isIdentifier(child.tag) && child.tag.text === "sql") {
            const text = child.getText(sourceFile);
            const match = /\b(SELECT|UPDATE)\b/.exec(text);
            if (match) statements.push({ kind: match[1] as "SELECT" | "UPDATE", text });
          }
          ts.forEachChild(child, visitSql);
        };
        ts.forEachChild(node, visitSql);
        return;
      }
      ts.forEachChild(node, visitFunction);
    };
    visitFunction(sourceFile);
    return statements;
  }

  it("maps every real cross-database SELECT/UPDATE field to the main-site schema and keeps identity fields read-only", () => {
    const dbText = fs.readFileSync(DB_SOURCE_PATH, "utf8");
    const mainSchemaText = fs.readFileSync(MAIN_SCHEMA_PATH, "utf8");
    const dbAst = ts.createSourceFile(DB_SOURCE_PATH, dbText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const mainAst = ts.createSourceFile(MAIN_SCHEMA_PATH, mainSchemaText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const validColumns = {
      company: findMysqlTableColumns(mainAst, "companies"),
      enterprise: findMysqlTableColumns(mainAst, "enterprises"),
    };
    const statements = [
      ...platformStatements(dbAst, "reviewHkRegistrationDraft"),
      ...platformStatements(dbAst, "setMerchantCrmStatus"),
    ];

    // Review: SELECT + guarded company promotion + enterprise-name sync +
    // reject UPDATE; CRM enable: SELECT.
    expect(statements.map(statement => statement.kind)).toEqual(["SELECT", "UPDATE", "UPDATE", "UPDATE", "SELECT"]);
    for (const statement of statements) {
      expect(statement.text).toContain("${sql.raw(PLATFORM_DB)}");
      if (statement.text.includes(".companies")) {
        expect(statement.text).toContain("companies");
      } else {
        // Approval updates the locked current enterprise by ID; a same-name
        // write can report zero changed rows and is intentionally accepted.
        expect(statement.text).toContain(".enterprises AS enterprise");
      }
      for (const match of statement.text.matchAll(/\b(company|enterprise)\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
        const [, alias, column] = match;
        expect(validColumns[alias as "company" | "enterprise"].has(column), `${alias}.${column} is not a main-site schema column`).toBe(true);
      }
    }

    const updates = statements.filter(statement => statement.kind === "UPDATE");
    for (const update of updates) {
      const setClause = update.text.split(/\bWHERE\b/)[0];
      // Stable identity / ownership ledgers only participate in the WHERE CAS.
      // This inspects executable SQL AST nodes, not comments or documentation.
      for (const readOnly of [
        "registrationRegion",
        "registrationIdentifier",
        "registrationSubmissionId",
        "registrationPayloadHash",
        "enterpriseId",
        "userId",
      ]) {
        expect(setClause).not.toMatch(new RegExp(`company\\.${readOnly}\\s*=`, "i"));
      }
    }

    const allSql = statements.map(statement => statement.text).join("\n");
    for (const nonexistentMainCompanyColumn of [
      "businessNature",
      "bankAddress",
      "registeredAddress",
      "establishedDate",
      "bankDocumentObjectKey",
    ]) {
      expect(allSql).not.toMatch(new RegExp(`company\\.${nonexistentMainCompanyColumn}\\b`, "i"));
    }
  });
});
