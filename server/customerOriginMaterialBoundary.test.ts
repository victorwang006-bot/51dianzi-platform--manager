import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { sql } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { officialInventoryPermissionsSchema, canonicalOfficialInventoryJson } from "../shared/internalBusinessOfficialInventory";
import { teamMaterialUpdateSchema } from "../client/src/business/platform/shared/channelInventoryCollaboration";
import { teamMaterialSourceSchema } from "../client/src/business/platform/shared/channelInventorySource";

// OFFLINE actual function bytes; every DB/authority dependency is synthetic.
// This is not a production session, DB, MySQL locking, or deployment test.
const dir = "/home/ubuntu/work/customer-origin-edit-20261115/backend";
const baseline = fs.readFileSync(dir + "/baseline-front-index.js");
const patched = fs.readFileSync(dir + "/patched-front-index.js");
const sf = ts.createSourceFile("actual", patched.toString(), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const beforeSf = ts.createSourceFile("baseline", baseline.toString(), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const top = (root: ts.SourceFile, name: string) => {
  const found = root.statements.filter(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  expect(found).toHaveLength(1); return found[0].getText(root);
};
const variable = (name: string) => sf.statements.find(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(sf) === name))!.getText(sf);
const bool = (v: unknown) => v === true || v === 1 || v === "1";
class FakeError extends Error { constructor(public code: string, message: string) { super(message); } }
const fail = (code: string, message: string): never => { throw new FakeError(code, message); };
function context(extra: Record<string, unknown> = {}) {
  const c = vm.createContext({ sql80: sql, sql82: sql, sql83: sql, sql86: sql, sql87: sql, z55: z,
    LEGACY_CONFIRMATION_ACTION: "legacyOriginalActorConfirmation", bool5: bool, bool6: bool, fail12: fail, fail13: fail,
    text10: (v: unknown) => v == null ? null : String(v), text11: (v: unknown) => v == null ? null : String(v),
    businessIndustryCodeSchema: { safeParse: () => ({ success: false }) }, ChannelInventoryError: FakeError,
    TRPCError66: TRPCError, createHmac9: crypto.createHmac, timingSafeEqual13: crypto.timingSafeEqual,
    canonicalOfficialInventoryJson, continued20261112_signedTargets: new WeakMap(), Buffer, process: { env: { PORTAL_API_KEY: "fixture-key" } }, Date, ...extra });
  vm.runInContext(variable("LEGACY_CONFIRMATION_HASH_PATHS") + "\n" + variable("channelMaterialManagementSchema") + "\n" + variable("officialInventoryPermissionsSchema") + "\n" + variable("signedOfficialInventoryGrantSchema") + "\n" + ["originalActorClaims", "officialMaterialCreator", "officialMaterialRecorderAdminAccountId", "officialMaterialRecorderStaffUserId", "teamMaterialManagementEligibility", "materialManagementProjection", "teamMaterialFrom", "verifyOfficialInventoryGrant"].map(n => top(sf,n)).join("\n"), c);
  return c;
}
const actor = (permissions: Record<string, unknown> = {}) => ({ enterpriseId: 1, dataOwnerUserId: 99, actorUserId: 202,
  officialActor: { adminAccountId: 303, bindingVersion: 7, requestId: "fixture-request-001", inventoryPermissions: { read: true, write: true, note: false, inventoryScopeWrite: true, authorizationVersion: "fixture-v1", ...permissions } } });
const compileSql = (q: unknown) => new MySqlDialect().sqlToQuery(q as any).sql;
const baseRow = (extra: Record<string, unknown> = {}) => ({ id: 101, channelId: 11, companyChannelId: 11,
  channelName: "PRIVATE-CHANNEL", authorizedChannelName: "PRIVATE-CHANNEL", partNumber: "PN", brand: "BR", currency: "CNY", revision: 1,
  createdAt: "2026-11-15", updatedAt: "2026-11-15", isMine: true, canViewSource: true, canManageMaterial: false, ...extra });

describe("actual offline reversible patch", () => {
  it.each(["front", "admin"])("%s patch recovers every original byte with the inverse", kind => {
    const proof = JSON.parse(fs.readFileSync(dir + `/${kind}-patchproof.json`, "utf8"));
    const original = fs.readFileSync(dir + `/baseline-${kind}-index.js`), candidate = fs.readFileSync(dir + `/patched-${kind}-index.js`);
    const hash = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
    expect(hash(original)).toBe(proof.beforeSha256); expect(hash(candidate)).toBe(proof.afterSha256);
    let cursor = 0; const pieces: Buffer[] = [];
    for (const span of proof.inverse) { expect(candidate.subarray(span.offset, span.offset+span.removedByteLength).toString()).toBe(span.removed); pieces.push(candidate.subarray(cursor,span.offset), Buffer.from(span.inserted)); cursor = span.offset+span.removedByteLength; }
    pieces.push(candidate.subarray(cursor)); expect(Buffer.concat(pieces).equals(original)).toBe(true);
  });
  it("retains immutable validator and public-read/share/price prerequisites", () => {
    for (const name of ["originalActorClaims", "officialMaterialCreator", "officialMaterialRecorderAdminAccountId", "continued20261112_channelSourceReadEligibility"]) expect(top(sf,name)).toBe(top(beforeSf,name));
    const visibility = top(sf,"resolveTeamInventoryVisibility");
    expect(visibility).toContain("continued20261112_channelSourceReadEligibility(scope, options.lock === true)");
    expect(visibility).toContain("scope.officialActor && access.write && member ? teamMaterialManagementEligibility");
    expect((sf as any).parseDiagnostics).toEqual([]);
  });
});

describe("strict signature and actual SQL management authority", () => {
  it.each([{ write: false }, { inventoryScopeWrite: false }, { inventoryScopeWrite: undefined }, { read: false }])("no write intersection fails closed: %j", permissions => {
    expect(compileSql(context().teamMaterialManagementEligibility(actor(permissions),true))).toBe("FALSE");
  });
  it("read-only business leader proof cannot produce a management leader", () => {
    const query = compileSql(context().teamMaterialManagementEligibility(actor({ channelProfileTeamRead: { ownerUserIds: [202], businessTeamLeaderRead: true } }),true));
    expect(query).not.toContain("management_reader.teamRole = 'leader'");
    expect(query).toContain("original_event"); expect(query).not.toContain("responsible_user_id = ? OR");
  });
  it("independent actor-bound ERP capability requires actual leader, recorder team, active accounts and nonambiguity", () => {
    const query = compileSql(context().teamMaterialManagementEligibility(actor({ materialBusinessTeamLeaderWrite: { adminAccountId: 303, staffUserId: 202 } }),true));
    for (const needle of ["management_reader.teamRole = 'leader'", "managed_recorder.teamId = management_a.teamId", "recorder_em.status = 'active'", "recorder_u.loginDisabled = 0", "conflicting_event", "reader_duplicate", "owner_duplicate", "FOR UPDATE", "management_a.currentOwnerUserId = m.responsible_user_id", "c.active = 1"]) expect(query).toContain(needle);
  });
  it.each([{ adminAccountId: 404, staffUserId: 202 }, { adminAccountId: 303, staffUserId: 999 }])("mismatched actor-only capability does not grant leadership %j", proof => {
    expect(compileSql(context().teamMaterialManagementEligibility(actor({ materialBusinessTeamLeaderWrite: proof }),true))).not.toContain("management_reader.teamRole = 'leader'");
  });
  it("paired official map is unique and bound to leader identity", () => {
    const c = context();
    const mapping = { leaderAdminAccountId: 303, recorderBindings: [{ adminAccountId: 303, staffUserId: 202 }, { adminAccountId: 404, staffUserId: 203 }] };
    expect(compileSql(c.teamMaterialManagementEligibility(actor({ channelMaterialManagement: mapping }),true))).toContain("managed_recorder.userId = ?");
    for (const recorderBindings of [[{ adminAccountId: 303, staffUserId: 202 }, { adminAccountId: 303, staffUserId: 203 }], [{ adminAccountId: 404, staffUserId: 203 }]]) expect(officialInventoryPermissionsSchema.safeParse({ ...actor().officialActor.inventoryPermissions, channelMaterialManagement: { leaderAdminAccountId: 303, recorderBindings } }).success).toBe(false);
  });
  it("HMAC signs management map and exact request target; deep freezes capabilities", () => {
    const c = context(), now = Date.now(), target = { staffUserId: 202, adminAccountId: 303, bindingVersion: 7, method: "channelInventory.updateTeamMaterial", requestId: "fixture-request-001", expectedOwnerUserId: 99 };
    const permissions = actor({ materialBusinessTeamLeaderWrite: { adminAccountId: 303, staffUserId: 202 }, channelMaterialManagement: { leaderAdminAccountId: 303, recorderBindings: [{ adminAccountId: 303, staffUserId: 202 }] } }).officialActor.inventoryPermissions;
    const grant = { schemaVersion: 1, issuedAt: now, expiresAt: now+30000, permissions };
    const token = { ...grant, signature: crypto.createHmac("sha256","fixture-key").update(canonicalOfficialInventoryJson({ grant,target })).digest("hex") };
    const verified = c.verifyOfficialInventoryGrant(token,target);
    expect(Object.isFrozen(verified.channelMaterialManagement.recorderBindings[0])).toBe(true);
    expect(Object.isFrozen(verified.materialBusinessTeamLeaderWrite)).toBe(true);
    expect(() => c.verifyOfficialInventoryGrant({ ...token, permissions: { ...permissions, inventoryScopeWrite: false } },target)).toThrow();
    expect(() => c.verifyOfficialInventoryGrant(token,{ ...target, requestId: "different-request" })).toThrow();
    expect(() => c.verifyOfficialInventoryGrant({ ...token, expiresAt: now-1 },target)).toThrow();
  });
});

describe("same customer projection and edit gate, not ownership inference", () => {
  it.each([false,true])("write=%s: source flag equals edit flag for every qualification/link state", write => {
    const c = context();
    for (const qualified of [false,true]) for (const company of [{ linked: false, customer: null }, { linked: true, customer: null }, { linked: true, customer: { id: 700, name: "Current CRM" } }]) {
      const projected = c.materialManagementProjection(baseRow({ canManageMaterial: qualified }),write,company);
      expect(projected.canViewCustomerSource).toBe(projected.canEditMaterial); expect(projected.canEdit).toBe(projected.canEditMaterial); expect(projected.readOnly).toBe(!projected.canEditMaterial);
      if (!projected.canEditMaterial) expect(projected).toMatchObject({ customerSource: null, customerSourceState: "restricted" });
      else if (!company.linked) expect(projected).toMatchObject({ customerSource: null, customerSourceState: "unlinked" });
      else expect(projected.customerSource).toEqual({ id: 700, name: "Current CRM" });
    }
  });
  it.each([{id:0,name:"Secret"},{id:700,name:""},{id:700,name:"  "},{id:700,name:123}])("invalid customer %j denies both edit/source", customer => {
    expect(context().materialManagementProjection(baseRow({canManageMaterial:true}),true,{linked:true,customer})).toMatchObject({canEditMaterial:false,customerSource:null,customerSourceState:"restricted"});
  });
  it.each([false,true])("actual authorizedMaterial denies current-owner/leader labels without evidence; qualified=%s", async qualified => {
    const row=baseRow({canManageMaterial:qualified}); const queries:string[]=[];
    const c=context({ PUBLIC_COLUMNS: sql`m.id, m.channel_id AS channelId`, TEAM_MATERIAL_FROM: sql`FROM fictional_m m JOIN fictional_c c`, teamInventoryAll: (p:any[])=>sql.join(p,sql` AND `), teamInventoryRows:(r:any)=>r[0], notFound:()=>fail("NOT_FOUND","missing"), linkedCompany:async()=>({linked:false,customer:null}),
      resolveTeamInventoryVisibility:async()=>({access:{write:true},leader:true,predicates:[sql`TRUE`]}),
      teamMaterialSourceEligibility:()=>sql`TRUE` });
    vm.runInContext(top(sf,"authorizedMaterial"),c);
    const result=c.authorizedMaterial({execute:async(q:any)=>{queries.push(compileSql(q));return [[row]];}},actor(),101,true);
    if (qualified) await expect(result).resolves.toMatchObject({id:101}); else await expect(result).rejects.toMatchObject({code:"FORBIDDEN"});
    expect(queries[0]).toContain("AS canManageMaterial"); expect(queries[0]).toContain("management_a");
  });
  it.each([true,false])("actual list masks old/new names when stocks-write is false (official=%s)", async official=>{
    const row=baseRow({canManageMaterial:true});
    const c=context({ expected4:()=>{},teamMaterialOrder:()=>sql`m.id DESC`,materialUploadBatchId:sql`NULL`,channelMaterialCanViewUploadBatch:()=>sql`FALSE`,TEAM_MATERIAL_FROM:sql`FROM fictional_m m JOIN fictional_c c`,all:(p:any[])=>sql.join(p,sql` AND `),rows13:(r:any)=>r[0],
      resolveTeamInventoryVisibility:async()=>({access:{write:false,scope:"team"},leader:true,sourceReader:true,predicates:[sql`TRUE`]}),teamMaterialSourceEligibility:()=>sql`TRUE`,linkedCompany:async()=>({linked:true,customer:{id:700,name:"SECRET CRM"}}),factoryMaterialPublicationMetadata:async()=>new Map() });
    vm.runInContext(top(sf,"createChannelTeamInventoryService"),c);
    const db={transaction:async(run:any)=>run({execute:async(q:any)=>compileSql(q).startsWith("SELECT COUNT(*)")?[[{total:1}]]:[[row]]})};
    const scope: any = actor(); if (!official) delete scope.officialActor;
    const result=await c.createChannelTeamInventoryService({getDb:async()=>db}).listTeamMaterials(scope,{page:1,pageSize:20});
    expect(result.items[0]).toMatchObject({canEditMaterial:false,customerSource:null,customerSourceState:"restricted",company:null,channelSource:null,canViewSource:false});
    expect(JSON.stringify(result.items)).not.toContain("SECRET");
  });
});

function methodText(root: ts.SourceFile, owner: string, name: string) {
  const node = root.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === owner)!;
  const found: ts.MethodDeclaration[] = []; const walk = (n: ts.Node) => { if (ts.isMethodDeclaration(n) && n.name.getText(root) === name) found.push(n); ts.forEachChild(n, walk); };
  walk(node); expect(found).toHaveLength(1); return found[0].getText(root);
}
const uuid = "11111111-1111-4111-8111-111111111111";
const sourceCompany = { linked: true, customer: { id: 700, name: "CURRENT CRM", contactName: "PRIVATE CRM CONTACT" } };
function sourceHarness({ write = true, qualified = true, official = true, company = sourceCompany, leader = true }: { write?: boolean; qualified?: boolean; official?: boolean; company?: any; leader?: boolean } = {}) {
  const queries: string[] = [], scope: any = actor(); if (!official) delete scope.officialActor;
  const companyReader = vi.fn(async () => company);
  const c = context({ expected4: () => {}, TEAM_MATERIAL_FROM: sql`FROM fictional_m m JOIN fictional_c c`, all: (p: any[]) => sql.join(p, sql` AND `), teamInventoryAll: (p: any[]) => sql.join(p, sql` AND `), rows13: (r: any) => r[0], teamInventoryRows: (r: any) => r[0],
    resolveTeamInventoryVisibility: async () => ({ access: { write, scope: "team" }, leader, sourceReader: true, predicates: [sql`TRUE`] }),
    linkedCompany: companyReader, linkedCompanyReadGate: async () => sql`CURRENT_CRM_GATE`, teamMaterialSourceSchema,
    businessFailureOf: () => null, TRPCError71: TRPCError, SOURCE_FORBIDDEN_MESSAGE: "暂无权限查看" });
  vm.runInContext(["teamMaterialSourceEligibility", "createChannelTeamInventoryService", "createChannelInventorySourceService", "channelCustomerMaterialReadGate"].map(n => top(sf, n)).join("\n"), c);
  const db = { transaction: async (run: any) => run({ execute: async (q: any) => { queries.push(compileSql(q)); return [[{ id: 11, companyChannelId: 11, name: "PRIVATE CHANNEL FALLBACK", canManageMaterial: qualified }]]; } }) };
  return { c, scope, queries, companyReader, service: c.createChannelTeamInventoryService({ getDb: async () => db }), getter: c.createChannelInventorySourceService({ getDb: async () => db }) };
}
describe("all customer source entrypoints share management+stock-write+CRM, no channel fallback", () => {
  it.each([true, false])("source options reject read-only profile+CRM even when sourceReader is true (official=%s)", async official => {
    const h = sourceHarness({ write: false, official });
    await expect(h.service.listTeamSourceOptions(h.scope, {})).resolves.toEqual({ canFilterSource: false, items: [] });
    expect(h.queries).toEqual([]); expect(h.companyReader).not.toHaveBeenCalled();
    await expect(h.getter.getTeamMaterialSource(h.scope, { materialId: 101 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.queries).toEqual([]);
  });
  it.each([true, false])("source options need an editable material and expose ONLY confirmed current customer name (official=%s)", async official => {
    for (const qualified of [true, false]) for (const company of [sourceCompany, { linked: false, customer: null }, { linked: true, customer: null }, { linked: true, customer: { id: 700, name: " " } }]) {
      const h = sourceHarness({ official, qualified, company });
      const result = await h.service.listTeamSourceOptions(h.scope, {});
      const valid = qualified && company === sourceCompany;
      expect(result.items).toEqual(valid ? [{ id: 11, name: "CURRENT CRM" }] : []);
      expect(JSON.stringify(result)).not.toMatch(/PRIVATE|FALLBACK/);
      expect(h.queries[0]).toContain("AS canManageMaterial"); expect(h.queries[0]).toContain("management_a"); expect(h.queries[0]).toContain("CURRENT_CRM_GATE");
      expect(h.queries[0]).not.toContain("c.name"); expect(h.queries[0]).not.toContain("channel_profile");
      const getter = h.getter.getTeamMaterialSource(h.scope, { materialId: 101 });
      if (valid) await expect(getter).resolves.toEqual({ name: "CURRENT CRM" }); else await expect(getter).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(h.queries.every(q => q.startsWith("SELECT"))).toBe(true);
    }
  });
  it("native member retains original filter entry restriction without gaining customer names", async () => {
    const h = sourceHarness({ official: false, leader: false });
    expect(await h.service.listTeamSourceOptions(h.scope, {})).toEqual({ canFilterSource: false, items: [] }); expect(h.queries).toEqual([]);
  });
  it.each([true, false])("Host listChannels/getChannel contain customer gate before selection/count/name search (official=%s)", async official => {
    const h = sourceHarness({ official, write: false });
    const gate = compileSql(await h.c.channelCustomerMaterialReadGate({}, h.scope));
    expect(gate).toContain("NOT EXISTS"); expect(gate).toContain("crm_customer_supply_channels"); expect(gate).not.toContain("OR EXISTS");
    for (const name of ["listChannels", "getChannel"]) expect(methodText(sf, "createChannelInventoryService", name)).toContain("predicates.push(await channelCustomerMaterialReadGate");
    const allowed = sourceHarness({ official });
    const allowedGate = compileSql(await allowed.c.channelCustomerMaterialReadGate({}, allowed.scope));
    expect(allowedGate).toContain("management_a"); expect(allowedGate).toContain("CURRENT_CRM_GATE"); expect(allowedGate).toContain("c.id = channel_inventory_channels.id");
  });
  it("all list flags, company/customerSource and legacy channelSource are masked together", async () => {
    for (const official of [true, false]) for (const write of [true, false]) for (const qualified of [true, false]) for (const company of [sourceCompany, { linked: false, customer: null }, { linked: true, customer: null }]) {
      const scope: any = actor(); if (!official) delete scope.officialActor;
      const row = baseRow({ canManageMaterial: qualified });
      const c = context({ expected4: () => {}, teamMaterialOrder: () => sql`m.id DESC`, materialUploadBatchId: sql`NULL`, channelMaterialCanViewUploadBatch: () => sql`FALSE`, TEAM_MATERIAL_FROM: sql`FROM fictional_m m JOIN fictional_c c`, all: (p: any[]) => sql.join(p, sql` AND `), rows13: (r: any) => r[0],
        resolveTeamInventoryVisibility: async () => ({ access: { write, scope: "team" }, leader: true, sourceReader: true, predicates: [sql`TRUE`] }), teamMaterialSourceEligibility: () => sql`TRUE`, linkedCompany: async () => company, factoryMaterialPublicationMetadata: async () => new Map() });
      vm.runInContext(top(sf, "createChannelTeamInventoryService"), c);
      const db = { transaction: async (run: any) => run({ execute: async (q: any) => compileSql(q).startsWith("SELECT COUNT(*)") ? [[{ total: 1 }]] : [[row]] }) };
      const item = (await c.createChannelTeamInventoryService({ getDb: async () => db }).listTeamMaterials(scope, { page: 1, pageSize: 20 })).items[0];
      const canEdit = write && qualified && (!company.linked || company.customer !== null);
      expect(item.canEditMaterial).toBe(canEdit); expect(item.canViewSource).toBe(canEdit); expect(item.canViewCustomerSource).toBe(canEdit); expect(item.readOnly).toBe(!canEdit);
      const expectedCompany = canEdit && company.linked ? { id: 700, name: "CURRENT CRM" } : null;
      expect(item.company).toEqual(expectedCompany); expect(item.customerSource).toEqual(expectedCompany);
      expect(item.channelSource).toEqual(expectedCompany ? { id: 11, name: "CURRENT CRM" } : null); expect(JSON.stringify(item)).not.toContain("PRIVATE");
    }
  });
});

function oldUpdateHarness({ write = true, qualified = true, company = sourceCompany, revision = 1, affected = 1, prior = null as any } = {}) {
  const queries: string[] = [], row = baseRow({ canManageMaterial: qualified, channelActive: true, revision });
  const scope: any = actor(); scope.officialActor.requestId = uuid;
  const c = context({ PUBLIC_COLUMNS: sql`m.id, m.channel_id AS channelId`, TEAM_MATERIAL_FROM: sql`FROM fictional_m m JOIN fictional_c c`, teamInventoryAll: (p: any[]) => sql.join(p, sql` AND `), teamInventoryRows: (r: any) => r[0], notFound: () => fail("NOT_FOUND", "missing"), conflict3: () => fail("CONFLICT", "stale"),
    resolveTeamInventoryVisibility: async () => ({ access: { write }, leader: true, predicates: [sql`TRUE`] }), linkedCompany: async () => company,
    parse2: (schema: z.ZodType, raw: unknown) => { const p = schema.safeParse(raw); if (!p.success) fail("BAD_REQUEST", "strict public input"); return p.data; }, expected3: () => {}, teamMaterialUpdateSchema,
    channelInventoryPayloadHash: (v: unknown) => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex"),
    priorAudit: async () => prior, replay: () => ({ item: { id: 101, revision: 2 }, idempotent: true }), projectMaterialCompany: async (_tx: any, _scope: any, item: any) => item,
    activeUnaliasedChannelMaterial: sql`TRUE`,
    requiredDatabase: async (getDb: any) => getDb(), lockAndRevalidateMutationScope: async () => {},
    header4: (r: any) => r[0], audit2: async (tx: any) => tx.execute(sql`INSERT INTO synthetic_audit VALUES (1)`), TRPCError74: TRPCError, isInnoDbDeadlock: () => false });
  vm.runInContext(["teamMaterialSourceEligibility", "authorizedMaterial", "teamMaterialPublicFrom", "createChannelInventoryCollaborationService", "createChannelInventoryService"].map(n => top(sf, n)).join("\n"), c);
  const db = { transaction: async (run: any) => run({ execute: async (q: any) => { const query = compileSql(q); queries.push(query); return query.startsWith("UPDATE") ? [{ affectedRows: affected }] : [[{ ...row, revision: query.includes("AS canManageMaterial") ? row.revision : row.revision + 1 }]]; } }) };
  return { c, scope, queries, service: c.createChannelInventoryService({ getDb: async () => db }) };
}
describe("old updateMaterial cannot bypass strict public management edit chain", () => {
  it.each([{ write: false }, { qualified: false }, { company: { linked: true, customer: null } }])("owner/effective leader label cannot bypass denial %j before ANY DML", async options => {
    const h = oldUpdateHarness(options);
    await expect(h.service.updateMaterial(h.scope, { id: 101, expectedRevision: 1, qty: 3 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.queries.some(q => /^(UPDATE|INSERT|DELETE)/.test(q))).toBe(false); expect(h.queries[0]).toContain("management_a");
  });
  it.each(["note", "responsibleUserId", "channelId", "currency", "enterpriseId", "dataOwnerUserId"])("injected %s cannot widen new leader into private/admin fields", async field => {
    const h = oldUpdateHarness();
    await expect(h.service.updateMaterial(h.scope, { id: 101, expectedRevision: 1, qty: 3, [field]: field === "note" ? "PRIVATE" : 11 })).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(h.queries).toEqual([]);
  });
  it("reuses signed UUID and preserves CAS, returns only public DTO with current source name", async () => {
    const h = oldUpdateHarness(); const result = await h.service.updateMaterial(h.scope, { id: 101, expectedRevision: 1, qty: 3 });
    expect(result).toMatchObject({ id: 101, revision: 2, canEditMaterial: true, channelName: "CURRENT CRM" }); expect(result).not.toHaveProperty("note");
    const update = h.queries.find(q => q.startsWith("UPDATE"))!; expect(update).toContain("AND revision = ?"); expect(update).not.toMatch(/note =|responsible_user_id =|channel_id =/);
    expect(h.queries.findIndex(q => q.includes("AS canManageMaterial"))).toBeLessThan(h.queries.findIndex(q => q.startsWith("UPDATE"))); expect(h.queries.some(q => q.startsWith("INSERT"))).toBe(true);
    const invalid = oldUpdateHarness(); invalid.scope.officialActor.requestId = "not-a-uuid";
    await expect(invalid.service.updateMaterial(invalid.scope, { id: 101, expectedRevision: 1, qty: 3 })).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(invalid.queries).toEqual([]);
  });
  it.each([{ revision: 2 }, { affected: 0 }])("stale/failed CAS remains conflict %j", async options => {
    const h = oldUpdateHarness(options); await expect(h.service.updateMaterial(h.scope, { id: 101, expectedRevision: 1, qty: 3 })).rejects.toMatchObject({ code: "CONFLICT" }); expect(h.queries.some(q => q.startsWith("INSERT"))).toBe(false);
  });
  it("revoked authority denies old-endpoint idempotent replay before audit read", async () => {
    const h = oldUpdateHarness({ write: false, prior: { action: "updateTeamMaterial" } });
    await expect(h.service.updateMaterial(h.scope, { id: 101, expectedRevision: 1, qty: 3 })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(h.queries.some(q => /^(INSERT|UPDATE)/.test(q))).toBe(false);
  });
  it.each([{ write: false }, { qualified: false }, { company: { linked: true, customer: null } }])("native old endpoint also cannot bypass same management+write+CRM %j", async options => {
    const h = oldUpdateHarness(options); delete h.scope.officialActor;
    await expect(h.service.updateMaterial(h.scope, { id: 101, expectedRevision: 1, qty: 3, note: "native private" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.queries.some(q => /^(UPDATE|INSERT|DELETE)/.test(q))).toBe(false); expect(h.queries[0]).toContain("management_a");
  });
  it("native old owner/private-field write body is byte-identical after added stricter authorization", () => {
    const old = methodText(beforeSf, "createChannelInventoryService", "updateMaterial"), current = methodText(sf, "createChannelInventoryService", "updateMaterial");
    expect(current).toContain("await authorizedMaterial(tx, scope, input.id, true)");
    expect(current.slice(current.indexOf("const current = await findMaterial"))).toBe(old.slice(old.indexOf("const current = await findMaterial")));
  });
  it("old-endpoint HMAC target cannot replay to another API or alter signed management/write", () => {
    const c = context(), now = Date.now(); const target = { staffUserId: 202, adminAccountId: 303, bindingVersion: 7, method: "channelInventory.updateMaterial", requestId: uuid, expectedOwnerUserId: 99 };
    const grant = { schemaVersion: 1, issuedAt: now, expiresAt: now + 30000, permissions: actor().officialActor.inventoryPermissions };
    const token = { ...grant, signature: crypto.createHmac("sha256", "fixture-key").update(canonicalOfficialInventoryJson({ grant, target })).digest("hex") };
    expect(c.verifyOfficialInventoryGrant(token, target).inventoryScopeWrite).toBe(true);
    expect(() => c.verifyOfficialInventoryGrant(token, { ...target, method: "channelInventory.updateTeamMaterial" })).toThrow();
    expect(() => c.verifyOfficialInventoryGrant({ ...token, permissions: { ...grant.permissions, write: false } }, target)).toThrow();
  });
});

describe("actual admin helper rejects archived actors before all early-return paths", () => {
  const adminSf = ts.createSourceFile("admin", fs.readFileSync(dir + "/patched-admin-index.js", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  it.each(["leader", "member", "super", "unassigned"])("archived %s issues neither read nor write proof", async kind => {
    const calls: string[] = [], run = vi.fn();
    const access = { adminUserId: 303, isSuperAdmin: kind === "super", teamId: kind === "unassigned" || kind === "super" ? null : 44, teamRole: kind === "leader" ? "leader" : "member", permissions: ["officialInventory.read", "officialInventory.write"] };
    const c = vm.createContext({ sql7: sql, TRPCError7: TRPCError, officialActorFromContext: () => ({}), loadOfficialAccess: async () => access,
      getDb: async () => ({ transaction: async (fn: any) => fn({ execute: async (q: any) => { calls.push(compileSql(q)); return [[{ id: 1 }]]; } }) }), officialChannelProfileAuthorityRows: (r: any) => r[0] });
    vm.runInContext(top(adminSf, "withOfficialChannelProfileRead"), c);
    await expect(c.withOfficialChannelProfileRead({}, 202, run, true)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(run).not.toHaveBeenCalled(); expect(calls).toHaveLength(1); expect(calls[0]).toContain("admin_staff_archives"); expect(calls[0]).toContain("FOR UPDATE");
  });
});

// B1/B2 finite regressions execute the FINAL actual function bytes. ERP fixtures
// are local synthetic rows; SQL truth-table evaluation uses in-memory SQLite
// (FOR UPDATE removed for dialect compatibility), not a live DB/lock test.
function legacyReadHarness({ write = false, qualified = true, official = true, company = sourceCompany } = {}) {
  const queries: string[] = [], scope: any = actor(); if (!official) delete scope.officialActor;
  const row = baseRow({ canManageMaterial: qualified, channelType: "trade", channelActive: true,
    enterpriseId: 1, dataOwnerUserId: 99, responsibleUserId: 202, note: "EXISTING PRIVATE NOTE", shareEnabled: true });
  const c = context({ sql18: sql, rows11: (r: any) => r[0], bool3: bool, nullableString: (v: unknown) => v == null ? null : String(v),
    TRPCError5: TRPCError, TRPCError72: TRPCError, BUSINESS_MODULES: ["stocks", "channels", "customers", "demands"],
    normalizeErpPermissions: (keys: string[]) => keys, businessModuleEntitled: () => true,
    appError: fail, databaseFailure: () => new Error("unexpected DB error"),
    isChannelType: (v: string) => ["factory", "agent", "trade", "other"].includes(v),
    MATERIAL_COLUMNS: sql`m.id, m.channel_id AS channelId`, MATERIAL_WITH_CHANNEL_FROM: sql`FROM fictional_m m JOIN fictional_c c`,
    materialWithChannelScopePredicates: () => [sql`m.enterprise_id = 1`, sql`m.responsible_user_id = 202`, sql`c.responsible_user_id = 202`],
    whereAll: (p: any[]) => sql.join(p, sql` AND `), assertPage: () => {}, literalSearch: (v: string) => `%${v}%`,
    linkedCompany: async () => company, projectMaterialCompany: async (_tx: any, _scope: any, item: any) => item.channelId == null ? item : { ...item, channelName: company.customer?.name ?? null },
    factoryMaterialPublicationMetadata: async () => new Map(), requiredDatabase: async (getDb: any) => getDb() });
  vm.runInContext(["businessRows", "businessIsTransaction", "businessBoolean", "businessIsOwner", "resolveBusinessModuleAccess", "resolveChannelInventoryAuthority", "teamMaterialSourceEligibility", "materialFrom", "projectOfficialMaterialManagement", "findMaterial", "createChannelInventoryService"].map(n => top(sf, n)).join("\n"), c);
  const tx = { rollback: () => {}, execute: async (q: any) => {
    const query = compileSql(q); queries.push(query);
    if (query.includes("FROM enterprises")) return [[{ id: 1, superAdminUserId: 999, crmDataOwnerUserId: 99 }]];
    if (query.includes("FROM enterprise_members em")) return [[{ id: 5, userId: 202, role: "member", status: "active", loginDisabled: 0 }]];
    if (query.includes("FROM enterprise_member_permissions")) return [[{ permissionKey: "inventory.manage" }]];
    if (query.includes("SELECT teamId, teamRole FROM enterprise_team_members")) return [[{ teamId: 44, teamRole: "leader" }]];
    if (query.includes("SELECT id, status FROM enterprise_teams")) return [[{ id: 44, status: "active" }]];
    if (query.startsWith("SELECT readAllowed, writeAllowed, dataScope, revision")) return [[{ readAllowed: 1, writeAllowed: write ? 1 : 0, dataScope: "team", revision: 9 }]];
    if (query.startsWith("SELECT COUNT(*)")) return [[{ total: 1 }]];
    return [[{ ...row }]];
  } };
  const db = { transaction: async (run: any) => run(tx) };
  return { c, scope, tx, queries, service: c.createChannelInventoryService({ getDb: async () => db }) };
}

describe("B1 official legacy reads use actual ERP write + same management/CRM projection", () => {
  it.each(["findMaterial", "getMaterial", "listMaterials"])("signed write=1 but actual ERP writeAllowed=0 masks source and canEdit in %s without removing stock/note", async name => {
    const h = legacyReadHarness();
    expect(h.scope.officialActor.inventoryPermissions).toMatchObject({ write: true, inventoryScopeWrite: true });
    const result = name === "findMaterial" ? await h.c.findMaterial(h.tx, h.scope, 101, true)
      : name === "getMaterial" ? await h.service.getMaterial(h.scope, 101) : await h.service.listMaterials(h.scope, { page: 1, pageSize: 20 });
    const item = name === "listMaterials" ? result.items[0] : result;
    expect(item).toMatchObject({ id: 101, partNumber: "PN", note: "EXISTING PRIVATE NOTE", canEdit: false, canEditMaterial: false, readOnly: true,
      channelId: null, channelName: null, company: null, customerSource: null, customerSourceState: "restricted" });
    expect(JSON.stringify(result)).not.toMatch(/CURRENT CRM|PRIVATE-CHANNEL|PRIVATE CRM CONTACT/);
    if (name === "listMaterials") expect(result).toMatchObject({ total: 1, canWrite: false });
    expect(h.queries.some(q => q.startsWith("SELECT readAllowed, writeAllowed, dataScope, revision") && q.includes("ORDER BY revision DESC, id DESC LIMIT 1 FOR UPDATE"))).toBe(true);
    expect(h.queries.some(q => q.includes("AS canManageMaterial") && q.includes("m.responsible_user_id = 202"))).toBe(true);
  });
  it.each([false, true])("actual write=1 still requires strict qualification=%s; CRM name never reverts to channel name", async qualified => {
    for (const company of [sourceCompany, { linked: true, customer: null }, { linked: false, customer: null }]) {
      const h = legacyReadHarness({ write: true, qualified, company });
      const items = [(await h.service.listMaterials(h.scope, { page: 1, pageSize: 20 })).items[0], await h.service.getMaterial(h.scope, 101)];
      const canEdit = qualified && (!company.linked || company.customer !== null);
      for (const item of items) {
        expect(item.canEdit).toBe(canEdit); expect(item.readOnly).toBe(!canEdit);
        expect(item.channelName).toBe(canEdit && company.linked ? "CURRENT CRM" : null);
        expect(item.company).toEqual(canEdit && company.linked ? { id: 700, name: "CURRENT CRM" } : null);
        expect(item.channelId).toBe(canEdit && company.linked ? 11 : null);
      }
    }
  });
  it("native legacy source and private note semantics remain unchanged", async () => {
    const h = legacyReadHarness({ official: false, write: true, qualified: false });
    const item = await h.service.getMaterial(h.scope, 101);
    expect(item).toMatchObject({ canEdit: true, readOnly: false, channelId: 11, channelName: "CURRENT CRM", note: "EXISTING PRIVATE NOTE" });
    expect(item).not.toHaveProperty("canEditMaterial");
  });
});

function evaluateManagementSql({ settings = [] as any[], creator = false, activeTeam = true, native = false, paired = false } = {}) {
  const c = context();
  // Verified immutable evidence prerequisites are fixture constants here; their
  // full validators remain covered unchanged by the existing actual tests.
  c.officialMaterialCreator = () => creator ? sql`TRUE` : sql`FALSE`;
  c.officialMaterialRecorderStaffUserId = () => sql`203`;
  c.officialMaterialRecorderAdminAccountId = () => sql`404`;
  const scope: any = actor(paired ? { channelMaterialManagement: { leaderAdminAccountId: 303, recorderBindings: [{ adminAccountId: 303, staffUserId: 202 }, { adminAccountId: 404, staffUserId: 203 }] } }
    : { materialBusinessTeamLeaderWrite: { adminAccountId: 303, staffUserId: 202 } });
  if (native) delete scope.officialActor;
  const query = new MySqlDialect().sqlToQuery(c.teamMaterialManagementEligibility(scope, true));
  // SQLite runs this generated expression's actual joins/OR/scalar/order/CASE.
  const code = `import json, sqlite3, sys
x=json.load(sys.stdin); db=sqlite3.connect(':memory:')
db.executescript('''
CREATE TABLE fixture_m(id, enterprise_id, data_owner_user_id, responsible_user_id);
CREATE TABLE fixture_c(active);
CREATE TABLE enterprise_team_record_assignments(id, enterpriseId, recordType, recordId, teamId, currentOwnerUserId, createdByUserId, revision);
CREATE TABLE enterprise_teams(id, enterpriseId, status);
CREATE TABLE enterprise_team_members(id, enterpriseId, teamId, userId, teamRole);
CREATE TABLE enterprise_members(enterpriseId, userId, status);
CREATE TABLE users(id, loginDisabled);
CREATE TABLE enterprise_member_module_access(id, enterpriseId, userId, module, dataScope, revision);
INSERT INTO fixture_m VALUES(101,1,99,203); INSERT INTO fixture_c VALUES(1);
INSERT INTO enterprise_team_record_assignments VALUES(1,1,'channel_material',101,44,203,203,1);
INSERT INTO enterprise_team_members VALUES(1,1,44,202,'leader'),(2,1,44,203,'member');
INSERT INTO enterprise_members VALUES(1,203,'active'); INSERT INTO users VALUES(203,0);
''')
db.execute('INSERT INTO enterprise_teams VALUES(44,1,?)',('active' if x['activeTeam'] else 'inactive',))
if x['nativeCreator']: db.execute('UPDATE enterprise_team_record_assignments SET createdByUserId=202')
for r in x['settings']: db.execute('INSERT INTO enterprise_member_module_access VALUES(?,?,?,?,?,?)',(r['id'],r.get('enterpriseId',1),r.get('userId',202),r.get('module','stocks'),r.get('dataScope'),r['revision']))
q=x['sql'].replace(' FOR UPDATE','').replace("BINARY management_access.dataScope = BINARY 'team'", "management_access.dataScope = 'team'")
print(json.dumps(bool(db.execute('SELECT '+q+' FROM fixture_m m JOIN fixture_c c',x['params']).fetchone()[0])))
`;
  const result = JSON.parse(execFileSync("python3", ["-c", code], { input: JSON.stringify({ ...query, settings, activeTeam, nativeCreator: native && creator }), encoding: "utf8" }));
  return { result, query: query.sql, projection: c.materialManagementProjection(baseRow({ canManageMaterial: result }), true, sourceCompany) };
}

describe("B2 current stocks scope restricts ONLY leader branch, actual SQL truth table", () => {
  it.each([false, true])("actor-bound/paired leader (paired=%s) with write=1+self cannot manage cross-recorder; current valid team/default can", paired => {
    for (const settings of [
      ...["self", "enterprise", null, "TEAM", "team ", "invalid"].map(dataScope => [{ id: 1, revision: 2, dataScope }]),
      ...[0, -1, 1.5, 9007199254740992].map(revision => [{ id: 1, revision, dataScope: "team" }]),
    ]) {
      const h = evaluateManagementSql({ settings, paired });
      expect(h.result).toBe(false); expect(h.projection).toMatchObject({ canEdit: false, readOnly: true, customerSource: null });
    }
    for (const settings of [[], [{ id: 1, revision: 2, dataScope: "team" }]]) {
      const h = evaluateManagementSql({ settings, paired }); expect(h.result).toBe(true);
      expect(h.projection).toMatchObject({ canEdit: true, customerSource: { id: 700, name: "CURRENT CRM" } });
      expect(evaluateManagementSql({ settings, paired, activeTeam: false }).result).toBe(false);
    }
  });
  it("latest revision then id is actor/enterprise/stocks-bound, not signed or older team scope", () => {
    const prior = [{ id: 1, revision: 1, dataScope: "team" }, { id: 2, revision: 2, dataScope: "self" }];
    expect(evaluateManagementSql({ settings: prior }).result).toBe(false);
    expect(evaluateManagementSql({ settings: [...prior, { id: 3, revision: 2, dataScope: "team" }] }).result).toBe(true);
    expect(evaluateManagementSql({ settings: [...prior, { id: 4, revision: 3, dataScope: "team", userId: 999 }, { id: 5, revision: 3, dataScope: "team", enterpriseId: 9 }, { id: 6, revision: 3, dataScope: "team", module: "customers" }] }).result).toBe(false);
    const query = evaluateManagementSql({ settings: prior }).query;
    expect(query).toContain("management_access.userId = ? AND management_access.module = 'stocks'");
    expect(query).toContain("ORDER BY management_access.revision DESC, management_access.id DESC LIMIT 1 FOR UPDATE");
  });
  it.each([false, true])("strict original creator stays independent of self/enterprise leader restriction (native=%s)", native => {
    for (const dataScope of ["self", "enterprise"]) {
      const settings = [{ id: 1, revision: 2, dataScope }];
      expect(evaluateManagementSql({ settings, native, creator: false }).result).toBe(false);
      expect(evaluateManagementSql({ settings, native, creator: true }).projection).toMatchObject({ canEdit: true, customerSource: { name: "CURRENT CRM" } });
    }
  });
  it.each(["self", "team"])("actual computed latest scope=%s drives the same source/options/old-save gates with signed write=1", async dataScope => {
    const qualified = evaluateManagementSql({ settings: [{ id: 1, revision: 8, dataScope }] }).result;
    const source = sourceHarness({ write: true, qualified });
    const options = await source.service.listTeamSourceOptions(source.scope, {});
    expect(options.items).toEqual(qualified ? [{ id: 11, name: "CURRENT CRM" }] : []);
    const getter = source.getter.getTeamMaterialSource(source.scope, { materialId: 101 });
    if (qualified) await expect(getter).resolves.toEqual({ name: "CURRENT CRM" }); else await expect(getter).rejects.toMatchObject({ code: "FORBIDDEN" });
    const save = oldUpdateHarness({ write: true, qualified });
    const update = save.service.updateMaterial(save.scope, { id: 101, expectedRevision: 1, qty: 3 });
    if (qualified) await expect(update).resolves.toMatchObject({ canEditMaterial: true, channelName: "CURRENT CRM" });
    else { await expect(update).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(save.queries.some(q => /^(UPDATE|INSERT|DELETE)/.test(q))).toBe(false); }
  });
  it("common SQL and every B1 function are identical to transpiled current mirror (mapped actual symbols)", () => {
    const serviceDir = "client/src/business/platform/front-router-types/server/services/";
    const manage = ts.createSourceFile("mirror", fs.readFileSync(serviceDir + "channelMaterialManagement.ts", "utf8"), ts.ScriptTarget.Latest, true);
    const inventory = ts.createSourceFile("mirror", fs.readFileSync(serviceDir + "channelInventory.ts", "utf8"), ts.ScriptTarget.Latest, true);
    const compile = (text: string) => ts.transpileModule(text.replace(/\bexport\s+/g, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    const map = (text: string) => text.replace(/\bsql\b/g, "sql83").replace(/\brows\b/g, "rows11").replace(/\bbool\b/g, "bool3").replace(/\bgetDb\b/g, "getDb2");
    expect(top(sf, "teamMaterialManagementEligibility")).toBe(compile(top(manage, "teamMaterialManagementEligibility")).replace(/\bsql\b/g, "sql83").trim());
    for (const name of ["projectOfficialMaterialManagement", "findMaterial"]) expect(top(sf, name)).toBe(map(compile(top(inventory, name))).trim());
    for (const name of ["listMaterials", "getMaterial"]) {
      const wrapper = "function __isolated() { return {" + methodText(inventory, "createChannelInventoryService", name) + "}; }";
      const compiled = ts.createSourceFile("compiled", map(compile(wrapper)), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      expect(methodText(sf, "createChannelInventoryService", name)).toBe(methodText(compiled, "__isolated", name));
    }
  });
});
