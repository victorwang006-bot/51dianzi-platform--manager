import { beforeEach, describe, expect, it, vi } from "vitest";
import { MetadataMemoryDb, METADATA_FIXTURE_ACTOR as actor, METADATA_FIXTURE_PROVENANCE as provenance } from "./businessSalesOrderMetadata.fixture";
import {
  businessSalesOrderSaveReceiverSchema, businessSalesOrderAddAfterSaleSchema,
  businessSalesOrderUpdateAfterSaleSchema, BUSINESS_AFTER_SALE_NOTICE,
} from "../../shared/businessSalesOrderMetadata";

const dbMock = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../db", () => dbMock);
import {
  deriveBusinessSalesOrderMetadataProvenance as derive,
  getBusinessSalesOrderMetadata as get,
  saveBusinessSalesOrderReceiver as save,
  addBusinessSalesOrderAfterSale as add,
  updateBusinessSalesOrderAfterSale as update,
} from "./businessSalesOrderMetadata";

let db: MetadataMemoryDb;
const receiverInput = (changes = {}) => ({
  id: provenance.orderId, customerId: provenance.customerId,
  receiver: "虚构收货人", receiverPhone: "000-TEST-ONLY", receiverAddress: "虚构测试地址", note: "", version: 0,
  requestId: "fictional_receiver_0001", ...changes,
});
const caseInput = (changes = {}) => ({
  id: provenance.orderId, customerId: provenance.customerId, kind: "consultation" as const,
  reason: "虚构咨询记录", requestId: "fictional_after_sale_0001", ...changes,
});
beforeEach(() => {
  db = new MetadataMemoryDb();
  dbMock.getDb.mockReset();
  dbMock.getDb.mockResolvedValue(db);
});

