import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import {
  contactsAddSchema, contactsEditSchema, contactsListSchema, contactsSetPrimarySchema,
  contactsStopSchema, contactsSummarySchema, createMultiSchema, updateBasicSchema,
} from "../client/src/business/platform/shared/customerContacts";

const prior = { node: process.env.NODE_ENV, ids: process.env.BUSINESS_WORKBENCH_MERCHANT_IDS,
  base: process.env.PLATFORM_API_BASE, key: process.env.PORTAL_API_KEY };
const merchant = { id: 30061, merchantNo: "local-contact-fixture", companyName: "本地虚构企业",
  crmStatus: "enabled", registrationRegion: "CN", registrationIdentifier: null,
  businessLicense: "91310000MAH4E001XX", crmOwnerPortalUserId: "101" };
const identity = { expectedActorUserId: 202, expectedEnterpriseId: 501 };
const contact = { name: "本地联系人", department: "", position: "", methods: [{ type: "wechat", value: "fixture-contact" }] };
const requestId = "contact-bff-runtime-request-0001";
const schemas = {
  createMulti: createMultiSchema, contactsList: contactsListSchema, contactsSummary: contactsSummarySchema,
  contactsAdd: contactsAddSchema, contactsEdit: contactsEditSchema, contactsStop: contactsStopSchema,
  contactsSetPrimary: contactsSetPrimarySchema, updateBasic: updateBasicSchema,
};
type Method = keyof typeof schemas;
const inputs: Record<Method, object> = {
  createMulti: { ...identity, data: { name: "本地客户" }, contacts: [{ ...contact, isPrimary: true }], requestId },
  contactsList: { ...identity, customerId: 1 },
  contactsSummary: { ...identity, customerIds: [1, 2] },
  contactsAdd: { ...identity, customerId: 1, contact, requestId },
  contactsEdit: { ...identity, customerId: 1, contactId: "fixture-contact-1", version: 2, contact, requestId },
  contactsStop: { ...identity, customerId: 1, contactId: "fixture-contact-1", version: 2, replacementContactId: "fixture-contact-2", requestId },
  contactsSetPrimary: { ...identity, customerId: 1, contactId: "fixture-contact-2", version: 3, requestId },
  updateBasic: { ...identity, customerId: 1, version: 4, data: { name: "本地客户" }, confirmDuplicate: true, requestId },
};
function context(role: "merchant_mgr" | "super_admin" = "merchant_mgr"): TrpcContext {
  const now = new Date("2030-01-01T00:00:00Z");
  return {
    user: { id: 303, openId: "local_admin:303", name: "本地后台员工", email: "operator@example.test",
      loginMethod: "password", role: "admin", createdAt: now, updatedAt: now, lastSignedIn: now },
    adminAccount: { id: 303, userId: 0, username: "fixture-operator", displayName: "本地后台员工",
      email: "operator@example.test", phone: null, passwordHash: null, adminRole: role, status: "active",
      mfaEnabled: false, lastLoginAt: now, createdAt: now, updatedAt: now },
    adminPermissions: [], req: { headers: { "x-business-merchant-id": "30061" }, protocol: "https", ip: "127.0.0.1" } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}
let binding: { adminUserId: number; frontUserId: number; bindingVersion: number } | null;
let permissions: string[];
let dbMocks: Record<string, ReturnType<typeof vi.fn>>;
let fetchMock: ReturnType<typeof vi.fn>;
let router: typeof import("./businessRouter")["businessRouter"];
let envelope: Record<string, unknown>[];

beforeEach(async () => {
  process.env.NODE_ENV = "test";
  process.env.BUSINESS_WORKBENCH_MERCHANT_IDS = "30061";
  process.env.PLATFORM_API_BASE = "http://platform.invalid";
  process.env.PORTAL_API_KEY = "local-fixture-key-not-production";
  binding = { adminUserId: 303, frontUserId: 202, bindingVersion: 7 };
  permissions = ["business.customers.read", "business.customers.write"];
  envelope = [];
  dbMocks = {
    withBusinessAuthorizationFence: vi.fn(async (_key: unknown, operation: () => Promise<unknown>) => operation()),
    getActiveBusinessStaffBinding: vi.fn(async () => binding),
    getActiveBusinessMerchantScope: vi.fn(async () => ({ id: 10, adminUserId: 303, merchantId: 30061, scopeVersion: 3, modulePermissions: permissions })),
    getBusinessWorkbenchMerchantById: vi.fn(async () => merchant),
    recordBusinessCommandAccess: vi.fn(async () => undefined),
  };
  fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe("http://platform.invalid/api/trpc/internalBusiness.execute?batch=1");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBeUndefined();
    const payload = JSON.parse(String(init.body))["0"].json as Record<string, unknown>;
    expect(payload.staffUserId).toBe(202);
    expect(payload.bindingVersion).toBe(binding?.bindingVersion);
    expect(payload.binding).toBeUndefined();
    expect(payload.expectedOwnerUserId).toBe(101);
    expect(payload.adminActor).toMatchObject({ id: 303 });
    const method = String(payload.method).replace(/^customer\./, "") as Method;
    expect(schemas[method]).toBeDefined();
    schemas[method].parse(payload.params);
    envelope.push(payload);
    return new Response(JSON.stringify([{ result: { data: { json: { accepted: true } } } }]), {
      status: 200, headers: { "content-type": "application/json" },
    });
  });
  vi.resetModules();
  vi.doMock("./db", () => dbMocks);
  vi.stubGlobal("fetch", fetchMock);
  ({ businessRouter: router } = await import("./businessRouter"));
});

