import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { verifyOfficialInventoryGrant } from "../client/src/business/platform/front-router-types/server/services/internalBusinessOfficialGrant";
import { CHANNEL_INVENTORY_BUSINESS_METHOD_IDS, CHANNEL_INVENTORY_BUSINESS_METHOD_POLICIES } from "../client/src/business/platform/shared/channelInventoryBusinessPolicy";
import { officialInventoryMethodRequirement } from "../shared/internalBusinessOfficialInventory";
import { CUSTOMER_UPLOAD_HISTORY_INPUT_SCHEMAS, isCustomerUploadHistoryBusinessMethod } from "./customerUploadHistoryBusinessInput";

const state = vi.hoisted(() => ({
  bound: true, active: true, scopeActive: true, role: "merchant_mgr", bindingVersion: 7,
  scope: [] as string[], native: [] as string[], revokeCrm: false, scopeReads: 0, denyRemote: false,
  fence: vi.fn(), transport: vi.fn(), audit: vi.fn(),
}));
vi.mock("./services/officialChannelProfileRead", () => ({ withOfficialChannelProfileRead: async (_ctx: unknown, _staff: unknown, run: (proof: undefined) => unknown) => run(undefined) }));
vi.mock("./db", () => ({
  withBusinessAuthorizationFence: async (key: unknown, operation: () => Promise<unknown>) => { state.fence(key); return operation(); },
  getAdminUserById: async () => ({ id: 303, status: state.active ? "active" : "disabled", adminRole: state.role, sessionVersion: 4 }),
  getAdminUserPermissions: async () => [...state.native],
  getActiveBusinessStaffBinding: async () => state.bound ? { frontUserId: 202, bindingVersion: state.bindingVersion } : null,
  getActiveBusinessMerchantScope: async () => { state.scopeReads++; return state.scopeActive ? { scopeVersion: 9, modulePermissions: state.revokeCrm && state.scopeReads % 2 === 0 ? state.scope.filter(p => p !== "business.customers.read") : [...state.scope] } : null; },
  getBusinessWorkbenchMerchantById: async () => ({ id: 51, merchantNo: "history-fixture", companyName: "本地虚构企业", crmStatus: "enabled", registrationRegion: "CN", businessLicense: "SYNTHETIC-CREDIT", crmOwnerPortalUserId: "101" }),
  recordBusinessCommandAccess: async (input: unknown) => state.audit(input),
}));
import { BUSINESS_METHOD_CAPABILITIES, businessRouter } from "./businessRouter";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const identity = { expectedEnterpriseId: 501, expectedActorUserId: 202 };
const file = { fileName: "synthetic.csv", mimeType: "text/csv", base64: Buffer.from("型号,品牌\nABC,本地测试品牌").toString("base64") };
const historyId = uuid(1), requestId = uuid(2), versionId = uuid(3);
const ref = { sheetIndex: 0, sheetName: "Sheet1", rowNumber: 2, originalRowHash: "0".repeat(64) };
const fields = { partNumber: "ABC", brand: "本地测试品牌", qty: 0, dateCode: null, price: "0.00", currency: "CNY", taxIncluded: null, leadTime: null, note: null };
const fence = { ...identity, historyId, requestId, expectedRevision: 1 };
const inputs = {
  customerUploadHistoryList: { ...identity, customerId: 11 },
  customerUploadHistoryGet: { ...identity, historyId },
  customerUploadOriginal: { ...identity, customerId: 11, mode: "parse", file, requestId },
  customerUploadManageMark: { ...fence, action: "start_parsing", reason: null },
  customerUploadResult: { ...fence, parentVersionId: null, normalizedFile: file, rows: [{ rowId: uuid(4), logicalRowId: uuid(5), sourceRefs: [ref], candidate: fields, disposition: "pending", excludeReason: null, issues: [] }], issues: [] },
  customerUploadDownload: { ...identity, files: [{ historyId, fileId: uuid(6) }] },
  customerUploadPrepareConfirmation: { ...fence, versionId, batchRequestId: uuid(7), expectedCustomerVersion: 2, sourceProfile: { type: "factory" }, confirmedRows: [{ logicalRowId: uuid(5), rowId: uuid(4), rowRequestId: uuid(8), sourceRefs: [ref], fields }], excludedRows: [] },
  customerUploadReconcileBatch: { ...identity, historyId, confirmationId: uuid(9), requestId },
} as const;
type Method = keyof typeof inputs;
const methods = Object.keys(inputs) as Method[];
const writes: Method[] = ["customerUploadOriginal", "customerUploadManageMark", "customerUploadResult", "customerUploadPrepareConfirmation", "customerUploadReconcileBatch"];
const ctx = (local = true): TrpcContext => ({ user: { id: 303, role: "admin" }, adminAccount: local ? { id: 303, status: "active", username: "history-fixture", displayName: "本地员工", adminRole: state.role } : null, adminPermissions: ["officialInventory.read", "officialInventory.write"], req: { headers: { "x-business-merchant-id": "51" }, ip: "127.0.0.1" }, res: {} } as unknown as TrpcContext);
async function call(method: Method, value: unknown = inputs[method]) { return (businessRouter.createCaller(ctx()).channelInventory[method] as (v: unknown) => Promise<unknown>)(value); }
function lastPayload() {
  const [url, init] = state.transport.mock.calls.at(-1)! as [string, RequestInit];
  expect(url).toBe("https://synthetic.invalid/api/trpc/internalBusiness.execute?batch=1");
  expect(init.method).toBe("POST");
  expect(init.headers).not.toHaveProperty("Cookie");
  expect(init.headers).not.toHaveProperty("Authorization");
  return JSON.parse(String(init.body))["0"].json;
}
beforeEach(() => {
  state.bound = true; state.active = true; state.scopeActive = true; state.role = "merchant_mgr"; state.bindingVersion = 7;
  state.scope = ["business.inventory.read", "business.inventory.write", "business.customers.read"];
  state.native = ["officialInventory.read", "officialInventory.write", "officialInventory.note"];
  state.revokeCrm = false; state.scopeReads = 0; state.denyRemote = false;
  for (const m of [state.fence, state.transport, state.audit]) m.mockReset();
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("BUSINESS_WORKBENCH_MERCHANT_IDS", "51");
  vi.stubEnv("PLATFORM_API_BASE", "https://synthetic.invalid"); vi.stubEnv("PORTAL_API_KEY", "synthetic-local-key");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    state.transport(url, init);
    return state.denyRemote
      ? new Response(JSON.stringify([{ error: { json: { message: "任务不存在或无权访问", data: { code: "NOT_FOUND" } } } }]), { status: 404 })
      : new Response(JSON.stringify([{ result: { data: { json: { marker: "synthetic-safe-result" } } } }]), { status: 200 });
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("解析历史八个固定 BFF 方法", () => {
  it.each(methods)("%s 真实注册、严格schema、mode、官方签名与绑定均一致", async method => {
    const full = `channelInventory.${method}`;
    const mode = writes.includes(method) ? "write" : "read";
    expect(businessRouter._def.procedures[full]._def.type).toBe(writes.includes(method) || method === "customerUploadDownload" ? "mutation" : "query");
    expect(BUSINESS_METHOD_CAPABILITIES.filter(c => c.method === full)).toEqual([{ method: full, module: "inventory", mode }]);
    expect(CHANNEL_INVENTORY_BUSINESS_METHOD_IDS.filter(id => id === full)).toHaveLength(1);
    expect(CHANNEL_INVENTORY_BUSINESS_METHOD_POLICIES[full as keyof typeof CHANNEL_INVENTORY_BUSINESS_METHOD_POLICIES]).toEqual({ mode, permission: "inventory.manage" });
    expect(officialInventoryMethodRequirement(full)).toBe(mode);
    await expect(call(method)).resolves.toEqual({ marker: "synthetic-safe-result" });
    const payload = lastPayload();
    expect(payload).toMatchObject({ method: full, staffUserId: 202, bindingVersion: 7, expectedOwnerUserId: 101, adminActor: { id: 303, role: "merchant_mgr" } });
    expect(payload.params).toEqual(CUSTOMER_UPLOAD_HISTORY_INPUT_SCHEMAS[full as keyof typeof CUSTOMER_UPLOAD_HISTORY_INPUT_SCHEMAS].parse(inputs[method]));
    const grant = verifyOfficialInventoryGrant(payload.officialInventoryGrant, { creditCode: payload.creditCode, expectedOwnerUserId: 101, staffUserId: 202, adminAccountId: 303, bindingVersion: 7, method: full, requestId: payload.requestId });
    expect(grant).toMatchObject({ read: true, write: true, customerScopeRead: true, inventoryScopeWrite: true });
    expect(state.fence).toHaveBeenCalledWith({ adminUserId: 303, merchantId: 51 });
    const audit = state.audit.mock.calls[0][0];
    expect(audit).toMatchObject({ staffUserId: 202, merchantId: 51, method: full });
    expect(audit).not.toHaveProperty("params"); expect(audit).not.toHaveProperty("result");
    expect(JSON.stringify(audit)).not.toContain(file.base64); expect(JSON.stringify(audit)).not.toContain(file.fileName);
  });
  it("不存在通配/动态命令/prototype方法识别", () => {
    expect(businessRouter._def.procedures["channelInventory.*"]).toBeUndefined();
    expect(businessRouter._def.procedures["channelInventory.customerUploadExecute"]).toBeUndefined();
    for (const method of ["constructor", "__proto__", "channelInventory.customerUploadOriginalFake", undefined]) expect(isCustomerUploadHistoryBusinessMethod(method)).toBe(false);
  });
  it.each(methods)("%s 缺独立customers.read仍拒绝，CRM写/官方库存权限不能替代", async method => {
    state.scope = ["business.inventory.read", "business.inventory.write", "business.customers.write"];
    await expect(call(method)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.transport).not.toHaveBeenCalled(); expect(state.audit).not.toHaveBeenCalled();
  });
  it.each(methods)("%s 缺库存精确商户scope仍拒绝，不新增native-read豁免", async method => {
    state.scope = ["business.customers.read"];
    await expect(call(method)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(state.transport).not.toHaveBeenCalled();
  });
  it("read-authorized POST下载允许当前read，但不能调用任一写方法", async () => {
    state.scope = ["business.inventory.read", "business.customers.read"]; state.native = ["officialInventory.read"];
    await call("customerUploadDownload");
    expect(lastPayload().officialInventoryGrant.permissions).toMatchObject({ read: true, write: false, customerScopeRead: true, inventoryScopeWrite: false });
    for (const method of writes) await expect(call(method)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.transport).toHaveBeenCalledTimes(1);
  });
  it.each(methods)("%s fresh final fence CRM撤权拒绝", async method => {
    state.revokeCrm = true;
    await expect(call(method)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(state.scopeReads).toBe(2); expect(state.transport).not.toHaveBeenCalled();
  });
  it("超级管理员仍无商户scope/绑定旁路，兼容OAuth会话不是企业员工", async () => {
    state.role = "super_admin"; state.scope = [];
    await expect(call("customerUploadHistoryList")).rejects.toMatchObject({ code: "FORBIDDEN" });
    state.scope = ["business.inventory.read", "business.inventory.write", "business.customers.read"]; state.bound = false;
    await expect(call("customerUploadOriginal")).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(businessRouter.createCaller(ctx(false)).channelInventory.customerUploadHistoryList(inputs.customerUploadHistoryList)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(state.transport).not.toHaveBeenCalled();
  });
  it.each(["method", "actorUserId", "dataOwnerUserId", "responsibleUserId", "officialInventoryGrant", "customerScopeRead", "materialId", "successCount"])("顶层%s不能作为浏览器权限/库存成功回执", async field => {
    await expect(call("customerUploadOriginal", { ...inputs.customerUploadOriginal, [field]: 666 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.fence).not.toHaveBeenCalled(); expect(state.transport).not.toHaveBeenCalled();
  });
  it("原表与外企业下载输入没有公开key/path字段；精确请求号仍只是服务端断言", async () => {
    for (const field of ["key", "url", "path", "locator", "ownerUserId"]) await expect(call("customerUploadDownload", { ...inputs.customerUploadDownload, [field]: "private" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(call("customerUploadDownload", { ...inputs.customerUploadDownload, files: [{ historyId, fileId: uuid(6), locator: "private" }] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.transport).not.toHaveBeenCalled();
  });
  it("前台文件ACL拒绝保持非枚举NOT_FOUND，不审计为成功", async () => {
    state.denyRemote = true;
    await expect(call("customerUploadDownload")).rejects.toMatchObject({ code: "NOT_FOUND", message: "任务不存在或无权访问" });
    expect(state.transport).toHaveBeenCalledTimes(1); expect(state.audit).not.toHaveBeenCalled();
  });
});
