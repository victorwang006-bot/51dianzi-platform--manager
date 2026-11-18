import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { sql } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { TRPCError } from "@trpc/server";
import { officialInventoryPermissionsSchema as readSchema } from "../client/src/business/platform/shared/internalBusinessOfficialInventory";
import { canonicalOfficialInventoryJson, channelMaterialManagementSchema } from "../shared/internalBusinessOfficialInventory";
import { teamMaterialSourceSchema } from "../client/src/business/platform/shared/channelInventorySource";
import { verifyOfficialInventoryGrant } from "../client/src/business/platform/front-router-types/server/services/internalBusinessOfficialGrant";

// Finite offline tests against CURRENT app function bytes. SQL dependencies are
// synthetic; SQLite exercises actual read-fence joins (FOR UPDATE removed only
// for dialect compatibility). No production DB, network, or business writes.
const serviceRoot = path.resolve("client/src/business/platform/front-router-types/server/services");
const files = Object.fromEntries(["channelInventorySource", "channelInventoryChannelAccess", "channelTeamInventory", "channelMaterialManagement"].map(name =>
  [name, ts.createSourceFile(name, fs.readFileSync(path.join(serviceRoot, name + ".ts"), "utf8"), ts.ScriptTarget.Latest, true)]));
function functionText(file: string, name: string) {
  const root = files[file];
  const node = root.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  if (!node) throw new Error("Missing inventory function: " + name);
  return node.getText(root);
}
class FixtureError extends Error { constructor(public code: string, message: string) { super(message); } }
const dialect = new MySqlDialect();
const compile = (query: any) => dialect.sqlToQuery(query);
const actorId = 202, tenantId = 51, ownerId = 99;
const key = "offline-inventory-source-proof";
const target = { staffUserId: actorId, adminAccountId: 303, bindingVersion: 7, method: "channelInventory.listTeamMaterials", requestId: "fixture-source-read-001", expectedOwnerUserId: ownerId };
function signedScope(overrides: Record<string, unknown> = {}) {
  vi.stubEnv("PORTAL_API_KEY", key);
  const permissions = { read: true, write: false, note: false, customerScopeRead: true,
    authorizationVersion: "fixture-source-v1", channelProfileTeamRead: { ownerUserIds: [actorId], businessTeamLeaderRead: true }, ...overrides };
  const now = Date.now();
  const grant = { schemaVersion: 1 as const, issuedAt: now, expiresAt: now + 30_000, permissions };
  const token = { ...grant, signature: crypto.createHmac("sha256", key).update(canonicalOfficialInventoryJson({ grant, target })).digest("hex") };
  const verified = verifyOfficialInventoryGrant(token as any, target);
  return { scope: { enterpriseId: tenantId, actorUserId: actorId, dataOwnerUserId: ownerId,
    officialActor: { adminAccountId: target.adminAccountId, bindingVersion: 7, requestId: target.requestId, inventoryPermissions: verified } }, token };
}
function currentFunctions(extra: Record<string, unknown> = {}) {
  const context = vm.createContext({ exports: {}, sql, officialInventoryPermissionsSchema: readSchema, channelMaterialManagementSchema,
    ChannelInventoryError: FixtureError, TRPCError, SOURCE_FORBIDDEN_MESSAGE: "暂无权限查看", teamMaterialSourceSchema,
    officialMaterialCreator: () => sql`FALSE`, officialMaterialRecorderAdminAccountId: () => sql`NULL`,
    officialMaterialRecorderStaffUserId: () => sql`NULL`, businessFailureOf: () => null,
    bool: (v: unknown) => v === true || v === 1 || v === "1", text: (v: unknown) => v == null ? null : String(v),
    fail: (code: string, message: string) => { throw new FixtureError(code, message); },
    businessIndustryCodeSchema: { safeParse: () => ({ success: false }) },
    channelInventoryManualReferenceValuesFrom: () => ({ manualReferenceLcsc: null, manualReferenceIckey: null }), ...extra });
  const source = [
    functionText("channelInventoryChannelAccess", "channelSourceReadEligibility"),
    functionText("channelMaterialManagement", "teamMaterialManagementEligibility"),
    functionText("channelMaterialManagement", "materialManagementProjection"),
    functionText("channelInventorySource", "teamMaterialSourceEligibility"),
    functionText("channelInventorySource", "teamMaterialSourceReadEligibility"),
    functionText("channelInventorySource", "teamMaterialSourceReadProjection"),
    functionText("channelTeamInventory", "teamMaterialFrom"),
    functionText("channelTeamInventory", "expected"),
    functionText("channelTeamInventory", "createChannelTeamInventoryService"),
    functionText("channelInventorySource", "createChannelInventorySourceService"),
  ].join("\n");
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
  return context;
}
afterEach(() => vi.unstubAllEnvs());

