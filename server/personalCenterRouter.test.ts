import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
const service = vi.hoisted(() => ({
  profile: vi.fn(),
  updateProfile: vi.fn(),
  changePassword: vi.fn(),
  requestPhoneCode: vi.fn(),
  bindPhone: vi.fn(),
  performance: vi.fn(),
}));
vi.mock("./personalCenterService", () => ({
  personalCenterService: service,
  getPersonalPerformance: service.performance,
}));
import { personalCenterRouter } from "./personalCenterRouter";
const ctx = (role = "operation") =>
  ({
    user: { role: "admin", id: 990811 },
    adminAccount: {
      id: 990811,
      adminRole: role,
      status: "active",
      sessionVersion: 2,
    },
    adminPermissions: [],
    req: { headers: {}, protocol: "https" },
    res: { clearCookie: vi.fn() },
  }) as unknown as TrpcContext;
beforeEach(() => {
  vi.clearAllMocks();
  service.profile.mockResolvedValue({ username: "fictional" });
  service.changePassword.mockResolvedValue({
    success: true,
    requiresRelogin: true,
  });
  service.bindPhone.mockResolvedValue({
    success: true,
    phone: "13900000001",
    requiresRelogin: true,
  });
});
describe("personalCenter own-account router", () => {
  it.each([
    "super_admin",
    "operation",
    "merchant_mgr",
    "customer_svc",
    "risk_control",
    "finance",
    "auditor",
  ])("allows active %s without profile.manage grant", async role => {
    const context = ctx(role);
    await personalCenterRouter.createCaller(context).profile();
    expect(service.profile).toHaveBeenCalledWith(context.adminAccount);
  });
  it("rejects anonymous/OAuth compatibility/disabled sessions for every procedure", async () => {
    const calls = (
      caller: ReturnType<typeof personalCenterRouter.createCaller>
    ) => [
      () => caller.profile(),
      () => caller.updateProfile({ displayName: "本人", email: "" }),
      () =>
        caller.changePassword({
          oldPassword: "fictional",
          newPassword: "new-fictional",
        }),
      () =>
        caller.requestPhoneCode({
          oldPassword: "fictional",
          phone: "13900000001",
        }),
      () =>
        caller.bindPhone({
          oldPassword: "fictional",
          phone: "13900000001",
          ticketId: "123e4567-e89b-42d3-a456-426614174000",
          code: "000000",
        }),
      () => caller.performance({ month: "2026-11" }),
      () => caller.commission({ month: "2026-11" }),
    ];
    for (const kind of ["anonymous", "oauth", "disabled"]) {
      const context = ctx();
      if (kind === "anonymous") context.user = null;
      if (kind === "oauth") context.adminAccount = null;
      if (kind === "disabled") context.adminAccount!.status = "disabled";
      for (const run of calls(personalCenterRouter.createCaller(context)))
        await expect(run()).rejects.toBeTruthy();
    }
    expect(service.profile).not.toHaveBeenCalled();
    expect(service.changePassword).not.toHaveBeenCalled();
  });
  it("rejects user ID/grant/phone injection into own-profile mutation", async () => {
    const caller = personalCenterRouter.createCaller(ctx());
    await expect(
      caller.updateProfile({
        displayName: "本人",
        email: "",
        phone: "13900000001",
      } as any)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.changePassword({
        oldPassword: "fictional",
        newPassword: "new-fictional",
        adminUserId: 999999,
      } as any)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.performance({ month: "2026-11", actorUserId: 999999 } as any)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("clears the current session cookie after successful password and phone transitions", async () => {
    const context = ctx();
    const caller = personalCenterRouter.createCaller(context);
    expect(
      await caller.changePassword({
        oldPassword: "fictional",
        newPassword: "new-fictional",
      })
    ).toMatchObject({ requiresRelogin: true });
    await caller.bindPhone({
      oldPassword: "fictional",
      phone: "13900000001",
      ticketId: "123e4567-e89b-42d3-a456-426614174000",
      code: "000000",
    });
    expect(context.res.clearCookie).toHaveBeenCalledTimes(2);
    expect(context.res.clearCookie).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        httpOnly: true,
        sameSite: "none",
        secure: true,
        path: "/",
      })
    );
  });
  it("never clears cookie or reports success after rejected password", async () => {
    service.changePassword.mockRejectedValueOnce(
      new Error("fictional failure")
    );
    const context = ctx();
    await expect(
      personalCenterRouter
        .createCaller(context)
        .changePassword({
          oldPassword: "fictional",
          newPassword: "new-fictional",
        })
    ).rejects.toThrow();
    expect(context.res.clearCookie).not.toHaveBeenCalled();
  });
  it("commission is explicitly unconfigured with null amount, never inferred percentage", async () => {
    const result = await personalCenterRouter
      .createCaller(ctx())
      .commission({ month: "2026-11" });
    expect(result).toMatchObject({
      status: "unconfigured",
      month: "2026-11",
      amount: null,
      currency: "CNY",
    });
  });
});
