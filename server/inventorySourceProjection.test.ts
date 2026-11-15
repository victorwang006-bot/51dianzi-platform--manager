import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";
import ts from "typescript";

// Finite OFFLINE verification only. Actual acquired function bytes are isolated;
// all authority/CRM/SQL dependencies are synthetic. This does not validate MySQL,
// current production grants, HTTP, deployment, or the live authority resolver.
const artifacts = "/home/ubuntu/work/inventory-compact-edit-20261115/backend";
const mirrorPath = path.resolve("client/src/business/platform/front-router-types/server/services/channelTeamInventory.ts");
const baseline = fs.readFileSync(path.join(artifacts, "baseline-front-index.js"));
const patched = fs.readFileSync(path.join(artifacts, "patched-front-index.js"));
const manifest = JSON.parse(fs.readFileSync(path.join(artifacts, "main-source-projection.patch.json"), "utf8"));
const hash = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");
const parse = (text: string, kind = ts.ScriptKind.JS) => ts.createSourceFile("isolated-source", text, ts.ScriptTarget.Latest, true, kind);
const originalSf = parse(baseline.toString());
const patchedSf = parse(patched.toString());
const mirrorSf = parse(fs.readFileSync(mirrorPath, "utf8"), ts.ScriptKind.TS);
function nodes(root: ts.Node, predicate: (n: ts.Node) => boolean): ts.Node[] {
  const found: ts.Node[] = [];
  const walk = (node: ts.Node) => { if (predicate(node)) found.push(node); ts.forEachChild(node, walk); };
  walk(root); return found;
}
function topFunction(sf: ts.SourceFile, name: string) {
  const matches = sf.statements.filter(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  expect(matches).toHaveLength(1); return matches[0].getText(sf);
}
function method(sf: ts.SourceFile, name: string) {
  const matches = nodes(sf, n => ts.isMethodDeclaration(n) && n.name?.getText(sf) === name && (name !== "getTeamMaterialSource" || n.getText(sf).includes("SELECT c.name, c.id AS companyChannelId")));
  expect(matches).toHaveLength(1); return matches[0].getText(sf);
}
const actualProjection = topFunction(patchedSf, "teamMaterialFrom");
const originalProjection = topFunction(originalSf, "teamMaterialFrom");
const mirrorProjection = topFunction(mirrorSf, "teamMaterialFrom");
const bool = (v: unknown) => v === true || v === 1 || v === "1";
class OfflineError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
const fail = (code: string, message: string): never => { throw new OfflineError(code, message); };
const basicDeps = {
  bool6: bool, bool, text11: (v: unknown) => v == null ? null : String(v), text: (v: unknown) => v == null ? null : String(v),
  fail13: fail, fail, ChannelInventoryError: OfflineError,
  businessIndustryCodeSchema: { safeParse: (v: unknown) => v === "automotive" ? { success: true, data: v } : { success: false } },
};
function evaluateFunction<T>(text: string, name: string, dependencies: Record<string, unknown> = basicDeps): T {
  const context = vm.createContext({ ...dependencies, exports: {} });
  const js = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInContext(js, context, { timeout: 1000 });
  return context[name] as T;
}
type Row = Record<string, any>;
type Projector = (row: Row, canWrite: boolean, leader: boolean) => Row;
const projectors = [
  ["actual-acquired-bundle AST projector", evaluateFunction<Projector>(actualProjection, "teamMaterialFrom")],
  ["typed-mirror AST projector", evaluateFunction<Projector>(mirrorProjection, "teamMaterialFrom")],
] as const;
const row = (patch: Row = {}): Row => ({
  id: 101, companyChannelId: 22, currency: "CNY", partNumber: "PN-01", brand: "Brand", revision: 1,
  updatedAt: "2026-11-15", createdAt: "2026-11-15", isMine: false, canViewSource: true,
  authorizedChannelName: "真实渠道", industryCode: "automotive", uploadBatchId: 9, canViewUploadBatch: true,
  contactName: "PRIVATE-CONTACT", phone: "PRIVATE-PHONE", responsibleUserId: 44, notes: "PRIVATE-NOTES",
  ...patch,
});

type Company = { linked: boolean; customer: Row | null };
const syntheticSql = (strings: TemplateStringsArray, ...values: unknown[]) => strings.reduce((result, piece, i) => result + piece + (i < values.length ? String(values[i]) : ""), "");
syntheticSql.join = (values: unknown[], sep: unknown) => values.join(String(sep));
const currentScope = { enterpriseId: 51, actorUserId: 10, dataOwnerUserId: 99 };
function harness(options: { rows?: Row[]; company?: Company; write?: boolean; leader?: boolean; sourceReader?: boolean; total?: unknown; original?: boolean; mirror?: boolean } = {}) {
  const data = (options.rows ?? [row()]).map(r => ({ ...r }));
  const queries: string[] = [];
  const company = options.company ?? { linked: false, customer: null };
  const linkedCompany = vi.fn(async () => company);
  const teamMaterialSourceEligibility = vi.fn(() => "(SYNTHETIC_SOURCE_ELIGIBILITY)");
  const visibility = { access: { write: options.write ?? false, scope: "team" }, leader: options.leader ?? false, sourceReader: options.sourceReader ?? false, predicates: ["SYNTHETIC_VISIBILITY"] };
  const tx = { execute: vi.fn(async (query: string) => {
    queries.push(String(query));
    if (String(query).startsWith("SELECT COUNT(*) AS total")) return [[{ total: Object.prototype.hasOwnProperty.call(options, "total") ? options.total : data.length }]];
    if (String(query).startsWith("SELECT m.id, ")) return [data];
    if (String(query).startsWith("SELECT c.name, c.id AS companyChannelId")) return [[{ name: data[0]?.rawChannelName ?? data[0]?.authorizedChannelName, companyChannelId: data[0]?.companyChannelId }]];
    throw new Error("Unexpected synthetic SQL: " + query);
  }) };
  const getDb = async () => ({ transaction: async (fn: (tx: unknown) => unknown) => fn(tx) });
  const deps = {
    ...basicDeps, sql87: syntheticSql, sql82: syntheticSql, sql: syntheticSql,
    rows13: (result: Row[][]) => result[0], rows: (result: Row[][]) => result[0], teamInventoryRows: (result: Row[][]) => result[0],
    all: (values: string[]) => values.join(" AND "), teamInventoryAll: (values: string[]) => values.join(" AND "),
    TEAM_MATERIAL_FROM: "FROM SYNTHETIC_ONLY", FROM: "FROM SYNTHETIC_ONLY", materialUploadBatchId: "synthetic_batch",
    channelMaterialCanViewUploadBatch: () => "SYNTHETIC_BATCH_ELIGIBILITY", teamMaterialSourceEligibility,
    resolveTeamInventoryVisibility: async () => visibility, visible: async () => visibility,
    expected4: evaluateFunction(topFunction(originalSf, "expected4"), "expected4"),
    expected: () => {}, teamMaterialOrder: () => "m.id DESC",
    linkedCompany, linkedCompanyReadGate: async () => "SYNTHETIC_CURRENT_CRM_GATE",
    factoryMaterialPublicationMetadata: vi.fn(async () => new Map()),
    officialMaterialRecorderAdminAccountId: () => "NULL", getDb2: getDb,
    teamMaterialFrom: evaluateFunction<Projector>(options.original ? originalProjection : options.mirror ? mirrorProjection : actualProjection, "teamMaterialFrom"),
    teamMaterialSourceSchema: { safeParse: (raw: unknown) => ({ success: true, data: raw }) },
    SOURCE_FORBIDDEN_MESSAGE: "SYNTHETIC_SOURCE_FORBIDDEN", businessFailureOf: () => null, TRPCError71: OfflineError,
  };
  const sf = options.original ? originalSf : options.mirror ? mirrorSf : patchedSf;
  const factory = evaluateFunction<(arg: { getDb: typeof getDb }) => { listTeamMaterials: (scope: unknown, input: unknown) => Promise<Row>; listTeamSourceOptions: unknown }>(topFunction(sf, "createChannelTeamInventoryService"), "createChannelTeamInventoryService", deps);
  const service = factory({ getDb });
  const getterContext = vm.createContext(deps);
  const getter = vm.runInContext("({" + method(originalSf, "getTeamMaterialSource") + "})", getterContext, { timeout: 1000 }).getTeamMaterialSource;
  return { data, queries, tx, linkedCompany, teamMaterialSourceEligibility, service, getter };
}

function applySpans(input: Buffer, spans: any[]) {
  let cursor = 0;
  const pieces: Buffer[] = [];
  for (const span of spans) {
    expect(span.offset).toBeGreaterThanOrEqual(cursor);
    const removed = input.subarray(span.offset, span.offset + span.removedByteLength);
    expect(removed.toString()).toBe(span.removed);
    expect(hash(removed)).toBe(span.beforeSha256);
    pieces.push(input.subarray(cursor, span.offset), Buffer.from(span.inserted));
    cursor = span.offset + span.removedByteLength;
  }
  pieces.push(input.subarray(cursor)); return Buffer.concat(pieces);
}

describe("actual bundle exact offline three-span patch", () => {
  it("pins real bytes twice and recovers the full baseline with the inverse", () => {
    expect(hash(baseline)).toBe("db920e472f854dd41ae6f610f2c0d1c37df28c5260afee4ab3f924b24c83c2c9");
    expect(hash(fs.readFileSync(manifest.actualBaselinePath))).toBe(manifest.beforeSha);
    expect(hash(patched)).toBe(manifest.afterSha);
    expect(manifest.spans).toHaveLength(3);
    expect(applySpans(baseline, manifest.spans).equals(patched)).toBe(true);
    expect(applySpans(patched, manifest.inverse.spans).equals(baseline)).toBe(true);
    let before = 0, after = 0;
    for (const span of manifest.spans) {
      const length = span.offset - before;
      expect(patched.subarray(after, after + length).equals(baseline.subarray(before, span.offset))).toBe(true);
      expect(hash(baseline.subarray(span.ownerBeforeByteStart, span.ownerBeforeByteEnd))).toBe(span.ownerBeforeSha256);
      before = span.offset + span.removedByteLength; after = span.afterOffset + span.insertedByteLength;
    }
    expect(patched.subarray(after).equals(baseline.subarray(before))).toBe(true);
  });
  it("does not alter source options, real visibility, source eligibility, getter or write guards", () => {
    for (const name of ["resolveTeamInventoryVisibility", "teamMaterialSourceEligibility", "authorizedMaterial"])
      expect(topFunction(patchedSf, name)).toBe(topFunction(originalSf, name));
    expect(method(patchedSf, "listTeamSourceOptions")).toBe(method(originalSf, "listTeamSourceOptions"));
    expect(method(patchedSf, "getTeamMaterialSource")).toBe(method(originalSf, "getTeamMaterialSource"));
    expect(topFunction(patchedSf, "authorizedMaterial")).toContain("!visibility.access.write || !bool5(row.isMine) && !visibility.leader");
    expect(topFunction(patchedSf, "resolveTeamInventoryVisibility")).toContain("businessTeamLeaderRead !== true");
    expect(actualProjection).toContain("const canEdit = (isMine || leader) && canWrite;");
    expect((patchedSf as any).parseDiagnostics).toHaveLength(0);
  });
  it("strictly type-checks the mirror projector against its existing source-bearing DTO type", () => {
    const dto = mirrorSf.statements.find(n => ts.isTypeAliasDeclaration(n) && n.name.text === "TeamChannelMaterial");
    expect(dto).toBeDefined();
    const virtualPath = path.resolve(".offline-inventory-source-projection.ts");
    const text = `type BusinessIndustryCode = "automotive";
      type SqlResultRow = Record<string, unknown>;
      const bool = (v: unknown): boolean => v === true || v === 1 || v === "1";
      const text = (v: unknown): string | null => v == null ? null : String(v);
      const fail = (code: string, message: string): never => { throw new Error(code + message); };
      const businessIndustryCodeSchema = { safeParse: (v: unknown): { success: true; data: BusinessIndustryCode } | { success: false } => v === "automotive" ? { success: true, data: v } : { success: false } };
      ${dto!.getText(mirrorSf)}
      ${mirrorProjection}`;
    const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, strict: true, noEmit: true, skipLibCheck: true, types: [] };
    const host = ts.createCompilerHost(options);
    const originalGetSourceFile = host.getSourceFile;
    host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => name === virtualPath ? ts.createSourceFile(name, text, languageVersion, true) : originalGetSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
    const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([virtualPath], options, host));
    expect(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n"))).toEqual([]);
  });
});

