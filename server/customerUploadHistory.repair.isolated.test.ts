import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { randomUUID, createHash } from "node:crypto";
import type { DatabaseSync as Sqlite } from "node:sqlite";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
// The mirror omits the unrelated .mjs CRM writer adapter. Execute ONLY the actual
// checked-in policy declarations. No native database/environment/secrets ever used.
vi.mock("../client/src/business/platform/front-router-types/server/db", () => ({ getDb: () => { throw new Error("REAL_DATABASE_FORBIDDEN"); } }));
vi.mock("../client/src/business/platform/front-router-types/server/services/crmCustomers", async () => {
  const { readFileSync } = await import("node:fs"); const { default: ts } = await import("typescript");
  const { sql } = await import("drizzle-orm"); const { TRPCError } = await import("@trpc/server");
  const { resolveBusinessModuleAccess } = await import("../client/src/business/platform/front-router-types/server/services/businessModuleAccess");
  const url = new URL("../client/src/business/platform/front-router-types/server/services/crmCustomers.ts", import.meta.url);
  const source = ts.createSourceFile(url.pathname, readFileSync(url, "utf8"), ts.ScriptTarget.Latest, true);
  const names = ["resolveCrmCustomerPolicy", "crmCustomerPolicyWhere", "assertCrmCustomerPolicy", "resultRows"];
  const declarations = source.statements.filter(n => ts.isFunctionDeclaration(n) && n.name && names.includes(n.name.text));
  if (declarations.length !== 4) throw new Error("NATIVE_CRM_POLICY_CHANGED");
  const code = ts.transpileModule(declarations.map(n => n.getText(source)).join("\n"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function("sql", "TRPCError", "resolveBusinessModuleAccess", `const exports={}; ${code}; return exports;`)(sql, TRPCError, resolveBusinessModuleAccess);
});
vi.mock("../client/src/business/platform/front-router-types/server/services/channelFactoryPublication", () => ({ factoryMaterialPublicationMetadata: async () => new Map(), createChannelFactoryPublicationService: vi.fn() }));
import { createCustomerUploadHistoryService, assertCustomerUploadSourceRefs, customerUploadCsvCell } from "../client/src/business/platform/front-router-types/server/services/customerUploadHistory";
import { resolveCustomerUploadHistoryPolicy } from "../client/src/business/platform/front-router-types/server/services/customerUploadHistoryPolicy";
import { createCustomerSupplyService } from "../client/src/business/platform/front-router-types/server/services/customerSupply";
import { inspectCustomerUploadFile } from "../client/src/business/platform/front-router-types/server/services/customerUploadPrivateStorage";
import { channelInventoryPayloadHash, type ChannelInventoryScope, type SqlDatabase, type SqlExecutor, type RegisterTeamRecord } from "../client/src/business/platform/front-router-types/server/services/channelInventory";
import { CUSTOMER_UPLOAD_HISTORY_INPUT_SCHEMAS, customerUploadPrepareConfirmationSchema, type CustomerUploadPrepareConfirmationInput, type ResultRow, type SourceRef } from "../client/src/business/platform/shared/customerUploadHistory";
import * as XLSX from "xlsx";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
const dialect = new MySqlDialect();
const scope = (actorUserId = 10): ChannelInventoryScope => ({ enterpriseId: 1, dataOwnerUserId: 99, actorUserId, isOwner: actorUserId === 99, inventoryDataScope: "enterprise", permissionSnapshot: true });
const expected = (actor = 10) => ({ expectedEnterpriseId: 1, expectedActorUserId: actor });
const inputFile = { fileName: "原表.csv", mimeType: "text/csv", base64: Buffer.from("A,TI,2\nB,ST,3\n").toString("base64") };
let sqlite: Sqlite; let db: SqlDatabase; let tx: SqlExecutor; let service: ReturnType<typeof createCustomerUploadHistoryService>;
let queries: { sql: string; params: unknown[] }[]; let files: Map<string, Buffer>; let reads: number; let failSql: RegExp | null; let commits: number; let rollbacks: number;
const register: RegisterTeamRecord = async (executor, record) => {
  const { sql } = await import("drizzle-orm");
  await executor.execute(sql`INSERT INTO enterprise_team_record_assignments (enterpriseId,recordType,recordId,currentOwnerUserId,createdByUserId,teamId,revision)
    VALUES (${record.enterpriseId},${record.recordType},${record.recordKey},${record.currentOwnerUserId},${record.actorUserId},7,1)`);
};
const count = (name: string) => Number(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get()!.n);
const build = () => createCustomerUploadHistoryService({ getDb: async () => db, registerTeamRecord: register, storage: {
  put: async file => { const inspected = inspectCustomerUploadFile(file); const locator = randomUUID(); const bytes = Buffer.from(file.base64, "base64"); files.set(locator, bytes);
    return { locator, fileName: file.fileName, mimeType: file.mimeType, byteSize: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), manifest: inspected.manifest }; },
  read: async locator => { reads++; const bytes = files.get(locator); if (!bytes) throw new Error("/SECRET/private/locator"); return bytes; },
} });
beforeEach(() => {
  sqlite = new DatabaseSync(":memory:"); queries = []; files = new Map(); reads = 0; failSql = null; commits = 0; rollbacks = 0;
  sqlite.exec(`
    CREATE TABLE enterprises (id INTEGER,superAdminUserId INTEGER,crmDataOwnerUserId INTEGER);
    CREATE TABLE users (id INTEGER,loginDisabled INTEGER);
    CREATE TABLE enterprise_members (id INTEGER,enterpriseId INTEGER,userId INTEGER,role TEXT,status TEXT);
    CREATE TABLE enterprise_member_permissions (enterpriseMemberId INTEGER,permissionKey TEXT);
    CREATE TABLE enterprise_teams (id INTEGER,enterpriseId INTEGER,status TEXT);
    CREATE TABLE enterprise_team_members (id INTEGER,enterpriseId INTEGER,teamId INTEGER,userId INTEGER,teamRole TEXT);
    CREATE TABLE enterprise_member_module_access (id INTEGER,enterpriseId INTEGER,userId INTEGER,module TEXT,readAllowed INTEGER,writeAllowed INTEGER,dataScope TEXT,revision INTEGER);
    CREATE TABLE enterprise_team_record_assignments (id INTEGER PRIMARY KEY AUTOINCREMENT,enterpriseId INTEGER,recordType TEXT,recordId INTEGER,currentOwnerUserId INTEGER,createdByUserId INTEGER,teamId INTEGER,revision INTEGER);
    CREATE TABLE channel_inventory_channels (id INTEGER PRIMARY KEY AUTOINCREMENT,enterprise_id INTEGER,data_owner_user_id INTEGER,responsible_user_id INTEGER,name TEXT,industryCode TEXT,channel_type TEXT,contact_name TEXT,phone TEXT,wechat TEXT,qq TEXT,notes TEXT,active INTEGER,revision INTEGER,create_request_id TEXT UNIQUE,create_payload_hash TEXT,created_at TEXT DEFAULT '2026-11-15T12:00:00.000Z',updated_at TEXT);
    CREATE TABLE channel_inventory_materials (id INTEGER PRIMARY KEY AUTOINCREMENT,enterprise_id INTEGER,data_owner_user_id INTEGER,responsible_user_id INTEGER,channel_id INTEGER,part_number TEXT,brand TEXT,qty INTEGER,date_code TEXT,price TEXT,currency TEXT,tax_included INTEGER,lead_time TEXT,note TEXT,revision INTEGER,create_request_id TEXT UNIQUE,create_payload_hash TEXT,created_at TEXT DEFAULT '2026-11-15T12:00:00.000Z',updated_at TEXT);
    CREATE TABLE channel_inventory_material_shares (enterprise_id INTEGER,material_id INTEGER,enabled INTEGER,owner_user_id INTEGER,share_team_id INTEGER,assignment_revision INTEGER,owner_membership_id INTEGER,revision INTEGER);
    CREATE TABLE channel_inventory_material_share_audits (enterprise_id INTEGER,material_id INTEGER,actor_user_id INTEGER,request_id TEXT,payload_hash TEXT,before_data TEXT,after_data TEXT);
    CREATE TABLE channel_inventory_material_management (enterprise_id INTEGER,material_id INTEGER,deleted_at TEXT);
    CREATE TABLE channel_inventory_upload_batches (id INTEGER PRIMARY KEY AUTOINCREMENT,enterprise_id INTEGER,data_owner_user_id INTEGER,channel_id INTEGER,uploaded_by_user_id INTEGER,team_id INTEGER,owner_membership_id INTEGER,uploaded_by_admin_account_id INTEGER,batch_code TEXT UNIQUE,file_name TEXT,total_rows INTEGER,revision INTEGER DEFAULT 1,archived INTEGER DEFAULT 0,closed INTEGER DEFAULT 0);
    CREATE TABLE channel_inventory_upload_batch_materials (enterprise_id INTEGER,batch_id INTEGER,material_id INTEGER,initial_revision INTEGER,initial_channel_id INTEGER,initial_owner_user_id INTEGER,initial_assignment_id INTEGER,initial_assignment_revision INTEGER,initial_team_id INTEGER,initial_membership_id INTEGER,initial_share_revision INTEGER);
    CREATE TABLE channel_inventory_management_requests (enterprise_id INTEGER,data_owner_user_id INTEGER,actor_user_id INTEGER,request_id TEXT,action TEXT,payload_hash TEXT,result_data TEXT);
    CREATE TABLE channel_inventory_collaboration_notes (enterpriseId INTEGER,materialId INTEGER);
    CREATE TABLE channel_inventory_notes (enterpriseId INTEGER,materialId INTEGER);
    CREATE TABLE channel_inventory_manual_references (enterpriseId INTEGER,dataOwnerUserId INTEGER,materialId INTEGER,manualReferenceLcsc TEXT,manualReferenceIckey TEXT,updatedByUserId INTEGER,updatedByAdminAccountId INTEGER,updatedAt TEXT);
    CREATE TABLE crm_customers (id INTEGER,enterpriseId INTEGER,assignedUserId INTEGER,name TEXT,industryCode TEXT,version INTEGER,archivedAt TEXT);
    CREATE TABLE crm_customer_supply_channels (enterpriseId INTEGER,dataOwnerUserId INTEGER,customerId INTEGER,inventoryResponsibleUserId INTEGER,channelId INTEGER,customerVersionAtBind INTEGER,firstRequestId TEXT,schemaVersion INTEGER);
    CREATE TABLE crm_customer_contact_primary (enterpriseId INTEGER,customerId INTEGER,primaryContactId TEXT,legacyContactPresent INTEGER);
    CREATE TABLE crm_customer_contacts (customerId INTEGER,contactName TEXT,phone TEXT,isPrimary INTEGER);
    CREATE TABLE customer_upload_histories (history_id TEXT PRIMARY KEY,enterprise_id INTEGER,data_owner_user_id INTEGER,customer_id INTEGER,mode TEXT,state TEXT,revision INTEGER,uploaded_by_user_id INTEGER,uploaded_by_admin_account_id INTEGER,original_file_id TEXT,latest_version_id TEXT DEFAULT NULL,latest_version_no INTEGER,last_reason TEXT,created_at TEXT DEFAULT '2026-11-15T12:00:00.000Z',updated_at TEXT);
    CREATE TABLE customer_upload_files (file_id TEXT PRIMARY KEY,enterprise_id INTEGER,data_owner_user_id INTEGER,customer_id INTEGER,history_id TEXT,kind TEXT,locator TEXT,file_name TEXT,mime_type TEXT,byte_size INTEGER,sha256 TEXT,original_manifest TEXT,created_at TEXT DEFAULT '2026-11-15T12:00:00.000Z');
    CREATE TABLE customer_upload_versions (version_id TEXT PRIMARY KEY,enterprise_id INTEGER,data_owner_user_id INTEGER,customer_id INTEGER,history_id TEXT,version_no INTEGER,parent_version_id TEXT,normalized_file_id TEXT,issues_file_id TEXT,rows_data TEXT,issues_data TEXT,uploaded_by_user_id INTEGER,uploaded_by_admin_account_id INTEGER,created_at TEXT DEFAULT '2026-11-15T12:00:00.000Z',UNIQUE(history_id,version_no));
    CREATE TABLE customer_upload_confirmations (confirmation_id TEXT PRIMARY KEY,enterprise_id INTEGER,data_owner_user_id INTEGER,customer_id INTEGER,history_id TEXT UNIQUE,actor_user_id INTEGER,batch_request_id TEXT,frozen_data TEXT,receipts_data TEXT,remaining_material_count INTEGER,created_at TEXT DEFAULT '2026-11-15T12:00:00.000Z',UNIQUE(enterprise_id,actor_user_id,batch_request_id));
    CREATE TABLE customer_upload_requests (enterprise_id INTEGER,data_owner_user_id INTEGER,actor_user_id INTEGER,request_id TEXT,operation TEXT,history_id TEXT,payload_hash TEXT,result_data TEXT,created_at TEXT DEFAULT '2026-11-15T12:00:00.000Z',PRIMARY KEY(enterprise_id,actor_user_id,request_id));
    INSERT INTO enterprises VALUES (1,99,99),(2,199,199);
    INSERT INTO users VALUES (10,0),(20,0),(30,0),(40,0),(50,0),(99,0);
    INSERT INTO enterprise_members VALUES (1,1,10,'staff','active'),(2,1,20,'staff','active'),(3,1,30,'admin','active'),(4,1,40,'admin','active'),(5,1,50,'staff','active'),(6,1,99,'super_admin','active');
    INSERT INTO enterprise_member_permissions VALUES (1,'inventory.manage'),(1,'customers.manage'),(2,'inventory.manage'),(2,'customers.manage'),(3,'inventory.manage'),(3,'customers.manage'),(3,'customers.manage_all'),(4,'inventory.manage'),(4,'customers.manage'),(5,'inventory.manage'),(5,'customers.manage');
    INSERT INTO enterprise_teams VALUES (7,1,'active'),(8,1,'active');
    INSERT INTO enterprise_team_members VALUES (11,1,7,10,'member'),(12,1,7,20,'leader'),(13,1,7,30,'member'),(14,1,7,40,'member'),(15,1,8,50,'leader');
    INSERT INTO enterprise_member_module_access VALUES (1,1,10,'stocks',1,1,'team',1),(2,1,10,'customers',1,1,'self',1),(3,1,10,'channels',1,1,'self',1),(4,1,20,'stocks',1,1,'team',1),(5,1,20,'customers',1,1,'team',1),(6,1,30,'customers',1,1,'enterprise',1),(7,1,30,'stocks',1,1,'team',1),(8,1,40,'stocks',1,1,'team',1),(9,1,40,'customers',1,1,'team',1),(10,1,50,'stocks',1,1,'team',1),(11,1,50,'customers',1,1,'team',1);
    INSERT INTO crm_customers VALUES (1,1,10,'客户甲','automotive',3,NULL),(2,1,10,'客户乙','automotive',2,NULL),(3,1,40,'隐藏客户','automotive',1,NULL),(4,2,10,'外企客户','automotive',1,NULL);
    INSERT INTO enterprise_team_record_assignments (enterpriseId,recordType,recordId,currentOwnerUserId,createdByUserId,teamId,revision) VALUES (1,'customer',1,10,10,7,1),(1,'customer',2,10,10,7,1),(1,'customer',3,40,40,7,1);
  `);
  tx = { execute: async (query: SQL) => {
    const compiled = dialect.sqlToQuery(query); queries.push(compiled);
    if (failSql?.test(compiled.sql)) throw new Error("PRIVATE /SECRET/SQL/locator");
    const executable = compiled.sql.replace(/\s+FOR UPDATE\b/g, "").replace(/CURRENT_TIMESTAMP\(3\)/g, "CURRENT_TIMESTAMP").replace(/BINARY /g, "");
    const params = compiled.params.map(v => v instanceof Date ? v.toISOString() : typeof v === "boolean" ? Number(v) : v) as never[];
    try {
      const statement = sqlite.prepare(executable);
      if (/^\s*SELECT\b/.test(executable)) return [statement.all(...params)];
      if (!/^\s*(INSERT|UPDATE)\b/.test(executable)) throw new Error("UNEXPECTED_DML");
      const result = statement.run(...params); return [{ affectedRows: Number(result.changes), insertId: Number(result.lastInsertRowid) }];
    } catch (error) { console.error("OFFLINE_SQL_FAILURE", executable, (error as Error).message); throw error; }
  } };
  db = { execute: tx.execute, transaction: async fn => { sqlite.exec("BEGIN"); try { const result = await fn(tx); sqlite.exec("COMMIT"); commits++; return result; } catch (e) { sqlite.exec("ROLLBACK"); rollbacks++; throw e; } } };
  service = build();
});
afterEach(() => sqlite.close());
const original = (mode: "parse" | "standard" = "parse", requestId = randomUUID()) => service.customerUploadOriginal(scope(), { ...expected(), customerId: 1, expectedCustomerVersion: 3, mode, file: inputFile, requestId });
async function get(historyId: string, actor = 10, versionId?: string) { return service.customerUploadHistoryGet(scope(actor), { ...expected(actor), historyId, ...(versionId ? { versionId } : {}) }); }
const candidate = { partNumber: "A", brand: "TI", qty: 2, price: "0.000000000001", currency: "CNY", taxIncluded: null, dateCode: null, leadTime: null, note: null };
async function result(historyId: string) {
  const current = await get(historyId); const s = current.originalSheets[0];
  const rows: ResultRow[] = s.rows.map(r => ({ rowId: randomUUID(), logicalRowId: randomUUID(), sourceRefs: [{ sheetIndex: s.sheetIndex, sheetName: s.sheetName, rowNumber: r.rowNumber, originalRowHash: r.originalRowHash }], candidate: { ...candidate }, disposition: "pending", excludeReason: null, issues: [] }));
  return service.customerUploadResult(scope(20), { ...expected(20), historyId, expectedRevision: current.history.revision, requestId: randomUUID(), parentVersionId: current.history.latestVersionId, normalizedFile: inputFile, rows, issues: [] });
}
async function prepare(historyId: string, override: Partial<CustomerUploadPrepareConfirmationInput> = {}) {
  const current = await get(historyId);
  const refs = current.originalSheets[0].rows.map(r => ({ sheetIndex: 0, sheetName: current.originalSheets[0].sheetName, rowNumber: r.rowNumber, originalRowHash: r.originalRowHash }));
  const rows = current.selectedVersion?.rows ?? refs.map(ref => ({ rowId: randomUUID(), logicalRowId: randomUUID(), sourceRefs: [ref], candidate }));
  const input: CustomerUploadPrepareConfirmationInput = { ...expected(), historyId, expectedRevision: current.history.revision, requestId: randomUUID(), batchRequestId: randomUUID(), expectedCustomerVersion: 3, sourceProfile: { type: "trade" }, ...(current.history.latestVersionId ? { versionId: current.history.latestVersionId } : {}), confirmedRows: rows.map(r => ({ logicalRowId: r.logicalRowId, rowId: r.rowId, rowRequestId: randomUUID(), sourceRefs: r.sourceRefs, fields: r.candidate })), excludedRows: [], ...override };
  return { input, output: await service.customerUploadPrepareConfirmation(scope(), input) };
}
const reconcile = (historyId: string, confirmationId: string) => service.customerUploadReconcileBatch(scope(), { ...expected(), historyId, confirmationId, requestId: randomUUID() });
/** channelId is queue mapping evidence, not an accepted field in the original strict create schema. */
const formalPayload = (entry: Awaited<ReturnType<typeof prepare>>["output"]["entries"][number]) => {
  const { channelId: _channelId, ...payload } = entry.payload;
  return payload;
};

import { customerUploadRepairPrepareConfirmationSchema, type CustomerUploadRepairPrepareConfirmationInput } from "../client/src/business/platform/shared/customerUploadHistory";
import { createChannelInventoryService } from "../client/src/business/platform/front-router-types/server/services/channelInventory";
const supply = () => createCustomerSupplyService({ getDb: async () => db, registerTeamRecord: register });
const frozenBytes = () => sqlite.prepare("SELECT frozen_data FROM customer_upload_confirmations").get()!.frozen_data;
async function withProblem(mode: "standard" | "parse" = "parse", reason = "跳过问题行：品牌不完整") {
  const a = await original(mode); if (mode === "parse") await result(a.history.historyId);
  const current = await get(a.history.historyId); const s = current.originalSheets[0];
  const source = current.selectedVersion?.rows ?? s.rows.map(r => ({ rowId: randomUUID(), logicalRowId: randomUUID(), sourceRefs: [{ sheetIndex: s.sheetIndex, sheetName: s.sheetName, rowNumber: r.rowNumber, originalRowHash: r.originalRowHash }], candidate }));
  const p = await prepare(a.history.historyId, { confirmedRows: [{ logicalRowId: source[0].logicalRowId, rowId: source[0].rowId, rowRequestId: randomUUID(), sourceRefs: source[0].sourceRefs, fields: candidate }], excludedRows: [{ logicalRowId: source[1].logicalRowId, reason, sourceRefs: source[1].sourceRefs }] });
  return { a, p, problem: source[1] };
}
async function repairInput(f: Awaited<ReturnType<typeof withProblem>>): Promise<CustomerUploadRepairPrepareConfirmationInput> {
  const g = await get(f.a.history.historyId);
  return { ...expected(), historyId: g.history.historyId, confirmationId: f.p.output.confirmationId, expectedRevision: g.history.revision, expectedBatchRevision: g.history.uploadBatch!.revision, expectedCustomerVersion: 3, requestId: randomUUID(), rows: [{ logicalRowId: f.problem.logicalRowId, rowRequestId: randomUUID(), fields: { ...candidate, partNumber: "B", brand: "ST", qty: 3 }, sourceRefs: f.problem.sourceRefs }] };
}
const repair = (input: CustomerUploadRepairPrepareConfirmationInput, actor = 10) => service.customerUploadRepairPrepareConfirmation(scope(actor), input);

describe("same-batch skipped-problem repair: isolated real native transactions", () => {
  it.each(["standard", "parse"] as const)("repairs %s after full original success in the same batch, preserving original frozen bytes", async mode => {
    const f = await withProblem(mode); const bytes = frozenBytes();
    await supply().createCustomerMaterial(scope(), formalPayload(f.p.output.entries[0]));
    const first = await reconcile(f.a.history.historyId, f.p.output.confirmationId);
    expect(first.history.state).toBe("imported"); expect(first.history.stats).toMatchObject({ successCount: 1, repairableCount: 1, failedCount: 0 });
    const input = await repairInput(f); const output = await repair(input);
    expect(output.batch).toMatchObject({ id: f.p.output.batch.id, batchCode: f.p.output.batch.batchCode, channelId: f.p.output.batch.channelId, revision: input.expectedBatchRevision + 1 });
    expect(output.entries).toHaveLength(1); expect(output.entries[0].sourceRefs).toEqual(f.problem.sourceRefs);
    expect(sqlite.prepare("SELECT total_rows FROM channel_inventory_upload_batches").get()!.total_rows).toBe(2);
    expect(count("channel_inventory_materials")).toBe(1); expect(frozenBytes()).toBe(bytes);
    const persisted = sqlite.prepare("SELECT result_data FROM customer_upload_requests WHERE operation='repair_prepare'").get()!;
    expect(JSON.parse(String(persisted.result_data)).entries[0].sourceRowKeys).toEqual(["0:2"]);
    service = build(); const restored = await get(f.a.history.historyId);
    expect(restored.confirmation!.entries).toHaveLength(2); expect(restored.confirmation!.excludedRows).toEqual([]);
    expect(restored.history.stats).toMatchObject({ repairableCount: 0, pendingCount: 1, successCount: 1 });
    expect((await repair(input)).entries[0].rowRequestId).toBe(input.rows[0].rowRequestId);
    const created = await supply().createCustomerMaterial(scope(), formalPayload(output.entries[0]));
    const final = await reconcile(f.a.history.historyId, f.p.output.confirmationId);
    expect(final.history.state).toBe("imported"); expect(final.history.stats).toMatchObject({ successCount: 2, unknownCount: 0, repairableCount: 0, remainingMaterialCount: 2 });
    expect(final.entries.find(e => e.rowRequestId === input.rows[0].rowRequestId)?.receipt).toMatchObject({ materialId: created.item.id, uploadBatchId: output.batch.id, status: "success" });
    expect(frozenBytes()).toBe(bytes); expect(count("customer_upload_confirmations")).toBe(1); expect(count("channel_inventory_upload_batches")).toBe(1);
  });
  it("keeps unresolved repair unknown and permits ONLY original rowRequestId/payload replay, never second prepare", async () => {
    const f = await withProblem(); const input = await repairInput(f); const output = await repair(input); const bytes = frozenBytes();
    await reconcile(f.a.history.historyId, f.p.output.confirmationId); service = build();
    expect((await repair(input)).entries[0]).toMatchObject({ status: "unknown", rowRequestId: input.rows[0].rowRequestId });
    await expect(repair(await repairInput(f))).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(supply().createCustomerMaterial(scope(), { ...formalPayload(output.entries[0]), brand: "edited-after-prepare" })).rejects.toMatchObject({ code: "CONFLICT" });
    await supply().createCustomerMaterial(scope(), formalPayload(output.entries[0])); await supply().createCustomerMaterial(scope(), formalPayload(output.entries[0]));
    expect(count("channel_inventory_materials")).toBe(1);
    const after = await reconcile(f.a.history.historyId, f.p.output.confirmationId); expect(after.entries.find(e => e.rowRequestId === input.rows[0].rowRequestId)?.status).toBe("success"); expect(frozenBytes()).toBe(bytes);
  });
  it("reserves capacity for mapped rows at every formal entry, including omission/change of batch or native create", async () => {
    const f = await withProblem(); const output = await repair(await repairInput(f)); const payload = formalPayload(output.entries[0]);
    await expect(supply().createCustomerMaterial(scope(), { ...payload, requestId: randomUUID() })).rejects.toMatchObject({ code: "CONFLICT" });
    const { uploadBatchId: _batch, ...withoutBatch } = payload;
    await expect(supply().createCustomerMaterial(scope(), withoutBatch)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(supply().createCustomerMaterial(scope(), { ...payload, uploadBatchId: 900 })).rejects.toMatchObject({ code: "CONFLICT" });
    const { customerId: _customer, expectedCustomerVersion: _version, expectedActorUserId: _actor, expectedEnterpriseId: _enterprise, ...native } = payload;
    await expect(createChannelInventoryService({ getDb: async () => db, registerTeamRecord: register }).createMaterial(scope(), { ...native, channelId: output.batch.channelId })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(count("channel_inventory_materials")).toBe(0);
    await supply().createCustomerMaterial(scope(), payload); expect(count("channel_inventory_materials")).toBe(1);
  });
  it.each(["pending", "unknown", "success"])("cannot turn %s canonical identity into a new repair request", async status => {
    const f = await withProblem(); const entry = f.p.output.entries[0];
    if (status === "success") await supply().createCustomerMaterial(scope(), formalPayload(entry));
    if (status !== "pending") await reconcile(f.a.history.historyId, f.p.output.confirmationId);
    const input = await repairInput(f); input.rows[0].logicalRowId = entry.logicalRowId;
    await expect(repair(input)).rejects.toMatchObject({ code: "CONFLICT" }); expect(sqlite.prepare("SELECT total_rows FROM channel_inventory_upload_batches").get()!.total_rows).toBe(1);
  });
  it.each(["表头不入库", "明确排除其他工作表", "跳过问题行："])("rejects normal or ambiguous excluded reason: %s", async reason => {
    const f = await withProblem("parse", reason);
    await expect(repair(await repairInput(f))).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await get(f.a.history.historyId)).history.stats.repairableCount).toBe(0);
  });
  it("rejects excluded/canonical physical-row overlap even if cellRange differs", async () => {
    const a = await original("standard"); const g = await get(a.history.historyId); const s = g.originalSheets[0]; const r = s.rows[0];
    const ref = { sheetIndex: s.sheetIndex, sheetName: s.sheetName, rowNumber: r.rowNumber, originalRowHash: r.originalRowHash };
    const logicalRowId = randomUUID(); const p = await prepare(a.history.historyId, { confirmedRows: [{ logicalRowId: randomUUID(), rowId: randomUUID(), rowRequestId: randomUUID(), sourceRefs: [{ ...ref, cellRange: "A1" }], fields: candidate }], excludedRows: [{ logicalRowId, reason: "跳过问题行：品牌", sourceRefs: [{ ...ref, cellRange: "B1" }] }] });
    const current = await get(a.history.historyId); const bytes = frozenBytes();
    await expect(repair({ ...expected(), historyId: a.history.historyId, confirmationId: p.output.confirmationId, expectedRevision: current.history.revision, expectedBatchRevision: 1, expectedCustomerVersion: 3, requestId: randomUUID(), rows: [{ logicalRowId, rowRequestId: randomUUID(), fields: candidate }] })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("重叠") });
    expect(count("channel_inventory_materials")).toBe(0); expect(frozenBytes()).toBe(bytes);
  });
  it("rejects incomplete frozen refs and caller-supplied replacement sources", async () => {
    const f = await withProblem(); const input = await repairInput(f); input.rows[0].sourceRefs = f.p.input.confirmedRows[0].sourceRefs;
    await expect(repair(input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Offline corruption only: absence never becomes definitive failure or guessed identity.
    const frozen = JSON.parse(String(frozenBytes())); delete frozen.excludedRows[0].sourceRefs;
    sqlite.prepare("UPDATE customer_upload_confirmations SET frozen_data=?").run(JSON.stringify(frozen));
    const missing = await repairInput(f); delete missing.rows[0].sourceRefs;
    await expect(repair(missing)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" }); expect(count("channel_inventory_materials")).toBe(0);
  });
  it.each(["currency", "price", "brand", "qty"])("enforces original field validation without defaults: %s", async field => {
    const f = await withProblem(); const input = await repairInput(f);
    (input.rows[0].fields as Record<string, unknown>)[field] = field === "price" ? "bad" : field === "qty" ? -1 : null;
    await expect(repair(input)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(count("channel_inventory_materials")).toBe(0);
  });
  it.each(["history revision", "batch revision", "customer revision"])("uses real independent CAS: %s", async cas => {
    const f = await withProblem(); const input = await repairInput(f);
    if (cas === "history revision") input.expectedRevision++;
    if (cas === "batch revision") input.expectedBatchRevision++;
    if (cas === "customer revision") sqlite.exec("UPDATE crm_customers SET version=4 WHERE id=1");
    await expect(repair(input)).rejects.toMatchObject({ code: "CONFLICT" }); expect(sqlite.prepare("SELECT total_rows FROM channel_inventory_upload_batches").get()!.total_rows).toBe(1);
  });
  it.each(["batch closed", "membership changed", "binding changed", "channel inactive", "write denied"])("rechecks current authority before new submission: %s", async fence => {
    const f = await withProblem(); const input = await repairInput(f); const output = await repair(input);
    if (fence === "batch closed") sqlite.exec("UPDATE channel_inventory_upload_batches SET closed=1");
    if (fence === "membership changed") sqlite.exec("UPDATE enterprise_team_members SET teamId=8 WHERE userId=10");
    if (fence === "binding changed") sqlite.exec("UPDATE crm_customer_supply_channels SET customerId=2");
    if (fence === "channel inactive") sqlite.exec("UPDATE channel_inventory_channels SET active=0");
    if (fence === "write denied") sqlite.exec("UPDATE enterprise_member_module_access SET writeAllowed=0 WHERE userId=10 AND module='stocks'");
    await expect(repair(input)).rejects.toBeDefined();
    await expect(supply().createCustomerMaterial(scope(), formalPayload(output.entries[0]))).rejects.toBeDefined();
    expect(count("channel_inventory_materials")).toBe(0);
  });
  it("never grants manager repair or accepts client receipts/scope overrides", async () => {
    const f = await withProblem(); const input = await repairInput(f);
    await expect(repair({ ...input, expectedActorUserId: 20 }, 20)).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const key of ["receipt", "dataOwnerUserId", "officialActor", "batchClosed"]) expect(customerUploadRepairPrepareConfirmationSchema.safeParse({ ...input, [key]: 1 }).success).toBe(false);
    await expect(repair({ ...input, rows: [{ ...input.rows[0], rowRequestId: f.p.output.entries[0].rowRequestId }] })).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it.each(["capacity CAS", "history CAS", "prepare record"])("rolls back source claims/capacity/mapping if %s persistence is uncertain", async phase => {
    const f = await withProblem(); const input = await repairInput(f); const countBefore = count("customer_upload_requests"); const bytes = frozenBytes();
    failSql = phase === "capacity CAS" ? /UPDATE channel_inventory_upload_batches SET total_rows/ : phase === "history CAS" ? /UPDATE customer_upload_histories/ : /INSERT INTO customer_upload_requests/;
    await expect(repair(input)).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(count("customer_upload_requests")).toBe(countBefore); expect(sqlite.prepare("SELECT total_rows FROM channel_inventory_upload_batches").get()!.total_rows).toBe(1); expect(frozenBytes()).toBe(bytes);
    failSql = null; const output = await repair(input); expect(output.entries[0].rowRequestId).toBe(input.rows[0].rowRequestId); expect(sqlite.prepare("SELECT total_rows FROM channel_inventory_upload_batches").get()!.total_rows).toBe(2);
  });
  it("cannot extend externally modified stale capacity", async () => {
    const f = await withProblem(); const input = await repairInput(f); const before = count("customer_upload_requests");
    sqlite.exec("UPDATE channel_inventory_upload_batches SET total_rows=999");
    await expect(repair(input)).rejects.toMatchObject({ code: "CONFLICT" }); expect(count("customer_upload_requests")).toBe(before);
  });
  it("requires exact creation audit/hash for repair receipt; deleted stock remains historically successful", async () => {
    const f = await withProblem(); const output = await repair(await repairInput(f)); const created = await supply().createCustomerMaterial(scope(), formalPayload(output.entries[0]));
    const audit = sqlite.prepare("SELECT payload_hash FROM channel_inventory_material_share_audits WHERE material_id=?").get(created.item.id)!;
    sqlite.prepare("UPDATE channel_inventory_material_share_audits SET payload_hash='forged' WHERE material_id=?").run(created.item.id);
    const bad = await reconcile(f.a.history.historyId, f.p.output.confirmationId); expect(bad.entries.find(e => e.rowRequestId === output.entries[0].rowRequestId)?.status).toBe("unknown");
    sqlite.prepare("UPDATE channel_inventory_material_share_audits SET payload_hash=? WHERE material_id=?").run(String(audit.payload_hash), created.item.id);
    const ok = await reconcile(f.a.history.historyId, f.p.output.confirmationId); expect(ok.entries.find(e => e.rowRequestId === output.entries[0].rowRequestId)?.status).toBe("success");
    sqlite.prepare("INSERT INTO channel_inventory_material_management VALUES(1,?,'2026-11-19')").run(created.item.id);
    const deleted = await reconcile(f.a.history.historyId, f.p.output.confirmationId); expect(deleted.history.stats).toMatchObject({ successCount: 1, remainingMaterialCount: 0, failedCount: 0, repairableCount: 0 });
  });
  it("exports validation problems and moves prepared unknown rows to original-request verification", async () => {
    const f = await withProblem(); const exported = await service.customerUploadProblemsExport(scope(), { ...expected(), historyId: f.a.history.historyId }); expect(exported.problemCount).toBe(1);
    await repair(await repairInput(f)); const after = await service.customerUploadProblemsExport(scope(), { ...expected(), historyId: f.a.history.historyId }); expect(after).toMatchObject({ problemCount: 0, verificationCount: 2, definitiveFailedCount: 0 });
  });
});