describe("native-admin business sales metadata (fictional; no external IO)", () => {
  it("derives only strict original merchant/order/customer tuple, not enterprise or owner aliases", () => {
    const original = { id: provenance.orderId, orderNumber: provenance.orderNumber, customerId: provenance.customerId, enterpriseId: 999, ownerId: 123 };
    expect(derive({ id: provenance.merchantId, enterpriseId: 555 }, { id: provenance.orderId }, original)).toEqual(provenance);
    expect(dbMock.getDb).not.toHaveBeenCalled();
  });
  it.each([
    null, [], {}, { id: String(provenance.orderId), orderNumber: provenance.orderNumber, customerId: provenance.customerId },
    { id: provenance.orderId + 1, orderNumber: provenance.orderNumber, customerId: provenance.customerId },
    { id: provenance.orderId, orderNumber: "", customerId: provenance.customerId },
    { id: provenance.orderId, orderNumber: "x".repeat(129), customerId: provenance.customerId },
    { id: provenance.orderId, orderNumber: provenance.orderNumber, customerId: "991801" },
    { id: provenance.orderId, orderNumber: provenance.orderNumber, customerId: 0 },
    { id: provenance.orderId, orderNumber: provenance.orderNumber, customerId: provenance.customerId, merchantId: 1 },
  ])("rejects malformed original provenance %j before metadata IO", original => {
    expect(() => derive({ id: provenance.merchantId }, { id: provenance.orderId }, original)).toThrow();
    expect(dbMock.getDb).not.toHaveBeenCalled();
  });
  it("rejects customer mismatch and fake merchant id without coercion", () => {
    const original = { id: provenance.orderId, orderNumber: provenance.orderNumber, customerId: provenance.customerId };
    expect(() => derive({ id: provenance.merchantId }, { id: provenance.orderId, customerId: 1 }, original)).toThrow();
    expect(() => derive({ id: String(provenance.merchantId) }, { id: provenance.orderId }, original)).toThrow();
  });
  it("returns an empty independent result with server tuple and no backfill/DML", async () => {
    await expect(get(provenance)).resolves.toEqual({ ...provenance, receiver: null, afterSales: [] });
    expect(db.state.bases).toEqual([]);
    expect(db.calls).toHaveLength(3);
    expect(db.calls.every(call => call.sql.startsWith("SELECT"))).toBe(true);
    expect(db.events).toEqual(["begin", "commit"]);
  });
  it("accepts individual empty fields but rejects all-empty save, unknown actor/financial fields and overflow", () => {
    expect(businessSalesOrderSaveReceiverSchema.safeParse(receiverInput({ receiver: "", receiverPhone: "", receiverAddress: "", note: "草稿" })).success).toBe(true);
    for (const payload of [
      receiverInput({ receiver: " ", receiverPhone: " ", receiverAddress: "", note: "" }),
      receiverInput({ receiver: "x".repeat(65) }), receiverInput({ receiverPhone: "x".repeat(41) }),
      receiverInput({ receiverAddress: "x".repeat(501) }), receiverInput({ note: "x".repeat(501) }),
      receiverInput({ frontUserId: 1 }), receiverInput({ amount: "123.00" }), receiverInput({ merchantId: 1 }),
    ]) expect(businessSalesOrderSaveReceiverSchema.safeParse(payload).success).toBe(false);
    expect(businessSalesOrderAddAfterSaleSchema.safeParse(caseInput({ reason: "" })).success).toBe(false);
    expect(businessSalesOrderAddAfterSaleSchema.safeParse(caseInput({ refundEvidence: "anything" })).success).toBe(false);
    expect(businessSalesOrderUpdateAfterSaleSchema.safeParse({ id: provenance.orderId, caseId: 1, version: 0, status: "closed", resolution: "", requestId: "fictional_update_01" }).success).toBe(false);
  });
  it("saves new receiver 0→1, CAS updates 1→2 and appends authenticated local audits", async () => {
    const first = await save(provenance, actor, receiverInput());
    expect(first.version).toBe(1);
    expect(first.receiver).toBe("虚构收货人");
    const second = await save(provenance, actor, receiverInput({ version: 1, note: "更新草稿", requestId: "fictional_receiver_0002" }));
    expect(second.version).toBe(2);
    expect(db.state.audits).toHaveLength(2);
    expect(db.state.audits[1]).toMatchObject({ ...provenance, actorAdminId: actor.adminUserId, actorFrontUserId: actor.frontUserId, bindingVersion: 7, scopeVersion: 3 });
    expect(JSON.parse(db.state.audits[1].beforeJson).version).toBe(1);
    expect(JSON.parse(db.state.audits[1].afterJson).version).toBe(2);
    const read = await get(provenance);
    expect(read.receiver).toEqual(second);
    expect(read.afterSales).toEqual([]);
  });
  it("parameterizes hostile receiver/note/JSON data and never selects or modifies original orders", async () => {
    const note = "' ); DROP TABLE orders; -- 以及 JSON \"字段\"";
    await save(provenance, actor, receiverInput({ note }));
    expect(db.calls.every(call => !call.sql.includes(note))).toBe(true);
    expect(db.calls.some(call => call.params.includes(note))).toBe(true);
    expect(db.calls.some(call => call.params.some(value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)))).toBe(true);
    expect(db.calls.every(call => !/\b(crm_sales_orders|orders|stocks|payments)\b/.test(call.sql))).toBe(true);
    const mutations = db.calls.filter(call => !call.sql.startsWith("SELECT"));
    expect(new Set(mutations.map(call => call.transaction)).size).toBe(1);
  });
  it("same receiver request/payload replay returns exact initial result after later version changes", async () => {
    const first = await save(provenance, actor, receiverInput());
    await save(provenance, actor, receiverInput({ version: 1, note: "later", requestId: "fictional_receiver_0002" }));
    await expect(save(provenance, actor, receiverInput())).resolves.toEqual(first);
    expect(db.state.receivers[0].version).toBe(2);
    expect(db.state.audits).toHaveLength(2);
    expect(db.state.requests).toHaveLength(2);
  });
  it("same request with different payload/action conflicts, with no partial changes", async () => {
    await save(provenance, actor, receiverInput());
    const before = structuredClone(db.state);
    await expect(save(provenance, actor, receiverInput({ note: "changed" }))).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(add(provenance, actor, caseInput({ requestId: receiverInput().requestId }))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.state).toEqual(before);
  });
  it("concurrent same requests create one record and one audit", async () => {
    const [a, b] = await Promise.all([save(provenance, actor, receiverInput()), save(provenance, actor, receiverInput())]);
    expect(a).toEqual(b);
    expect(db.state.receivers).toHaveLength(1);
    expect(db.state.audits).toHaveLength(1);
  });
  it("concurrent distinct requests with stale version yield one success and one CAS conflict", async () => {
    const result = await Promise.allSettled([
      save(provenance, actor, receiverInput()),
      save(provenance, actor, receiverInput({ requestId: "fictional_receiver_OTHER" })),
    ]);
    expect(result.filter(row => row.status === "fulfilled")).toHaveLength(1);
    expect(result.find(row => row.status === "rejected")).toMatchObject({ reason: { code: "CONFLICT" } });
    expect(db.state.requests).toHaveLength(1);
    expect(db.state.audits).toHaveLength(1);
  });
  it("stale receiver version and forced SQL CAS miss roll back request/audit together", async () => {
    await save(provenance, actor, receiverInput());
    const before = structuredClone(db.state);
    await expect(save(provenance, actor, receiverInput({ requestId: "fictional_receiver_STALE" }))).rejects.toMatchObject({ code: "CONFLICT" });
    db.forceCasMiss = true;
    await expect(save(provenance, actor, receiverInput({ version: 1, requestId: "fictional_receiver_CASMISS" }))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.state).toEqual(before);
  });
  it.each(["audit", "request-completion"])("%s failure rolls back newly created receiver/base/request/audit", async stage => {
    db.failAudit = stage === "audit";
    db.failRequestCompletion = stage === "request-completion";
    await expect(save(provenance, actor, receiverInput())).rejects.toMatchObject({ code: stage === "audit" ? "SERVICE_UNAVAILABLE" : "CONFLICT" });
    expect(db.state.receivers).toEqual([]);
    expect(db.state.bases).toEqual([]);
    expect(db.state.requests).toEqual([]);
    expect(db.state.audits).toEqual([]);
    expect(db.events).toEqual(["begin", "rollback"]);
  });
  it("no database/private errors escape with SQL, paths or causes", async () => {
    db.unavailableTransaction = true;
    try { await get(provenance); throw new Error("expected rejection"); }
    catch (error) {
      expect(error).toMatchObject({ code: "SERVICE_UNAVAILABLE", cause: undefined });
      expect(String(error)).not.toContain("fictional-private");
    }
    dbMock.getDb.mockResolvedValue(null);
    await expect(get(provenance)).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });
  it.each(["customer", "number", "order-id"])("read/write reject existing provenance collision: %s", async kind => {
    await save(provenance, actor, receiverInput());
    const mismatched = { ...provenance, ...(kind === "customer" ? { customerId: 1 } : kind === "number" ? { orderNumber: "DIFFERENT" } : { orderId: provenance.orderId + 1 }) };
    const before = structuredClone(db.state);
    await expect(get(mismatched)).rejects.toBeInstanceOf(Error);
    await expect(save(mismatched, actor, receiverInput({ id: mismatched.orderId, customerId: mismatched.customerId, requestId: "fictional_collision" }))).rejects.toBeInstanceOf(Error);
    expect(db.state).toEqual(before);
  });
  it("order/case namespace is exact merchant+order; no cross-scope read/update", async () => {
    const added = await add(provenance, actor, caseInput());
    await expect(get({ ...provenance, merchantId: 991202 })).resolves.toEqual({ ...provenance, merchantId: 991202, receiver: null, afterSales: [] });
    const before = structuredClone(db.state);
    await expect(update({ ...provenance, orderId: 991702, orderNumber: "FICTIONAL-OTHER" }, actor, {
      id: 991702, caseId: added.id, version: 1, status: "closed", resolution: "", requestId: "fictional_wrong_order",
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(db.state).toEqual(before);
  });
  it.each(["consultation", "repair", "exchange", "return_request", "refund_request"] as const)("%s records intent only, with defaults and replay", async kind => {
    const input = caseInput({ kind });
    const first = await add(provenance, actor, input);
    const replay = await add(provenance, actor, input);
    expect(replay).toEqual(first);
    expect(first).toMatchObject({ kind, status: "open", resolution: "", version: 1, closedAt: null });
    expect(first).not.toHaveProperty("amount");
    expect(first).not.toHaveProperty("refundEvidence");
    expect(db.state.audits).toHaveLength(1);
    expect(db.state.receivers).toHaveLength(0);
    expect((await get(provenance)).afterSales).toEqual([first]);
  });
  it("closed case note updates preserve close time; explicit-version reopen clears it; all changes audit", async () => {
    const added = await add(provenance, actor, caseInput({ kind: "refund_request" }));
    const base = { id: provenance.orderId, caseId: added.id, resolution: "仅登记，不退款" };
    const closed = await update(provenance, actor, { ...base, version: 1, status: "closed", requestId: "fictional_close_001" });
    const noted = await update(provenance, actor, { ...base, resolution: "记录备注修改", version: 2, status: "closed", requestId: "fictional_note_001" });
    expect(noted.closedAt).toBe(closed.closedAt);
    const reopened = await update(provenance, actor, { ...base, version: 3, status: "open", requestId: "fictional_reopen_001" });
    expect(reopened).toMatchObject({ version: 4, status: "open", closedAt: null });
    expect(db.state.audits).toHaveLength(4);
    expect(BUSINESS_AFTER_SALE_NOTICE).toContain("关闭记录不代表退款或退货完成");
    expect(db.calls.every(call => !call.sql.startsWith("DELETE"))).toBe(true);
  });
  it("after-sale update replay returns same saved result and rejects changed/stale payload", async () => {
    const added = await add(provenance, actor, caseInput());
    const input = { id: provenance.orderId, caseId: added.id, version: 1, status: "processing" as const, resolution: "跟进", requestId: "fictional_processing_001" };
    const first = await update(provenance, actor, input);
    await expect(update(provenance, actor, input)).resolves.toEqual(first);
    await expect(update(provenance, actor, { ...input, resolution: "其他" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(update(provenance, actor, { ...input, requestId: "fictional_stale_update" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.state.audits).toHaveLength(2);
  });
  it("case update audit failure rolls back case, version, close time and request", async () => {
    const added = await add(provenance, actor, caseInput());
    const before = structuredClone(db.state);
    db.failAudit = true;
    await expect(update(provenance, actor, { id: provenance.orderId, caseId: added.id, version: 1, status: "closed", resolution: "关闭登记", requestId: "fictional_close_001" })).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(db.state).toEqual(before);
  });
  it("invalid actor or tuple is rejected before metadata DB", async () => {
    await expect(save(provenance, { ...actor, frontUserId: 0 }, receiverInput())).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    await expect(save(provenance, actor, receiverInput({ id: 1 }))).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(dbMock.getDb).not.toHaveBeenCalled();
  });
  it("malformed rows and corrupt replay fail closed, rather than return an empty success", async () => {
    db.malformedSelect = true;
    await expect(get(provenance)).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    db.malformedSelect = false;
    await save(provenance, actor, receiverInput());
    db.state.requests[0].resultJson = "{bad-json";
    await expect(save(provenance, actor, receiverInput())).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });
});