function evaluateReadFence(patch: Record<string, unknown> = {}, scope = signedScope().scope) {
  const functions = currentFunctions();
  const query = compile(functions.teamMaterialSourceReadEligibility(scope, true));
  const code = `import sqlite3,json,sys
x=json.load(sys.stdin); p=x['patch']; db=sqlite3.connect(':memory:')
db.executescript('''
CREATE TABLE fixture_m(id,enterprise_id,data_owner_user_id,responsible_user_id);
CREATE TABLE fixture_c(id,enterprise_id,data_owner_user_id,responsible_user_id,active);
CREATE TABLE enterprise_team_record_assignments(id,enterpriseId,recordType,recordId,teamId,currentOwnerUserId,createdByUserId,revision);
CREATE TABLE enterprise_team_members(id,enterpriseId,teamId,userId,teamRole);
CREATE TABLE enterprise_teams(id,enterpriseId,status);
CREATE TABLE enterprise_members(enterpriseId,userId,status);
CREATE TABLE users(id,loginDisabled);
''')
db.execute('INSERT INTO fixture_m VALUES(101,?,?,203)',(p.get('materialTenant',51),p.get('materialDataOwner',99)))
db.execute('INSERT INTO fixture_c VALUES(11,?,?,?,?)',(p.get('channelTenant',51),p.get('channelDataOwner',99),p.get('channelOwner',203),p.get('channelActive',1)))
db.execute("INSERT INTO enterprise_team_record_assignments VALUES(1,51,'channel',11,44,203,NULL,?)",(p.get('revision',1),))
db.execute('INSERT INTO enterprise_team_members VALUES(1,51,?,202,?)',(p.get('readerTeam',44),p.get('readerRole','leader')))
db.execute("INSERT INTO enterprise_team_members VALUES(2,51,44,203,'member')")
db.execute('INSERT INTO enterprise_teams VALUES(44,51,?)',(p.get('teamStatus','active'),))
db.execute('INSERT INTO enterprise_members VALUES(51,203,?)',(p.get('ownerStatus','active'),))
db.execute('INSERT INTO users VALUES(203,?)',(p.get('ownerDisabled',0),))
if p.get('duplicateReader'): db.execute("INSERT INTO enterprise_team_members VALUES(3,51,44,202,'leader')")
if p.get('duplicateOwner'): db.execute("INSERT INTO enterprise_team_members VALUES(4,51,44,203,'member')")
q=x['sql'].replace(' FOR UPDATE','')
print(json.dumps(bool(db.execute('SELECT '+q+' FROM fixture_m m JOIN fixture_c c',x['params']).fetchone()[0])))
`;
  const result = JSON.parse(execFileSync("python3", ["-c", code], { encoding: "utf8", input: JSON.stringify({ ...query, patch }) }));
  return { result, query };
}

