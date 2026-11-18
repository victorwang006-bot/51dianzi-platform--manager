import { describe, expect, it, vi } from "vitest";
vi.mock("mysql2/promise", () => ({ default: { createPool: vi.fn(() => { throw Error("NO_DATABASE_CONNECTION_ALLOWED"); }) } }));
import mysql from "mysql2/promise";
import { adaptProduct, centsPrice, parseInput, preparePlan, ACTOR_ID, TEAM_ID, SCOPE, hash } from "./input";
import { executePlan, type Checkpoint } from "./engine";
import { sourceImportKey, verifiedSnapshotPublishedAt } from "./native";
import { publicProjection } from "../../server/services/officialMall";

const original = (stock = 0, unit = "个") => ({
  original_fields: {
    型号: "SAME-SOURCE-SKU", 品牌: "ORIGINAL-BRAND", 封装: "PKG", 商城库存: stock,
    起订量: 999, 销售单位: unit, 商品编号: "C8257", 整包装数量: 2400,
    广东仓库存: stock, 江苏仓库存: 0, 全部公开参数: "原参数内容", 备注: "原有私有值",
    "全部公开价格阶梯（CNY/销售单位）": "原价 ¥6.93",
  },
  adjusted_tiers: [
    { "起购数量（含）": 1, 单价: 6.72, "最高数量（含；空=无上限）": 9, 销售单位: unit },
    { "起购数量（含）": 10, 单价: 5.9, "最高数量（含；空=无上限）": "", 销售单位: unit },
  ],
});
function planFor(count: number) {
  return preparePlan(Array.from({ length: count }, () => original()), adaptProduct, { products: count, tiers: count * 2, zeroStock: count });
}
function checkpointFor(plan: ReturnType<typeof planFor>): Checkpoint {
  return {
    version: 1, scope: SCOPE, datasetHash: plan.datasetHash, sourceHash: "a".repeat(64),
    actor: { adminUserId: ACTOR_ID, sessionVersion: 7 }, teamId: TEAM_ID,
    baseline: [{ id: 1, partNumber: "PRESERVE_EXISTING_ONE" }],
    imports: [], publications: [], sourceMetadata: [], ids: [], state: "ready",
  };
}
function fixture(plan: ReturnType<typeof planFor>, checkpoint = checkpointFor(plan)) {
  const ledger = new Map<string, any>();
  const inserted: number[] = [];
  const metadata = new Map<number, any>();
  const snapshots: Checkpoint[] = [];
  let id = 1;
  const service = {
    importRows: vi.fn(async (_actor, payload) => {
      if (ledger.has(payload.requestId)) return { ...ledger.get(payload.requestId), idempotent: true };
      expect(checkpoint.imports.find(receipt => receipt.requestId === payload.requestId)?.state).toBe("attempting");
      expect(snapshots.at(-1)?.imports.find(receipt => receipt.requestId === payload.requestId)?.state).toBe("attempting");
      const ids = payload.rows.map(() => ++id);
      inserted.push(...ids);
      const result = { success: true, imported: ids.length, updated: 0, skipped: 0, errors: [], ids };
      ledger.set(payload.requestId, result);
      return result;
    }),
    bulkAction: vi.fn(async (_actor, payload) => {
      if (ledger.has(payload.requestId)) return { ...ledger.get(payload.requestId), idempotent: true };
      expect(snapshots.at(-1)?.publications.find(receipt => receipt.requestId === payload.requestId)?.state).toBe("attempting");
      const result = { success: true, successful: payload.items.length, errors: [] };
      ledger.set(payload.requestId, result);
      return result;
    }),
    requestStatus: vi.fn(async (_actor, { requestId }) => ledger.has(requestId)
      ? { state: "completed" as const, result: ledger.get(requestId) }
      : { state: "not_found" as const, result: null }),
  };
  const deps = {
    service,
    persist: vi.fn(async (value: Checkpoint) => { snapshots.push(structuredClone(value)); }),
    verifyDrafts: vi.fn(async (ids: number[]) => ids.map(id => ({ id, expectedRevision: 1 }))),
    ensurePrivateMetadata: vi.fn(async (ids: number[], firstIndex: number) => {
      ids.forEach((id, offset) => {
        const desired = { id, unit: plan.sourceMetadata[firstIndex + offset].unit, importKey: sourceImportKey(plan, firstIndex + offset), raw: plan.privatePayloads[firstIndex + offset] };
        if (metadata.has(id)) expect(metadata.get(id)).toEqual(desired);
        else metadata.set(id, desired);
      });
      return { ids, count: ids.length };
    }),
    verifyFinal: vi.fn(async (ids: number[]) => ({ published: ids.length, sourceMetadata: ids.length, baselinePreserved: true })),
    progress: vi.fn(),
  };
  return { checkpoint, deps, ledger, inserted, metadata, snapshots };
}

