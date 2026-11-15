import { describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
vi.mock("../client/src/business/platform/front-router-types/server/db", () => ({ getDb: () => { throw new Error("REAL_DB_FORBIDDEN"); } }));
vi.mock("../client/src/business/platform/front-router-types/server/services/crmCustomers", () => ({
  resolveCrmCustomerPolicy: vi.fn(), assertCrmCustomerPolicy: vi.fn(),
  crmCustomerPolicyWhere: asyncPlaceholder,
}));
function asyncPlaceholder() { throw new Error("NATIVE_SQL_IS_TESTED_IN_SERVICE_SUITE"); }
vi.mock("../client/src/business/platform/front-router-types/server/services/channelFactoryPublication", () => ({ factoryMaterialPublicationMetadata: async () => new Map(), createChannelFactoryPublicationService: vi.fn() }));
import { historyActorIsSelf, resolveCustomerUploadHistoryPolicy, type CustomerUploadHistoryPolicyDependencies } from "../client/src/business/platform/front-router-types/server/services/customerUploadHistoryPolicy";
import { ChannelInventoryError, type ChannelInventoryScope } from "../client/src/business/platform/front-router-types/server/services/channelInventory";
import * as schemas from "../client/src/business/platform/shared/customerUploadHistory";
import { CHANNEL_INVENTORY_BUSINESS_METHOD_IDS, CHANNEL_INVENTORY_BUSINESS_METHOD_POLICIES } from "../client/src/business/platform/shared/channelInventoryBusinessPolicy";
import { officialInventoryMethodRequirement, NATIVE_TEAM_READ_METHODS } from "../client/src/business/platform/shared/internalBusinessOfficialInventory";
const scope: ChannelInventoryScope = { enterpriseId: 1, dataOwnerUserId: 99, actorUserId: 10, isOwner: false, permissionSnapshot: true, inventoryDataScope: "enterprise" };
const expected = { expectedEnterpriseId: 1, expectedActorUserId: 10 };
const uuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const defaultPolicy = { read: true, write: true, scope: "self" as const, teamRole: "member" as const, teamId: 7, explicit: true };
const dependencies = (options: Partial<CustomerUploadHistoryPolicyDependencies> = {}): CustomerUploadHistoryPolicyDependencies => ({
  resolveCustomerSupplyReadPolicy: vi.fn(async () => defaultPolicy),
  resolveChannelInventoryAuthority: vi.fn(async () => ({ ...defaultPolicy, isOwner: false })),
  resolveCrmCustomerPolicy: vi.fn(async () => defaultPolicy), ...options,
});

describe("customer history: fixed strict contracts and trusted identity policy", () => {
  it("exactly eight static methods with original inventory.manage and proper read/write", () => {
    expect(Object.keys(schemas.CUSTOMER_UPLOAD_HISTORY_INPUT_SCHEMAS)).toHaveLength(8);
    for (const method of Object.keys(schemas.CUSTOMER_UPLOAD_HISTORY_INPUT_SCHEMAS)) {
      expect(CHANNEL_INVENTORY_BUSINESS_METHOD_IDS).toContain(method); expect(schemas.isCustomerUploadHistoryMethod(method)).toBe(true);
      const mode = ["channelInventory.customerUploadHistoryList", "channelInventory.customerUploadHistoryGet", "channelInventory.customerUploadDownload"].includes(method) ? "read" : "write";
      expect(CHANNEL_INVENTORY_BUSINESS_METHOD_POLICIES[method as keyof typeof CHANNEL_INVENTORY_BUSINESS_METHOD_POLICIES]).toEqual({ mode, permission: "inventory.manage" });
      expect(officialInventoryMethodRequirement(method)).toBe(mode); expect(NATIVE_TEAM_READ_METHODS).not.toContain(method);
    }
    expect(schemas.isCustomerUploadHistoryMethod("__proto__")).toBe(false); expect(schemas.isCustomerUploadHistoryMethod("channelInventory.createMaterial")).toBe(false);
  });
  it("self requires immutable front AND official admin identities, never current role or owner", () => {
    expect(historyActorIsSelf(scope, { uploaded_by_user_id: 10, uploaded_by_admin_account_id: null })).toBe(true);
    const official = { ...scope, officialActor: { adminAccountId: 55, bindingVersion: 2, requestId: uuid } };
    expect(historyActorIsSelf(official, { uploaded_by_user_id: 10, uploaded_by_admin_account_id: 55 })).toBe(true);
    expect(historyActorIsSelf(official, { uploaded_by_user_id: 10, uploaded_by_admin_account_id: 56 })).toBe(false);
    expect(historyActorIsSelf(official, { uploaded_by_user_id: 11, uploaded_by_admin_account_id: 55 })).toBe(false);
    expect(historyActorIsSelf({ ...scope, isOwner: true }, { uploaded_by_user_id: 11, uploaded_by_admin_account_id: null })).toBe(false);
    expect(historyActorIsSelf(scope, { uploaded_by_user_id: 10, uploaded_by_admin_account_id: 55 })).toBe(false);
  });
  it("native CRM read rejection occurs before ANY metadata/database projection", async () => {
    const execute = vi.fn(); const deps = dependencies({ resolveCustomerSupplyReadPolicy: vi.fn(async () => { throw new ChannelInventoryError("FORBIDDEN", "客户读取拒绝"); }) });
    await expect(resolveCustomerUploadHistoryPolicy({ execute }, scope, false, deps)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(execute).not.toHaveBeenCalled(); expect(deps.resolveChannelInventoryAuthority).not.toHaveBeenCalled();
  });
  it("both native channels/stocks and write CRM run before manager query, exact tx executor", async () => {
    const order: string[] = []; const execute = vi.fn(async () => { order.push("managerSQL"); return [[]]; });
    const deps = dependencies({
      resolveCustomerSupplyReadPolicy: vi.fn(async tx => { order.push("CRMread"); expect(typeof tx.execute).toBe("function"); return defaultPolicy; }),
      resolveChannelInventoryAuthority: vi.fn(async (_tx, _scope, module, write, lock) => { order.push(module); expect(write).toBe(true); expect(lock).toBe(true); return { ...defaultPolicy, isOwner: false }; }),
      resolveCrmCustomerPolicy: vi.fn(async (_tx, _scope, write) => { order.push("CRMwrite"); expect(write).toBe(true); return defaultPolicy; }),
    });
    const policy = await resolveCustomerUploadHistoryPolicy({ execute }, scope, true, deps); expect(order).toEqual(["CRMread", "channels", "stocks", "CRMwrite", "managerSQL"]); expect(policy.canManage).toBe(false);
    const compiled = new MySqlDialect().sqlToQuery(execute.mock.calls[0][0]); expect(compiled.sql).toContain("e.id = em.enterpriseId"); expect(compiled.sql).toContain("mp.enterpriseMemberId = em.id");
  });
  it("self CRM / ordinary peer / stock self / false manager SQL never invent team management", async () => {
    const native = { ...defaultPolicy, scope: "team" as const, teamRole: "leader" as const };
    for (const [crm, stock, actualManager] of [[defaultPolicy, native, true], [native, defaultPolicy, true], [native, { ...native, teamId: 8 }, false], [{ ...native, explicit: false }, native, false]] as const) {
      const deps = dependencies({ resolveCustomerSupplyReadPolicy: vi.fn(async () => crm), resolveChannelInventoryAuthority: vi.fn(async () => ({ ...stock, isOwner: false })) });
      const policy = await resolveCustomerUploadHistoryPolicy({ execute: async () => actualManager ? [[{ id: 1 }]] : [[]] }, scope, false, deps); expect(policy.canManage).toBe(false);
    }
  });
  it("bounded list/date/cursor rejects malformed dates, arbitrary actor/tenant fields, size", () => {
    expect(schemas.customerUploadHistoryListSchema.safeParse({ ...expected, pageSize: 51 }).success).toBe(false);
    expect(schemas.customerUploadHistoryListSchema.safeParse({ ...expected, dateFrom: "2026-02-30" }).success).toBe(false);
    expect(schemas.customerUploadHistoryListSchema.safeParse({ ...expected, dateFrom: "2026-11-16", dateTo: "2026-11-15" }).success).toBe(false);
    expect(schemas.customerUploadHistoryListSchema.safeParse({ ...expected, dataOwnerUserId: 99 }).success).toBe(false);
    expect(schemas.customerUploadHistoryGetSchema.safeParse({ ...expected, historyId: uuid, locator: "/private/foo" }).success).toBe(false);
    expect(schemas.customerUploadDownloadSchema.safeParse({ ...expected, files: Array.from({ length: 21 }, () => ({ historyId: uuid, fileId: uuid })) }).success).toBe(false);
    expect(schemas.customerUploadDownloadSchema.safeParse({ ...expected, files: [{ historyId: uuid, fileId: uuid }], materialId: 1 }).success).toBe(false);
  });
  it("base64 validates linearly at binary cap, rejects padding/path/publicURL", () => {
    const file = { fileName: "valid.csv", mimeType: "text/csv", base64: Buffer.alloc(10 * 1024 * 1024).toString("base64") };
    expect(schemas.customerUploadFileInputSchema.safeParse(file).success).toBe(true);
    expect(schemas.customerUploadFileInputSchema.safeParse({ ...file, base64: "AA=A" }).success).toBe(false);
    expect(schemas.customerUploadFileInputSchema.safeParse({ ...file, base64: "YWJj\n" }).success).toBe(false);
    expect(schemas.customerUploadFileInputSchema.safeParse({ ...file, fileName: "../secret.csv" }).success).toBe(false);
    expect(schemas.customerUploadFileInputSchema.safeParse({ ...file, publicUrl: "https://unsafe" }).success).toBe(false);
  });
  it("unknown candidate stays null; resolution/exclusion require human reasons; strict browser receipt rejection", () => {
    const candidate = { partNumber: null, brand: null, qty: null, dateCode: null, price: null, currency: null, taxIncluded: null, leadTime: null, note: null };
    expect(schemas.customerUploadCandidateFieldsSchema.parse(candidate)).toEqual(candidate);
    expect(schemas.customerUploadIssueSchema.safeParse({ issueId: uuid, rowId: null, field: "currency", message: "未知", resolved: true, resolution: null }).success).toBe(false);
    expect(schemas.customerUploadIssueSchema.safeParse({ issueId: uuid, rowId: null, field: "currency", message: "未知", resolved: true, resolution: "人工核对后仍未知留空" }).success).toBe(true);
    expect(schemas.customerUploadReconcileBatchSchema.safeParse({ ...expected, historyId: uuid, confirmationId: uuid, requestId: uuid, receipt: { materialId: 1, successCount: 1 } }).success).toBe(false);
  });
});
