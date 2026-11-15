import { describe, expect, it } from "vitest";
import { buildSync } from "esbuild";
import { createRequire } from "node:module";
import vm from "node:vm";
import path from "node:path";
import { MySqlDialect, getTableConfig } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { channelInventoryManualReferences } from "../client/src/business/platform/front-router-types/drizzle/channelInventoryManualReferenceTables";
import { teamMaterialUpdateSchema } from "../client/src/business/platform/shared/channelInventoryCollaboration";
import type { ChannelInventoryScope, SqlDatabase, SqlResultRow } from "../client/src/business/platform/front-router-types/server/services/channelInventory";

// Compile CURRENT source, not last release's frozen bundle. Only the absent
// businessRuntime.mjs registration module is externalized and fails if called.
// All SQL, authority, CRM, material, CAS, manual-reference and audit code is real.
const servicesDir = path.resolve("client/src/business/platform/front-router-types/server/services");
const compiled = buildSync({ stdin: { contents: ["channelInventoryCollaboration", "channelTeamInventory", "channelInventory", "channelInventoryManualReference"].map(name => `export * from "./${name}";`).join("\n"), resolveDir: servicesDir, loader: "ts" },
  bundle: true, platform: "node", format: "cjs", packages: "external", external: ["*businessRuntime.mjs"], write: false });
const nodeRequire = createRequire(path.resolve("package.json"));
const module = { exports: {} as typeof import("../client/src/business/platform/front-router-types/server/services/channelInventoryCollaboration")
  & typeof import("../client/src/business/platform/front-router-types/server/services/channelTeamInventory")
  & typeof import("../client/src/business/platform/front-router-types/server/services/channelInventory")
  & typeof import("../client/src/business/platform/front-router-types/server/services/channelInventoryManualReference") };
vm.runInNewContext(compiled.outputFiles[0].text, { module, exports: module.exports,
  require: (name: string) => name.endsWith("businessRuntime.mjs") ? { createRuntimeTeamBusinessAdapter: () => ({ registerInsertedRecord: () => { throw new Error("unreachable team registration runtime"); } }) } : nodeRequire(name),
  process, Buffer, console, Date, setTimeout, clearTimeout, URL, URLSearchParams, TextEncoder, TextDecoder });
const { createChannelInventoryCollaborationService, authorizedMaterial, teamMaterialPublicFrom,
  createChannelTeamInventoryService, createChannelInventoryService, channelInventoryManualReferenceValuesFrom, readChannelInventoryManualReferences } = module.exports;

const uuid = "11111111-1111-4111-8111-111111111111";
const scope: ChannelInventoryScope = { enterpriseId: 1, dataOwnerUserId: 99, actorUserId: 202,
  isOwner: false, inventoryDataScope: "enterprise", permissionSnapshot: true };
const precise = "999999999999999.123456789012";
const input = (patch: Record<string, unknown> = {}) => ({ id: 101, expectedRevision: 1, requestId: uuid, ...patch });

/** Offline driver-level fixture, NOT a real MySQL locking test. No authority,
 * collaboration, audit or manual-reference helper is mocked. Each SQL family
 * has a narrow explicit handler, checked scope/params and mutation semantics;
 * ANY unrecognized SQL throws instead of silently returning a material row.
 * Transaction state is copied and committed only when the actual callback ends.
 */
