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
import { ChannelInventoryError, type ChannelInventoryScope, type SqlDatabase, type SqlExecutor, type RegisterTeamRecord } from "../client/src/business/platform/front-router-types/server/services/channelInventory";

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
    CREATE TABLE crm_customer_supply_channels (enterpriseId INTEGER, dataOwnerUserId INTEGER, customerId INTEGER, inventoryResponsibleUserId INTEGER, channelId INTEGER, customerVersionAtBind INTEGER, firstRequestId TEXT, schemaVersion INTEGER);
    CREATE TABLE crm_customer_contact_primary (enterpriseId INTEGER, customerId INTEGER, primaryContactId TEXT, legacyContactPresent INTEGER);
    CREATE TABLE crm_customer_contacts (customerId INTEGER, contactName TEXT, phone TEXT, isPrimary INTEGER);
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
    await expect(service.createCustomerMaterial(scope, rowInput(batch.id))).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(count("channel_inventory_materials")).toBe(0);
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
