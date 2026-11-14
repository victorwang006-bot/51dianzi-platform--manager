import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { sql, type SQLWrapper } from "drizzle-orm";
const demand = vi.hoisted(() => ({ policy: vi.fn() }));
vi.mock("../client/src/business/platform/front-router-types/server/db", () => ({
  getDb: vi.fn(async () => null),
}));
vi.mock(
  "../client/src/business/platform/front-router-types/server/services/customerDemands",
  () => ({
    resolveCrmDemandPolicy: demand.policy,
    crmDemandCustomerWhere: () =>
      sql`c.enterpriseId = 999711 AND c.assignedUserId = 999722`,
  })
);
import {
  personalMonthBounds,
  personalPerformanceDecimal,
  summarizePersonalPerformance,
} from "../client/src/business/platform/front-router-types/server/services/personalPerformance";
import { personalPerformanceInputSchema } from "../client/src/business/platform/shared/personalPerformance";
const dialect = new MySqlDialect();
let owner: boolean, permitted: boolean;
let summary: Record<string, unknown>;
let calls: { sql: string; params: unknown[] }[];
const executor = {
  execute: vi.fn(async (query: SQLWrapper) => {
    const compiled = dialect.sqlToQuery(query.getSQL());
    calls.push(compiled);
    if (compiled.sql.includes("FROM enterprises e"))
      return [
        [
          {
            id: 999733,
            role: owner ? "super_admin" : "member",
            status: "active",
            loginDisabled: 0,
            superAdminUserId: 999722,
          },
        ],
        [],
      ];
    if (compiled.sql.includes("FROM enterprise_member_permissions"))
      return [
        permitted ? [{ permissionKey: "sales.business_orders" }] : [],
        [],
      ];
    return [[summary], []];
  }),
};
beforeEach(() => {
  vi.clearAllMocks();
  owner = false;
  permitted = true;
  calls = [];
  demand.policy.mockResolvedValue({
    customers: { scope: "own" },
    demands: { scope: "own" },
  });
  summary = {
    orderCount: "1208",
    orderAmount: "9007199254740993.1234",
    collectedAmount: "250.25",
    monthlyBookedAmount: "700.00",
    items: JSON.stringify([
      {
        id: 999741,
        orderNumber: "FICTIONAL-SALES-ORDER",
        totalAmount: "9007199254740993.1234",
        createdAt: "2026-11-14T09:30:00",
      },
    ]),
  };
});
describe("real source personalPerformance, no DB connection", () => {
  it("keeps decimal precision as strings and calculates December boundary correctly", () => {
    expect(personalPerformanceDecimal("9007199254740993.1234")).toBe(
      "9007199254740993.1234"
    );
    expect(personalPerformanceDecimal("1")).toBe("1.0000");
    expect(() => personalPerformanceDecimal("-1")).toThrow();
    expect(personalMonthBounds("2026-12")).toEqual({
      start: "2026-12-01",
      end: "2027-01-01",
    });
    expect(
      personalPerformanceInputSchema.safeParse({
        month: "2026-11",
        actorUserId: 999999,
      }).success
    ).toBe(false);
  });
  it("returns full >100 totals and precise own page, never sums page or monthly as cash", async () => {
    const result = await summarizePersonalPerformance(
      { enterpriseId: 999711, actorUserId: 999722 },
      { month: "2026-11", page: 2, pageSize: 10 },
      executor
    );
    expect(result).toMatchObject({
      status: "available",
      orderCount: 1208,
      total: 1208,
      page: 2,
      pageSize: 10,
      orderAmount: "9007199254740993.1234",
      collectedAmount: "250.2500",
      monthlyBookedAmount: "700.0000",
      refundAmount: null,
      refundStatus: "unavailable",
    });
    if (result.status !== "available")
      throw new Error("unexpected unavailable");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].totalAmount).toBe("9007199254740993.1234");
    expect(result.items[0].createdAt).toBe("2026-11-14T01:30:00.000Z");
    const aggregate = calls.find(c => c.sql.includes("AS orderCount"))!;
    expect(aggregate.sql.match(/o\.createdByUserId = \?/g)).toHaveLength(5);
    expect(aggregate.sql.match(/o\.status = 'confirmed'/g)).toHaveLength(5);
    expect(aggregate.sql.match(/o\.currency = 'CNY'/g)).toHaveLength(5);
    expect(aggregate.sql).toContain("p.method IN ('bank', 'cash')");
    expect(aggregate.sql).toContain("p.method = 'monthly'");
    expect(aggregate.sql).toContain("CAST(o.totalAmount AS CHAR)");
    expect(aggregate.sql).toContain("LIMIT ? OFFSET ?");
    expect(aggregate.params.slice(-2)).toEqual([10, 10]);
    expect(aggregate.params).toContain("2026-11-01 00:00:00");
    expect(aggregate.params).toContain("2026-12-01");
    expect(aggregate.sql).not.toContain("p.actorUserId");
    expect(demand.policy).toHaveBeenCalledWith(executor, {
      enterpriseId: 999711,
      actorUserId: 999722,
    });
  });
  it("verified enterprise owner still only gets own createdByUserId, not enterprise total", async () => {
    owner = true;
    await summarizePersonalPerformance(
      { enterpriseId: 999711, actorUserId: 999722 },
      { month: "2026-11" },
      executor
    );
    expect(calls.find(c => c.sql.includes("AS orderCount"))!.sql).toContain(
      "o.createdByUserId = ?"
    );
    expect(
      calls.some(c => c.sql.includes("FROM enterprise_member_permissions"))
    ).toBe(false);
  });
  it("denies absent sales grant and native CRM policy failure without executing totals", async () => {
    permitted = false;
    await expect(
      summarizePersonalPerformance(
        { enterpriseId: 999711, actorUserId: 999722 },
        { month: "2026-11" },
        executor
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(calls.some(c => c.sql.includes("AS orderCount"))).toBe(false);
    permitted = true;
    demand.policy.mockRejectedValue(new Error("fictional CRM policy denied"));
    await expect(
      summarizePersonalPerformance(
        { enterpriseId: 999711, actorUserId: 999722 },
        { month: "2026-11" },
        executor
      )
    ).rejects.toThrow();
    expect(calls.some(c => c.sql.includes("AS orderCount"))).toBe(false);
  });
  it("refuses invalid money or missing pagination data rather than substituting zero", async () => {
    summary.orderAmount = "NaN";
    await expect(
      summarizePersonalPerformance(
        { enterpriseId: 999711, actorUserId: 999722 },
        { month: "2026-11" },
        executor
      )
    ).rejects.toThrow();
    summary.orderAmount = "0";
    summary.items = null;
    await expect(
      summarizePersonalPerformance(
        { enterpriseId: 999711, actorUserId: 999722 },
        { month: "2026-11" },
        executor
      )
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });
});