class ManualSqlFixture implements SqlDatabase {
  queries: { sql: string; params: unknown[] }[] = [];
  write = true; read = true; activeMember = true; qualified = true; visible = true;
  ownerMatches = true; linked = false; casAffected = 1; failAt = ""; commits = 0; rollbacks = 0;
  peer = false; expectedAdminAccountId: number | null = null;
  state = {
    material: { id: 101, channelId: 11, companyChannelId: 11, channelName: "PRIVATE SOURCE", channelActive: true,
      partNumber: "PN", brand: "BR", qty: 5, price: "7.5000", currency: "CNY", revision: 1,
      createdAt: "2026-11-15", updatedAt: "2026-11-15", note: "PRIVATE NOTE" } as SqlResultRow,
    references: [] as SqlResultRow[], audits: [] as SqlResultRow[],
  };
  async transaction<T>(operation: Parameters<SqlDatabase["transaction"]>[0]): Promise<T> {
    const saved = structuredClone(this.state);
    try { const result = await operation(this); this.commits++; return result as T; }
    catch (error) { this.state = saved; this.rollbacks++; throw error; }
  }
  async execute(statement: SQL): Promise<unknown> {
    const query = new MySqlDialect().sqlToQuery(statement);
    const q = query.sql.replace(/\s+/g, " ").trim(), p = query.params;
    this.queries.push({ sql: q, params: p });
    const result = (rows: SqlResultRow[]) => [structuredClone(rows), []];
    if (q.startsWith("SELECT id, superAdminUserId")) return result([{ id: 1, superAdminUserId: 999, crmDataOwnerUserId: this.ownerMatches ? 99 : 88 }]);
    if (q.startsWith("SELECT em.id,") && q.includes("FROM enterprise_members em")) return result([{ id: 5, userId: 202, role: "member", status: this.activeMember ? "active" : "archived", loginDisabled: 0 }]);
    if (q.startsWith("SELECT permissionKey FROM enterprise_member_permissions")) return result([{ permissionKey: "inventory.manage" }]);
    if (q.startsWith("SELECT teamId, teamRole FROM enterprise_team_members")) return result([{ teamId: 44, teamRole: "member" }]);
    if (q.startsWith("SELECT id, status FROM enterprise_teams")) return result([{ id: 44, status: "active" }]);
    if (q.startsWith("SELECT readAllowed, writeAllowed, dataScope, revision FROM enterprise_member_module_access")) return result([{ readAllowed: this.read ? 1 : 0, writeAllowed: p[1] === 203 || this.write ? 1 : 0, dataScope: "team", revision: 1 }]);
    if (q.startsWith("SELECT tm.id, tm.teamId, tm.teamRole FROM enterprise_team_members")) return result([{ id: 4, teamId: 44, teamRole: "member" }]);
    if (q.startsWith("SELECT m.id, m.responsible_user_id AS ownerUserId")) {
      expect(p.slice(0, 3)).toEqual([101, 1, 99]);
      return result(this.visible ? [{ id: 101, ownerUserId: this.peer ? 203 : 202 }] : []);
    }
    if (q.startsWith("SELECT material_id FROM channel_inventory_material_shares")) return result([{ material_id: 101 }]);
    if (q.startsWith("SELECT id FROM enterprise_team_record_assignments")) return result([{ id: 8 }]);
    if (q.startsWith("SELECT tm.id FROM enterprise_team_members")) return result([{ id: 4 }]);
    if (q.startsWith("SELECT DISTINCT m.responsible_user_id AS ownerUserId")) return result(this.peer ? [{ ownerUserId: 203 }] : []);
    if (q.startsWith("SELECT customerId FROM crm_customer_supply_channels")) {
      expect(p).toEqual([1, 99, 11]); return result(this.linked ? [{ customerId: 700 }] : []);
    }
    if (q.startsWith("SELECT materialId, manualReferenceLcsc, manualReferenceIckey FROM channel_inventory_manual_references")) {
      expect(q).toContain("WHERE enterpriseId = ? AND dataOwnerUserId = ? AND materialId IN (");
      expect(q).toMatch(/ FOR UPDATE$/); expect(p.slice(0, 2)).toEqual([1, 99]);
      if (this.failAt === "manualRead" || this.failAt === "manualReadAfter" && Number(this.state.material.revision) > 1) throw new Error("fixture manual read failure");
      return result(this.state.references.filter(r => r.enterpriseId === p[0] && r.dataOwnerUserId === p[1] && p.slice(2).includes(r.materialId)));
    }
    if (q.startsWith("SELECT materialId, noteId, action, payloadHash, afterData FROM channel_inventory_collaboration_audit")) {
      expect(p).toEqual([1, 202, uuid]); return result(this.state.audits.filter(r => r.enterpriseId === p[0] && r.actorUserId === p[1] && r.requestId === p[2]));
    }
    if (q.startsWith("UPDATE channel_inventory_materials SET ")) {
      expect(q).toContain("WHERE id = ? AND enterprise_id = ? AND data_owner_user_id = ? AND revision = ?");
      const set = q.slice(q.indexOf(" SET ") + 5, q.indexOf(" WHERE "));
      expect(set).not.toMatch(/manualReference|note =|channel_id =|responsible_user_id =/);
      const columns = Array.from(set.matchAll(/(part_number|brand|qty|date_code|price|tax_included|lead_time) = \?/g), m => m[1]);
      expect(p.slice(columns.length, columns.length + 4)).toEqual([101, 1, 99, this.state.material.revision]);
      if (!this.casAffected) return [{ affectedRows: 0 }];
      const names: Record<string, string> = { part_number: "partNumber", date_code: "dateCode", tax_included: "taxIncluded", lead_time: "leadTime" };
      columns.forEach((column, i) => { this.state.material[names[column] ?? column] = p[i]; });
      this.state.material.revision = Number(this.state.material.revision) + 1;
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith("INSERT INTO channel_inventory_manual_references ")) {
      expect(p.slice(0, 3)).toEqual([1, 99, 101]);
      expect(p.slice(5)).toEqual([202, this.expectedAdminAccountId]);
      if (this.failAt === "manualWrite") throw new Error("fixture manual storage failure");
      let row = this.state.references.find(r => r.enterpriseId === p[0] && r.dataOwnerUserId === p[1] && r.materialId === p[2]);
      if (!row) { row = { enterpriseId: p[0], dataOwnerUserId: p[1], materialId: p[2], manualReferenceLcsc: p[3], manualReferenceIckey: p[4] }; this.state.references.push(row); }
      const duplicate = q.split("ON DUPLICATE KEY UPDATE ")[1];
      if (duplicate.includes("manualReferenceLcsc = VALUES")) row.manualReferenceLcsc = p[3];
      if (duplicate.includes("manualReferenceIckey = VALUES")) row.manualReferenceIckey = p[4];
      Object.assign(row, { updatedByUserId: p[5], updatedByAdminAccountId: p[6], updatedAt: "2026-11-15 12:00:00.123" });
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith("INSERT INTO channel_inventory_collaboration_audit ")) {
      if (this.failAt === "audit") throw new Error("fixture audit storage failure");
      expect(p.slice(0, 6)).toEqual([1, 101, null, 202, "updateTeamMaterial", uuid]);
      const keys = ["enterpriseId", "materialId", "noteId", "actorUserId", "action", "requestId", "payloadHash", "expectedRevision", "resultingRevision", "beforeData", "afterData"];
      this.state.audits.push(Object.fromEntries(keys.map((key, i) => [key, p[i]])));
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith("SELECT COUNT(*) AS total FROM channel_inventory_materials")) return result([{ total: this.visible ? 1 : 0 }]);
    if (q.startsWith("SELECT m.id,") && q.includes("AS canPublish")) return result([]);
    if (q.startsWith("SELECT m.id,") && q.includes("FROM channel_inventory_materials m INNER JOIN channel_inventory_channels c")) {
      const authorized = q.includes("AS canManageMaterial") && !q.includes("AS uploadBatchId");
      expect(q).toContain("m.enterprise_id = ?"); expect(q).toContain("m.data_owner_user_id = ?");
      if (authorized) { expect(q).toMatch(/management_a\.createdByUserId = \?|original_event/); expect(q).toMatch(/FOR UPDATE$/); }
      if (this.peer && q.includes("AS canManageMaterial")) expect(q).toContain("s.assignment_revision");
      return result(this.visible ? [{ ...this.state.material, isMine: !this.peer, canViewSource: false, canManageMaterial: this.qualified }] : []);
    }
    throw new Error(`UNHANDLED FIXTURE SQL: ${q}`);
  }
  service() { return createChannelInventoryCollaborationService({ getDb: async () => this }); }
  seed(lcsc: string | null = "1.2300", ickey: string | null = "2.500") { this.state.references.push({ enterpriseId: 1, dataOwnerUserId: 99, materialId: 101, manualReferenceLcsc: lcsc, manualReferenceIckey: ickey }); }
}

