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

// Dedicated offline fixture copied from the existing history transaction suite.
// Intentionally uses no native database, credentials, router writes or environment.
import { createChannelInventoryManagementService } from "../client/src/business/platform/front-router-types/server/services/channelInventoryManagement";
import { listUploadBatchesSchema } from "../client/src/business/platform/shared/channelInventoryManagement";
import { customerUploadProblemsExportSchema } from "../client/src/business/platform/shared/customerUploadHistory";
const management = () => createChannelInventoryManagementService({ getDb: async () => db });
beforeEach(() => {
  sqlite.exec("ALTER TABLE users ADD COLUMN name TEXT; ALTER TABLE channel_inventory_upload_batches ADD COLUMN name TEXT; ALTER TABLE channel_inventory_upload_batches ADD COLUMN created_at TEXT DEFAULT '2026-11-15T12:00:00.000Z';");
  sqlite.function("CONCAT", (...values: unknown[]) => values.join(""));
});

describe("customer batch actions: isolated native transactions", () => {
  it("validates customer filtering without accepting client scope or repair receipts", () => {
    expect(listUploadBatchesSchema.parse({ customerId: 1 })).toMatchObject({ customerId: 1, page: 1, pageSize: 20 });
    for (const customerId of [0, -1, 1.5, "1"]) expect(listUploadBatchesSchema.safeParse({ customerId }).success).toBe(false);
    for (const field of ["dataOwnerUserId", "enterpriseId", "rowStatus", "receipt", "closed"]) expect(customerUploadProblemsExportSchema.safeParse({ ...expected(), historyId: randomUUID(), [field]: true }).success).toBe(false);
  });
  it("filters all current customer channels server-side, with exact owner and identical count/page predicate", async () => {
    const a = await original("standard"); const p = await prepare(a.history.historyId); const channel = p.output.batch.channelId;
    sqlite.exec(`INSERT INTO channel_inventory_channels (id,enterprise_id,data_owner_user_id,responsible_user_id,name,channel_type,active,revision) VALUES(901,1,99,10,'second','trade',1,1),(902,1,99,10,'other customer','trade',1,1),(903,1,99,20,'other uploader','trade',1,1); INSERT INTO crm_customer_supply_channels (enterpriseId,dataOwnerUserId,customerId,inventoryResponsibleUserId,channelId) VALUES(1,99,1,10,901),(1,99,2,10,902),(1,99,1,20,903); INSERT INTO channel_inventory_upload_batches (enterprise_id,data_owner_user_id,channel_id,uploaded_by_user_id,team_id,owner_membership_id,batch_code,file_name,total_rows) VALUES(1,99,901,10,7,11,'b-second','second.csv',1),(1,99,902,10,7,11,'b-other','other.csv',1),(1,99,903,20,7,12,'b-uploader','other-uploader.csv',1);`);
    const listed = await management().listUploadBatches(scope(), { ...expected(), customerId: 1, pageSize: 1 }); expect(listed.total).toBe(2); expect(listed.items).toHaveLength(1); expect(listed.items[0].closed).toBe(false);
    const next = await management().listUploadBatches(scope(), { ...expected(), customerId: 1, pageSize: 1, page: 2 }); expect(new Set([...listed.items, ...next.items].map(i => i.channelId))).toEqual(new Set([channel, 901]));
    const exact = await management().listUploadBatches(scope(), { ...expected(), customerId: 1, channelId: 901 }); expect(exact.total).toBe(1); expect(exact.items[0].channelId).toBe(901);
    const pageSql = queries.find(q => q.sql.includes("b.total_rows AS totalRows") && q.sql.includes("batch_customer_link"))!.sql;
    const countSql = queries.find(q => q.sql.includes("SELECT COUNT(*) AS total FROM channel_inventory_upload_batches") && q.sql.includes("batch_customer_link"))!.sql;
    for (const query of [pageSql, countSql]) { expect(query).toContain("batch_customer_link.dataOwnerUserId = b.data_owner_user_id"); expect(query).toContain("batch_customer_link.inventoryResponsibleUserId = c.responsible_user_id"); expect(query).toContain("supply_customer"); }
    sqlite.exec("UPDATE enterprise_member_module_access SET readAllowed=0 WHERE userId=10 AND module='customers'");
    const hidden = await management().listUploadBatches(scope(), { ...expected(), customerId: 1 }); expect(hidden.total).toBe(0); expect(hidden.items).toEqual([]);
  });
  it("history lists expose current authorized batch revision/closed without changing immutable receipt", async () => {
    const a = await original("standard"); const p = await prepare(a.history.historyId);
    await createCustomerSupplyService({ getDb: async () => db, registerTeamRecord: register }).createCustomerMaterial(scope(), formalPayload(p.output.entries[0]));
    const g = await get(a.history.historyId); expect(g.history.uploadBatch).toMatchObject({ id: p.output.batch.id, revision: 2 }); expect(g.history.batchClosed).toBe(false); expect(g.confirmation?.batch.revision).toBe(1); expect(g.confirmation?.batchClosed).toBe(false);
    const list = await service.customerUploadHistoryList(scope(), { ...expected() }); expect(list.items[0].uploadBatch?.id).toBe(p.output.batch.id);
    const manager = await get(a.history.historyId, 20); expect(manager.history).not.toHaveProperty("uploadBatch"); expect(manager.history).not.toHaveProperty("batchClosed");
    sqlite.exec("UPDATE enterprise_team_members SET teamId=8 WHERE userId=10"); expect((await get(a.history.historyId)).history).not.toHaveProperty("uploadBatch");
  });
  it("native batch deletion closes an empty queue; canonical row submit stays blocked and evidence remains", async () => {
    const a = await original("standard"); const p = await prepare(a.history.historyId); const originalHash = a.history.originalFile.sha256;
    const frozen = sqlite.prepare("SELECT frozen_data FROM customer_upload_confirmations").get()!.frozen_data;
    const preview = await management().previewDeleteUploadBatch(scope(), { ...expected(), id: p.output.batch.id }); expect(preview.revision).toBe(1);
    await expect(management().deleteUploadBatch(scope(), { ...expected(), id: p.output.batch.id, expectedRevision: 9, requestId: randomUUID() })).rejects.toMatchObject({ code: "CONFLICT" });
    const deleted = await management().deleteUploadBatch(scope(), { ...expected(), id: p.output.batch.id, expectedRevision: preview.revision, requestId: randomUUID() }); expect(deleted.deletedCount).toBe(0);
    const current = await get(a.history.historyId); expect(current.history.batchClosed).toBe(true); expect(current.history.capabilities.canConfirm).toBe(false); expect(current.confirmation?.batchClosed).toBe(true);
    const listed = await management().listUploadBatches(scope(), { ...expected(), customerId: 1 }); expect(listed.items[0].closed).toBe(true);
    await expect(createCustomerSupplyService({ getDb: async () => db, registerTeamRecord: register }).createCustomerMaterial(scope(), formalPayload(p.output.entries[0]))).rejects.toMatchObject({ code: "CONFLICT" });
    await reconcile(a.history.historyId, p.output.confirmationId); expect(count("channel_inventory_materials")).toBe(0); expect(sqlite.prepare("SELECT frozen_data FROM customer_upload_confirmations").get()!.frozen_data).toBe(frozen);
    const downloaded = await service.customerUploadDownload(scope(), { ...expected(), files: [{ historyId: a.history.historyId, fileId: a.history.originalFile.fileId }] }); expect(downloaded.sha256).toBe(originalHash);
  });
  it("exports excluded separately from unknown, never exports a successful/deleted row as failed", async () => {
    const a = await original(); const v = await result(a.history.historyId); const rows = v.version.rows;
    const p = await prepare(a.history.historyId, { confirmedRows: [{ logicalRowId: rows[0].logicalRowId, rowId: rows[0].rowId, rowRequestId: randomUUID(), sourceRefs: rows[0].sourceRefs, fields: rows[0].candidate }], excludedRows: [{ logicalRowId: rows[1].logicalRowId, reason: "跳过问题行：=HYPERLINK(unsafe)", sourceRefs: rows[1].sourceRefs }] }); await reconcile(a.history.historyId, p.output.confirmationId);
    const frozen = sqlite.prepare("SELECT frozen_data FROM customer_upload_confirmations").get()!.frozen_data; const beforeRequests = count("customer_upload_requests"); const beforeWrites = queries.filter(q => /^\s*(INSERT|UPDATE)/.test(q.sql)).length;
    const exported = await service.customerUploadProblemsExport(scope(), { ...expected(), historyId: a.history.historyId }); expect(exported).toMatchObject({ problemCount: 1, verificationCount: 1, definitiveFailedCount: 0 });
    expect(count("customer_upload_requests")).toBe(beforeRequests); expect(queries.filter(q => /^\s*(INSERT|UPDATE)/.test(q.sql))).toHaveLength(beforeWrites); expect(reads).toBe(0);
    const book = XLSX.read(Buffer.from(exported.base64, "base64"), { type: "buffer" }); expect(book.SheetNames).toEqual(["说明", "问题行", "待核实原请求", "版本级问题", "原表问题行1"]); expect(book.Sheets["问题行"].D2).toMatchObject({ t: "s", v: "跳过问题行：=HYPERLINK(unsafe)" }); expect(book.Sheets["问题行"].D2).not.toHaveProperty("f");
    expect(book.Sheets["原表问题行1"].A2.v).toBe("B"); expect(book.Sheets["原表问题行1"].B2.v).toBe("ST"); expect(exported.fileName).toMatch(/^库存_失败记录_\d{8}_\d{4}\.xlsx$/);
    expect(book.Sheets["待核实原请求"].N2.v).toBe(p.output.entries[0].rowRequestId); expect(book.Sheets["问题行"].O2.v).toContain(rows[1].sourceRefs[0].originalRowHash); expect(book.Sheets["待核实原请求"].I2).toMatchObject({ t: "s", v: "0.000000000001" });
    const created = await createCustomerSupplyService({ getDb: async () => db, registerTeamRecord: register }).createCustomerMaterial(scope(), formalPayload(p.output.entries[0])); await reconcile(a.history.historyId, p.output.confirmationId);
    sqlite.prepare("INSERT INTO channel_inventory_material_management VALUES(1,?,'2026-11-15')").run(created.item.id); await reconcile(a.history.historyId, p.output.confirmationId);
    const after = await service.customerUploadProblemsExport(scope(), { ...expected(), historyId: a.history.historyId }); expect(after.verificationCount).toBe(0); expect(after.problemCount).toBe(1); expect(after.definitiveFailedCount).toBe(0); expect(sqlite.prepare("SELECT frozen_data FROM customer_upload_confirmations").get()!.frozen_data).toBe(frozen);
  });
  it("export uses live history ACL/context and optional snapshot CAS, never storage for denied requests", async () => {
    const a = await original(); await result(a.history.historyId);
    await expect(service.customerUploadProblemsExport(scope(), { ...expected(), historyId: a.history.historyId, expectedRevision: 99 })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(service.customerUploadProblemsExport(scope(), { ...expected(20), historyId: a.history.historyId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.customerUploadProblemsExport(scope(50), { ...expected(50), historyId: a.history.historyId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const managed = await service.customerUploadProblemsExport(scope(20), { ...expected(20), historyId: a.history.historyId }); expect(managed.problemCount).toBe(2);
    sqlite.exec("UPDATE enterprise_member_module_access SET readAllowed=0 WHERE userId=20 AND module='customers'"); await expect(service.customerUploadProblemsExport(scope(20), { ...expected(20), historyId: a.history.historyId })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(reads).toBe(0);
  });
  it("excluded repair is not silently forced through a full immutable batch", async () => {
    const a = await original(); const v = await result(a.history.historyId); const rows = v.version.rows;
    const p = await prepare(a.history.historyId, { confirmedRows: [{ logicalRowId: rows[0].logicalRowId, rowId: rows[0].rowId, rowRequestId: randomUUID(), sourceRefs: rows[0].sourceRefs, fields: rows[0].candidate }], excludedRows: [{ logicalRowId: rows[1].logicalRowId, reason: "缺少品牌" }] });
    const supply = createCustomerSupplyService({ getDb: async () => db, registerTeamRecord: register }); await supply.createCustomerMaterial(scope(), formalPayload(p.output.entries[0]));
    await expect(supply.createCustomerMaterial(scope(), { ...formalPayload(p.output.entries[0]), requestId: randomUUID() })).rejects.toMatchObject({ code: "CONFLICT", message: "正式批次只允许原确认或已持久化补发映射的原请求及原内容" }); expect(count("channel_inventory_materials")).toBe(1); expect(sqlite.prepare("SELECT total_rows FROM channel_inventory_upload_batches").get()!.total_rows).toBe(1);
  });
});
