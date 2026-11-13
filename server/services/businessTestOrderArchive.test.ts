import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), execute: vi.fn() }));
vi.mock("../db", () => ({ getDb: mocks.getDb }));

import {
  applyBusinessTestOrderArchives,
  filterBusinessTestOrderArchives,
  loadActiveBusinessTestOrderArchives,
  type BusinessTestOrderArchiveScope,
  type BusinessTestOrderArchiveTuple,
} from "./businessTestOrderArchive";

const scope = { merchantId: 201, sellerUserId: 501 };
function archive(overrides: Partial<BusinessTestOrderArchiveTuple> = {}): BusinessTestOrderArchiveTuple {
  return { ...scope, orderId: 71001, orderNo: "TEST-ORDER-0001", originalStatus: "cancel", isTest: 1, state: "archived", ...overrides };
}
function order(overrides: Record<string, unknown> = {}) {
  return { id: 71001, orderNo: "TEST-ORDER-0001", sellerId: 501, status: "cancel", totalAmount: "123.45", extra: { untouched: true }, ...overrides };
}
function filter(rows: unknown[], archives: BusinessTestOrderArchiveTuple[] = [archive()]) {
  return filterBusinessTestOrderArchives(rows, scope, archives);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getDb.mockResolvedValue({ execute: mocks.execute });
  mocks.execute.mockResolvedValue([[archive()], []]);
});

