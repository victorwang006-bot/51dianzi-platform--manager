import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
const state = vi.hoisted(() => ({ access: { adminUserId: 303, isSuperAdmin: false, teamId: 44 as number | null, teamRole: "leader" as string | null, permissions: ["officialInventory.read", "officialInventory.write"] as string[] }, owners: [202, 203], calls: [] as string[], inTransaction: false, archived: false, malformedArchive: false }));
vi.mock("./officialChannelAccess", () => ({ officialActorFromContext: () => ({ adminUserId: 303, sessionVersion: 7 }), loadOfficialAccess: vi.fn(async () => state.access) }));
vi.mock("../db", () => ({ getDb: async () => ({ async transaction(run: (tx: unknown) => Promise<unknown>) {
  state.inTransaction = true;
  try { return await run({ execute: async (query: SQL) => {
    const text = new MySqlDialect().sqlToQuery(query).sql; state.calls.push(text);
    if (text.startsWith("SELECT archived.id")) return state.malformedArchive ? {} : [state.archived ? [{ id: 1 }] : []];
    return [state.owners.map((ownerUserId, index) => ({ ownerUserId, recorderAdminAccountId: index + 303 }))];
  } }); }
  finally { state.inTransaction = false; }
} }) }));
import { withOfficialChannelProfileRead } from "./officialChannelProfileRead";
import { loadOfficialAccess } from "./officialChannelAccess";
beforeEach(() => { state.access = { adminUserId: 303, isSuperAdmin: false, teamId: 44, teamRole: "leader", permissions: ["officialInventory.read", "officialInventory.write"] }; state.owners = [202, 203]; state.calls = []; state.archived = false; state.malformedArchive = false; vi.mocked(loadOfficialAccess).mockClear(); });
describe("native official leader -> explicit current staff bridge, no database", () => {
  it("holds actor archive and read locks through operation and never equates admin/team IDs to ERP IDs", async () => {
    await withOfficialChannelProfileRead({} as never, 202, async (proof, management) => { expect(management).toEqual({ leaderAdminAccountId: 303, recorderBindings: [{ adminAccountId: 303, staffUserId: 202 }, { adminAccountId: 304, staffUserId: 203 }] }); expect(state.inTransaction).toBe(true); expect(proof).toEqual({ ownerUserIds: [202, 203] }); expect(proof).not.toHaveProperty("teamId"); return 1; });
    expect(loadOfficialAccess).toHaveBeenCalledWith(expect.anything(), { adminUserId: 303, sessionVersion: 7 }, "officialInventory.read");
    expect(state.calls).toHaveLength(2);
    expect(state.calls[0]).toMatch(/SELECT archived.id.*admin_staff_archives/s); expect(state.calls[0]).toContain("LIMIT 1 FOR UPDATE");
    const query = state.calls[1];
    for (const text of ["official_channel_team_members", "t.status = 'active'", "a.status = 'active'", "b.status = 'active'", "NOT EXISTS (SELECT 1 FROM admin_staff_archives archived", "LIMIT 501"]) expect(query).toContain(text);
    expect(state.calls.every(query => query.startsWith("SELECT"))).toBe(true);
  });
  it("fresh super admin gains only actor-bound read when not an actual official leader", async () => {
    state.access = { adminUserId: 303, isSuperAdmin: true, teamId: null, teamRole: null, permissions: ["officialInventory.read", "officialInventory.write"] };
    await withOfficialChannelProfileRead({} as never, 202, async (proof, management) => { expect(state.inTransaction).toBe(true); expect(proof).toEqual({ ownerUserIds: [202], businessTeamLeaderRead: true }); expect(management).toBeUndefined(); });
    expect(state.calls).toHaveLength(1);
  });
  it.each(["leader", "member", "super", "unassigned"])("archived %s actor never reaches remote work/signing", async kind => {
    state.archived = true;
    if (kind === "member") state.access.teamRole = "member";
    if (kind === "super") { state.access.isSuperAdmin = true; state.access.teamRole = null; state.access.teamId = null; }
    if (kind === "unassigned") { state.access.teamRole = null; state.access.teamId = null; }
    const run = vi.fn();
    await expect(withOfficialChannelProfileRead({} as never, 202, run, true)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(run).not.toHaveBeenCalled(); expect(state.calls).toHaveLength(1); expect(state.inTransaction).toBe(false);
  });
  it("malformed archive SQL result never issues a proof", async () => {
    state.malformedArchive = true; const run = vi.fn();
    await expect(withOfficialChannelProfileRead({} as never, 202, run)).rejects.toThrow("INVALID_PROFILE_AUTHORITY_RESULT"); expect(run).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("super admin proof rejects invalid binding %s", async staffUserId => {
    state.access.isSuperAdmin = true; const run = vi.fn();
    await expect(withOfficialChannelProfileRead({} as never, staffUserId, run)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(run).not.toHaveBeenCalled();
  });
  it("revoked live authority never reaches signing", async () => {
    vi.mocked(loadOfficialAccess).mockRejectedValueOnce(Object.assign(new Error("revoked"), { code: "FORBIDDEN" })); const run = vi.fn();
    await expect(withOfficialChannelProfileRead({} as never, 202, run)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(run).not.toHaveBeenCalled(); expect(state.calls).toEqual([]);
  });
  it("ordinary members gain no profile team projection", async () => {
    state.access.teamRole = "member";
    await withOfficialChannelProfileRead({} as never, 202, async proof => { expect(proof).toBeUndefined(); }); expect(state.calls).toHaveLength(1);
  });
  it("removed/archived team fails instead of an empty successful list", async () => {
    state.access.teamId = null; state.access.teamRole = null;
    await expect(withOfficialChannelProfileRead({} as never, 202, vi.fn())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("unassigned public-stock compatibility issues no source/team proof", async () => {
    state.access.teamId = null; state.access.teamRole = null;
    await withOfficialChannelProfileRead({} as never, 202, async proof => { expect(proof).toBeUndefined(); }, true); expect(state.calls).toHaveLength(1);
  });
  it.each([[203], [202, 202], [0], Array.from({ length: 501 }, (_, i) => i + 1)].map(owners => ({ owners })))("rejects absent, ambiguous or oversized bindings", async ({ owners }) => {
    state.owners = owners; await expect(withOfficialChannelProfileRead({} as never, 202, vi.fn())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("read-only native leader cannot issue management proof", async () => {
    state.access.permissions = ["officialInventory.read"];
    await withOfficialChannelProfileRead({} as never, 202, async (proof, management) => { expect(proof).toEqual({ ownerUserIds: [202, 203] }); expect(management).toBeUndefined(); });
  });
});
