import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { staffArchiveInput, assertArchivePreview, isMemberArchiveReceipt, type MemberArchivePreview } from "./staffArchiveModel";
const mock = vi.hoisted(() => ({ get: vi.fn(), permissions: vi.fn(), fence: vi.fn(), binding: vi.fn(), access: vi.fn(), call: vi.fn(), history: vi.fn(), find: vi.fn(), start: vi.fn(), attempt: vi.fn(), complete: vi.fn(), fail: vi.fn() }));
vi.mock("./db", () => ({ getAdminUserById: mock.get, getAdminUserPermissions: mock.permissions, withBusinessAuthorizationFence: mock.fence, getActiveBusinessStaffBinding: mock.binding }));
vi.mock("./businessAccess", () => ({ requireBusinessBindingManager: (ctx: any) => { if (!ctx.adminAccount || ctx.adminAccount.status !== "active" || ctx.adminAccount.adminRole !== "super_admin") throw new Error("DENIED"); return ctx.adminAccount; }, assertBusinessMerchantAccess: mock.access, businessEnterpriseBindingFromMerchant: () => ({ creditCode: "ISOLATED", expectedOwnerUserId: 900 }) }));
vi.mock("./staffArchiveDb", () => ({ findStaffArchive: mock.find, staffBindingHistory: mock.history, startStaffArchive: mock.start, markStaffArchiveAttempt: mock.attempt, completeStaffArchive: mock.complete, failStaffArchive: mock.fail }));
vi.mock("./platformBusinessApi", () => ({ callPlatformBusinessCommand: mock.call, PlatformBusinessPublicError: class DomainError extends Error {} }));
import { archiveStaff, previewStaffArchive } from "./staffArchive";
const input = { id: 20, merchantId: 30061, expectedSessionVersion: 4, expectedBindingVersion: 3, expectedRevision: "a".repeat(64), requestId: "staff_archive_test_0001" };
const actor = { id: 10, status: "active", sessionVersion: 8, adminRole: "super_admin", displayName: "Actor", username: "actor" };
const ctx = { user: { id: 10, role: "admin" }, adminAccount: actor } as any;
const preview: MemberArchivePreview = { enterpriseId: 701, target: { userId: 202, displayName: "Target" }, revision: input.expectedRevision, inventory: { total: 0 }, inquiries: { total: 0 }, customers: { total: 0 }, limits: { exceeded: false }, unsupported: [], candidates: [{ userId: 303, displayName: "Recipient", eligible: true, unavailableReason: null }] };
function record(overrides = {}) { return { id: 1, adminUserId: 20, merchantId: 30061, enterpriseId: 701, frontUserId: 202, actorAdminUserId: 10, actorFrontUserId: 101, actorBindingVersion: 2, bindingVersion: 3, expectedSessionVersion: 4, resultingSessionVersion: 5, requestId: input.requestId, expectedRevision: input.expectedRevision, nextOwnerUserId: null, enterpriseBinding: { creditCode: "ISOLATED", expectedOwnerUserId: 900 }, state: "access_closed", ...overrides }; }
beforeEach(() => {
  vi.clearAllMocks();
  mock.get.mockImplementation(async (id: number) => id === 10 ? actor : { id: 20, status: "active", sessionVersion: 4 });
  mock.permissions.mockResolvedValue([]); mock.fence.mockImplementation(async (_key: unknown, callback: any) => callback());
  mock.history.mockResolvedValue({ kind: "bound", current: {} });
  mock.binding.mockImplementation(async (id: number) => ({ frontUserId: id === 10 ? 101 : 202, bindingVersion: id === 10 ? 2 : 3 }));
  mock.access.mockResolvedValue({}); mock.find.mockResolvedValue(null); mock.start.mockResolvedValue(record());
  mock.call.mockImplementation(async (command: any) => command.method.endsWith("Preview") ? preview : { success: true, removed: true, enterpriseId: 701, targetUserId: 202 });
  mock.attempt.mockResolvedValue(undefined); mock.complete.mockResolvedValue(undefined); mock.fail.mockResolvedValue(undefined);
});
describe("staff retirement coordinator", () => {
  it("closes access durably before member handoff, using the actor binding not the target ID", async () => {
    const result = await archiveStaff(ctx, input);
    expect(result.success).toBe(true);
    const remote = mock.call.mock.calls[1][0];
    expect(remote.staffUserId).toBe(101); expect(remote.adminActor.id).toBe(10); expect(remote.params.userId).toBe(202);
    expect(mock.start.mock.invocationCallOrder[0]).toBeLessThan(mock.call.mock.invocationCallOrder[1]);
    expect(mock.attempt.mock.invocationCallOrder[0]).toBeLessThan(mock.call.mock.invocationCallOrder[1]);
    expect(mock.complete).toHaveBeenCalledOnce();
  });
  it("reports access closed + pending, never all-success on RPC failure", async () => {
    mock.call.mockImplementation(async (command: any) => { if (command.method.endsWith("Preview")) return preview; throw new Error("network failed"); });
    expect(await archiveStaff(ctx, input)).toMatchObject({ success: false, state: "retryable", backendAccessClosed: true, enterpriseRemoved: false });
    expect(mock.complete).not.toHaveBeenCalled(); expect(mock.fail).toHaveBeenCalledOnce();
  });
  it("rejects a wrong enterprise/member success receipt", async () => {
    mock.call.mockImplementation(async (command: any) => command.method.endsWith("Preview") ? preview : { success: true, removed: true, enterpriseId: 999, targetUserId: 202 });
    expect((await archiveStaff(ctx, input)).success).toBe(false); expect(mock.complete).not.toHaveBeenCalled();
  });
  it("retries a durable pending record without a new preview or a second disable", async () => {
    mock.find.mockResolvedValue(record({ state: "retryable" }));
    await archiveStaff(ctx, input);
    expect(mock.start).not.toHaveBeenCalled(); expect(mock.call).toHaveBeenCalledOnce(); expect(mock.call.mock.calls[0][0].params.requestId).toBe(input.requestId);
  });
  it("replays completed records with no remote side effect", async () => {
    mock.find.mockResolvedValue(record({ state: "completed" }));
    expect(await archiveStaff(ctx, input)).toMatchObject({ success: true, idempotent: true }); expect(mock.call).not.toHaveBeenCalled();
  });
  it("rejects request payload, actor, and binding-version collisions", async () => {
    mock.find.mockResolvedValue(record());
    await expect(archiveStaff(ctx, { ...input, expectedRevision: "b".repeat(64) })).rejects.toMatchObject({ code: "CONFLICT" });
    mock.find.mockResolvedValue(record({ actorAdminUserId: 99 }));
    await expect(archiveStaff(ctx, input)).rejects.toMatchObject({ code: "CONFLICT" });
    mock.find.mockResolvedValue(record({ bindingVersion: 8 }));
    await expect(archiveStaff(ctx, input)).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("blocks self/owner and unresolved formerly-bound accounts", async () => {
    await expect(archiveStaff(ctx, { ...input, id: 10 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    mock.binding.mockImplementation(async (id: number) => ({ frontUserId: id === 10 ? 101 : 900, bindingVersion: 3 }));
    await expect(archiveStaff(ctx, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    mock.history.mockResolvedValue({ kind: "unresolved" });
    await expect(previewStaffArchive(ctx, input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it("never-bound admin-only retirement needs no forged front principal or handoff", async () => {
    mock.history.mockResolvedValue({ kind: "never_bound" });
    const only = { ...input, merchantId: null, expectedBindingVersion: 0, expectedRevision: null };
    const onlyPreview = await previewStaffArchive(ctx, { id: 20 });
    expect(onlyPreview).toMatchObject({ adminOnly: true, preview: null, expectedBindingVersion: 0 });
    mock.start.mockResolvedValue(record({ frontUserId: null, enterpriseId: null, enterpriseBinding: null, state: "completed" }));
    expect(await archiveStaff(ctx, only)).toMatchObject({ success: true, idempotent: false, membershipRequired: false, enterpriseRemoved: null });
    expect(mock.call).not.toHaveBeenCalled(); expect(mock.access).not.toHaveBeenCalled();
  });
  it("replays an existing admin-only receipt only in its original null enterprise", async () => {
    mock.history.mockResolvedValue({ kind: "never_bound" });
    const only = { ...input, merchantId: null, expectedBindingVersion: 0, expectedRevision: null };
    mock.find.mockResolvedValue(record({ merchantId: null, frontUserId: null, enterpriseId: null, bindingVersion: 0, expectedRevision: null, state: "completed" }));
    expect(await archiveStaff(ctx, only)).toMatchObject({ success: true, idempotent: true, membershipRequired: false });
    await expect(archiveStaff(ctx, { ...only, merchantId: 999 })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mock.start).not.toHaveBeenCalled(); expect(mock.call).not.toHaveBeenCalled();
  });
  it("returns pending only after verifying the original actor and enterprise bindings", async () => {
    mock.find.mockResolvedValue(record({ state: "retryable", nextOwnerUserId: 303 }));
    expect(await previewStaffArchive(ctx, input)).toMatchObject({ preview: null, pending: { requestId: input.requestId, nextOwnerUserId: 303, expectedRevision: input.expectedRevision } });
    for (const changed of [{ actorAdminUserId: 99 }, { merchantId: 999 }, { actorBindingVersion: 99 }, { frontUserId: 404 }, { enterpriseBinding: { registrationIdentifier: "other", expectedOwnerUserId: 900 } }]) {
      mock.find.mockResolvedValue(record(changed));
      await expect(previewStaffArchive(ctx, input)).rejects.toBeTruthy();
    }
    expect(mock.call).not.toHaveBeenCalled();
  });
  it("rejects all original request and actor payload collisions without side effects", async () => {
    mock.find.mockResolvedValue(record());
    for (const changed of [{ requestId: "staff_other_request" }, { merchantId: 999 }, { expectedSessionVersion: 99 }, { nextOwnerUserId: 303 }]) {
      await expect(archiveStaff(ctx, { ...input, ...changed })).rejects.toMatchObject({ code: "CONFLICT" });
    }
    mock.get.mockResolvedValue({ ...actor, sessionVersion: 99 });
    await expect(archiveStaff(ctx, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mock.start).not.toHaveBeenCalled(); expect(mock.attempt).not.toHaveBeenCalled(); expect(mock.call).not.toHaveBeenCalled();
  });
  it("fails closed on unknown responsibilities before any disable", async () => {
    mock.call.mockResolvedValue({ ...preview, unsupported: [{ key: "unknown", label: "未支持责任", reason: "无法核验", blocking: true }] });
    await expect(archiveStaff(ctx, input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" }); expect(mock.start).not.toHaveBeenCalled();
  });
});
describe("retirement safety contracts", () => {
  it("requires supported duties to use a currently eligible same-enterprise recipient", () => {
    expect(() => assertArchivePreview({ ...preview, inventory: { total: 1 } }, input)).toThrow("请先交接负责业务");
    expect(() => assertArchivePreview({ ...preview, inventory: { total: 1 } }, { ...input, nextOwnerUserId: 404 })).toThrow("合法");
    expect(() => assertArchivePreview({ ...preview, inventory: { total: 1 } }, { ...input, nextOwnerUserId: 303 })).not.toThrow();
    expect(isMemberArchiveReceipt({ success: true, removed: true }, 701, 202)).toBe(false);
  });
  it("accepts no identity/version shortcuts and permits genuine admin-only absence", () => {
    expect(staffArchiveInput.safeParse({ ...input, expectedBindingVersion: -1 }).success).toBe(false);
    expect(staffArchiveInput.safeParse({ ...input, expectedBindingVersion: 0, expectedRevision: null, merchantId: null }).success).toBe(true);
  });
  it("retains rows/history, uses permanent archives, and disables the legacy physical-delete API", () => {
    const lifecycle = readFileSync("server/staffArchiveDb.ts", "utf8");
    const routers = readFileSync("server/routers.ts", "utf8");
    expect(lifecycle).not.toMatch(/\.delete\(/); expect(lifecycle).not.toContain("adminUserId: null");
    expect(lifecycle).toContain('state: adminOnly ? "completed" : "access_closed"');
    expect(routers.slice(routers.indexOf("    remove: adminManageProcedure"))).not.toContain("db.deleteAdminUser(input.id");
    expect(readFileSync("scripts/20261105-admin-staff-archives.sql", "utf8")).not.toMatch(/\b(ALTER|DELETE|UPDATE|DROP)\s/i);
  });
});