describe("signed source-only capability intersects current native channel assignment", () => {
  it("allows a unique actual active ERP same-team leader with no creator evidence and no write", () => {
    const { scope } = signedScope();
    const evaluated = evaluateReadFence({}, scope);
    expect(evaluated.result).toBe(true);
    for (const fragment of ["profile_a.recordType = 'channel'", "profile_a.currentOwnerUserId = c.responsible_user_id", "profile_reader.teamRole = 'leader'", "profile_t.status = 'active'", "profile_em.status = 'active'", "profile_u.loginDisabled = 0", "FOR UPDATE"])
      expect(evaluated.query.sql).toContain(fragment);
    expect(evaluated.query.sql).not.toContain("createdByUserId");
    expect(compile(currentFunctions().teamMaterialManagementEligibility(scope, true)).sql).toBe("FALSE");
    expect(compile(currentFunctions().teamMaterialSourceEligibility(scope, true)).sql).toBe("FALSE");
  });
  it.each([
    { readerRole: "member" }, { readerTeam: 45 }, { teamStatus: "inactive" }, { ownerStatus: "inactive" },
    { ownerDisabled: 1 }, { duplicateReader: true }, { duplicateOwner: true }, { revision: 0 }, { channelOwner: 204 },
    { materialTenant: 52 }, { channelTenant: 52 }, { materialDataOwner: 100 }, { channelDataOwner: 100 }, { channelActive: 0 },
  ])("does not widen stale/cross-tenant/ambiguous authority: %j", patch => expect(evaluateReadFence(patch).result).toBe(false));
  it.each([
    undefined, null, {}, { ownerUserIds: [] }, { ownerUserIds: [999], businessTeamLeaderRead: true },
    { ownerUserIds: [actorId, 203], businessTeamLeaderRead: true }, { ownerUserIds: [actorId], businessTeamLeaderRead: false },
    { ownerUserIds: [actorId], businessTeamLeaderRead: true, browserBypass: true }, { ownerUserIds: ["202"], businessTeamLeaderRead: true },
  ])("missing or malformed actor proof retains the old narrower management read: %j", proof => {
    const scope = signedScope().scope;
    scope.officialActor.inventoryPermissions = { ...scope.officialActor.inventoryPermissions, channelProfileTeamRead: proof } as any;
    expect(compile(currentFunctions().teamMaterialSourceReadEligibility(scope, true)).sql).toBe("FALSE");
  });
  it("read=false and native leadership/role labels alone cannot create an official source grant", () => {
    const scope = signedScope({ read: false }).scope;
    expect(compile(currentFunctions().teamMaterialSourceReadEligibility(scope, true)).sql).toBe("FALSE");
    const withoutProof = signedScope({ channelProfileTeamRead: undefined }).scope;
    expect(compile(currentFunctions().teamMaterialSourceReadEligibility({ ...withoutProof, isOwner: true, inventoryDataScope: "enterprise" }, true)).sql).toBe("FALSE");
  });
  it("HMAC rejects altered proof, expiry, target actor/method/merchant and signature; freezes verified proof", () => {
    const { token, scope } = signedScope();
    expect(Object.isFrozen(scope.officialActor.inventoryPermissions.channelProfileTeamRead)).toBe(true);
    expect(Object.isFrozen(scope.officialActor.inventoryPermissions.channelProfileTeamRead!.ownerUserIds)).toBe(true);
    for (const invalid of [{ ...token, signature: "0".repeat(64) }, { ...token, expiresAt: Date.now() - 1 },
      { ...token, permissions: { ...token.permissions, channelProfileTeamRead: { ownerUserIds: [203], businessTeamLeaderRead: true } } }])
      expect(() => verifyOfficialInventoryGrant(invalid as any, target)).toThrow();
    for (const override of [{ staffUserId: 203 }, { method: "channelInventory.getTeamMaterialSource" }, { expectedOwnerUserId: 100 }, { adminAccountId: 304 }])
      expect(() => verifyOfficialInventoryGrant(token as any, { ...target, ...override })).toThrow();
  });
});

const baseRow = (extra: Record<string, unknown> = {}) => ({ id: 101, companyChannelId: 11, currency: "CNY", partNumber: "FAKE-PN", brand: "FictionalBrand", revision: 1,
  canManageMaterial: false, canViewSource: true, authorizedChannelName: "虚构历史渠道", isMine: false, ...extra });
function readHarness(options: { row?: Record<string, unknown>; company?: { linked: boolean; customer: any }; write?: boolean } = {}) {
  const queries: string[] = [];
  const row = baseRow(options.row);
  const company = options.company ?? { linked: false, customer: null };
  const companyReader = vi.fn(async () => company);
  const getDb = vi.fn(async () => ({ transaction: async (run: any) => run({ execute: async (query: any) => {
    const { sql: text } = compile(query); queries.push(text);
    if (text.startsWith("SELECT COUNT(*) AS total")) return [[{ total: 1 }]];
    if (text.startsWith("SELECT DISTINCT")) return [[{ ...row, id: 11 }]];
    if (text.startsWith("SELECT m.id,") || text.startsWith("SELECT c.id AS companyChannelId")) return [[{ ...row }]];
    throw new Error("Unexpected offline inventory SELECT: " + text);
  } }) }));
  const visibility = { access: { read: true, write: options.write ?? false, scope: "team" }, leader: true, predicates: [sql`m.enterprise_id = ${tenantId}`, sql`m.data_owner_user_id = ${ownerId}`] };
  const context = currentFunctions({ rows: (r: any) => r[0], teamInventoryRows: (r: any) => r[0], all: (p: any[]) => sql.join(p, sql` AND `), teamInventoryAll: (p: any[]) => sql.join(p, sql` AND `),
    FROM: sql`FROM fictional_material m JOIN fictional_channel c`, TEAM_MATERIAL_FROM: sql`FROM fictional_material m JOIN fictional_channel c`,
    materialUploadBatchId: sql`NULL`, teamMaterialOrder: () => sql`m.id DESC`,
    visible: async () => visibility, resolveTeamInventoryVisibility: async () => visibility,
    linkedCompany: companyReader, linkedCompanyReadGate: async () => sql`CURRENT_CRM_GATE`,
    factoryMaterialPublicationMetadata: async () => new Map(), readChannelInventoryManualReferences: async () => new Map() });
  return { context, row, queries, getDb, companyReader, service: context.createChannelTeamInventoryService({ getDb }), getter: context.createChannelInventorySourceService({ getDb }), scope: signedScope().scope };
}