describe("native snapshot milliseconds / Beijing SQL seconds regression", () => {
  it("keeps nonzero service milliseconds while validating both persisted second-precision timestamps", () => {
    const iso = "2026-11-18T15:32:35.987Z";
    const databaseDate = new Date("2026-11-18T23:32:35+08:00");
    expect(verifiedSnapshotPublishedAt(iso, databaseDate, databaseDate)).toBe(iso);
    const data = adaptProduct(original(), 0).data;
    const input = { ...data, publicId: "OM_00000000-0000-4000-8000-000000000001", revision: 2 };
    const snapshot = publicProjection(input, iso);
    const rebuilt = publicProjection(input, verifiedSnapshotPublishedAt(snapshot.publishedAt, databaseDate, databaseDate));
    expect(rebuilt).toEqual(snapshot);
    expect(publicProjection(input, databaseDate.toISOString())).not.toEqual(snapshot);
  });
  it("accepts UTC ISO with SQL Beijing timestamps on the next local date, without eight-hour drift", () => {
    const iso = "2026-11-18T23:59:59.001Z", databaseDate = new Date("2026-11-19T07:59:59+08:00");
    expect(verifiedSnapshotPublishedAt(iso, databaseDate, new Date("2026-11-18T23:59:59.000Z"))).toBe(iso);
    expect(() => verifiedSnapshotPublishedAt(iso, new Date("2026-11-19T07:59:59Z"), databaseDate)).toThrow("SECOND_MISMATCH");
  });
  it("fails closed on invalid/noncanonical ISO, different seconds, null or invalid database dates", () => {
    const iso = "2026-11-18T15:32:35.987Z", databaseDate = new Date("2026-11-18T15:32:35.000Z");
    for (const bad of [null, "2026-11-18T15:32:35Z", "2026-11-18T23:32:35.987+08:00", "2026-02-30T15:32:35.987Z", "invalid"]) {
      expect(() => verifiedSnapshotPublishedAt(bad, databaseDate, databaseDate)).toThrow("ISO_INVALID");
    }
    expect(() => verifiedSnapshotPublishedAt(iso, new Date("2026-11-18T15:32:36Z"), databaseDate)).toThrow("SECOND_MISMATCH");
    expect(() => verifiedSnapshotPublishedAt(iso, databaseDate, new Date("2026-11-18T15:32:34Z"))).toThrow("SECOND_MISMATCH");
    expect(() => verifiedSnapshotPublishedAt(iso, null, databaseDate)).toThrow("SECOND_MISMATCH");
    expect(() => verifiedSnapshotPublishedAt(iso, databaseDate, new Date("invalid"))).toThrow("SECOND_MISMATCH");
    expect(mysql.createPool).not.toHaveBeenCalled();
  });
});

describe("official 20000 import input adapter (pure offline)", () => {
  it("reads JSON arrays, products wrappers and JSONL without guessing the format", () => {
    const row = original();
    expect(parseInput(JSON.stringify([row]))).toEqual([row]);
    expect(parseInput(JSON.stringify({ products: [row] }))).toEqual([row]);
    expect(parseInput(JSON.stringify(row) + "\n" + JSON.stringify(row) + "\n")).toEqual([row, row]);
    expect(() => parseInput("{broken}\n")).toThrow("INVALID");
  });
  it.each(["个", "米"])("preserves real stock, full tiers and sales unit %s in private metadata only", unit => {
    const raw = original(0, unit), mapped = adaptProduct(raw, 0);
    expect(mapped.data).toMatchObject({ qtyOnSale: 0, qtyStock: 0, qtyOrder: null, dateCode: "", leadTime: "", taxIncluded: true, moq: 999, spq: null, priceEx: "6.72", note: "", ladderPrices: [{ minQty: 1, price: "6.72" }, { minQty: 10, price: "5.90" }] });
    expect(mapped.unit).toBe(unit);
    expect(mapped.privatePayload).toBe(raw);
    expect(mapped.data).not.toHaveProperty("unit");
    expect(mapped.data).not.toHaveProperty("sourcePayload");
    expect(mapped.data.note).not.toContain("原价");
  });
  it("rejects unknown/negative stock, missing original units and bad quantity/quote relationships before service calls", () => {
    for (const stock of [null, undefined, -1, 0.5, "0"]) {
      expect(() => adaptProduct({ ...original(), original_fields: { ...original().original_fields, 商城库存: stock } }, 0)).toThrow();
    }
    expect(() => adaptProduct({ ...original(), original_fields: { ...original().original_fields, 销售单位: "" } }, 0)).toThrow();
    expect(() => adaptProduct({ ...original(), adjusted_tiers: [{ "起购数量（含）": 1, 单价: 1 }, { "起购数量（含）": 2, 单价: 2 }] }, 0)).toThrow("不能");
    expect(() => preparePlan([original()], adaptProduct, { products: 2, tiers: 2, zeroStock: 1 })).toThrow("PRODUCT_COUNT");
    expect(() => preparePlan([original()], adaptProduct, { products: 1, tiers: 3, zeroStock: 1 })).toThrow("TIER_COUNT");
  });
  it("formats approved cent values exactly and never rounds/reprices tiny authorization exceptions", () => {
    expect(centsPrice(0.01)).toBe("0.01");
    expect(centsPrice("5.90")).toBe("5.90");
    expect(centsPrice(5.9)).toBe("5.90");
    for (const invalid of [0, -1, 0.001, "1e2", NaN, Infinity]) expect(() => centsPrice(invalid)).toThrow();
  });
  it("keeps repeated source SKUs as separate new rows and binds private source metadata to dataset identity", () => {
    const plan = planFor(2);
    expect(plan.rows.map(row => row.duplicatePolicy)).toEqual(["new", "new"]);
    expect(plan.rows.map(row => row.rowNumber)).toEqual([1, 2]);
    expect(sourceImportKey(plan, 0)).not.toBe(sourceImportKey(plan, 1));
    expect(sourceImportKey(plan, 0)).toBe(sourceImportKey(planFor(2), 0));
    const changed = original(); changed.original_fields.全部公开参数 = "真实变化";
    const other = preparePlan([changed, original()], adaptProduct, { products: 2, tiers: 4, zeroStock: 2 });
    expect(other.datasetHash).not.toBe(plan.datasetHash);
    expect(mysql.createPool).not.toHaveBeenCalled();
  });
});

