import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";

// No native DB, ECS, environment credentials, fixture files or runtime adapter.
vi.mock("../client/src/business/platform/front-router-types/server/db", () => ({ getDb: () => { throw new Error("REAL DATABASE FORBIDDEN IN OFFLINE TEST"); } }));
// The mirror lacks the unrelated CRM write adapter's .mjs. Execute exactly the
// checked-in CRM policy declarations, not an authorization replacement.
vi.mock("../client/src/business/platform/front-router-types/server/services/crmCustomers", async () => {
  const { readFileSync } = await import("node:fs");
  const { default: ts } = await import("typescript");
  const { sql } = await import("drizzle-orm");
  const { TRPCError } = await import("@trpc/server");
  const { resolveBusinessModuleAccess } = await import("../client/src/business/platform/front-router-types/server/services/businessModuleAccess");
  const path = new URL("../client/src/business/platform/front-router-types/server/services/crmCustomers.ts", import.meta.url);
  const source = ts.createSourceFile(path.pathname, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const names = ["resolveCrmCustomerPolicy", "crmCustomerPolicyWhere", "assertCrmCustomerPolicy", "resultRows"];
  const declarations = source.statements.filter(node => ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text));
  if (declarations.length !== names.length) throw new Error("CRM policy declarations changed");
  const code = ts.transpileModule(declarations.map(node => node.getText(source)).join("\n"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function("sql", "TRPCError", "resolveBusinessModuleAccess", `const exports={}; ${code}; return exports;`)(sql, TRPCError, resolveBusinessModuleAccess);
});
vi.mock("../client/src/business/platform/front-router-types/server/services/channelFactoryPublication", () => ({
  createChannelFactoryPublicationService: vi.fn(), factoryMaterialPublicationMetadata: async () => new Map(),
}));
import { createCustomerSupplyService } from "../client/src/business/platform/front-router-types/server/services/customerSupply";
import { createChannelTeamInventoryService } from "../client/src/business/platform/front-router-types/server/services/channelTeamInventory";
import { createChannelInventorySourceService } from "../client/src/business/platform/front-router-types/server/services/channelInventorySource";
import { createChannelInventoryCollaborationService } from "../client/src/business/platform/front-router-types/server/services/channelInventoryCollaboration";
import { ChannelInventoryError, channelInventoryPayloadHash, type ChannelInventoryScope, type SqlDatabase, type SqlExecutor, type RegisterTeamRecord } from "../client/src/business/platform/front-router-types/server/services/channelInventory";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
const dialect = new MySqlDialect();
const scope: ChannelInventoryScope = { enterpriseId: 1, dataOwnerUserId: 99, actorUserId: 10, isOwner: false, inventoryDataScope: "enterprise", permissionSnapshot: true };
const expected = { expectedEnterpriseId: 1, expectedActorUserId: 10 };
const contextInput = { ...expected, customerId: 1 };
const batchRequestId = "11111111-1111-4111-8111-111111111111";
const rowRequestId = "22222222-2222-4222-8222-222222222222";
const batchInput = { ...contextInput, expectedCustomerVersion: 3, sourceProfile: { type: "trade" as const }, fileName: "real-first-upload.xlsx", totalRows: 1, requestId: batchRequestId };
const rowInput = (uploadBatchId: number) => ({ ...contextInput, expectedCustomerVersion: 3, partNumber: "SAME-PART", brand: "TI", qty: 0, dateCode: null, price: "0.000000000001", currency: "CNY" as const, taxIncluded: null, leadTime: null, note: null, uploadBatchId, requestId: rowRequestId });
const sourceReadReason = "暂无权限读取关联库存来源，请联系有权人员确认";
let sqlite: DatabaseSyncType;
let queries: { sql: string; params: unknown[] }[];
let db: SqlDatabase;
let tx: SqlExecutor;
let service: ReturnType<typeof createCustomerSupplyService>;
let failSql: RegExp | null;
let commits: number;
let rollbacks: number;
const count = (table: string) => Number(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n);
const newService = () => createCustomerSupplyService({ getDb: async () => db, registerTeamRecord });
const registerTeamRecord: RegisterTeamRecord = async (executor, record) => {
  // A deterministic transactional substitute for the missing runtime adapter,
  // preserving the exact creator/currentOwner/parent creation-team semantics.
  const { sql } = await import("drizzle-orm");
  await executor.execute(sql`INSERT INTO enterprise_team_record_assignments
    (enterpriseId, recordType, recordId, currentOwnerUserId, createdByUserId, teamId, revision)
    VALUES (${record.enterpriseId}, ${record.recordType}, ${record.recordKey}, ${record.currentOwnerUserId}, ${record.actorUserId}, 7, 1)`);
};
beforeEach(() => {
  sqlite = new DatabaseSync(":memory:"); queries = []; failSql = null; commits = 0; rollbacks = 0;
  sqlite.exec(`
    CREATE TABLE enterprises (id INTEGER, superAdminUserId INTEGER, crmDataOwnerUserId INTEGER);
    CREATE TABLE users (id INTEGER, loginDisabled INTEGER);
    CREATE TABLE enterprise_members (id INTEGER, enterpriseId INTEGER, userId INTEGER, role TEXT, status TEXT);
    CREATE TABLE enterprise_member_permissions (enterpriseMemberId INTEGER, permissionKey TEXT);
    CREATE TABLE enterprise_teams (id INTEGER, enterpriseId INTEGER, status TEXT);
    CREATE TABLE enterprise_team_members (id INTEGER, enterpriseId INTEGER, teamId INTEGER, userId INTEGER, teamRole TEXT);
    CREATE TABLE enterprise_member_module_access (id INTEGER, enterpriseId INTEGER, userId INTEGER, module TEXT, readAllowed INTEGER, writeAllowed INTEGER, dataScope TEXT, revision INTEGER);
    CREATE TABLE enterprise_team_record_assignments (id INTEGER PRIMARY KEY AUTOINCREMENT, enterpriseId INTEGER, recordType TEXT, recordId INTEGER, currentOwnerUserId INTEGER, createdByUserId INTEGER, teamId INTEGER, revision INTEGER);
    CREATE TABLE channel_inventory_channels (id INTEGER PRIMARY KEY AUTOINCREMENT, enterprise_id INTEGER, data_owner_user_id INTEGER, responsible_user_id INTEGER, name TEXT, industryCode TEXT, channel_type TEXT, contact_name TEXT, phone TEXT, wechat TEXT, qq TEXT, notes TEXT, active INTEGER, revision INTEGER, create_request_id TEXT UNIQUE, create_payload_hash TEXT, created_at TEXT DEFAULT '2026-11-15', updated_at TEXT DEFAULT '2026-11-15');
    CREATE TABLE channel_inventory_materials (id INTEGER PRIMARY KEY AUTOINCREMENT, enterprise_id INTEGER, data_owner_user_id INTEGER, responsible_user_id INTEGER, channel_id INTEGER, part_number TEXT, brand TEXT, qty INTEGER, date_code TEXT, price TEXT, currency TEXT, tax_included INTEGER, lead_time TEXT, note TEXT, revision INTEGER, create_request_id TEXT UNIQUE, create_payload_hash TEXT, updated_at TEXT DEFAULT '2026-11-15', created_at TEXT DEFAULT '2026-11-15');
    CREATE TABLE channel_inventory_material_shares (enterprise_id INTEGER, material_id INTEGER, enabled INTEGER, owner_user_id INTEGER, share_team_id INTEGER, assignment_revision INTEGER, owner_membership_id INTEGER, revision INTEGER);
    CREATE TABLE channel_inventory_material_share_audits (enterprise_id INTEGER, material_id INTEGER, actor_user_id INTEGER, request_id TEXT, payload_hash TEXT, before_data TEXT, after_data TEXT);
    CREATE TABLE channel_inventory_material_management (enterprise_id INTEGER, material_id INTEGER, deleted_at TEXT);
    CREATE TABLE channel_inventory_upload_batches (id INTEGER PRIMARY KEY AUTOINCREMENT, enterprise_id INTEGER, data_owner_user_id INTEGER, channel_id INTEGER, uploaded_by_user_id INTEGER, team_id INTEGER, owner_membership_id INTEGER, uploaded_by_admin_account_id INTEGER, batch_code TEXT, file_name TEXT, total_rows INTEGER, revision INTEGER, archived INTEGER, closed INTEGER);
    CREATE TABLE channel_inventory_upload_batch_materials (enterprise_id INTEGER, batch_id INTEGER, material_id INTEGER, initial_revision INTEGER, initial_channel_id INTEGER, initial_owner_user_id INTEGER, initial_assignment_id INTEGER, initial_assignment_revision INTEGER, initial_team_id INTEGER, initial_membership_id INTEGER, initial_share_revision INTEGER);
    CREATE TABLE channel_inventory_management_requests (enterprise_id INTEGER, data_owner_user_id INTEGER, actor_user_id INTEGER, request_id TEXT, action TEXT, payload_hash TEXT, result_data TEXT);
    CREATE TABLE channel_inventory_collaboration_notes (enterpriseId INTEGER, materialId INTEGER);
    CREATE TABLE channel_inventory_manual_references (enterpriseId INTEGER, dataOwnerUserId INTEGER, materialId INTEGER, manualReferenceLcsc TEXT, manualReferenceIckey TEXT, updatedByUserId INTEGER, updatedByAdminAccountId INTEGER, updatedAt TEXT);
    CREATE TABLE crm_customers (id INTEGER, enterpriseId INTEGER, assignedUserId INTEGER, name TEXT, industryCode TEXT, version INTEGER, archivedAt TEXT);
    CREATE TABLE crm_customer_supply_channels (enterpriseId INTEGER, dataOwnerUserId INTEGER, customerId INTEGER, inventoryResponsibleUserId INTEGER, channelId INTEGER, customerVersionAtBind INTEGER, firstRequestId TEXT, schemaVersion INTEGER,
      UNIQUE (enterpriseId, dataOwnerUserId, customerId, inventoryResponsibleUserId), UNIQUE (enterpriseId, dataOwnerUserId, channelId));
    CREATE TABLE crm_customer_contact_primary (enterpriseId INTEGER, customerId INTEGER, primaryContactId TEXT, legacyContactPresent INTEGER);
    CREATE TABLE crm_customer_contacts (customerId INTEGER, contactName TEXT, phone TEXT, isPrimary INTEGER);
    -- Existing history tables are intentionally empty for the legacy/no-history path.
    -- The native unified create fence must query real SQL, not be stubbed out.
    CREATE TABLE customer_upload_histories (history_id TEXT PRIMARY KEY, enterprise_id INTEGER, data_owner_user_id INTEGER, customer_id INTEGER, uploaded_by_user_id INTEGER, uploaded_by_admin_account_id INTEGER);
    CREATE TABLE customer_upload_confirmations (history_id TEXT UNIQUE, enterprise_id INTEGER, data_owner_user_id INTEGER, customer_id INTEGER, frozen_data TEXT);
    CREATE TABLE customer_upload_requests (enterprise_id INTEGER, data_owner_user_id INTEGER, actor_user_id INTEGER, request_id TEXT, operation TEXT, history_id TEXT, result_data TEXT, created_at TEXT);
    INSERT INTO enterprises VALUES (1,99,99),(2,199,199);
    INSERT INTO users VALUES (10,0),(20,0);
    INSERT INTO enterprise_members VALUES (1,1,10,'staff','active'),(2,1,20,'staff','active');
    INSERT INTO enterprise_member_permissions VALUES (1,'inventory.manage'),(1,'customers.manage'),(2,'inventory.manage');
    INSERT INTO enterprise_teams VALUES (7,1,'active'),(8,1,'active');
    INSERT INTO enterprise_team_members VALUES (11,1,7,10,'member'),(12,1,7,20,'member');
    INSERT INTO enterprise_member_module_access VALUES (1,1,10,'stocks',1,1,'team',1),(2,1,10,'customers',1,1,'self',1),(3,1,10,'channels',1,1,'self',1),(4,1,20,'stocks',1,1,'team',1);
    INSERT INTO crm_customers VALUES (1,1,10,'客户甲（当前CRM）','automotive',3,NULL),(2,1,10,'客户乙','automotive',2,NULL),(3,1,20,'不可读客户','automotive',1,NULL);
  `);
  tx = { execute: async (query: SQL) => {
    const compiled = dialect.sqlToQuery(query); queries.push(compiled);
    if (failSql?.test(compiled.sql)) throw new ChannelInventoryError("INTERNAL_SERVER_ERROR", "injected transactional failure");
    // Native policies/predicates run as actual SQL. MySQL locking syntax is
    // captured unchanged, then removed for SQLite (no production lock claim).
    // Official immutable JSON evidence is not emulated. For EMPTY material
    // relations only, such SELECTs have provably zero rows for EVERY predicate.
    if (compiled.sql.includes("JSON_EXTRACT") && /FROM channel_inventory_materials m/.test(compiled.sql)) {
      if (count("channel_inventory_materials") !== 0) throw new Error("Official nonempty evidence evaluation unsupported by this offline harness");
      return [[...(compiled.sql.trimStart().startsWith("SELECT COUNT(*)") ? [{ total: 0 }] : [])]];
    }
    const executable = compiled.sql.replace(/\s+FOR UPDATE\b/g, "")
      .replace(/BINARY management_access\.dataScope = BINARY 'team'/g, "management_access.dataScope COLLATE BINARY = 'team'");
    const params = compiled.params.map(value => typeof value === "boolean" ? Number(value) : value) as never[];
    const statement = sqlite.prepare(executable);
    if (/^\s*SELECT\b/.test(executable)) return [statement.all(...params)];
    if (!/^\s*(INSERT|UPDATE)\b/.test(executable)) throw new Error("Unexpected SQL: " + executable);
    const result = statement.run(...params);
    return [{ affectedRows: Number(result.changes), insertId: Number(result.lastInsertRowid) }];
  } };
  db = { execute: tx.execute, transaction: async fn => {
    sqlite.exec("BEGIN");
    try { const result = await fn(tx); sqlite.exec("COMMIT"); commits++; return result; }
    catch (error) { sqlite.exec("ROLLBACK"); rollbacks++; throw error; }
  } };
  service = newService();
});
afterEach(() => sqlite.close());
const prepare = () => service.createCustomerUploadBatch(scope, batchInput);
const readContext = (s = scope, input = contextInput) => service.customerSupplyContext(s, input);
const emptyProofs = () => queries.filter(q => q.sql.includes("upload_material.channel_id = c.id"));
const materialInserts = () => queries.filter(q => /^\s*INSERT INTO channel_inventory_materials\s/.test(q.sql));

describe("customer supply empty-channel preparation (offline native services)", () => {
  it("first real batch -> empty context -> first real material, same inventory id with no copy", async () => {
    expect(await readContext()).toMatchObject({ channel: null, canUpload: true, disabledReason: null });
    const batch = await prepare();
    expect(count("channel_inventory_channels")).toBe(1); expect(count("crm_customer_supply_channels")).toBe(1);
    expect(count("channel_inventory_upload_batches")).toBe(1); expect(count("channel_inventory_materials")).toBe(0);
    const beforeRead = queries.length;
    expect(await readContext()).toMatchObject({ channel: { id: batch.channelId, name: "客户甲（当前CRM）", type: "trade", active: true, revision: 1 }, canUpload: true, disabledReason: null });
    const summary = await service.customerSupplySummary(scope, { ...expected, customerIds: [1] });
    expect(summary).toEqual({ items: [{ customerId: 1, channelId: null, materialCount: 0, canUpload: true, canViewStock: false, disabledReason: null }], canWrite: true });
    expect(queries.slice(beforeRead).every(q => q.sql.trimStart().startsWith("SELECT"))).toBe(true);
    const item = await service.createCustomerMaterial(scope, rowInput(batch.id));
    const team = createChannelTeamInventoryService({ getDb: async () => db });
    const customer = await team.listTeamMaterials(scope, { customerId: 1, page: 1, pageSize: 20 });
    const global = await team.listTeamMaterials(scope, { page: 1, pageSize: 20 });
    expect(customer.items.map(row => row.id)).toEqual([item.item.id]); expect(global.items.map(row => row.id)).toEqual([item.item.id]);
    expect(item).toMatchObject({ customerId: 1, channelId: batch.channelId, item: { uploadBatchId: batch.id, qty: 0, price: "0.000000000001" }, idempotent: false });
    expect(materialInserts()).toHaveLength(1); expect(count("channel_inventory_materials")).toBe(1);
    expect(count("channel_inventory_material_shares")).toBe(1); expect(count("channel_inventory_upload_batch_materials")).toBe(1);
    const priorProofs = emptyProofs().length;
    expect(await readContext()).toMatchObject({ channel: { id: batch.channelId }, canUpload: true });
    expect(emptyProofs()).toHaveLength(priorProofs); // existing-source path, not fallback
  });
  it("close/reopen empty persisted binding recovers original batch and row UUID, replay is one ID", async () => {
    const batch = await prepare();
    service = newService();
    const context = await readContext(); expect(context.channel?.id).toBe(batch.channelId); expect(context.canUpload).toBe(true);
    const replayBatch = await service.createCustomerUploadBatch(scope, batchInput);
    expect(replayBatch).toEqual(batch); expect(count("channel_inventory_upload_batches")).toBe(1);
    const request = rowInput(batch.id);
    const first = await service.createCustomerMaterial(scope, request);
    service = newService();
    const replay = await service.createCustomerMaterial(scope, request);
    expect(replay.item.id).toBe(first.item.id); expect(replay.idempotent).toBe(true); expect(materialInserts()).toHaveLength(1);
    await expect(service.createCustomerMaterial(scope, { ...request, qty: 1 })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(count("channel_inventory_materials")).toBe(1);
  });
  it.each([/INSERT INTO enterprise_team_record_assignments/, /INSERT INTO channel_inventory_upload_batch_materials/, /INSERT INTO channel_inventory_material_shares/])("failed first row %s rolls back only row, then original UUID resumes", async failing => {
    const batch = await prepare(); failSql = failing;
    await expect(service.createCustomerMaterial(scope, rowInput(batch.id))).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(rollbacks).toBe(1); expect(count("channel_inventory_materials")).toBe(0);
    expect(count("channel_inventory_material_shares")).toBe(0); expect(count("channel_inventory_upload_batch_materials")).toBe(0);
    expect(count("enterprise_team_record_assignments")).toBe(1); expect(count("channel_inventory_upload_batches")).toBe(1);
    failSql = null; service = newService(); expect(await readContext()).toMatchObject({ channel: { id: batch.channelId }, canUpload: true });
    expect((await service.createCustomerMaterial(scope, rowInput(batch.id))).channelId).toBe(batch.channelId);
    expect(count("channel_inventory_materials")).toBe(1);
  });
  it("manually chosen own empty existing channel works without creating a placeholder or channel copy", async () => {
    sqlite.exec("INSERT INTO channel_inventory_channels (id,enterprise_id,data_owner_user_id,responsible_user_id,name,industryCode,channel_type,active,revision) VALUES (55,1,99,10,'PRIVATE OLD NAME','automotive','trade',1,4); INSERT INTO enterprise_team_record_assignments (enterpriseId,recordType,recordId,currentOwnerUserId,createdByUserId,teamId,revision) VALUES (1,'channel',55,10,10,7,4)");
    const batch = await service.createCustomerUploadBatch(scope, { ...batchInput, sourceProfile: { type: "trade", existingChannelId: 55 } });
    expect(await readContext()).toMatchObject({ channel: { id: 55, name: "客户甲（当前CRM）", revision: 4 }, canUpload: true });
    expect(batch.channelId).toBe(55); expect(count("channel_inventory_channels")).toBe(1); expect(materialInserts()).toHaveLength(0);
  });
  it.each(["source-hidden", "soft-deleted", "foreign-material-owner", "foreign-material-enterprise"])("any raw material prevents empty fallback even if %s", async variant => {
    const batch = await prepare();
    const created = await service.createCustomerMaterial(scope, rowInput(batch.id));
    sqlite.exec("UPDATE enterprise_team_record_assignments SET createdByUserId=20 WHERE recordType='channel_material'");
    if (variant === "soft-deleted") sqlite.prepare("INSERT INTO channel_inventory_material_management VALUES (1,?, '2026-11-15')").run(created.item.id);
    if (variant === "foreign-material-owner") sqlite.exec("UPDATE channel_inventory_materials SET responsible_user_id=20");
    if (variant === "foreign-material-enterprise") sqlite.exec("UPDATE channel_inventory_materials SET enterprise_id=2,data_owner_user_id=199");
    expect(await readContext()).toMatchObject({ channel: null, canUpload: false, disabledReason: sourceReadReason });
    const proof = emptyProofs().at(-1)!;
    const rawClause = proof.sql.slice(proof.sql.indexOf("AND NOT EXISTS (SELECT 1 FROM channel_inventory_materials upload_material"));
    expect(rawClause).toContain("upload_material.channel_id = c.id FOR UPDATE");
    expect(rawClause).not.toMatch(/deleted|source|share|responsible|enterprise|data_owner/);
    if (variant === "source-hidden") {
      const global = await createChannelTeamInventoryService({ getDb: async () => db }).listTeamMaterials(scope, { page: 1, pageSize: 20 });
      expect(global.items).toHaveLength(1); expect(global.items[0]).toMatchObject({ id: created.item.id, canViewSource: false, canEditMaterial: false, company: null });
      await expect(createChannelInventorySourceService({ getDb: async () => db }).getTeamMaterialSource(scope, { materialId: created.item.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(createChannelInventoryCollaborationService({ getDb: async () => db }).getTeamMaterialForEdit(scope, { id: created.item.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  });
  it.each([
    ["CRM write", "UPDATE enterprise_member_module_access SET writeAllowed=0 WHERE module='customers'"],
    ["stocks write", "UPDATE enterprise_member_module_access SET writeAllowed=0 WHERE module='stocks'"],
    ["stocks read", "UPDATE enterprise_member_module_access SET readAllowed=0 WHERE module='stocks'"],
    ["channels write", "UPDATE enterprise_member_module_access SET writeAllowed=0 WHERE module='channels'"],
    ["inventory ERP", "DELETE FROM enterprise_member_permissions WHERE permissionKey='inventory.manage' AND enterpriseMemberId=1"],
    ["inactive channel", "UPDATE channel_inventory_channels SET active=0"],
    ["channel enterprise", "UPDATE channel_inventory_channels SET enterprise_id=2"],
    ["channel dataOwner", "UPDATE channel_inventory_channels SET data_owner_user_id=199"],
    ["channel responsible", "UPDATE channel_inventory_channels SET responsible_user_id=20"],
    ["assignment owner", "UPDATE enterprise_team_record_assignments SET currentOwnerUserId=20"],
    ["assignment team", "UPDATE enterprise_team_record_assignments SET teamId=8"],
    ["assignment revision", "UPDATE enterprise_team_record_assignments SET revision=0"],
    ["missing assignment", "DELETE FROM enterprise_team_record_assignments"],
    ["inactive team", "UPDATE enterprise_teams SET status='inactive' WHERE id=7"],
    ["no team", "DELETE FROM enterprise_team_members WHERE userId=10"],
    ["ambiguous teams", "INSERT INTO enterprise_team_members VALUES (13,1,8,10,'member')"],
    ["invalid channel revision", "UPDATE channel_inventory_channels SET revision=0"],
  ])("empty binding refuses %s; no source reason or channel is accidentally enabled", async (_name, mutation) => {
    await prepare(); sqlite.exec(mutation); queries = [];
    expect(await readContext()).toMatchObject({ channel: null, canUpload: false, disabledReason: sourceReadReason });
    expect(materialInserts()).toHaveLength(0); expect(count("channel_inventory_materials")).toBe(0);
    if (_name !== "invalid channel revision") expect(emptyProofs()).toHaveLength(0);
  });
  it.each([
    ["name", "UPDATE crm_customers SET name=' ' WHERE id=1", "请先在客户档案补全公司名称"],
    ["industry", "UPDATE crm_customers SET industryCode='invalid' WHERE id=1", "请先完善客户所属行业"],
    ["archived", "UPDATE crm_customers SET archivedAt='2026-11-15' WHERE id=1", "客户已归档，不能上传供应库存"],
  ])("completion %s stays disabled and never reaches the empty proof", async (_name, mutation, reason) => {
    await prepare(); sqlite.exec(mutation); queries = [];
    expect(await readContext()).toMatchObject({ channel: null, canUpload: false, disabledReason: reason }); expect(emptyProofs()).toHaveLength(0);
  });
  it.each([
    "UPDATE crm_customers SET assignedUserId=20 WHERE id=1",
    "UPDATE enterprise_member_module_access SET readAllowed=0 WHERE module='customers'",
    "DELETE FROM enterprise_member_permissions WHERE permissionKey='customers.manage'",
    "UPDATE users SET loginDisabled=1 WHERE id=10",
    "UPDATE enterprise_members SET status='suspended' WHERE userId=10",
    "UPDATE enterprises SET crmDataOwnerUserId=199 WHERE id=1",
  ])("current CRM/actor/dataOwner denial fails closed before preparation: %s", async mutation => {
    await prepare(); sqlite.exec(mutation); queries = [];
    await expect(readContext()).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|NOT_FOUND/) }); expect(emptyProofs()).toHaveLength(0);
  });
  it.each(["customerId=2", "inventoryResponsibleUserId=20", "enterpriseId=2", "dataOwnerUserId=199"])("another binding %s is not used, treated only as genuinely unbound", async replacement => {
    const batch = await prepare(); sqlite.exec(`UPDATE crm_customer_supply_channels SET ${replacement}`); queries = [];
    expect(await readContext()).toMatchObject({ channel: null, canUpload: true }); expect(emptyProofs()).toHaveLength(0);
    await expect(service.createCustomerMaterial(scope, rowInput(batch.id))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(count("channel_inventory_materials")).toBe(0);
    expect(count("channel_inventory_channels")).toBe(1); expect(count("crm_customer_supply_channels")).toBe(1);
    expect(rollbacks).toBe(1); // newly attempted other source joins the failed row transaction
  });
  it("SQL revalidates persisted binding rather than trusting the earlier link read", async () => {
    await prepare(); const execute = tx.execute;
    tx.execute = async q => {
      const compiled = dialect.sqlToQuery(q);
      if (compiled.sql.includes("FROM channel_inventory_channels c INNER JOIN crm_customer_supply_channels upload_link")) sqlite.exec("UPDATE crm_customer_supply_channels SET customerId=2");
      return execute(q);
    };
    expect(await readContext()).toMatchObject({ channel: null, canUpload: false, disabledReason: sourceReadReason });
  });
  it.each(["read", "write", "inventoryScopeWrite", "customerScopeRead"])("official %s revoke cannot acquire empty preparation", async permission => {
    await prepare(); queries = [];
    const official: ChannelInventoryScope = { ...scope, officialActor: { adminAccountId: 303, bindingVersion: 7, requestId: "signed-test-request", inventoryPermissions: { read: true, write: true, note: false, inventoryScopeWrite: true, customerScopeRead: true, authorizationVersion: "offline-v1", [permission]: false } } };
    if (permission === "customerScopeRead") await expect(readContext(official)).rejects.toMatchObject({ code: "FORBIDDEN" });
    else expect(await readContext(official)).toMatchObject({ channel: null, canUpload: false });
    expect(emptyProofs()).toHaveLength(0);
  });
  it("official full current grants may prepare a proved empty own binding, not view stock", async () => {
    const batch = await prepare();
    const official: ChannelInventoryScope = { ...scope, officialActor: { adminAccountId: 303, bindingVersion: 7, requestId: "signed-test-request", inventoryPermissions: { read: true, write: true, note: false, inventoryScopeWrite: true, customerScopeRead: true, authorizationVersion: "offline-v1" } } };
    expect(await readContext(official)).toMatchObject({ channel: { id: batch.channelId }, canUpload: true });
    expect((await service.customerSupplySummary(official, { ...expected, customerIds: [1] })).items[0]).toMatchObject({ channelId: null, materialCount: 0, canViewStock: false, canUpload: true });
  });
  it("customer CAS, channel assignment revision, expected binding, source type and batch ownership stay original fences", async () => {
    const batch = await prepare(); const request = rowInput(batch.id);
    sqlite.exec("UPDATE crm_customers SET version=4 WHERE id=1");
    expect(await readContext()).toMatchObject({ customer: { version: 4 }, canUpload: true });
    await expect(service.createCustomerMaterial(scope, request)).rejects.toMatchObject({ code: "CONFLICT" });
    sqlite.exec("UPDATE crm_customers SET version=3 WHERE id=1");
    await expect(service.createCustomerUploadBatch(scope, { ...batchInput, expectedChannelRevision: 2 })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(service.createCustomerUploadBatch(scope, { ...batchInput, expectedChannelId: batch.channelId + 1 })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(service.createCustomerMaterial(scope, { ...request, sourceProfile: { type: "factory" } })).rejects.toMatchObject({ code: "CONFLICT" });
    for (const mutation of ["uploaded_by_user_id=20", "channel_id=999", "team_id=8", "owner_membership_id=12", "closed=1"]) {
      sqlite.exec("BEGIN"); sqlite.exec(`UPDATE channel_inventory_upload_batches SET ${mutation}`); sqlite.exec("COMMIT");
      await expect(service.createCustomerMaterial(scope, request)).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|CONFLICT/) });
      sqlite.exec(`UPDATE channel_inventory_upload_batches SET uploaded_by_user_id=10,channel_id=${batch.channelId},team_id=7,owner_membership_id=11,closed=0`);
    }
    expect(materialInserts()).toHaveLength(0); expect(count("channel_inventory_materials")).toBe(0);
  });
  it("input identity guard and unavailable empty-proof SQL never silently enable upload", async () => {
    await prepare();
    await expect(readContext(scope, { ...contextInput, expectedActorUserId: 20 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    failSql = /upload_material.channel_id = c.id/;
    await expect(readContext()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
  it("minimal source AST contains one helper and one insertion after original policy/writeFence", () => {
    const path = new URL("../client/src/business/platform/front-router-types/server/services/customerSupply.ts", import.meta.url);
    const source = ts.createSourceFile(path.pathname, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    const owner = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "createCustomerSupplyService") as ts.FunctionDeclaration;
    const context = owner.body!.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "context") as ts.FunctionDeclaration;
    const originalTry = context.body!.statements.filter(ts.isTryStatement).at(-1)!;
    expect(originalTry.tryBlock.statements).toHaveLength(3);
    expect(originalTry.tryBlock.statements[0].getText(source)).toContain("assertCrmCustomerPolicy");
    expect(originalTry.tryBlock.statements[1].getText(source)).toBe("await writeFence(tx, scope, link ? Number(link.channelId) : undefined);");
    expect(originalTry.tryBlock.statements[2].getText(source)).toContain("ownEmptyUploadChannel");
    expect(source.statements.filter(n => ts.isFunctionDeclaration(n) && n.name?.text === "ownEmptyUploadChannel")).toHaveLength(1);
    expect(commits).toBe(0);
  });
});

const automaticBatchInput = () => {
  const { sourceProfile: _profile, ...input } = batchInput;
  return input;
};
const automaticMaterialInput = () => {
  const { uploadBatchId: _batch, ...input } = rowInput(1);
  return input;
};
const sourceRows = () => sqlite.prepare("SELECT * FROM channel_inventory_channels ORDER BY id").all();
const linkRows = () => sqlite.prepare("SELECT * FROM crm_customer_supply_channels ORDER BY channelId").all();
const noCustomerOrChannelUpdates = () => expect(queries.some(q => /^\s*UPDATE\s+(crm_customers|crm_customer_contact\w*|channel_inventory_channels)\b/.test(q.sql))).toBe(false);

describe("customer-bound uploads without sourceProfile (offline native services)", () => {
  it("first batch defaults only its new source to other, with null contact copies and original request UUID", async () => {
    sqlite.exec("INSERT INTO crm_customer_contacts VALUES (1,'PRIVATE CRM CONTACT','13800000000',1)");
    const beforeCustomer = sqlite.prepare("SELECT * FROM crm_customers WHERE id=1").get();
    const input = automaticBatchInput();
    const batch = await service.createCustomerUploadBatch(scope, input);
    expect(input).not.toHaveProperty("sourceProfile");
    expect(sourceRows()).toHaveLength(1);
    expect(sourceRows()[0]).toMatchObject({ id: batch.channelId, channel_type: "other", name: "客户甲（当前CRM）", industryCode: "automotive", contact_name: null, phone: null, wechat: null, qq: null, notes: null, create_request_id: batchRequestId, revision: 1 });
    expect(linkRows()).toEqual([expect.objectContaining({ customerId: 1, inventoryResponsibleUserId: 10, channelId: batch.channelId, customerVersionAtBind: 3, firstRequestId: batchRequestId })]);
    expect(await readContext()).toMatchObject({ channel: { id: batch.channelId, type: "other" }, canUpload: true });
    const row = await service.createCustomerMaterial(scope, rowInput(batch.id));
    expect(row).toMatchObject({ customerId: 1, channelId: batch.channelId, item: { uploadBatchId: batch.id } });
    expect(count("channel_inventory_material_shares")).toBe(1); expect(count("channel_inventory_upload_batch_materials")).toBe(1);
    expect(sqlite.prepare("SELECT * FROM crm_customers WHERE id=1").get()).toEqual(beforeCustomer);
    expect(commits).toBe(3); expect(rollbacks).toBe(0); noCustomerOrChannelUpdates();
  });
  it("first unbatched material also creates other atomically; retry and a new UUID reuse the same customer channel", async () => {
    const input = automaticMaterialInput();
    const first = await service.createCustomerMaterial(scope, input);
    const beforeSource = sourceRows(); const beforeLink = linkRows();
    expect(beforeSource[0]).toMatchObject({ channel_type: "other", create_request_id: rowRequestId, contact_name: null, phone: null });
    service = newService();
    const replay = await service.createCustomerMaterial(scope, input);
    expect(replay).toMatchObject({ channelId: first.channelId, item: { id: first.item.id }, idempotent: true });
    const next = await service.createCustomerMaterial(scope, { ...input, requestId: "33333333-3333-4333-8333-333333333333" });
    expect(next.channelId).toBe(first.channelId); expect(next.item.id).not.toBe(first.item.id);
    expect(sourceRows()).toEqual(beforeSource); expect(linkRows()).toEqual(beforeLink);
    expect(count("channel_inventory_materials")).toBe(2); expect(count("channel_inventory_material_shares")).toBe(2);
    expect(commits).toBe(3); noCustomerOrChannelUpdates();
  });
  it("same batch UUID replay never creates a duplicate channel, link or batch; changed payload still conflicts", async () => {
    const input = automaticBatchInput(); const first = await service.createCustomerUploadBatch(scope, input);
    const beforeSource = sourceRows(); const beforeLink = linkRows();
    service = newService(); expect(await service.createCustomerUploadBatch(scope, input)).toEqual(first);
    await expect(service.createCustomerUploadBatch(scope, { ...input, fileName: "changed.xlsx" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(sourceRows()).toEqual(beforeSource); expect(linkRows()).toEqual(beforeLink); expect(count("channel_inventory_upload_batches")).toBe(1);
    noCustomerOrChannelUpdates();
  });
  it("two overlapping requests serialize at the outer transaction and replay one customer source", async () => {
    // This deterministic queue emulates the production customer FOR UPDATE
    // serialization; SQLite does NOT prove MySQL locking or live concurrency.
    const transaction = db.transaction; let tail: Promise<unknown> = Promise.resolve();
    db.transaction = fn => {
      const pending = tail.then(() => transaction(fn));
      tail = pending.then(() => undefined, () => undefined);
      return pending;
    };
    const input = automaticBatchInput();
    const [a, b] = await Promise.all([service.createCustomerUploadBatch(scope, input), newService().createCustomerUploadBatch(scope, input)]);
    expect(a).toEqual(b); expect(count("channel_inventory_channels")).toBe(1); expect(count("crm_customer_supply_channels")).toBe(1); expect(count("channel_inventory_upload_batches")).toBe(1);
    expect(queries.filter(q => q.sql.includes("FROM crm_customers sc")).every(q => q.sql.includes("FOR UPDATE"))).toBe(true);
    expect(queries.filter(q => q.sql.includes("SELECT channelId FROM crm_customer_supply_channels")).every(q => q.sql.includes("FOR UPDATE"))).toBe(true);
    expect(() => sqlite.prepare("INSERT INTO crm_customer_supply_channels SELECT * FROM crm_customer_supply_channels").run()).toThrow(/UNIQUE/);
  });
  it.each(["factory", "agent", "trade", "other"] as const)("existing %s binding without profile reuses exact records for batch and material; explicit mismatch still conflicts", async type => {
    sqlite.prepare("INSERT INTO channel_inventory_channels (id,enterprise_id,data_owner_user_id,responsible_user_id,name,industryCode,channel_type,contact_name,phone,active,revision) VALUES (55,1,99,10,'OLD PRIVATE NAME','automotive',?,'OLD CONTACT','OLD PHONE',1,4)").run(type);
    sqlite.exec("INSERT INTO enterprise_team_record_assignments (enterpriseId,recordType,recordId,currentOwnerUserId,createdByUserId,teamId,revision) VALUES (1,'channel',55,10,10,7,4); INSERT INTO crm_customer_supply_channels VALUES (1,99,1,10,55,2,'old-request',1)");
    const beforeSource = sourceRows(); const beforeLink = linkRows();
    const batch = await service.createCustomerUploadBatch(scope, { ...automaticBatchInput(), expectedChannelId: 55, expectedChannelRevision: 4 });
    const row = await service.createCustomerMaterial(scope, rowInput(batch.id));
    expect(batch.channelId).toBe(55); expect(row.channelId).toBe(55);
    expect(sqlite.prepare("SELECT create_payload_hash FROM channel_inventory_materials WHERE id=?").get(row.item.id)!.create_payload_hash).toBe(channelInventoryPayloadHash({
      channelId: 55, partNumber: "SAME-PART", brand: "TI", qty: 0, dateCode: null, price: "0.000000000001", currency: "CNY", taxIncluded: null, leadTime: null, note: null,
      uploadBatchId: batch.id, customerSupply: { customerId: 1, expectedCustomerVersion: 3, sourceType: type },
    }));
    expect(await service.createCustomerMaterial(scope, { ...rowInput(batch.id), sourceProfile: { type } })).toMatchObject({ item: { id: row.item.id }, idempotent: true });
    await expect(service.createCustomerMaterial(scope, { ...rowInput(batch.id), sourceProfile: { type: type === "factory" ? "trade" : "factory" } })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(sourceRows()).toEqual(beforeSource); expect(linkRows()).toEqual(beforeLink); noCustomerOrChannelUpdates();
    expect(queries.some(q => /^\s*INSERT INTO (channel_inventory_channels|crm_customer_supply_channels)\b/.test(q.sql))).toBe(false);
  });
  it.each(["factory", "agent", "trade", "other"] as const)("first explicit %s type is still honored, not rewritten to other", async type => {
    const batch = await service.createCustomerUploadBatch(scope, { ...batchInput, sourceProfile: { type } });
    expect(sourceRows()[0]).toMatchObject({ id: batch.channelId, channel_type: type, create_request_id: batchRequestId });
    expect(sourceRows()[0].create_payload_hash).toBe(channelInventoryPayloadHash({ name: "客户甲（当前CRM）", industryCode: "automotive", type, contactName: null, phone: null, wechat: null, qq: null, notes: null, active: true }));
    expect((await service.createCustomerUploadBatch(scope, { ...batchInput, sourceProfile: { type } })).channelId).toBe(batch.channelId);
    expect(count("channel_inventory_channels")).toBe(1); noCustomerOrChannelUpdates();
  });
  it.each([
    ["CRM write", "UPDATE enterprise_member_module_access SET writeAllowed=0 WHERE module='customers'"],
    ["stocks write", "UPDATE enterprise_member_module_access SET writeAllowed=0 WHERE module='stocks'"],
    ["stocks read", "UPDATE enterprise_member_module_access SET readAllowed=0 WHERE module='stocks'"],
    ["channels write", "UPDATE enterprise_member_module_access SET writeAllowed=0 WHERE module='channels'"],
    ["ERP inventory", "DELETE FROM enterprise_member_permissions WHERE permissionKey='inventory.manage' AND enterpriseMemberId=1"],
    ["CRM record visibility", "UPDATE crm_customers SET assignedUserId=20 WHERE id=1"],
    ["disabled account", "UPDATE users SET loginDisabled=1 WHERE id=10"],
    ["suspended membership", "UPDATE enterprise_members SET status='suspended' WHERE userId=10"],
    ["data owner changed", "UPDATE enterprises SET crmDataOwnerUserId=199 WHERE id=1"],
    ["no team", "DELETE FROM enterprise_team_members WHERE userId=10"],
    ["inactive team", "UPDATE enterprise_teams SET status='inactive' WHERE id=7"],
    ["ambiguous teams", "INSERT INTO enterprise_team_members VALUES (13,1,8,10,'member')"],
    ["customer version", "UPDATE crm_customers SET version=4 WHERE id=1"],
    ["archived customer", "UPDATE crm_customers SET archivedAt='2026-11-15' WHERE id=1"],
  ])("missing profile never bypasses %s on either creation entrypoint", async (_name, mutation) => {
    sqlite.exec(mutation);
    await expect(service.createCustomerUploadBatch(scope, automaticBatchInput())).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|NOT_FOUND|PRECONDITION_FAILED|CONFLICT/) });
    await expect(service.createCustomerMaterial(scope, automaticMaterialInput())).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|NOT_FOUND|PRECONDITION_FAILED|CONFLICT/) });
    expect(sourceRows()).toHaveLength(0); expect(linkRows()).toHaveLength(0); expect(count("channel_inventory_materials")).toBe(0); expect(count("channel_inventory_upload_batches")).toBe(0);
  });
  it.each(["read", "write", "inventoryScopeWrite", "customerScopeRead"])("missing profile cannot bypass revoked official %s", async permission => {
    // The real BFF intersects native write with inventory scope write before
    // signing; a scope revoke therefore also clears the signed write bit.
    const official: ChannelInventoryScope = { ...scope, officialActor: { adminAccountId: 303, bindingVersion: 7, requestId: "signed-test-request", inventoryPermissions: { read: true, write: true, note: false, inventoryScopeWrite: true, customerScopeRead: true, authorizationVersion: "offline-v1", [permission]: false, ...(permission === "inventoryScopeWrite" ? { write: false } : {}) } } };
    await expect(service.createCustomerUploadBatch(official, automaticBatchInput())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.createCustomerMaterial(official, automaticMaterialInput())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(sourceRows()).toHaveLength(0); expect(linkRows()).toHaveLength(0);
  });
  it.each([
    "UPDATE channel_inventory_channels SET active=0",
    "UPDATE channel_inventory_channels SET responsible_user_id=20",
    "UPDATE enterprise_team_record_assignments SET currentOwnerUserId=20",
    "UPDATE enterprise_team_record_assignments SET teamId=8",
    "UPDATE enterprise_team_record_assignments SET revision=0",
  ])("missing profile preserves bound channel write fence: %s", async mutation => {
    const batch = await service.createCustomerUploadBatch(scope, automaticBatchInput()); sqlite.exec(mutation);
    const beforeSource = sourceRows(); const beforeLink = linkRows();
    await expect(service.createCustomerUploadBatch(scope, automaticBatchInput())).rejects.toMatchObject({ code: expect.stringMatching(/NOT_FOUND|PRECONDITION_FAILED/) });
    await expect(service.createCustomerMaterial(scope, rowInput(batch.id))).rejects.toMatchObject({ code: expect.stringMatching(/NOT_FOUND|PRECONDITION_FAILED/) });
    expect(sourceRows()).toEqual(beforeSource); expect(linkRows()).toEqual(beforeLink); expect(count("channel_inventory_materials")).toBe(0);
  });
  it("missing profile keeps expected channel CAS, explicit existing ID and selected-channel occupancy conflicts", async () => {
    const input = automaticBatchInput(); const batch = await service.createCustomerUploadBatch(scope, input);
    await expect(service.createCustomerUploadBatch(scope, { ...input, expectedChannelId: batch.channelId + 1 })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(service.createCustomerUploadBatch(scope, { ...input, expectedChannelRevision: 2 })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(service.createCustomerMaterial(scope, { ...rowInput(batch.id), sourceProfile: { type: "other", existingChannelId: batch.channelId + 1 } })).rejects.toMatchObject({ code: "CONFLICT" });
    const otherCustomer = { ...automaticMaterialInput(), customerId: 2, expectedCustomerVersion: 2, sourceProfile: { type: "other" as const, existingChannelId: batch.channelId } };
    await expect(service.createCustomerMaterial(scope, otherCustomer)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(service.createCustomerUploadBatch(scope, { ...input, customerId: 2, expectedCustomerVersion: 2, sourceProfile: otherCustomer.sourceProfile, requestId: rowRequestId })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(sourceRows()).toHaveLength(1); expect(linkRows()).toHaveLength(1); expect(count("channel_inventory_materials")).toBe(0);
  });
  it("another customer cannot upload to current batch; failure rolls back only attempted source, normal upload gets its own channel", async () => {
    const batch = await service.createCustomerUploadBatch(scope, automaticBatchInput());
    const beforeSource = sourceRows(); const beforeLink = linkRows();
    await expect(service.createCustomerMaterial(scope, { ...rowInput(batch.id), customerId: 2, expectedCustomerVersion: 2 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(sourceRows()).toEqual(beforeSource); expect(linkRows()).toEqual(beforeLink); expect(count("channel_inventory_materials")).toBe(0);
    const row = await service.createCustomerMaterial(scope, { ...automaticMaterialInput(), customerId: 2, expectedCustomerVersion: 2 });
    expect(row.customerId).toBe(2); expect(row.channelId).not.toBe(batch.channelId);
    expect(linkRows().map(link => [link.customerId, link.channelId])).toEqual([[1, batch.channelId], [2, row.channelId]]);
  });
  it.each([/INSERT INTO channel_inventory_channels/, /INSERT INTO crm_customer_supply_channels/, /INSERT INTO channel_inventory_upload_batches/, /INSERT INTO channel_inventory_management_requests/])("first automatic batch failure at %s rolls back source/link/batch/request together and resumes original UUID", async failing => {
    failSql = failing;
    await expect(service.createCustomerUploadBatch(scope, automaticBatchInput())).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    for (const table of ["channel_inventory_channels", "crm_customer_supply_channels", "enterprise_team_record_assignments", "channel_inventory_upload_batches", "channel_inventory_management_requests"]) expect(count(table)).toBe(0);
    expect(commits).toBe(0); expect(rollbacks).toBe(1);
    failSql = null; const resumed = await newService().createCustomerUploadBatch(scope, automaticBatchInput());
    expect(sourceRows()[0]).toMatchObject({ id: resumed.channelId, channel_type: "other", create_request_id: batchRequestId });
  });
  it.each([/INSERT INTO crm_customer_supply_channels/, /INSERT INTO channel_inventory_materials\s/, /INSERT INTO enterprise_team_record_assignments/, /INSERT INTO channel_inventory_material_shares\s/, /INSERT INTO channel_inventory_material_share_audits/])("first automatic material failure at %s rolls back source/link/material/claims together", async failing => {
    failSql = failing;
    await expect(service.createCustomerMaterial(scope, automaticMaterialInput())).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    for (const table of ["channel_inventory_channels", "crm_customer_supply_channels", "enterprise_team_record_assignments", "channel_inventory_materials", "channel_inventory_material_shares", "channel_inventory_material_share_audits"]) expect(count(table)).toBe(0);
    expect(commits).toBe(0); expect(rollbacks).toBe(1);
    failSql = null; const resumed = await newService().createCustomerMaterial(scope, automaticMaterialInput());
    expect(sourceRows()[0]).toMatchObject({ id: resumed.channelId, channel_type: "other", create_request_id: rowRequestId });
    expect(count("channel_inventory_materials")).toBe(1); expect(count("channel_inventory_material_shares")).toBe(1);
  });
  it.each(["channelId", "responsibleUserId", "enterpriseId", "dataOwnerUserId", "name", "contactName", "phone", "officialInventoryPermissions"])("missing profile does not admit custom top-level %s", async field => {
    await expect(service.createCustomerUploadBatch(scope, { ...automaticBatchInput(), [field]: 666 })).rejects.toThrow();
    await expect(service.createCustomerMaterial(scope, { ...automaticMaterialInput(), [field]: 666 })).rejects.toThrow();
    expect(commits).toBe(0); expect(rollbacks).toBe(0); expect(queries).toHaveLength(0);
  });
  it("identity mismatch without profile rejects before any transaction", async () => {
    await expect(service.createCustomerUploadBatch(scope, { ...automaticBatchInput(), expectedEnterpriseId: 2 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.createCustomerMaterial(scope, { ...automaticMaterialInput(), expectedActorUserId: 20 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(queries).toHaveLength(0); expect(commits).toBe(0); expect(rollbacks).toBe(0);
  });
});
