import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getHkCrmBindingByRegistrationIdentifier: vi.fn(),
    getCrmOwnerRebindLog: vi.fn(),
    rebindMerchantCrmOwner: vi.fn(),
    completeCrmOwnerRebindPlatformSync: vi.fn(),
    markCrmOwnerRebindPlatformSyncRetryable: vi.fn(),
  };
});

vi.mock("./platformCrmApi", () => ({
  validatePlatformCrmRebindTarget: vi.fn(),
  completePlatformCrmRebind: vi.fn(),
}));

import * as db from "./db";
import * as platformCrmApi from "./platformCrmApi";
import { appRouter } from "./routers";

const PORTAL_KEY = "portal-hk-owner-rebind-test-key";
const registrationIdentifier = "HK:12345678";
const requestId = "portal-hk-rebind-30004-001";

function portalCtx(portalKey = PORTAL_KEY): TrpcContext {
  return {
    user: null,
    adminAccount: null,
    req: {
      protocol: "https",
      ip: "198.51.100.9",
      headers: { ...(portalKey ? { "x-portal-key": portalKey } : {}), "user-agent": "portal-hk-owner-rebind-test" },
    } as unknown as TrpcContext["req"],
    res: { clearCookie: () => {}, cookie: () => {} } as unknown as TrpcContext["res"],
  };
}

const binding = {
  found: true as const,
  merchantId: 30004,
  merchantNo: "M30004",
  companyName: "Example Hong Kong Limited",
  registrationIdentifier,
  identity: registrationIdentifier,
  crmStatus: "enabled",
  crmOwnerPortalUserId: "390005",
};

const ledger = {
  id: 1,
  requestId,
  merchantId: 30004,
  expectedOwnerPortalUserId: "390005",
  nextOwnerPortalUserId: "396297",
  creditCode: null,
  registrationIdentifier,
  reason: "Original owner left and active member was verified",
  platformSyncStatus: "pending" as const,
};

const input = () => ({
  registrationIdentifier: registrationIdentifier.toLowerCase(),
  expectedPortalUserId: "390005",
  newPortalUserId: "396297",
  reason: "Original owner left and active member was verified",
  requestId,
  actorName: "HK enterprise owner",
});

describe("portal.rebindHkCrmOwnerByEnterpriseOwner", () => {
  const getBinding = vi.mocked(db.getHkCrmBindingByRegistrationIdentifier);
  const getLog = vi.mocked(db.getCrmOwnerRebindLog);
  const rebind = vi.mocked(db.rebindMerchantCrmOwner);
  const preflight = vi.mocked(platformCrmApi.validatePlatformCrmRebindTarget);
  const complete = vi.mocked(platformCrmApi.completePlatformCrmRebind);

  beforeEach(() => {
    process.env.PORTAL_API_KEY = PORTAL_KEY;
    vi.resetAllMocks();
    getBinding.mockResolvedValue(binding as Awaited<ReturnType<typeof db.getHkCrmBindingByRegistrationIdentifier>>);
    getLog.mockResolvedValue(null);
    preflight.mockResolvedValue({
      valid: true,
      enterpriseId: 51,
      registrationIdentifier,
      expectedSuperAdminUserId: 390005,
      targetUserId: 396297,
    });
    rebind.mockResolvedValue({
      success: true,
      idempotent: false,
      requestId,
      merchantId: 30004,
      crmStatus: "enabled",
      previousPortalUserId: "390005",
      crmOwnerPortalUserId: "396297",
      platformSyncStatus: "pending",
    });
    getLog.mockResolvedValueOnce(null).mockResolvedValueOnce(ledger as Awaited<ReturnType<typeof db.getCrmOwnerRebindLog>>);
    db.completeCrmOwnerRebindPlatformSync = vi.fn().mockResolvedValue({ ...ledger, platformSyncStatus: "completed" }) as never;
    db.markCrmOwnerRebindPlatformSyncRetryable = vi.fn().mockResolvedValue({ ...ledger, platformSyncStatus: "retryable" }) as never;
    complete.mockResolvedValue({ success: true, idempotent: false, enterpriseId: 51, superAdminUserId: 396297 });
  });

  it("rejects a missing portal key before any HK identity lookup", async () => {
    await expect(appRouter.createCaller(portalCtx("")).portal.rebindHkCrmOwnerByEnterpriseOwner(input()))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(getBinding).not.toHaveBeenCalled();
  });

  it("uses only registrationIdentifier through preflight, CAS, and platform completion", async () => {
    const result = await appRouter.createCaller(portalCtx()).portal.rebindHkCrmOwnerByEnterpriseOwner(input());
    expect(getBinding).toHaveBeenCalledWith(registrationIdentifier);
    expect(preflight).toHaveBeenCalledWith({
      registrationIdentifier,
      expectedPortalUserId: "390005",
      newPortalUserId: "396297",
    });
    expect(rebind).toHaveBeenCalledWith(expect.objectContaining({ merchantId: 30004, requestId }));
    expect(complete).toHaveBeenCalledWith({
      registrationIdentifier,
      expectedPortalUserId: "390005",
      newPortalUserId: "396297",
      reason: "Original owner left and active member was verified",
      requestId,
    });
    expect(JSON.stringify(preflight.mock.calls)).not.toContain("creditCode");
    expect(JSON.stringify(complete.mock.calls)).not.toContain("creditCode");
    expect(result).toMatchObject({ success: true, platformEnterpriseId: 51 });
  });

  it("replays an HK retry by the ledger identity and does not re-run lookup or preflight", async () => {
    getLog.mockReset();
    getLog.mockResolvedValue({ ...ledger, platformSyncStatus: "retryable" } as Awaited<ReturnType<typeof db.getCrmOwnerRebindLog>>);
    await expect(appRouter.createCaller(portalCtx()).portal.rebindHkCrmOwnerByEnterpriseOwner(input()))
      .resolves.toMatchObject({ success: true, idempotent: true, platformEnterpriseId: 51 });
    expect(getBinding).not.toHaveBeenCalled();
    expect(preflight).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ registrationIdentifier }));
  });
});