describe("list/getter/options read projections do not depend on editable material", () => {
  it.each([false, true])("unlinked history is source-only even with stock-write=%s and no immutable creator", async write => {
    const h = readHarness({ write });
    const result = await h.service.listTeamMaterials(h.scope, { page: 1, pageSize: 20 });
    expect(result.items[0]).toMatchObject({ canEditMaterial: false, canEdit: false, readOnly: true, canViewSource: true, canViewCustomerSource: true,
      customerSourceState: "unlinked", customerSource: null, company: null, channelSource: { id: 11, name: "虚构历史渠道" } });
    expect(await h.getter.getTeamMaterialSource(h.scope, { materialId: 101 })).toEqual({ name: "历史渠道：虚构历史渠道（未关联CRM客户）" });
    expect(await h.service.listTeamSourceOptions(h.scope, {})).toEqual({ canFilterSource: true, items: [{ id: 11, name: "历史渠道：虚构历史渠道（未关联CRM客户）" }] });
    expect(h.queries.every(query => query.startsWith("SELECT"))).toBe(true);
    expect(h.queries.find(query => query.startsWith("SELECT m.id,"))).toContain("CASE WHEN");
  });
  it("matched source uses only confirmed current CRM company, never c.name or private CRM fields", async () => {
    const h = readHarness({ company: { linked: true, customer: { id: 701, name: "虚构已确认公司", phone: "PRIVATE-PHONE", notes: "PRIVATE-NOTES" } } });
    const item = (await h.service.listTeamMaterials(h.scope, { page: 1, pageSize: 20 })).items[0];
    expect(item).toMatchObject({ canEdit: false, readOnly: true, canViewSource: true, customerSourceState: "matched", company: { id: 701, name: "虚构已确认公司" }, channelSource: { id: 11, name: "虚构已确认公司" } });
    expect(JSON.stringify(item)).not.toMatch(/历史渠道|PRIVATE/);
    expect(await h.getter.getTeamMaterialSource(h.scope, { materialId: 101 })).toEqual({ name: "虚构已确认公司" });
  });
  it.each([null, { id: 0, name: "PRIVATE" }, { id: 701, name: " " }, { id: 701, name: 123 }])("linked CRM denied/missing/invalid %j masks every source with no historical fallback", async customer => {
    const h = readHarness({ company: { linked: true, customer } });
    const item = (await h.service.listTeamMaterials(h.scope, { page: 1, pageSize: 20 })).items[0];
    expect(item).toMatchObject({ canViewSource: false, canViewCustomerSource: false, customerSourceState: "restricted", company: null, customerSource: null, channelSource: null });
    expect(JSON.stringify(item)).not.toMatch(/历史渠道|PRIVATE/);
    await expect(h.getter.getTeamMaterialSource(h.scope, { materialId: 101 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await h.service.listTeamSourceOptions(h.scope)).items).toEqual([]);
  });
  it("CRM-read cannot revive an initially denied source even when old management is qualified", async () => {
    const h = readHarness({ write: true, row: { canViewSource: false, canManageMaterial: true }, company: { linked: true, customer: { id: 701, name: "PRIVATE-CRM" } } });
    const item = (await h.service.listTeamMaterials(h.scope, { page: 1, pageSize: 20 })).items[0];
    expect(item).toMatchObject({ canViewSource: false, customerSourceState: "restricted", company: null, customerSource: null, channelSource: null });
  });
  it.each([{ expectedEnterpriseId: 52 }, { expectedActorUserId: 203 }])("stale/cross-tenant assertions reject list/options/getter before DB: %j", mismatch => {
    const h = readHarness();
    return Promise.all([
      expect(h.service.listTeamMaterials(h.scope, { page: 1, pageSize: 20, ...mismatch })).rejects.toMatchObject({ code: "FORBIDDEN" }),
      expect(h.service.listTeamSourceOptions(h.scope, mismatch)).rejects.toMatchObject({ code: "FORBIDDEN" }),
      expect(h.getter.getTeamMaterialSource(h.scope, { materialId: 101, ...mismatch })).rejects.toMatchObject({ code: "FORBIDDEN" }),
    ]).then(() => expect(h.getDb).not.toHaveBeenCalled());
  });
  it("management projector retains the unchanged strict write/immutable qualification rules", () => {
    const functions = currentFunctions();
    for (const write of [false, true]) for (const qualified of [false, true]) {
      const row = baseRow({ canManageMaterial: qualified });
      const projection = functions.materialManagementProjection(row, write, { linked: false, customer: null });
      expect(projection.canEditMaterial).toBe(write && qualified);
      expect(projection.readOnly).toBe(!(write && qualified));
    }
    expect(functionText("channelInventorySource", "teamMaterialSourceEligibility")).toContain("return teamMaterialManagementEligibility(scope, lock)");
  });
});
