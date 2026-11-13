import { describe, expect, it, vi } from "vitest";
import {
  officialReceptionScopeAllows,
  resolveOfficialReception,
  type OfficialReceptionDependencies,
} from "./officialChannelInventory";
import { officialChannelInventoryRouter } from "../routers/officialChannelInventory";
const stock = { id: 11, teamId: 7, ownerAdminUserId: 101, revision: 3 };
const config = {
  stockId: 11,
  merchantId: 30061,
  sellerEnterpriseId: 31,
  routingMode: "owner" as const,
  recipientAdminUserId: null,
  responsibilityVersion: 4,
};
const authority = {
  ownerStatus: "active",
  ownerRole: "operation",
  ownerTeamId: 7,
  recipientStatus: "active",
  recipientRole: "operation",
  recipientTeamId: 7,
  recipientName: "真实业务员工",
  teamStatus: "active",
  bindingStatus: "active",
  frontUserId: 7001,
  bindingVersion: 2,
  scopeStatus: "active",
  modulePermissions: [
    "business.context.read",
    "business.inquiries.read",
    "business.inquiries.write",
  ],
  id: 30061,
  merchantNo: "TEST",
  companyName: "工厂同名不参与映射",
  crmStatus: "enabled",
  registrationRegion: "CN",
  registrationIdentifier: null,
  businessLicense: "91310000123456789X",
  crmOwnerPortalUserId: "8001",
};
function dependencies(
  changes: {
    authority?: Record<string, unknown> | null;
    context?: Record<string, unknown>;
    merchantIds?: number[];
  } = {}
) {
  const context = {
    enterpriseId: 31,
    ownerUserId: 8001,
    dataOwnerUserId: 8001,
    companyName: "可信企业",
    staffPrincipal: {
      status: "ready",
      frontendUserId: 7001,
      adminAccountId: 101,
      enterpriseId: 31,
      bindingVersion: 2,
      user: {
        id: 7001,
        name: "真实业务员工",
        username: "staff",
        loginDisabled: false,
      },
    },
    enabledModules: ["inquiry.receive"],
    workbenchCapabilities: ["inquiry.receive"],
    sessionCapabilities: { chat: false, receptionReady: true },
    ...changes.context,
  };
  return {
    allowedMerchantIds: () => changes.merchantIds ?? [30061],
    loadAuthority: vi
      .fn()
      .mockResolvedValue(
        changes.authority === undefined ? authority : changes.authority
      ),
    context: vi.fn().mockResolvedValue(context),
  } as unknown as OfficialReceptionDependencies & {
    loadAuthority: ReturnType<typeof vi.fn>;
    context: ReturnType<typeof vi.fn>;
  };
}
describe("official factory reception DI; never accesses MySQL/network", () => {
  it("uses current business owner plus exact legal merchant binding, not factoryName or uploader", async () => {
    const deps = dependencies();
    const result = await resolveOfficialReception(stock, config, deps);
    expect(result.projection).toMatchObject({
      status: "ready",
      recipientAdminUserId: 101,
      recipientFrontendUserId: 7001,
      businessOwnerAdminUserId: 101,
      sellerEnterpriseId: 31,
      bindingVersion: 2,
      responsibilityVersion: 4,
      stockRevision: 3,
    });
    expect(deps.context).toHaveBeenCalledWith(
      { creditCode: "91310000123456789X", expectedOwnerUserId: 8001 },
      { staffUserId: 7001, adminAccountId: 101, bindingVersion: 2 }
    );
    expect(JSON.stringify(deps.context.mock.calls)).not.toContain("工厂同名");
  });
  it("missing old config remains pending with no ownership/name/operator fallback", async () => {
    const deps = dependencies();
    expect(
      (await resolveOfficialReception(stock, null, deps)).projection
    ).toMatchObject({
      status: "pending",
      reason: "SELLER_MAPPING_REQUIRED",
      recipientFrontendUserId: null,
    });
    expect(deps.loadAuthority).not.toHaveBeenCalled();
    expect(deps.context).not.toHaveBeenCalled();
  });
  it("unapproved seller scope fails before upstream RPC", async () => {
    const deps = dependencies({ merchantIds: [] });
    expect(
      (await resolveOfficialReception(stock, config, deps)).projection.reason
    ).toBe("SELLER_OUT_OF_APPROVED_SCOPE");
    expect(deps.context).not.toHaveBeenCalled();
  });
  it.each([
    { ownerRole: "super_admin" },
    { recipientRole: "super_admin" },
    { ownerStatus: "disabled" },
    { recipientStatus: "locked" },
    { teamStatus: "archived" },
    { ownerTeamId: 8 },
    { recipientTeamId: 8 },
  ])(
    "admin proxy / inactive or cross-team employee stays pending: %j",
    async patch => {
      const deps = dependencies({ authority: { ...authority, ...patch } });
      expect(
        (await resolveOfficialReception(stock, config, deps)).projection.reason
      ).toBe("ACTIVE_BUSINESS_EMPLOYEE_REQUIRED");
      expect(deps.context).not.toHaveBeenCalled();
    }
  );
  it.each([
    { bindingStatus: "revoked" },
    { frontUserId: null },
    { bindingVersion: 0 },
  ])("does not use revoked/invalid real binding: %j", async patch => {
    const deps = dependencies({ authority: { ...authority, ...patch } });
    expect(
      (await resolveOfficialReception(stock, config, deps)).projection.reason
    ).toBe("STAFF_BINDING_REQUIRED");
    expect(deps.context).not.toHaveBeenCalled();
  });
  it("explicit prior division is preserved across owner handoff", async () => {
    const explicit = {
      ...config,
      routingMode: "explicit" as const,
      recipientAdminUserId: 202,
    };
    const deps = dependencies({
      context: {
        staffPrincipal: {
          status: "ready",
          frontendUserId: 7001,
          adminAccountId: 202,
          enterpriseId: 31,
          bindingVersion: 2,
          user: { id: 7001, name: "真实业务员工", loginDisabled: false },
        },
      },
    });
    const result = await resolveOfficialReception(
      { ...stock, ownerAdminUserId: 303, revision: 4 },
      { ...explicit, responsibilityVersion: 5 },
      deps
    );
    expect(result.projection).toMatchObject({
      status: "ready",
      businessOwnerAdminUserId: 303,
      recipientAdminUserId: 202,
      routingMode: "explicit",
      responsibilityVersion: 5,
      stockRevision: 4,
    });
    expect(explicit.recipientAdminUserId).toBe(202);
  });
  it.each([
    { sessionCapabilities: { chat: false, receptionReady: false } },
    { workbenchCapabilities: ["inventory.publish"] },
  ])("inventory grants cannot substitute inquiry.receive: %j", async patch => {
    expect(
      (
        await resolveOfficialReception(
          stock,
          config,
          dependencies({ context: patch })
        )
      ).projection.reason
    ).toBe("INQUIRY_RECEIVE_REQUIRED");
  });
  it.each([
    { frontendUserId: 9001 },
    { adminAccountId: 999 },
    { enterpriseId: 99 },
    { bindingVersion: 7 },
    { user: { id: 7001, loginDisabled: true } },
    { user: { id: 999, loginDisabled: false } },
  ])(
    "rejects principal substitution and stale binding evidence: %j",
    async patch => {
      const principal = {
        status: "ready",
        frontendUserId: 7001,
        adminAccountId: 101,
        enterpriseId: 31,
        bindingVersion: 2,
        user: { id: 7001, name: "真实业务员工", loginDisabled: false },
        ...patch,
      };
      expect(
        (
          await resolveOfficialReception(
            stock,
            config,
            dependencies({ context: { staffPrincipal: principal } })
          )
        ).projection.reason
      ).toBe("TRUSTED_SELLER_OR_STAFF_CHANGED");
    }
  );
  it("remote service unavailable is explicitly pending, never fake delivered", async () => {
    const deps = dependencies();
    deps.context.mockRejectedValue(new Error("network unavailable"));
    expect(
      (await resolveOfficialReception(stock, config, deps)).projection
    ).toMatchObject({
      status: "pending",
      reason: "FRONT_RECEPTION_UNAVAILABLE",
      recipientFrontendUserId: null,
    });
  });
  it("HK uses existing formal identifier mapping, never prepending twice or guessing factory name", async () => {
    const deps = dependencies({
      authority: {
        ...authority,
        registrationRegion: "HK",
        registrationIdentifier: "HK:12345678",
        businessLicense: null,
      },
    });
    expect(
      (await resolveOfficialReception(stock, config, deps)).projection.status
    ).toBe("ready");
    expect(deps.context.mock.calls[0][0]).toEqual({
      registrationIdentifier: "HK:12345678",
      expectedOwnerUserId: 8001,
    });
  });
  it("requires ready enterprise identity even if a different enterprise has receive authority", async () => {
    const deps = dependencies({
      context: {
        enterpriseId: 32,
        staffPrincipal: {
          status: "ready",
          frontendUserId: 7001,
          adminAccountId: 101,
          enterpriseId: 32,
          bindingVersion: 2,
          user: { id: 7001, loginDisabled: false },
        },
      },
    });
    expect(
      (await resolveOfficialReception(stock, config, deps)).projection.reason
    ).toBe("TRUSTED_SELLER_OR_STAFF_CHANGED");
  });
});
describe("explicit inquiry-only scope and strict client assertions", () => {
  it("allows independent reception without inventory grants but requires real enterprise context entry", () => {
    expect(
      officialReceptionScopeAllows([
        "business.context.read",
        "business.inquiries.read",
        "business.inquiries.write",
      ])
    ).toBe(true);
    expect(
      officialReceptionScopeAllows([
        "business.context.read",
        "business.inventory.read",
        "business.inventory.write",
      ])
    ).toBe(true);
    expect(
      officialReceptionScopeAllows([
        "business.inquiries.read",
        "business.inquiries.write",
      ])
    ).toBe(false);
  });
  it.each(["read", "write"])(
    "partial explicit inquiry %s never inherits legacy inventory scope",
    suffix => {
      expect(
        officialReceptionScopeAllows([
          "business.context.read",
          `business.inquiries.${suffix}`,
          "business.inventory.read",
          "business.inventory.write",
        ])
      ).toBe(false);
    }
  );
  it("unknown scope or inventory publish alone never makes reception ready", () => {
    expect(officialReceptionScopeAllows(["inventory.publish"])).toBe(false);
    expect(officialReceptionScopeAllows([])).toBe(false);
  });
  it.each([
    { sellerEnterpriseId: 31 },
    { recipientFrontendUserId: 7001 },
    { factoryName: "51电子网" },
    { routingMode: "owner", recipientAdminUserId: 101 },
    { routingMode: "explicit" },
  ])(
    "strict configure rejects identity injection / invalid division before DB: %j",
    async patch => {
      const caller = officialChannelInventoryRouter.createCaller({
        user: { id: 1, role: "admin" },
        adminAccount: { id: 1, status: "active", sessionVersion: 1 },
        adminPermissions: [],
        req: { headers: {} },
        res: {},
      } as any);
      await expect(
        caller.configureReception({
          stockId: 11,
          merchantId: 30061,
          routingMode: "owner",
          expectedRevision: 3,
          expectedResponsibilityVersion: 4,
          requestId: "test-request-reception",
          reason: "人工确认分工",
          ...patch,
        } as any)
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  );
});
