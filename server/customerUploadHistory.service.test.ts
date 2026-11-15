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

describe("customer upload history: actual native helpers with isolated in-memory SQL", () => {
  it("parse persists independent original/history; no source/batch/material and same request replay", async () => {
    const requestId = randomUUID(); const first = await original("parse", requestId); const replay = await original("parse", requestId); const second = await original("parse");
    expect(first.history.state).toBe("pending_parse"); expect(first.submissionMessage).toBe("已提交，等待解析"); expect(replay.history.historyId).toBe(first.history.historyId); expect(replay.idempotent).toBe(true);
    expect(second.history.historyId).not.toBe(first.history.historyId); expect(count("customer_upload_histories")).toBe(2); expect(count("customer_upload_files")).toBe(2);
    for (const table of ["channel_inventory_channels", "channel_inventory_upload_batches", "channel_inventory_materials", "crm_customer_supply_channels"]) expect(count(table)).toBe(0);
    const serialized = JSON.stringify(await get(first.history.historyId)); expect(serialized).not.toMatch(/locator|\/SECRET|\/opt\/|storageProxy/);
  });
  it("request different payload/customer/mode conflicts without metadata or additional file", async () => {
    const requestId = randomUUID(); await original("parse", requestId);
    await expect(service.customerUploadOriginal(scope(), { ...expected(), customerId: 2, mode: "parse", file: inputFile, requestId })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(original("standard", requestId)).rejects.toMatchObject({ code: "CONFLICT" }); expect(count("customer_upload_files")).toBe(1);
  });
  it("ordinary peer/admin-role/former-leader denied; real current leader and manage_all allowed", async () => {
    const { history } = await original(); expect((await get(history.historyId, 20)).history.access).toBe("current_team_leader"); expect((await get(history.historyId, 30)).history.access).toBe("enterprise_manager");
    await expect(get(history.historyId, 40)).rejects.toMatchObject({ code: "NOT_FOUND" }); await expect(get(history.historyId, 50)).rejects.toMatchObject({ code: "NOT_FOUND" });
    sqlite.exec("UPDATE enterprise_team_members SET teamRole='member' WHERE userId=20"); await expect(get(history.historyId, 20)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it.each(["UPDATE enterprise_member_module_access SET dataScope='self' WHERE userId=20 AND module='customers'", "UPDATE enterprise_member_module_access SET dataScope='self' WHERE userId=20 AND module='stocks'", "UPDATE enterprise_team_members SET teamId=8 WHERE userId=10", "UPDATE enterprise_members SET status='inactive' WHERE userId=10", "UPDATE users SET loginDisabled=1 WHERE id=10", "INSERT INTO enterprise_team_members VALUES(99,1,8,10,'member')", "UPDATE enterprise_teams SET status='inactive' WHERE id=7"]) ("leader current scope fail closed: %s", async change => {
    const { history } = await original(); sqlite.exec(change); await expect(get(history.historyId, 20)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("management view denied to ordinary peer; bounded scoped SQL contains no count/total", async () => {
    await original(); await original(); await expect(service.customerUploadHistoryList(scope(40), { ...expected(40), view: "management" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const first = await service.customerUploadHistoryList(scope(20), { ...expected(20), view: "management", pageSize: 1 }); expect(first.items).toHaveLength(1); expect(first.nextCursor).toBeTypeOf("string"); expect(first).not.toHaveProperty("total");
    const next = await service.customerUploadHistoryList(scope(20), { ...expected(20), view: "management", pageSize: 1, cursor: first.nextCursor! }); expect(next.items).toHaveLength(1); expect(next.items[0].historyId).not.toBe(first.items[0].historyId);
    expect(queries.some(q => q.sql.includes("customer_upload_histories h") && q.sql.includes("EXISTS (SELECT 1 FROM crm_customers") && q.sql.includes("LIMIT ?"))).toBe(true);
  });
  it("cross-enterprise/dataowner/customer/file/version tuples rejected before bytes", async () => {
    const a = await original(); const b = await original(); const r = await result(b.history.historyId);
    await expect(service.customerUploadDownload(scope(), { ...expected(), files: [{ historyId: a.history.historyId, fileId: b.history.originalFile.fileId }] })).rejects.toMatchObject({ code: "NOT_FOUND" }); expect(reads).toBe(0);
    await expect(get(a.history.historyId, 10, r.version.versionId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    sqlite.prepare("UPDATE customer_upload_histories SET data_owner_user_id=199 WHERE history_id=?").run(a.history.historyId); await expect(get(a.history.historyId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.customerUploadOriginal(scope(), { ...expected(), customerId: 4, mode: "parse", file: inputFile, requestId: randomUUID() })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("append result files/versions, old bytes immutable, CAS and source worksheet/hash enforced", async () => {
    const a = await original(); const one = await result(a.history.historyId); const two = await result(a.history.historyId);
    expect(one.version.versionNo).toBe(1); expect(two.version.versionNo).toBe(2); expect(two.version.parentVersionId).toBe(one.version.versionId); expect(count("customer_upload_versions")).toBe(2);
    expect((await get(a.history.historyId, 10, one.version.versionId)).selectedVersion?.rows).toEqual(one.version.rows);
    await expect(service.customerUploadResult(scope(20), { ...expected(20), historyId: a.history.historyId, expectedRevision: 1, requestId: randomUUID(), parentVersionId: two.version.versionId, normalizedFile: inputFile, rows: two.version.rows, issues: [] })).rejects.toMatchObject({ code: "CONFLICT" });
    const originalSheets = (await get(a.history.historyId)).originalSheets;
    expect(() => assertCustomerUploadSourceRefs({ sheets: originalSheets }, [{ ...two.version.rows[0].sourceRefs[0], sheetName: "forged" }])).toThrow();
  });
  it("mark reason/CAS/legal state; cancellation never deletes old files", async () => {
    const a = await original(); const r = await service.customerUploadManageMark(scope(20), { ...expected(20), historyId: a.history.historyId, expectedRevision: 1, requestId: randomUUID(), action: "start_parsing", reason: null }); expect(r.history.state).toBe("parsing");
    await expect(service.customerUploadManageMark(scope(20), { ...expected(20), historyId: a.history.historyId, expectedRevision: 2, requestId: randomUUID(), action: "fail_parse", reason: "" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const cancelled = await service.customerUploadManageMark(scope(), { ...expected(), historyId: a.history.historyId, expectedRevision: 2, requestId: randomUUID(), action: "cancel", reason: "人工取消" }); expect(cancelled.history.state).toBe("cancelled"); expect(count("customer_upload_files")).toBe(1);
  });
  it("missing/nonCNY currency and missing brand rejected before batch creation", async () => {
    const a = await original("standard"); const g = await get(a.history.historyId); const sheet = g.originalSheets[0]; const ref: SourceRef = { sheetIndex: 0, sheetName: sheet.sheetName, rowNumber: sheet.rows[0].rowNumber, originalRowHash: sheet.rows[0].originalRowHash };
    for (const fields of [{ ...candidate, currency: null }, { ...candidate, currency: "USD" }, { ...candidate, brand: null }]) await expect(prepare(a.history.historyId, { confirmedRows: [{ logicalRowId: randomUUID(), rowId: randomUUID(), rowRequestId: randomUUID(), sourceRefs: [ref], fields }] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(count("channel_inventory_upload_batches")).toBe(0); expect(count("channel_inventory_materials")).toBe(0);
  });
  it("prepare creates only original real batch in TRUE outer tx; row/batch UUIDs fixed and replay", async () => {
    const a = await original("standard"); const p = await prepare(a.history.historyId); expect(count("channel_inventory_upload_batches")).toBe(1); expect(count("channel_inventory_materials")).toBe(0);
    expect(p.output.batch.batchCode).not.toBe(p.input.batchRequestId);
    expect(sqlite.prepare("SELECT request_id FROM channel_inventory_management_requests WHERE action='createUploadBatch'").get()?.request_id).toBe(p.input.batchRequestId);
    expect((await get(a.history.historyId)).confirmation?.batchRequestId).toBe(p.input.batchRequestId);
    expect(p.output.entries.map(e => e.rowRequestId)).toEqual(p.input.confirmedRows.map(r => r.rowRequestId)); expect(p.output.entries[0].payload.channelId).toBe(p.output.batch.channelId);
    const replay = await service.customerUploadPrepareConfirmation(scope(), p.input); expect(replay.confirmationId).toBe(p.output.confirmationId); expect(count("channel_inventory_upload_batches")).toBe(1);
    expect(replay.batch).toEqual(p.output.batch);
    await expect(service.customerUploadPrepareConfirmation(scope(20), { ...p.input, ...expected(20), requestId: randomUUID(), expectedRevision: p.output.revision })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("history confirmation failure rolls back real source/batch/claims together", async () => {
    const a = await original("standard"); failSql = /INSERT INTO customer_upload_confirmations/; await expect(prepare(a.history.historyId)).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(count("channel_inventory_upload_batches")).toBe(0); expect(count("channel_inventory_channels")).toBe(0); expect(count("crm_customer_supply_channels")).toBe(0); expect(count("customer_upload_requests")).toBe(1); expect(rollbacks).toBeGreaterThan(0);
  });
  it("same rowUUID/batchUUID cannot be moved to another history; no second create", async () => {
    const a = await original("standard"); const p = await prepare(a.history.historyId); const b = await original("standard");
    await expect(prepare(b.history.historyId, { batchRequestId: p.input.batchRequestId })).rejects.toMatchObject({ code: "CONFLICT" });
    const g = await get(b.history.historyId); const row = g.originalSheets[0].rows[0]; const ref = { sheetIndex: 0, sheetName: g.originalSheets[0].sheetName, rowNumber: row.rowNumber, originalRowHash: row.originalRowHash };
    await expect(prepare(b.history.historyId, { confirmedRows: [{ ...p.input.confirmedRows[0], sourceRefs: [ref] }] })).rejects.toMatchObject({ code: "CONFLICT" }); expect(count("channel_inventory_upload_batches")).toBe(1);
  });
  it("no browser receipt accepted; absent DB receipt remains unknown, and reparse/mark refused", async () => {
    const a = await original("standard"); const p = await prepare(a.history.historyId); const r = await reconcile(a.history.historyId, p.output.confirmationId);
    expect(r.history.stats).toMatchObject({ successCount: 0, unknownCount: 2, failedCount: 0 }); expect(r.history.state).toBe("awaiting_confirmation");
    await expect(result(a.history.historyId)).rejects.toMatchObject({ code: "CONFLICT" }); await expect(service.customerUploadManageMark(scope(20), { ...expected(20), historyId: a.history.historyId, expectedRevision: r.history.revision, requestId: randomUUID(), action: "start_parsing", reason: null })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(CUSTOMER_UPLOAD_HISTORY_INPUT_SCHEMAS["channelInventory.customerUploadReconcileBatch"].safeParse({ ...expected(), historyId: a.history.historyId, confirmationId: p.output.confirmationId, requestId: randomUUID(), materialId: 123, successCount: 2 }).success).toBe(false);
  });
  it("actual old create gives same material ID once; DB receipt drives partial/imported and survives deletion", async () => {
    const a = await original("standard"); const p = await prepare(a.history.historyId); const supply = createCustomerSupplyService({ getDb: async () => db, registerTeamRecord: register });
    const first = await supply.createCustomerMaterial(scope(), formalPayload(p.output.entries[0])); const again = await supply.createCustomerMaterial(scope(), formalPayload(p.output.entries[0])); expect(again.item.id).toBe(first.item.id); expect(again.idempotent).toBe(true);
    const partial = await reconcile(a.history.historyId, p.output.confirmationId); expect(partial.history.state).toBe("partially_imported"); expect(partial.history.stats.successCount).toBe(1);
    await supply.createCustomerMaterial(scope(), formalPayload(p.output.entries[1])); const complete = await reconcile(a.history.historyId, p.output.confirmationId); expect(complete.history.state).toBe("imported"); expect(complete.history.stats.successCount).toBe(2); expect(count("channel_inventory_materials")).toBe(2);
    sqlite.prepare("INSERT INTO channel_inventory_material_management VALUES(1,?,'2026-11-15')").run(first.item.id); sqlite.prepare("UPDATE channel_inventory_materials SET brand='edited',revision=2 WHERE id=?").run(first.item.id);
    const afterDelete = await reconcile(a.history.historyId, p.output.confirmationId); expect(afterDelete.history.stats).toMatchObject({ successCount: 2, remainingMaterialCount: 1 }); expect(afterDelete.history.state).toBe("imported");
  });
  it("unresolved issues require explicit resolutions; frozen confirmation stores them", async () => {
    const a = await original(); const current = await get(a.history.historyId); const sheet = current.originalSheets[0]; const issueId = randomUUID(); const rowId = randomUUID();
    const rows: ResultRow[] = sheet.rows.map((r, i) => ({ rowId: i === 0 ? rowId : randomUUID(), logicalRowId: randomUUID(), sourceRefs: [{ sheetIndex: 0, sheetName: sheet.sheetName, rowNumber: r.rowNumber, originalRowHash: r.originalRowHash }], candidate, disposition: "pending", excludeReason: null, issues: i === 0 ? [{ issueId, rowId, field: "currency", message: "币种待人工确认", resolved: false, resolution: null }] : [] }));
    await service.customerUploadResult(scope(20), { ...expected(20), historyId: a.history.historyId, expectedRevision: 1, requestId: randomUUID(), parentVersionId: null, normalizedFile: inputFile, rows, issues: [] });
    await expect(prepare(a.history.historyId)).rejects.toMatchObject({ code: "BAD_REQUEST" }); const p = await prepare(a.history.historyId, { resolvedIssues: [{ issueId, resolution: "人工核对原报价为人民币" }] }); expect((await get(a.history.historyId)).confirmation?.resolvedIssues).toEqual([{ issueId, resolution: "人工核对原报价为人民币" }]); expect(p.output.entries).toHaveLength(2);
  });
  it("only human-confirmed rows become imported after real receipts, with unprocessed original rows explicitly retained", async () => {
    const a = await original("standard"); const current = await get(a.history.historyId); const row = current.originalSheets[0].rows[0]; const p = await prepare(a.history.historyId, { confirmedRows: [{ logicalRowId: randomUUID(), rowId: randomUUID(), rowRequestId: randomUUID(), sourceRefs: [{ sheetIndex: 0, sheetName: current.originalSheets[0].sheetName, rowNumber: row.rowNumber, originalRowHash: row.originalRowHash }], fields: candidate }] });
    await createCustomerSupplyService({ getDb: async () => db, registerTeamRecord: register }).createCustomerMaterial(scope(), formalPayload(p.output.entries[0]));
    const reconciled = await reconcile(a.history.historyId, p.output.confirmationId);
    expect(reconciled.history.state).toBe("imported");
    expect(reconciled.history.stats).toMatchObject({ successCount: 1, unprocessedSourceRowCount: 1 });
    expect(reconciled.history.sourceCoverageWarning).toContain("不代表原表所有行已处理");
    expect((await get(a.history.historyId)).confirmation?.sourceCoverage?.unprocessedSourceRefs).toHaveLength(1);
  });
  it("download all tuples checked before read and ZIP CSV manifest neutralizes formulas", async () => {
    const a = await original(); const b = await original(); sqlite.exec("UPDATE crm_customers SET name='=HYPERLINK(unsafe)' WHERE id=1");
    await expect(service.customerUploadDownload(scope(), { ...expected(), files: [{ historyId: a.history.historyId, fileId: a.history.originalFile.fileId }, { historyId: b.history.historyId, fileId: randomUUID() }], includeManifest: true })).rejects.toMatchObject({ code: "NOT_FOUND" }); expect(reads).toBe(0);
    const zip = await service.customerUploadDownload(scope(), { ...expected(), files: [{ historyId: a.history.historyId, fileId: a.history.originalFile.fileId }], includeManifest: true }); expect(zip.mimeType).toBe("application/zip"); expect(zip.byteSize).toBeLessThan(10485760); expect(zip).not.toHaveProperty("locator"); expect(customerUploadCsvCell("=SUM(A1)")).toBe('"\'=SUM(A1)"');
    const { unzipSync, strFromU8 } = await import("fflate"); expect(strFromU8(unzipSync(Buffer.from(zip.base64, "base64"))["manifest.csv"])).toContain("'=HYPERLINK");
  });
  it("private storage and SQL errors are domain failures, not private paths", async () => {
    const a = await original(); files.clear(); await expect(service.customerUploadDownload(scope(), { ...expected(), files: [{ historyId: a.history.historyId, fileId: a.history.originalFile.fileId }] })).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE", message: expect.not.stringContaining("SECRET") });
    failSql = /FROM customer_upload_files/; await expect(get(a.history.historyId)).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE", message: expect.not.stringContaining("SECRET") });
  });
  it("manager self/deny CRM policy cannot widen team; native column SQL convention preserved", async () => {
    const a = await original(); sqlite.exec("UPDATE enterprise_member_module_access SET dataScope='self' WHERE userId=30 AND module='customers'"); await expect(get(a.history.historyId, 30)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const policy = await resolveCustomerUploadHistoryPolicy(tx, scope(30)); expect(policy.canManage).toBe(false); const actual = queries.find(q => q.sql.includes("e.crmDataOwnerUserId") && q.sql.includes("customers.manage_all")); expect(actual?.sql).toContain("mp.enterpriseMemberId = em.id"); expect(actual?.sql).toContain("e.id = em.enterpriseId");
  });
});

describe("customer history: receipt integrity and uncertain acknowledgement regressions", () => {
  it("a committed old material survives failed history acknowledgement; retry the same UUID and reconcile without duplicate create", async () => {
    const a = await original("standard"); const p = await prepare(a.history.historyId);
    const supply = createCustomerSupplyService({ getDb: async () => db, registerTeamRecord: register });
    const first = await supply.createCustomerMaterial(scope(), formalPayload(p.output.entries[0]));
    failSql = /UPDATE customer_upload_confirmations/;
    await expect(reconcile(a.history.historyId, p.output.confirmationId)).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(count("channel_inventory_materials")).toBe(1);
    expect((await get(a.history.historyId)).history.stats.successCount).toBe(0);
    failSql = null;
    const retry = await supply.createCustomerMaterial(scope(), formalPayload(p.output.entries[0]));
    expect(retry.item.id).toBe(first.item.id); expect(retry.idempotent).toBe(true);
    const actual = await reconcile(a.history.historyId, p.output.confirmationId);
    expect(actual.history.stats).toMatchObject({ successCount: 1, unknownCount: 1, failedCount: 0 });
    expect(actual.entries.map(e => e.rowRequestId)).toEqual(p.input.confirmedRows.map(r => r.rowRequestId));
    expect(count("channel_inventory_materials")).toBe(1);
  });

  it.each([
    "UPDATE channel_inventory_materials SET create_payload_hash='forged'",
    "UPDATE channel_inventory_materials SET create_request_id='00000000-0000-4000-8000-000000000999'",
    "UPDATE channel_inventory_materials SET revision=0",
    "UPDATE channel_inventory_upload_batch_materials SET initial_channel_id=999",
    "UPDATE channel_inventory_upload_batch_materials SET initial_owner_user_id=40",
    "UPDATE channel_inventory_material_share_audits SET actor_user_id=40",
    "UPDATE channel_inventory_material_share_audits SET payload_hash='forged'",
    "UPDATE channel_inventory_material_share_audits SET after_data='{}'",
  ])("one formal material is NOT success without every immutable receipt association: %s", async change => {
    const a = await original("standard"); const p = await prepare(a.history.historyId);
    await createCustomerSupplyService({ getDb: async () => db, registerTeamRecord: register }).createCustomerMaterial(scope(), formalPayload(p.output.entries[0]));
    sqlite.exec(change);
    const actual = await reconcile(a.history.historyId, p.output.confirmationId);
    expect(actual.history.state).toBe("awaiting_confirmation");
    expect(actual.history.stats).toMatchObject({ successCount: 0, unknownCount: 2, failedCount: 0 });
    expect(actual.entries.every(e => e.status === "unknown" && !e.receipt)).toBe(true);
    expect(count("channel_inventory_materials")).toBe(1);
  });

  it("a changed customer CAS blocks old create but retains the same unknown row UUID/payload and forbids reparse", async () => {
    const a = await original("standard"); const p = await prepare(a.history.historyId);
    sqlite.exec("UPDATE crm_customers SET version=4 WHERE id=1");
    await expect(createCustomerSupplyService({ getDb: async () => db, registerTeamRecord: register }).createCustomerMaterial(scope(), formalPayload(p.output.entries[0]))).rejects.toMatchObject({ code: "CONFLICT" });
    const actual = await reconcile(a.history.historyId, p.output.confirmationId);
    expect(actual.history.stats).toMatchObject({ successCount: 0, unknownCount: 2, failedCount: 0 });
    const retained = (await get(a.history.historyId)).confirmation!;
    expect(retained.entries.map(e => e.payload)).toEqual(p.output.entries.map(e => e.payload));
    expect(retained.batchRequestId).toBe(p.input.batchRequestId);
    await expect(result(a.history.historyId)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(count("channel_inventory_materials")).toBe(0);
  });

  it("new service process instances recover immutable files and append-only versions from the same persisted storage", async () => {
    const a = await original(); const v = await result(a.history.historyId);
    service = build();
    const recovered = await get(a.history.historyId);
    expect(recovered.history.originalFile).toEqual(a.history.originalFile);
    expect(recovered.selectedVersion?.versionId).toBe(v.version.versionId);
    const downloaded = await service.customerUploadDownload(scope(), { ...expected(), files: [{ historyId: a.history.historyId, fileId: a.history.originalFile.fileId }] });
    expect(downloaded.base64).toBe(inputFile.base64);
    expect(downloaded.sha256).toBe(createHash("sha256").update(Buffer.from(inputFile.base64, "base64")).digest("hex"));
  });

  it("private original bytes with a different SHA are never downloaded and do not expose storage paths", async () => {
    const a = await original(); const locator = sqlite.prepare("SELECT locator FROM customer_upload_files WHERE file_id=?").get(a.history.originalFile.fileId)!.locator as string;
    files.set(locator, Buffer.from("X,TI,2\nB,ST,3\n"));
    await expect(service.customerUploadDownload(scope(), { ...expected(), files: [{ historyId: a.history.historyId, fileId: a.history.originalFile.fileId }] })).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE", message: expect.not.stringMatching(/locator|SECRET|\/opt\//) });
  });
});