afterEach(() => {
  vi.doUnmock("./db");
  vi.unstubAllGlobals();
  vi.resetModules();
  const restore = (key: string, value: string | undefined) => value === undefined ? delete process.env[key] : process.env[key] = value;
  restore("NODE_ENV", prior.node); restore("BUSINESS_WORKBENCH_MERCHANT_IDS", prior.ids);
  restore("PLATFORM_API_BASE", prior.base); restore("PORTAL_API_KEY", prior.key);
});

describe("联系人精确BFF真实caller和运输合同", () => {
  it("八方法保留读写类型、真实binding和共享严格DTO，再进入internalBusiness运输", async () => {
    const caller = router.createCaller(context());
    for (const method of Object.keys(schemas) as Method[]) {
      const mode = method === "contactsList" || method === "contactsSummary" ? "query" : "mutation";
      expect(router._def.procedures[`customer.${method}`]._def.type).toBe(mode);
      await expect(caller.customer[method](inputs[method])).resolves.toEqual({ accepted: true });
    }
    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(dbMocks.withBusinessAuthorizationFence).toHaveBeenCalledTimes(8);
    expect(dbMocks.getActiveBusinessStaffBinding).toHaveBeenCalledTimes(8);
    expect(dbMocks.recordBusinessCommandAccess).toHaveBeenCalledTimes(8);
    expect(envelope.map(item => item.method)).toEqual(Object.keys(schemas).map(method => `customer.${method}`));
    for (const item of envelope) expect(item.staffUserId).not.toBe(303);
  });
  it("即使后台超管，无绑定也不得转发；scope撤销后下一请求重新拒绝", async () => {
    binding = null;
    await expect(router.createCaller(context("super_admin")).customer.contactsList(inputs.contactsList)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(fetchMock).not.toHaveBeenCalled();
    binding = { adminUserId: 303, frontUserId: 202, bindingVersion: 7 };
    await router.createCaller(context()).customer.contactsList(inputs.contactsList);
    permissions = [];
    await expect(router.createCaller(context()).customer.contactsAdd(inputs.contactsAdd)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(dbMocks.recordBusinessCommandAccess).toHaveBeenCalledTimes(1);
  });
  it("bindingVersion每请求重新读取，浏览器params不得替换BFF员工身份", async () => {
    const caller = router.createCaller(context());
    await caller.customer.contactsList(inputs.contactsList);
    binding = { adminUserId: 303, frontUserId: 202, bindingVersion: 8 };
    await caller.customer.contactsList(inputs.contactsList);
    expect(envelope.map(item => item.bindingVersion)).toEqual([7, 8]);
    expect(router._def.procedures["customer.*"]).toBeUndefined();
    expect(router._def.procedures["customer.contactsSetCollaborators"]).toBeUndefined();
    expect(router._def.procedures["customer.contactsSharedList"]).toBeUndefined();
  });
});
