import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
const f = vi.hoisted(() => ({ binding: vi.fn(), scopes: vi.fn(), commission: vi.fn(), performance: vi.fn(), companies: vi.fn() }));
vi.mock("./db", () => ({ getDb: async () => null, getActiveBusinessStaffBinding: f.binding, listActiveBusinessMerchantScopes: f.scopes }));
vi.mock("./businessRouter", () => ({ readBusinessPersonalCommission: f.commission, readBusinessPersonalPerformance: f.performance, readPersonalBusinessCompanies: f.companies }));
import { getPersonalCommission, getPersonalPerformance, getPersonalBusinessCompanies } from "./personalCenterService";
import { PlatformBusinessServiceError, PlatformBusinessPublicError } from "./platformBusinessApi";
import { PERSONAL_COMMISSION_PAYOUT_REASON } from "../shared/personalCommission";
const ctx = { user: { id: 881131, role: "admin" }, adminAccount: { id: 881131, status: "active", username: "synthetic", adminRole: "auditor", sessionVersion: 3 } } as any;
const result = () => ({ status: "available", month: "2027-01", currency: "CNY", currencyLabel: "人民币（按订单原税务口径）",
  timezone: "Asia/Shanghai", amount: null, payoutStatus: "unavailable", payoutReason: PERSONAL_COMMISSION_PAYOUT_REASON,
  refundAmount: null, refundStatus: "unavailable", basis: "synthetic creation month; lifetime collections; no settlement",
  orderCount: 16, total: 16, readyCount: 16, pendingCount: 0, estimatedAmount: "123.45", earnedAmount: "80.00",
  verifiedEstimatedAmount: "123.45", verifiedEarnedAmount: "80.00", items: [], page: 2, pageSize: 5 });
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("BUSINESS_WORKBENCH_MERCHANT_IDS", "881142,881153");
  f.binding.mockResolvedValue({ frontUserId: 881164, bindingVersion: 5 });
  f.scopes.mockResolvedValue([{ merchantId: 881142, modulePermissions: ["business.orders.read", "business.customers.read"] }]);
  f.commission.mockResolvedValue(result());
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe("personal commission center trusts fixed summary only", () => {
  it("preserves full-month totals rather than empty current-page sum and forwards month/page only", async () => {
    expect(await getPersonalCommission(ctx, { month: "2027-01", page: 2, pageSize: 5 })).toMatchObject({ orderCount: 16, estimatedAmount: "123.45", amount: null, payoutStatus: "unavailable" });
    expect(f.commission).toHaveBeenCalledWith(ctx, 881142, { month: "2027-01", page: 2, pageSize: 5 });
  });
  it("requires choice among multiple EXISTING scopes, never chooses or adds foreign company", async () => {
    f.scopes.mockResolvedValue([{ merchantId: 881142, modulePermissions: ["business.orders.read", "business.customers.read"] },
      { merchantId: 881153, modulePermissions: ["business.orders.read", "business.customers.read"] }]);
    expect(await getPersonalCommission(ctx, { month: "2027-01" })).toMatchObject({ status: "unavailable", errorCategory: "identity_scope", amount: null });
    expect(await getPersonalCommission(ctx, { month: "2027-01", merchantId: 881999 })).toMatchObject({ status: "unavailable", errorCategory: "identity_scope" });
    expect(f.commission).not.toHaveBeenCalled();
    await getPersonalCommission(ctx, { month: "2027-01", merchantId: 881153, page: 2, pageSize: 5 });
    expect(f.commission).toHaveBeenCalledWith(ctx, 881153, expect.anything());
  });
  it("keeps production merchant boundary 30061 even if an otherwise valid scope exists", async () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("BUSINESS_WORKBENCH_MERCHANT_IDS", "30061,881142");
    const value = await getPersonalCommission(ctx, { month: "2027-01", merchantId: 881142 });
    expect(value).toMatchObject({ status: "unavailable", errorCategory: "identity_scope" });
    expect(f.commission).not.toHaveBeenCalled();
  });
  it.each(["binding", "orders", "customers"])("missing %s yields unavailable, not fake zero", async kind => {
    if (kind === "binding") f.binding.mockResolvedValue(null);
    if (kind === "orders") f.scopes.mockResolvedValue([{ merchantId: 881142, modulePermissions: ["business.customers.read"] }]);
    if (kind === "customers") f.scopes.mockResolvedValue([{ merchantId: 881142, modulePermissions: ["business.orders.read"] }]);
    const value = await getPersonalCommission(ctx, { month: "2027-01" });
    expect(value.status).toBe("unavailable"); expect(value).not.toHaveProperty("estimatedAmount"); expect(f.commission).not.toHaveBeenCalled();
  });
  it.each(["month", "page", "total", "ready", "pending", "payout"])("invalid %s source fails closed", async kind => {
    const value: any = result();
    if (kind === "month") value.month = "2027-02";
    if (kind === "page") value.page = 3;
    if (kind === "total") value.total = 8;
    if (kind === "ready") value.readyCount = 15;
    if (kind === "pending") { value.readyCount = 15; value.pendingCount = 1; }
    if (kind === "payout") value.amount = "80.00";
    f.commission.mockResolvedValue(value);
    expect(await getPersonalCommission(ctx, { month: "2027-01", page: 2, pageSize: 5 })).toMatchObject({ status: "unavailable", errorCategory: "source_invalid", amount: null });
  });
  it.each([
    [new TRPCError({ code: "UNAUTHORIZED", message: "synthetic secret SQL token" }), "identity_scope"],
    [new PlatformBusinessPublicError("FORBIDDEN", "synthetic secret SQL token"), "identity_scope"],
    [new PlatformBusinessServiceError("CONFIGURATION", { configMs: 0, requestMs: 0, decodeMs: 0 }), "delegation_unavailable"],
    [new PlatformBusinessServiceError("INVALID_RESPONSE", { configMs: 0, requestMs: 0, decodeMs: 0 }), "source_invalid"],
    [new Error("synthetic secret SQL token"), "query_failed"],
  ])("classifies failure safely without leaking exception detail", async (error, category) => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    f.commission.mockRejectedValue(error);
    const value = await getPersonalCommission(ctx, { month: "2027-01" });
    expect(value).toMatchObject({ status: "unavailable", errorCategory: category });
    expect(value).toHaveProperty("correlationId");
    expect(JSON.stringify(value)).not.toContain("synthetic secret");
    expect(JSON.stringify(log.mock.calls)).not.toContain("synthetic secret");
    expect(log.mock.calls[0][1]).toMatchObject({ method: "personalCommission.summary", category, correlationId: (value as any).correlationId });
  });
  it("performance reports safe correlation category too", async () => {
    f.performance.mockRejectedValue(new Error("synthetic secret SQL token"));
    const value = await getPersonalPerformance(ctx, { month: "2027-01" });
    expect(value).toMatchObject({ status: "unavailable", errorCategory: "query_failed" });
    expect(value).toHaveProperty("correlationId"); expect(JSON.stringify(value)).not.toContain("synthetic secret");
  });
  it("company wrapper returns fixed read-only choices", async () => {
    f.companies.mockResolvedValue([{ merchantId: 881142, label: "Synthetic" }]);
    expect(await getPersonalBusinessCompanies(ctx)).toEqual([{ merchantId: 881142, label: "Synthetic" }]);
    expect(f.companies).toHaveBeenCalledWith(ctx);
  });
});

describe("upstream unavailable result sanitization", () => {
  it("never reflects arbitrary upstream failure text or reuses upstream correlation", async () => {
    const raw: any = { ...result(), status: "unavailable", reason: "synthetic secret SQL token", errorCategory: "query_failed",
      correlationId: "123e4567-e89b-42d3-a456-426614174000" };
    for (const key of ["basis", "orderCount", "total", "readyCount", "pendingCount", "estimatedAmount", "earnedAmount", "verifiedEstimatedAmount", "verifiedEarnedAmount", "items", "page", "pageSize"]) delete raw[key];
    f.commission.mockResolvedValue(raw);
    const value: any = await getPersonalCommission(ctx, { month: "2027-01" });
    expect(value.status).toBe("unavailable"); expect(value.errorCategory).toBe("query_failed");
    expect(value.reason).not.toContain("synthetic secret"); expect(value.correlationId).not.toBe(raw.correlationId);
  });
});