describe("pure business test-order archive filter", () => {
  it("removes only the exact active cancelled tuple; retained row objects/order/properties are untouched", () => {
    const before = Object.freeze(order({ id: 71002, status: "shipped", orderNo: "SHIP-1" }));
    const target = Object.freeze(order());
    const after = Object.freeze(order({ id: 90005, orderNo: "OTHER-1" }));
    const rows = Object.freeze([before, target, after]) as unknown as ReturnType<typeof order>[];
    const result = filterBusinessTestOrderArchives(rows, scope, [archive()]);
    expect(result).toEqual([before, after]);
    expect(result[0]).toBe(before);
    expect(result[1]).toBe(after);
    expect(rows).toEqual([before, target, after]);
    expect(Object.keys(result[0])).toEqual(Object.keys(before));
    expect(result[0].extra).toBe(before.extra);
  });

  it.each([
    ["order ID", { id: 71003 }],
    ["order number", { orderNo: "TEST-ORDER-0002" }],
    ["number case", { orderNo: "test-order-0001" }],
    ["number whitespace", { orderNo: "TEST-ORDER-0001 " }],
    ["seller", { sellerId: 397752 }],
    ["string seller", { sellerId: "501" }],
    ["string ID", { id: "71001" }],
    ["merchant DTO", { merchantId: 30062 }],
    ["string merchant DTO", { merchantId: "201" }],
    ["shipped status", { status: "shipped" }],
    ["status alias", { status: "cancelled" }],
    ["status case", { status: "CANCEL" }],
    ["missing ID", { id: undefined, orderId: 71001 }],
    ["missing seller", { sellerId: undefined, sellerUserId: 501 }],
    ["missing number", { orderNo: undefined }],
  ])("does not hide a real row with mismatched %s", (_label, overrides) => {
    const rows = [order(overrides)];
    expect(filter(rows)).toBe(rows);
  });

  it.each(["pending", "paid", "shipped", "completed", "refund", "return", "closed", ""]) (
    "never hides a previously archived order whose original live status is now %s", status => {
      const rows = [order({ status })];
      expect(filter(rows)).toBe(rows);
    },
  );

  it.each([
    ["registry merchant", { merchantId: 30062 }],
    ["registry seller", { sellerUserId: 397752 }],
    ["registry ID", { orderId: 71003 }],
    ["registry number", { orderNo: "OTHER" }],
    ["restored state", { state: "restored" }],
    ["not test", { isTest: 0 }],
    ["invalid test flag value", { isTest: 2 }],
    ["original status", { originalStatus: "shipped" }],
  ] as const)("does not hide when %s differs", (_label, overrides) => {
    const rows = [order()];
    expect(filter(rows, [archive(overrides)])).toBe(rows);
  });

  it("requires paired ID + number; never joins separately matching identifiers", () => {
    const rows = [order()];
    expect(filter(rows, [archive({ orderNo: "OTHER" }), archive({ orderId: 71003 })])).toBe(rows);
  });

  it("uses generic registry tuples for other authorized merchants/sellers without an ID allowlist", () => {
    const other = { merchantId: 76, sellerUserId: 83 };
    const row = order({ id: 7, orderNo: "EXPERIMENT-7", sellerId: 83, merchantId: 76 });
    expect(filterBusinessTestOrderArchives([row], other, [archive({ ...other, orderId: 7, orderNo: "EXPERIMENT-7" })])).toEqual([]);
  });

  it("preserves malformed/non-order rows instead of inferring their identity", () => {
    const rows = [null, undefined, 71001, "71001", [], {}, { id: 71001 }, order({ sellerId: null })];
    expect(filter(rows)).toBe(rows);
  });

  it("preserves the exact array when no active registry matches, including empty/restored metadata", () => {
    const rows = [order()];
    expect(filter(rows, [])).toBe(rows);
    expect(filter(rows, [archive({ state: "restored" })])).toBe(rows);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it.each([null, {}, { merchantId: "201", sellerUserId: 501 }, { merchantId: 201, sellerUserId: 0 }, { merchantId: Number.MAX_SAFE_INTEGER + 1, sellerUserId: 501 }])(
    "rejects invalid proven scope instead of falling back", invalid => {
      expect(() => filterBusinessTestOrderArchives([order()], invalid as BusinessTestOrderArchiveScope, [archive()]))
        .toThrow(expect.objectContaining({ code: "SERVICE_UNAVAILABLE" }));
    },
  );

  it.each([null, {}, [null], [archive({ orderId: 0 })], [{ ...archive(), isTest: "1" }], [{ ...archive(), state: "unknown" }], [{ ...archive(), merchantId: "201" }]])(
    "fails closed on malformed registry data %j", invalid => {
      expect(() => filter([order()], invalid as BusinessTestOrderArchiveTuple[]))
        .toThrow(expect.objectContaining({ code: "SERVICE_UNAVAILABLE" }));
    },
  );
});

describe("admin DB metadata loader and fail-closed orchestration", () => {
  it("uses one parameterized scoped SELECT and selects no private metadata", async () => {
    const metadata = await loadActiveBusinessTestOrderArchives(scope);
    expect(metadata).toEqual([archive()]);
    expect(mocks.getDb).toHaveBeenCalledTimes(1);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    const query = new MySqlDialect().sqlToQuery(mocks.execute.mock.calls[0][0] as SQL);
    expect(query.params).toEqual([201, 501]);
    expect(query.sql).toMatch(/FROM business_test_order_archives/);
    expect(query.sql).toMatch(/merchantId = \?/);
    expect(query.sql).toMatch(/sellerUserId = \?/);
    expect(query.sql).toContain("state = 'archived' AND isTest = 1 AND originalStatus = 'cancel'");
    expect(query.sql).not.toMatch(/backupReference|snapshotSha256|confirmed|actor|\borders\b|\bCREATE\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b/i);
  });

  it("accepts only a positively decoded empty registry, not absent DB data", async () => {
    mocks.execute.mockResolvedValue([[], []]);
    const rows = [order()];
    await expect(applyBusinessTestOrderArchives(rows, scope)).resolves.toBe(rows);
  });

  it("loads fresh metadata on every request so restore is immediately reflected", async () => {
    const rows = [order()];
    await expect(applyBusinessTestOrderArchives(rows, scope)).resolves.toEqual([]);
    mocks.execute.mockResolvedValue([[], []]);
    await expect(applyBusinessTestOrderArchives(rows, scope)).resolves.toBe(rows);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it("still checks metadata availability when the original seller result is empty", async () => {
    await expect(applyBusinessTestOrderArchives([], scope)).resolves.toEqual([]);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it.each([null, undefined])("never returns original rows when getDb returns %s", async db => {
    mocks.getDb.mockResolvedValue(db);
    await expect(applyBusinessTestOrderArchives([order()], scope)).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it.each(["getDb", "execute"] as const)("sanitizes %s failures without leaking the unfiltered rows or private errors", async method => {
    mocks[method].mockRejectedValue(new Error("mysql://secret-password@host/private-backup"));
    try {
      await applyBusinessTestOrderArchives([order()], scope);
      throw new Error("EXPECTED_FAILURE");
    } catch (error) {
      expect(error).toMatchObject({ code: "SERVICE_UNAVAILABLE", message: "订单归档核验服务暂时不可用，请稍后重试" });
      expect((error as Error).message).not.toContain("secret-password");
      expect((error as { cause?: unknown }).cause).toBeUndefined();
    }
  });

  it.each([undefined, null, [], {}, [archive()], [[archive()]], [[archive()], null], [[archive()], [], []], [[{ ...archive(), orderId: "71001" }], []], [[null], []]])(
    "never treats malformed execute result %j as a successful empty registry", async result => {
      mocks.execute.mockResolvedValue(result);
      await expect(applyBusinessTestOrderArchives([order()], scope)).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    },
  );

  it.each([null, undefined, {}, { items: [order()] }, "[]"])("rejects an unexpected upstream result %j", async result => {
    await expect(applyBusinessTestOrderArchives(result, scope)).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