const refFields = ["manualReferenceLcsc", "manualReferenceIckey"] as const;
describe("shared exact decimal contract and independent storage interface", () => {
  it.each(refFields)("%s allows only nullable optional exact nonnegative strings", field => {
    for (const value of [null, "0", "0.000000000001", precise, " 1.2300 "]) expect(teamMaterialUpdateSchema.safeParse(input({ [field]: value })).success).toBe(true);
    for (const value of [1, -1, "", "-0", "-1", "+1", "01", "1e3", "NaN", "Infinity", ".5", "1.", "1000000000000000", "1.1234567890123"]) expect(teamMaterialUpdateSchema.safeParse(input({ [field]: value })).success).toBe(false);
    expect(teamMaterialUpdateSchema.safeParse(input({ [field]: undefined })).success).toBe(false);
  });
  it("projection never makes a float string or leaks metadata; no row returns explicit null", () => {
    expect(channelInventoryManualReferenceValuesFrom({})).toEqual({ manualReferenceLcsc: null, manualReferenceIckey: null });
    expect(() => channelInventoryManualReferenceValuesFrom({ manualReferenceLcsc: 1.2 })).toThrow();
    expect(channelInventoryManualReferenceValuesFrom({ manualReferenceLcsc: precise, updatedByUserId: 999 })).toEqual({ manualReferenceLcsc: precise, manualReferenceIckey: null });
    const table = getTableConfig(channelInventoryManualReferences);
    expect(table.name).toBe("channel_inventory_manual_references");
    expect(table.primaryKeys[0].columns.map(c => c.name)).toEqual(["enterpriseId", "dataOwnerUserId", "materialId"]);
  });
  it("empty authorized IDs issue no SQL; exact scope and IDs are the only lookup keys", async () => {
    const db = new ManualSqlFixture(); db.seed();
    db.state.references.push({ enterpriseId: 2, dataOwnerUserId: 99, materialId: 101, manualReferenceLcsc: "99" }, { enterpriseId: 1, dataOwnerUserId: 88, materialId: 101, manualReferenceLcsc: "88" }, { enterpriseId: 1, dataOwnerUserId: 99, materialId: 102, manualReferenceLcsc: "77" });
    expect((await readChannelInventoryManualReferences(db, scope, [])).size).toBe(0); expect(db.queries).toEqual([]);
    expect(Array.from((await readChannelInventoryManualReferences(db, scope, [101, 101])).entries())).toEqual([[101, { manualReferenceLcsc: "1.2300", manualReferenceIckey: "2.500" }]]);
    expect(db.queries[0].params).toEqual([1, 99, 101]);
  });
});

