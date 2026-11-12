import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
const state = vi.hoisted(() => ({ access: { adminUserId: 303, isSuperAdmin: false, teamId: 44 as number | null, teamRole: "leader" as string | null }, owners: [202, 203], calls: [] as string[], inTransaction: false }));
vi.mock("./officialChannelAccess", () => ({ officialActorFromContext: () => ({ adminUserId: 303, sessionVersion: 7 }), loadOfficialAccess: vi.fn(async () => state.access) }));
vi.mock("../db", () => ({ getDb: async () => ({ async transaction(run: (tx: unknown) => Promise<unknown>) {
  state.inTransaction = true;
  try { return await run({ execute: async (query: SQL) => { state.calls.push(new MySqlDialect().sqlToQuery(query).sql); return [state.owners.map(ownerUserId => ({ ownerUserId }))]; } }); }
  finally { state.inTransaction = false; }
} }) }));
import { withOfficialChannelProfileRead } from "./officialChannelProfileRead";
import { loadOfficialAccess } from "./officialChannelAccess";
beforeEach(() => { state.access = { adminUserId: 303, isSuperAdmin: false, teamId: 44, teamRole: "leader" }; state.owners = [202, 203]; state.calls = []; vi.mocked(loadOfficialAccess).mockClear(); });
describe("native official leader -> explicit current staff bridge, no database", () => {
  it("holds live official read locks through the operation and never equates admin/team IDs to ERP IDs", async () => {
    await withOfficialChannelProfileRead({} as never, 202, async proof => { expect(state.inTransaction).toBe(true); expect(proof).toEqual({ ownerUserIds: [202, 203] }); expect(proof).not.toHaveProperty("teamId"); return 1; });
    expect(loadOfficialAccess).toHaveBeenCalledWith(expect.anything(), { adminUserId: 303, sessionVersion: 7 }, "officialInventory.read");
    expect(state.calls).toHaveLength(1);
    const query = state.calls[0];
    for (const text of ["official_channel_team_members", "t.status = 'active'", "a.status = 'active'", "b.status = 'active'", "LIMIT 501"]) expect(query).toContain(text);
    expect(state.calls.every(query => query.startsWith("SELECT"))).toBe(true);
  });
  it("ordinary native members gain no profile team projection", async () => {
    state.access.teamRole = "member";
    await withOfficialChannelProfileRead({} as never, 202, async proof => { expect(proof).toBeUndefined(); });
    expect(state.calls).toEqual([]);
  });
  it("a removed/archived native team fails instead of returning an empty successful list", async () => {
    state.access.teamId = null; state.access.teamRole = null;
    await expect(withOfficialChannelProfileRead({} as never, 202, vi.fn())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("unassigned ordinary public-stock compatibility issues no source/team proof", async () => {
    state.access.teamId = null; state.access.teamRole = null;
    await withOfficialChannelProfileRead({} as never, 202, async proof => { expect(proof).toBeUndefined(); }, true);
    expect(state.calls).toEqual([]);
  });
  it.each([[203], [202, 202], [0], Array.from({ length: 501 }, (_, i) => i + 1)].map(owners => ({ owners })))("rejects absent, ambiguous or oversized bindings", async ({ owners }) => {
    state.owners = owners;
    await expect(withOfficialChannelProfileRead({} as never, 202, vi.fn())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
