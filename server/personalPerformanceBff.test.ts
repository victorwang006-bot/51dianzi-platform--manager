import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQLWrapper } from "drizzle-orm";
import type { TrpcContext } from "./_core/context";
let read: (typeof import("./businessRouter"))["readBusinessPersonalPerformance"];
let fenceHeld: boolean;
let scope: string[];
let binding: { frontUserId: number; bindingVersion: number } | null;
let platform: ReturnType<typeof vi.fn>;
let calls: ReturnType<typeof vi.fn>;
let nativeVersion: number;
let nativeStatus: string;
let archived: boolean;
let beforeFence: (() => Promise<void>) | undefined;
let nativeSelect: ReturnType<typeof vi.fn>;
const oldIds = process.env.BUSINESS_WORKBENCH_MERCHANT_IDS;
const oldEnv = process.env.NODE_ENV;
const context = () =>
  ({
    user: { id: 999861, role: "admin" },
    adminAccount: {
      id: 999861,
      username: "fictional_admin",
      displayName: "虚构后台本人",
      status: "active",
      adminRole: "auditor",
      sessionVersion: 3,
    },
    adminPermissions: [],
    req: { headers: {} },
    res: {},
  }) as unknown as TrpcContext;
beforeEach(async () => {
  vi.resetModules();
  fenceHeld = false;
  scope = ["business.orders.read", "business.customers.read"];
  binding = { frontUserId: 999872, bindingVersion: 6 };
  nativeVersion = 3;
  nativeStatus = "active";
  archived = false;
  beforeFence = undefined;
  nativeSelect = vi.fn(async (query: SQLWrapper) => {
    expect(fenceHeld).toBe(true);
    const compiled = new MySqlDialect().sqlToQuery(query.getSQL());
    expect(compiled.sql).toContain("a.status = 'active'");
    expect(compiled.sql).toContain("a.sessionVersion = ?");
    expect(compiled.sql).toContain(
      "NOT EXISTS (SELECT 1 FROM admin_staff_archives"
    );
    expect(compiled.params).toEqual([999861, 3]);
    return [
      nativeVersion === 3 && nativeStatus === "active" && !archived
        ? [{ id: 999861 }]
        : [],
      [],
    ];
  });
  process.env.NODE_ENV = "test";
  process.env.BUSINESS_WORKBENCH_MERCHANT_IDS = "999883";
  calls = vi.fn(async (_admin: number, merchantId: number) => {
    expect(fenceHeld).toBe(true);
    return { merchantId, modulePermissions: scope, scopeVersion: 8 };
  });
  platform = vi.fn(async () => {
    expect(fenceHeld).toBe(true);
    return { status: "fictional-result" };
  });
  vi.doMock("./db", () => ({
    getDb: vi.fn(async () => ({ execute: nativeSelect })),
    withBusinessAuthorizationFence: vi.fn(
      async (_key: unknown, run: () => Promise<unknown>) => {
        await beforeFence?.();
        fenceHeld = true;
        try {
          return await run();
        } finally {
          fenceHeld = false;
        }
      }
    ),
    getActiveBusinessStaffBinding: vi.fn(async () => {
      expect(fenceHeld).toBe(true);
      return binding;
    }),
    getActiveBusinessMerchantScope: calls,
    getBusinessWorkbenchMerchantById: vi.fn(async (id: number) => ({
      id,
      crmStatus: "enabled",
      registrationRegion: "CN",
      businessLicense: "FICTIONAL-CREDIT-CODE",
      crmOwnerPortalUserId: "999894",
    })),
  }));
  vi.doMock("./platformBusinessApi", () => ({
    PlatformBusinessPublicError: class extends Error {},
    PlatformBusinessServiceError: class extends Error {},
    callPlatformBusinessCommand: platform,
    getPlatformBusinessContext: vi.fn(),
    validatePlatformBusinessStaffCandidate: vi.fn(),
  }));
  ({ readBusinessPersonalPerformance: read } = await import(
    "./businessRouter"
  ));
});
afterEach(() => {
  vi.doUnmock("./db");
  vi.doUnmock("./platformBusinessApi");
  vi.resetModules();
  if (oldIds === undefined) delete process.env.BUSINESS_WORKBENCH_MERCHANT_IDS;
  else process.env.BUSINESS_WORKBENCH_MERCHANT_IDS = oldIds;
  if (oldEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = oldEnv;
});
describe("personal performance fixed read-only BFF (fictional IO)", () => {
  it("forwards only fixed method and verified frontend staff identity inside fence", async () => {
    await read(context(), 999883, { month: "2026-11", page: 3, pageSize: 10 });
    expect(platform).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "personalPerformance.summary",
        params: { month: "2026-11", page: 3, pageSize: 10 },
        staffUserId: 999872,
        bindingVersion: 6,
        adminActor: { id: 999861, name: "虚构后台本人", role: "auditor" },
        binding: {
          creditCode: "FICTIONAL-CREDIT-CODE",
          expectedOwnerUserId: 999894,
        },
      })
    );
    expect(calls).toHaveBeenCalledWith(999861, 999883);
    expect(fenceHeld).toBe(false);
  });
  it("requires both exact orders-read and customers-read local scope; superadmin role is not a bypass", async () => {
    for (const permissions of [
      ["business.orders.read"],
      ["business.customers.read"],
      [],
    ]) {
      scope = permissions;
      const ctx = context();
      ctx.adminAccount!.adminRole = "super_admin";
      await expect(
        read(ctx, 999883, { month: "2026-11" })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(platform).not.toHaveBeenCalled();
  });
  it("revoked binding/foreign merchant/OAuth account never reach platform", async () => {
    binding = null;
    await expect(
      read(context(), 999883, { month: "2026-11" })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    binding = { frontUserId: 999872, bindingVersion: 6 };
    await expect(
      read(context(), 999999, { month: "2026-11" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const oauth = context();
    oauth.adminAccount = null;
    await expect(
      read(oauth, 999883, { month: "2026-11" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(platform).not.toHaveBeenCalled();
  });
  it.each(["password", "disabled", "archive"])(
    "does not forward when %s revokes native account during fence wait with unchanged binding/scope",
    async reason => {
      let release!: () => void;
      let entered!: () => void;
      const waiting = new Promise<void>(resolve => {
        entered = resolve;
      });
      const barrier = new Promise<void>(resolve => {
        release = resolve;
      });
      beforeFence = async () => {
        entered();
        await barrier;
      };
      const pending = read(context(), 999883, { month: "2026-11" });
      await waiting;
      if (reason === "password") nativeVersion++;
      if (reason === "disabled") nativeStatus = "disabled";
      if (reason === "archive") archived = true;
      release();
      await expect(pending).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(binding).toEqual({ frontUserId: 999872, bindingVersion: 6 });
      expect(scope).toEqual([
        "business.orders.read",
        "business.customers.read",
      ]);
      expect(calls).toHaveBeenCalled();
      expect(nativeSelect).toHaveBeenCalledTimes(1);
      expect(platform).not.toHaveBeenCalled();
    }
  );
});