describe("native-service batch engine receipts/reconciliation (no SQL)", () => {
  it("uses 500/import and 100/publish, persists before/after, preserves original one and all duplicate source rows", async () => {
    const plan = planFor(501), f = fixture(plan);
    const result = await executePlan(plan, f.checkpoint, f.deps);
    expect(f.deps.service.importRows.mock.calls.map(call => call[1].rows.length)).toEqual([500, 1]);
    expect(f.deps.service.bulkAction.mock.calls.map(call => call[1].items.length)).toEqual([100, 100, 100, 100, 100, 1]);
    expect(result.ids).toHaveLength(501);
    expect(new Set(result.ids).size).toBe(501);
    expect(result.ids).not.toContain(1);
    expect(f.metadata.size).toBe(501);
    expect(result.publications).toHaveLength(6);
    expect(result.sourceMetadata).toHaveLength(2);
    expect(result.state).toBe("completed");
    expect(f.deps.progress).toHaveBeenCalledTimes(8);
    const keys = [...result.imports, ...result.publications].map(receipt => receipt.requestId);
    expect(keys.every(key => /^[a-f0-9]{64}$/.test(key))).toBe(true);
    expect(new Set(keys).size).toBe(8);
    await executePlan(plan, result, f.deps);
    expect(f.inserted).toHaveLength(501);
    expect(f.deps.service.importRows).toHaveBeenCalledTimes(2);
    expect(f.deps.service.bulkAction).toHaveBeenCalledTimes(6);
  });
  it("stops on a committed partial import receipt and never retries its remaining rows", async () => {
    const plan = planFor(501), f = fixture(plan);
    f.deps.service.importRows.mockImplementationOnce(async (_actor, payload) => ({ success: false, imported: 1, updated: 0, skipped: 0, errors: [{ rowNumber: 2, message: "native failure" }], ids: [2] }));
    await expect(executePlan(plan, f.checkpoint, f.deps)).rejects.toThrow("IMPORT_PARTIAL");
    expect(f.checkpoint.imports[0]).toMatchObject({ state: "failed", result: { ids: [2] } });
    expect(f.deps.service.importRows).toHaveBeenCalledTimes(1);
    expect(f.deps.service.bulkAction).not.toHaveBeenCalled();
    expect(f.deps.ensurePrivateMetadata).not.toHaveBeenCalled();
    await expect(executePlan(plan, f.checkpoint, f.deps)).rejects.toThrow("MANUAL_REVIEW");
    expect(f.deps.service.importRows).toHaveBeenCalledTimes(1);
  });
  it("recovers an ambiguous committed native request only by original receipt and exact idempotent replay", async () => {
    const plan = planFor(1), f = fixture(plan);
    f.deps.service.importRows.mockImplementationOnce(async (_actor, payload) => {
      f.ledger.set(payload.requestId, { success: true, imported: 1, updated: 0, skipped: 0, errors: [], ids: [2] });
      throw Object.assign(Error("sensitive driver connection text"), { code: "ECONNRESET" });
    });
    await expect(executePlan(plan, f.checkpoint, f.deps)).rejects.toThrow();
    const originalRequest = structuredClone(f.checkpoint.imports[0]);
    expect(originalRequest.state).toBe("attempting");
    expect(originalRequest.failureCode).toBe("ECONNRESET");
    expect(JSON.stringify(f.checkpoint)).not.toContain("sensitive");
    await executePlan(plan, f.checkpoint, f.deps);
    expect(f.checkpoint.imports[0].requestId).toBe(originalRequest.requestId);
    expect(f.checkpoint.imports[0].payload).toEqual(originalRequest.payload);
    expect(f.checkpoint.ids).toEqual([2]);
    expect(f.inserted).toEqual([]); // Fake native ledger replays; no new creation.
  });
  it("does not blindly retry pending/not_found requests; explicit review permits only the same not_found ID", async () => {
    const plan = planFor(1), f = fixture(plan);
    f.deps.service.importRows.mockRejectedValueOnce(Error("transient"));
    await expect(executePlan(plan, f.checkpoint, f.deps)).rejects.toThrow();
    await expect(executePlan(plan, f.checkpoint, f.deps)).rejects.toThrow("EXPLICIT_INDIVIDUAL_REVIEW");
    expect(f.deps.service.importRows).toHaveBeenCalledTimes(1);
    f.deps.service.requestStatus.mockResolvedValueOnce({ state: "pending" as any, result: null });
    await expect(executePlan(plan, f.checkpoint, { ...f.deps, retryConfirmedNotFound: f.checkpoint.imports[0].requestId })).rejects.toThrow("PENDING");
    expect(f.deps.service.importRows).toHaveBeenCalledTimes(1);
    await executePlan(plan, f.checkpoint, { ...f.deps, retryConfirmedNotFound: f.checkpoint.imports[0].requestId });
    expect(f.inserted).toEqual([2]);
  });
  it("sidecar failure keeps native IDs durably and resumes only idempotent private metadata without another new import", async () => {
    const plan = planFor(1), f = fixture(plan);
    f.deps.ensurePrivateMetadata.mockRejectedValueOnce(Error("sidecar failure"));
    await expect(executePlan(plan, f.checkpoint, f.deps)).rejects.toThrow("sidecar");
    expect(f.checkpoint.ids).toEqual([2]);
    expect(f.checkpoint.imports[0].state).toBe("completed");
    await executePlan(plan, f.checkpoint, f.deps);
    expect(f.deps.service.importRows).toHaveBeenCalledTimes(1);
    expect(f.inserted).toEqual([2]);
    expect(f.metadata.size).toBe(1);
  });
  it("stops permanently at a partial publication receipt instead of rerunning all batches", async () => {
    const plan = planFor(101), f = fixture(plan);
    f.deps.service.bulkAction.mockImplementationOnce(async (_actor, payload) => ({ success: false, successful: 99, errors: [{ id: payload.items[0].id, message: "version changed" }] }));
    await expect(executePlan(plan, f.checkpoint, f.deps)).rejects.toThrow("PUBLICATION_PARTIAL");
    expect(f.checkpoint.ids).toHaveLength(101);
    expect(f.checkpoint.publications[0].state).toBe("failed");
    expect(f.deps.service.bulkAction).toHaveBeenCalledTimes(1);
    await expect(executePlan(plan, f.checkpoint, f.deps)).rejects.toThrow("MANUAL_REVIEW");
    expect(f.deps.service.bulkAction).toHaveBeenCalledTimes(1);
  });
  it("fails closed on changed actor/session/dataset or corrupt receipt before further import", async () => {
    const plan = planFor(1), f = fixture(plan);
    f.checkpoint.actor.adminUserId = 9;
    await expect(executePlan(plan, f.checkpoint, f.deps)).rejects.toThrow("CONTEXT_MISMATCH");
    f.checkpoint.actor.adminUserId = ACTOR_ID;
    f.checkpoint.actor.sessionVersion = 0;
    await expect(executePlan(plan, f.checkpoint, f.deps)).rejects.toThrow("CONTEXT_MISMATCH");
    expect(f.deps.service.importRows).not.toHaveBeenCalled();
    f.checkpoint.actor.sessionVersion = 7;
    await executePlan(plan, f.checkpoint, f.deps);
    f.checkpoint.imports[0].payloadHash = hash("tampered");
    await expect(executePlan(plan, f.checkpoint, f.deps)).rejects.toThrow("BATCH_MISMATCH");
    expect(f.deps.service.importRows).toHaveBeenCalledTimes(1);
    expect(mysql.createPool).not.toHaveBeenCalled();
  });
});