for (const [label, project] of projectors) describe(label, () => {
  it("projects only positive safe channel id and literal authorized name", () => {
    const name = "  Literal %_'客户名称  ";
    const dto = project(row({ companyChannelId: "22", authorizedChannelName: name }), false, false);
    expect(dto.channelSource).toEqual({ id: 22, name });
    expect(Object.keys(dto.channelSource).sort()).toEqual(["id", "name"]);
    for (const key of ["phone", "contactName", "responsibleUserId", "notes", "authorizedChannelName", "companyChannelId"]) expect(dto).not.toHaveProperty(key);
  });
  it.each([false, 0, "0", undefined, null])("denies source when final canViewSource is %s", flag => {
    expect(project(row({ canViewSource: flag }), true, true).channelSource).toBeNull();
  });
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, "bad-id", "1.5", "", null, undefined])("denies invalid source id %s", id => {
    expect(project(row({ companyChannelId: id }), true, true).channelSource).toBeNull();
  });
  it.each(["", " \t\n", undefined, null, 123, { name: "object" }])("denies blank/non-string authorized name %j", name => {
    expect(project(row({ authorizedChannelName: name }), true, true).channelSource).toBeNull();
  });
  it("never infers a name from raw customer/channel fields or fake old DTO fields", () => {
    expect(project(row({ authorizedChannelName: undefined, companyName: "PRIVATE-COMPANY", channelName: "PRIVATE-CHANNEL", channelSource: { id: 99, name: "UNTRUSTED-DTOS" }, company: { id: 88, name: "UNTRUSTED-CUSTOMER" } }), false, false).channelSource).toBeNull();
  });
  it.each([false, true])("keeps original owner/effective-leader AND write gate (write=%s)", canWrite => {
    for (const isMine of [false, true]) for (const leader of [false, true]) {
      const result = project(row({ isMine }), canWrite, leader);
      expect(result.canEdit).toBe((isMine || leader) && canWrite);
      expect(result.readOnly).toBe(!result.canEdit);
      expect(result.canDelete).toBe(result.canEdit);
    }
  });
});