describe("current service actual SQL CAS + manual upsert + audit transaction", () => {
  it("reads edit defaults as explicit null without automatic pricing", async () => {
    const db = new ManualSqlFixture(); const item = await db.service().getTeamMaterialForEdit(scope, { id: 101 });
    expect(item).toMatchObject({ manualReferenceLcsc: null, manualReferenceIckey: null, price: "7.5000" });
  });
  it("both fields preserve every decimal digit, increment stock revision and audit before/after", async () => {
    const db = new ManualSqlFixture(); const original = structuredClone(db.state.material);
    const result = await db.service().updateTeamMaterial(scope, input({ manualReferenceLcsc: precise, manualReferenceIckey: "0.000000000001" }));
    expect(result).toMatchObject({ idempotent: false, item: { manualReferenceLcsc: precise, manualReferenceIckey: "0.000000000001", revision: 2, price: "7.5000" } });
    expect(db.state.material).toEqual({ ...original, revision: 2 });
    const audit = db.state.audits[0]; expect(audit.actorUserId).toBe(202);
    expect(JSON.parse(String(audit.beforeData))).toMatchObject({ manualReferenceLcsc: null, manualReferenceIckey: null, revision: 1 });
    expect(JSON.parse(String(audit.afterData))).toMatchObject({ manualReferenceLcsc: precise, manualReferenceIckey: "0.000000000001", revision: 2 });
    expect(db.state.references[0]).toMatchObject({ updatedByUserId: 202, updatedByAdminAccountId: null });
    expect(result.item).not.toHaveProperty("updatedByUserId"); expect(result.item).not.toHaveProperty("note");
    expect(db.commits).toBe(1);
  });
  it.each(refFields)("null clears only %s; omitted counterpart survives and audit contains both", async field => {
    const db = new ManualSqlFixture(); db.seed();
    const other = field === "manualReferenceLcsc" ? "manualReferenceIckey" : "manualReferenceLcsc";
    const saved = db.state.references[0][other];
    const result = await db.service().updateTeamMaterial(scope, input({ [field]: null }));
    expect(result.item[field]).toBeNull(); expect(result.item[other]).toBe(saved);
    const dml = db.queries.find(q => q.sql.startsWith("INSERT INTO channel_inventory_manual_references"))!.sql.split("ON DUPLICATE KEY UPDATE")[1];
    expect(dml).toContain(`${field} = VALUES`); expect(dml).not.toContain(`${other} = VALUES`);
    expect(JSON.parse(String(db.state.audits[0].beforeData))[field]).not.toBeNull();
    expect(JSON.parse(String(db.state.audits[0].afterData))[field]).toBeNull();
  });
  it("omitting both makes no manual DML and preserves values after confirmed model/brand change", async () => {
    const db = new ManualSqlFixture(); db.seed(); const refs = structuredClone(db.state.references);
    const result = await db.service().updateTeamMaterial(scope, input({ partNumber: "NEW", brand: "NEW BRAND" }));
    expect(result.item).toMatchObject({ partNumber: "NEW", brand: "NEW BRAND", manualReferenceLcsc: "1.2300", manualReferenceIckey: "2.500" });
    expect(db.state.references).toEqual(refs); expect(db.queries.some(q => q.sql.startsWith("INSERT INTO channel_inventory_manual_references"))).toBe(false);
  });
  it.each(["manualWrite", "manualReadAfter", "audit"])("%s failure rolls back stock revision + reference + audit together", async failAt => {
    const db = new ManualSqlFixture(); db.seed(); const saved = structuredClone(db.state); db.failAt = failAt;
    await expect(db.service().updateTeamMaterial(scope, input({ qty: 8, manualReferenceLcsc: precise }))).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(db.state).toEqual(saved); expect(db.commits).toBe(0); expect(db.rollbacks).toBe(1);
  });
  it("manual read storage failure fails closed; no write is attempted", async () => {
    const db = new ManualSqlFixture(); db.failAt = "manualRead";
    await expect(db.service().updateTeamMaterial(scope, input({ manualReferenceLcsc: "1" }))).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(db.queries.some(q => /^(UPDATE|INSERT)/.test(q.sql))).toBe(false);
  });
  it.each(["write", "qualified", "activeMember", "ownerMatches", "read", "visible"])("revoked %s denies before manual/audit read and before DML", async gate => {
    const db = new ManualSqlFixture(); (db as any)[gate] = false; db.seed();
    await expect(db.service().updateTeamMaterial(scope, input({ manualReferenceLcsc: "1" }))).rejects.toMatchObject({ code: gate === "visible" ? "NOT_FOUND" : "FORBIDDEN" });
    expect(db.queries.some(q => q.sql.includes("FROM channel_inventory_manual_references") || q.sql.includes("FROM channel_inventory_collaboration_audit") || /^(UPDATE|INSERT)/.test(q.sql))).toBe(false);
  });
  it("linked customer without CRM cannot write even with original-recorder eligibility", async () => {
    const db = new ManualSqlFixture(); db.linked = true;
    const officialScope = { ...scope, officialActor: { adminAccountId: 303, bindingVersion: 7, requestId: uuid, inventoryPermissions: { read: true, write: true, note: false, inventoryScopeWrite: true, authorizationVersion: "fixture" } } };
    await expect(db.service().updateTeamMaterial(officialScope, input({ manualReferenceLcsc: "1" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.queries.some(q => q.sql.includes("FROM channel_inventory_manual_references") || /^(UPDATE|INSERT)/.test(q.sql))).toBe(false);
  });
  it.each(["stale", "affectedZero"])("CAS %s cannot save manual values or audit", async kind => {
    const db = new ManualSqlFixture(); if (kind === "stale") db.state.material.revision = 2; else db.casAffected = 0;
    await expect(db.service().updateTeamMaterial(scope, input({ manualReferenceLcsc: "1" }))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.state.references).toEqual([]); expect(db.state.audits).toEqual([]); expect(db.queries.some(q => q.sql.startsWith("INSERT"))).toBe(false);
  });
  it("UUID replay returns same whitelist/precise prices without DML; different payload conflicts; revoked authority wins", async () => {
    const db = new ManualSqlFixture(); const request = input({ manualReferenceLcsc: precise });
    const first = await db.service().updateTeamMaterial(scope, request); db.queries = [];
    const replay = await db.service().updateTeamMaterial(scope, request);
    expect(replay).toEqual({ item: first.item, idempotent: true }); expect(db.state.material.revision).toBe(2); expect(db.state.audits).toHaveLength(1);
    expect(db.queries.some(q => /^(UPDATE|INSERT)/.test(q.sql))).toBe(false);
    await expect(db.service().updateTeamMaterial(scope, input({ manualReferenceLcsc: "3" }))).rejects.toMatchObject({ code: "CONFLICT" });
    db.write = false; db.queries = [];
    await expect(db.service().updateTeamMaterial(scope, request)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.queries.some(q => q.sql.includes("collaboration_audit"))).toBe(false);
  });
  it("replay of pre-feature receipts exposes null; injected source/actor metadata is not projected", () => {
    const item = teamMaterialPublicFrom({ id: 101, currency: "CNY", partNumber: "PN", brand: "BR", revision: 2, note: "PRIVATE", updatedByUserId: 999 }, false);
    expect(item).toMatchObject({ channelId: null, channelName: null, manualReferenceLcsc: null, manualReferenceIckey: null });
    expect(JSON.stringify(item)).not.toContain("PRIVATE"); expect(item).not.toHaveProperty("updatedByUserId");
  });
  it.each(["note", "channelId", "currency", "responsibleUserId", "enterpriseId", "dataOwnerUserId", "updatedByUserId", "updatedByAdminAccountId"])("old official update forwarding still rejects %s injection", async field => {
    const db = new ManualSqlFixture(); const service = createChannelInventoryService({ getDb: async () => db, registerTeamRecord: async () => { throw new Error("must not create"); } });
    await expect(service.updateMaterial({ ...scope, officialActor: { adminAccountId: 303, bindingVersion: 7, requestId: uuid } }, { id: 101, expectedRevision: 1, qty: 3, [field]: 11 } as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.queries).toEqual([]);
  });
  it("actual authorized read and list expose manual prices without source or write capability", async () => {
    const db = new ManualSqlFixture(); db.seed(precise); db.write = false; db.qualified = false; db.peer = true;
    const row = await authorizedMaterial(db, scope, 101);
    expect(row).toMatchObject({ manualReferenceLcsc: precise, canViewSource: false, channelName: null, isMine: false });
    const list = await createChannelTeamInventoryService({ getDb: async () => db }).listTeamMaterials(scope, { page: 1, pageSize: 20 });
    expect(list.items[0]).toMatchObject({ manualReferenceLcsc: precise, manualReferenceIckey: "2.500", canEditMaterial: false, readOnly: true, customerSource: null, company: null, channelSource: null, isMine: false });
    expect(JSON.stringify(list.items)).not.toMatch(/PRIVATE|updatedByUserId/);
  });
  it("official metadata comes from authenticated scope, not input, and both null fields can create a cleared row", async () => {
    const db = new ManualSqlFixture(); db.expectedAdminAccountId = 303;
    const officialScope = { ...scope, officialActor: { adminAccountId: 303, bindingVersion: 7, requestId: uuid, inventoryPermissions: { read: true, write: true, note: false, inventoryScopeWrite: true, authorizationVersion: "fixture" } } };
    const saved = await db.service().updateTeamMaterial(officialScope, input({ manualReferenceLcsc: null, manualReferenceIckey: null }));
    expect(saved.item).toMatchObject({ manualReferenceLcsc: null, manualReferenceIckey: null, revision: 2 });
    expect(db.state.references[0]).toMatchObject({ updatedByUserId: 202, updatedByAdminAccountId: 303 });
    expect(JSON.parse(String(db.state.audits[0].afterData))).not.toHaveProperty("updatedByAdminAccountId");
  });
  it("unknown SQL fails fixture loudly rather than permissive row fallback", async () => {
    const { sql } = await import("drizzle-orm"); const db = new ManualSqlFixture(); await expect(db.execute(sql`SELECT unexpected`)).rejects.toThrow("UNHANDLED FIXTURE SQL");
  });
});
