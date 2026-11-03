import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { COOKIE_NAME } from "../../shared/const";
const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  overview: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  member: vi.fn(),
  template: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("../_core/sdk", () => ({ sdk: { verifySession: mocks.verify } }));
vi.mock("../adminAuth", () => ({
  LOCAL_ADMIN_SESSION_APP_ID: "51dianzi-admin",
  parseLocalAdminId: (openId: string) =>
    /^local_admin:[1-9][0-9]*$/.test(openId) ? Number(openId.slice(12)) : null,
}));
vi.mock("../services/staffOrganization", () => ({
  getStaffOrganizationOverview: mocks.overview,
  createStaffOrganizationTeam: mocks.create,
  updateStaffOrganizationTeam: mocks.update,
  setStaffOrganizationMember: mocks.member,
  applyStaffOrganizationTemplate: mocks.template,
  getStaffOrganizationAudit: mocks.audit,
}));
import {
  staffOrganizationActorFromContext,
  staffOrganizationRouter,
} from "./staffOrganization";
function ctx(
  options: { token?: string; account?: boolean; role?: string } = {}
): TrpcContext {
  return {
    req: {
      headers: {
        ...(options.token === undefined
          ? { cookie: `${COOKIE_NAME}=signed_token` }
          : options.token
            ? { authorization: `Bearer ${options.token}` }
            : {}),
      },
      method: "POST",
      path: "/api/trpc",
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    user: { id: 30004, role: "admin" } as TrpcContext["user"],
    adminAccount:
      options.account === false
        ? null
        : ({
            id: 30004,
            username: "admin",
            adminRole: options.role ?? "super_admin",
            displayName: "Victor",
            status: "active",
            sessionVersion: 7,
          } as TrpcContext["adminAccount"]),
    adminPermissions: ["admins.manage"],
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.verify.mockResolvedValue({
    openId: "local_admin:30004",
    appId: "51dianzi-admin",
    sessionVersion: 7,
  });
  mocks.overview.mockResolvedValue({ canManage: true });
  mocks.create.mockResolvedValue({ revision: 1 });
});
describe("staffOrganization signed local boundary", () => {
  it("reverifies the signed token and derives actor only from matching local account", async () => {
    expect(await staffOrganizationActorFromContext(ctx())).toEqual({
      adminUserId: 30004,
      sessionVersion: 7,
    });
    expect(mocks.verify).toHaveBeenCalledWith("signed_token");
    await staffOrganizationRouter
      .createCaller(ctx())
      .createTeam({ name: "运营组", requestId: "request_001" });
    expect(mocks.create).toHaveBeenCalledWith(
      { adminUserId: 30004, sessionVersion: 7 },
      { name: "运营组", requestId: "request_001" }
    );
  });
  it("rejects an OAuth admin or a context snapshot without a signed session", async () => {
    await expect(
      staffOrganizationActorFromContext(ctx({ account: false }))
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      staffOrganizationActorFromContext(ctx({ token: "" }))
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it.each([
    null,
    { openId: "local_admin:30004", appId: "other-app", sessionVersion: 7 },
    { openId: "local_admin:30009", appId: "51dianzi-admin", sessionVersion: 7 },
    { openId: "local_admin:30004", appId: "51dianzi-admin", sessionVersion: 6 },
  ])(
    "rejects invalid signature/audience/actor/session version %#",
    async session => {
      mocks.verify.mockResolvedValue(session);
      await expect(
        staffOrganizationActorFromContext(ctx())
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
  );
  it("requires strict schemas on reads as well as mutations", async () => {
    const caller = staffOrganizationRouter.createCaller(ctx());
    await expect(
      caller.overview({ actorAdminUserId: 30009 } as never)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.audit({ page: 1, pageSize: 20, adminUserId: 30009 } as never)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.createTeam({
        name: "运营组",
        requestId: "request_001",
        actorAdminUserId: 30009,
      } as never)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.overview).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("requires and forwards a nonnegative target session CAS independently of the signed actor", async () => {
    const caller = staffOrganizationRouter.createCaller(ctx());
    const input = {
      adminUserId: 30009,
      templateId: "operations-view" as const,
      expectedRevision: 0,
      requestId: "template_router_001",
    };
    for (const expectedSessionVersion of [undefined, -1, 1.5, "3", null])
      await expect(caller.applyTemplate({ ...input, expectedSessionVersion } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.template).not.toHaveBeenCalled();
    await caller.applyTemplate({ ...input, expectedSessionVersion: 3 });
    expect(mocks.template).toHaveBeenCalledWith(
      { adminUserId: 30004, sessionVersion: 7 },
      { ...input, expectedSessionVersion: 3 }
    );
  });
  it("does not leak raw SQL or connection credentials on service failure", async () => {
    mocks.create.mockRejectedValue(
      new Error("mysql://user:secret@host/db SQL failure")
    );
    await expect(
      staffOrganizationRouter
        .createCaller(ctx())
        .createTeam({ name: "运营组", requestId: "request_001" })
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "运营组织操作失败，请重试；若版本冲突请先刷新",
    });
  });
});