describe("actual service with fake SQL/authority/CRM dependencies (not real-service integration)", () => {
  it("uses guarded CASE with locked source eligibility and no added SQL/helper calls", async () => {
    const data = [row(), row({ id: 102 }), row({ id: 103 })];
    const before = harness({ original: true, rows: data });
    const after = harness({ rows: data });
    const oldResult = await before.service.listTeamMaterials(currentScope, { page: 1, pageSize: 50 });
    const newResult = await after.service.listTeamMaterials(currentScope, { page: 1, pageSize: 50 });
    expect(after.queries).toHaveLength(before.queries.length);
    expect(after.queries).toHaveLength(2);
    expect(after.linkedCompany.mock.calls).toHaveLength(before.linkedCompany.mock.calls.length);
    expect(after.linkedCompany).toHaveBeenCalledTimes(3); // pre-existing per-row helper, no new source queries
    expect(after.queries[1]).toMatch(/CASE WHEN \(SYNTHETIC_SOURCE_ELIGIBILITY\) THEN c\.name ELSE NULL END AS authorizedChannelName/);
    expect(after.queries[1]).toContain("AS canViewSource");
    expect(after.teamMaterialSourceEligibility.mock.calls.every((args: any[]) => args[1] === true)).toBe(true);
    newResult.items.forEach((item: Row, index: number) => {
      expect({ ...item, channelSource: null }).toEqual(oldResult.items[index]);
      expect(item.channelSource).toEqual({ id: 22, name: "真实渠道" });
    });
  });
  it("linked readable customer matches unchanged getter semantics, not stale c.name", async () => {
    const h = harness({ rows: [row({ authorizedChannelName: "STALE-CHANNEL", rawChannelName: "STALE-CHANNEL" })], company: { linked: true, customer: { id: 700, name: "当前授权客户名称", industryCode: "automotive", phone: "PRIVATE-CRM-PHONE", notes: "PRIVATE-CRM-NOTES" } } });
    const result = await h.service.listTeamMaterials(currentScope, { page: 1, pageSize: 50 });
    const source = await h.getter(currentScope, { materialId: 101 });
    expect(result.items[0].channelSource).toEqual({ id: 22, name: source.name });
    expect(source.name).toBe("当前授权客户名称");
    expect(JSON.stringify(result.items[0].channelSource)).not.toMatch(/STALE|PRIVATE|700/);
  });
  it("unlinked authorized c.name matches unchanged getter literal", async () => {
    const name = "Literal Channel %_ '";
    const h = harness({ rows: [row({ authorizedChannelName: name })] });
    const result = await h.service.listTeamMaterials(currentScope, { page: 1, pageSize: 50 });
    expect(result.items[0].channelSource).toEqual({ id: 22, name: (await h.getter(currentScope, { materialId: 101 })).name });
  });
  it("linked CRM denied narrows final visibility to false and never falls back to channel/company", async () => {
    const h = harness({ rows: [row({ companyName: "PRIVATE-COMPANY", authorizedChannelName: "STALE-PRIVATE-CHANNEL" })], company: { linked: true, customer: null }, write: true, leader: true });
    const result = await h.service.listTeamMaterials(currentScope, { page: 1, pageSize: 50 });
    expect(result.items[0]).toMatchObject({ canViewSource: false, channelSource: null, company: null, canViewUploadBatch: false });
    expect(h.data[0].authorizedChannelName).toBeNull();
    await expect(h.getter(currentScope, { materialId: 101 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("linked permitted customer cannot revive an initially denied source", async () => {
    const h = harness({ rows: [row({ canViewSource: false })], company: { linked: true, customer: { id: 700, name: "CRM-READABLE-NOT-SOURCE-READABLE" } } });
    const result = await h.service.listTeamMaterials(currentScope, { page: 1, pageSize: 50 });
    expect(result.items[0]).toMatchObject({ canViewSource: false, channelSource: null, company: null, canEdit: false });
    expect(h.data[0].authorizedChannelName).toBeNull();
  });
  it("preserves sourceReader versus effective leader: official read bridge does not create edit permission", async () => {
    const h = harness({ write: true, leader: false, sourceReader: true });
    const result = await h.service.listTeamMaterials({ ...currentScope, officialActor: { inventoryPermissions: { note: false } } }, { page: 1, pageSize: 50 });
    expect(result).toMatchObject({ canWrite: true, canFilterSource: true });
    expect(result.items[0]).toMatchObject({ canEdit: false, readOnly: true, canDelete: false, canAddNote: false });
  });
  it.each([null, -1, Number.NaN, 1.5])("retains actual strict count guard for %s", async total => {
    const h = harness({ total });
    await expect(h.service.listTeamMaterials(currentScope, { page: 1, pageSize: 50 })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
  it("rejects unknown filter fields before any synthetic DB query", async () => {
    const h = harness();
    await expect(h.service.listTeamMaterials(currentScope, { page: 1, pageSize: 50, sourceName: "invented" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(h.queries).toHaveLength(0);
  });
  it("keeps scope mismatch guard before any synthetic DB query", async () => {
    const h = harness();
    await expect(h.service.listTeamMaterials(currentScope, { page: 1, pageSize: 50, expectedActorUserId: 20 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.queries).toHaveLength(0);
  });
  it("mirror three-logical-delta also projects authorized linked names in fake service", async () => {
    const h = harness({ mirror: true, company: { linked: true, customer: { id: 700, name: "镜像授权客户" } } });
    const result = await h.service.listTeamMaterials(currentScope, { page: 1, pageSize: 50 });
    expect(result.items[0].channelSource).toEqual({ id: 22, name: "镜像授权客户" });
  });
});
