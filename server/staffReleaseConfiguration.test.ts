import { afterEach, describe, expect, it, vi } from "vitest";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyStaffTeamPlan, assertSafePlanStat, main, readSecurePlan, safeError, staffTeamPlanSchema, type ConfigurationServices } from "../scripts/apply-staff-team-configuration";
const member = { adminUserId: 30005, role: "leader" as const, expectedRevision: 7, requestId: "member_req_0001" };
const plan = () => ({ actor: { adminUserId: 30004, sessionVersion: 8 }, team: { name: "Reviewed team", notes: "explicit grouping", requestId: "team_req_0001" }, members: [structuredClone(member)] });
function mocks() {
  return {
    createStaffOrganizationTeam: vi.fn().mockResolvedValue({ targetId: 70, revision: 1, requestId: "team_req_0001", idempotent: false }),
    setStaffOrganizationMember: vi.fn().mockResolvedValue({ targetId: 30005, revision: 8, requestId: member.requestId, idempotent: false }),
  };
}
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
describe("controlled native staff grouping (no DB)", () => {
  it("strictly validates all boundaries; never accepts client teamId/template/permissions/nativeRole", () => {
    expect(staffTeamPlanSchema.safeParse(plan()).success).toBe(true);
    for (const bad of [
      { ...plan(), dsn: "forbidden" },
      { ...plan(), actor: { ...plan().actor, sessionVersion: 0 } },
      { ...plan(), actor: { ...plan().actor, nativeRole: "super_admin" } },
      { ...plan(), team: { ...plan().team, templateId: "platform-operations" } },
      { ...plan(), members: [{ ...member, teamId: 8 }] },
      { ...plan(), members: [{ ...member, role: null }] },
      { ...plan(), members: [{ ...member, permissions: [] }] },
      { ...plan(), members: [{ ...member, expectedRevision: -1 }] },
      { ...plan(), members: [{ ...member, requestId: plan().team.requestId }] },
      { ...plan(), members: [member, { ...member, adminUserId: 30006 }] },
      { ...plan(), members: Array.from({ length: 101 }, (_, i) => ({ ...member, requestId: `request_${i}` })) },
    ]) expect(staffTeamPlanSchema.safeParse(bad).success).toBe(false);
  });
  it("checks file type, symlink, UID, mode and size before reading", async () => {
    const stat = { isFile: () => true, isSymbolicLink: () => false, uid: 123, mode: 0o100600, size: 10 };
    expect(() => assertSafePlanStat(stat, 123)).not.toThrow();
    for (const change of [{ uid: 124 }, { mode: 0o100604 }, { size: 1048577 }, { isFile: () => false }, { isSymbolicLink: () => true }])
      expect(() => assertSafePlanStat({ ...stat, ...change }, 123)).toThrow();
    const dir = await mkdtemp(join(tmpdir(), "staff-runner-")); dirs.push(dir);
    const file = join(dir, "plan.json"); await writeFile(file, JSON.stringify(plan()), { mode: 0o600 });
    expect(await readSecurePlan(file)).toEqual(plan());
    await symlink(file, join(dir, "link")); await expect(readSecurePlan(join(dir, "link"))).rejects.toThrow();
    await chmod(file, 0o640); await expect(readSecurePlan(file)).rejects.toThrow();
    await chmod(file, 0o600); await writeFile(file, Buffer.alloc(1048577)); await expect(readSecurePlan(file)).rejects.toThrow();
  });
  it("creates first, injects only stable targetId, retries exact original payload and CAS", async () => {
    const service = mocks(); const emit = vi.fn().mockResolvedValue(undefined); const raw = plan();
    expect(await applyStaffTeamPlan(raw, service as ConfigurationServices, emit)).toBe(true);
    service.createStaffOrganizationTeam.mockResolvedValue({ targetId: 70, revision: 1, requestId: raw.team.requestId, idempotent: true });
    service.setStaffOrganizationMember.mockResolvedValue({ targetId: 30005, revision: 8, requestId: member.requestId, idempotent: true });
    expect(await applyStaffTeamPlan(raw, service as ConfigurationServices, emit)).toBe(true);
    expect(service.createStaffOrganizationTeam.mock.calls).toEqual([[raw.actor, raw.team], [raw.actor, raw.team]]);
    expect(service.setStaffOrganizationMember.mock.calls).toEqual([[raw.actor, { ...member, teamId: 70 }], [raw.actor, { ...member, teamId: 70 }]]);
    expect(service.createStaffOrganizationTeam.mock.invocationCallOrder[0]).toBeLessThan(service.setStaffOrganizationMember.mock.invocationCallOrder[0]);
    expect(raw).toEqual(plan());
    expect(emit.mock.calls.some(([receipt]) => receipt.idempotent === true)).toBe(true);
  });
  it("stops on first member failure without compensation or implicit authorization", async () => {
    const service = mocks(); const emit = vi.fn().mockResolvedValue(undefined); const raw = plan();
    raw.members.push({ ...member, adminUserId: 30006, requestId: "member_req_0002" });
    service.setStaffOrganizationMember.mockRejectedValue({ code: "CONFLICT", message: "mysql://secret", stack: "private" });
    expect(await applyStaffTeamPlan(raw, service as ConfigurationServices, emit)).toBe(false);
    expect(service.createStaffOrganizationTeam).toHaveBeenCalledTimes(1); expect(service.setStaffOrganizationMember).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0].success).toBe(true); expect(emit.mock.calls[1][0].success).toBe(false);
    expect(JSON.stringify(emit.mock.calls)).not.toMatch(/mysql|secret|private/);
    service.createStaffOrganizationTeam.mockRejectedValue(new Error("secret")); service.setStaffOrganizationMember.mockClear();
    expect(await applyStaffTeamPlan(plan(), service as ConfigurationServices, emit)).toBe(false);
    expect(service.setStaffOrganizationMember).not.toHaveBeenCalled();
    expect(safeError({ code: "mysql://secret" }).code).toBe("CONFIGURATION_FAILED");
  });
  it("does not load any DB service without explicit apply plus valid flags", async () => {
    const load = vi.fn(); const output = vi.fn().mockResolvedValue(undefined);
    expect(await main([], load, output)).toBe(0);
    expect(await main(["--plan", "/not/read"], load, output)).toBe(0);
    expect(await main(["--apply"], load, output)).toBe(1);
    expect(await main(["--apply", "--plan", "/not/read", "--extra"], load, output)).toBe(1);
    expect(load).not.toHaveBeenCalled();
  });
});
