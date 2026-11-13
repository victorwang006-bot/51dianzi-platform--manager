import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { z } from "zod";
import { businessIndustryCodeSchema } from "../client/src/business/platform/shared/businessIndustry";

// Never open the native database. All authorization helpers use the passed mock tx.
vi.mock("../client/src/business/platform/front-router-types/server/db", () => ({ getDb: () => { throw new Error("REAL DATABASE FORBIDDEN IN OFFLINE TEST"); } }));
// The router-type snapshot has only a .d.mts for the unrelated CRM write runtime.
// Execute the exact checked-in read function declarations, not replacement policy mocks.
vi.mock("../client/src/business/platform/front-router-types/server/services/crmCustomers", async () => {
  const { readFileSync } = await import("node:fs");
  const { default: ts } = await import("typescript");
  const { sql } = await import("drizzle-orm");
  const { TRPCError } = await import("@trpc/server");
  const { resolveBusinessModuleAccess } = await import("../client/src/business/platform/front-router-types/server/services/businessModuleAccess");
  const path = new URL("../client/src/business/platform/front-router-types/server/services/crmCustomers.ts", import.meta.url);
  const source = ts.createSourceFile(path.pathname, readFileSync(path,"utf8"), ts.ScriptTarget.Latest, true);
  const names = ["resolveCrmCustomerPolicy","crmCustomerPolicyWhere","assertCrmCustomerPolicy","resultRows"];
  const declarations = source.statements.filter(node => ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text));
  if (declarations.length !== names.length) throw new Error("CRM source read declarations changed");
  const code = ts.transpileModule(declarations.map(node=>node.getText(source)).join("\n"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  return new Function("sql","TRPCError","resolveBusinessModuleAccess",`const exports={}; ${code}; return exports;`)(sql,TRPCError,resolveBusinessModuleAccess);
});
// Publication metadata has separate tests and is not an inventory/source/CRM grant.
vi.mock("../client/src/business/platform/front-router-types/server/services/channelFactoryPublication", () => ({
  createChannelFactoryPublicationService: vi.fn(), factoryMaterialPublicationMetadata: async () => new Map(),
}));
import { createChannelTeamInventoryService, customerTeamInventoryBindingPredicate } from "../client/src/business/platform/front-router-types/server/services/channelTeamInventory";
import { channelInventoryListBusinessInputSchema } from "./channelInventoryListBusinessInput";
import type { ChannelInventoryScope, SqlDatabase } from "../client/src/business/platform/front-router-types/server/services/channelInventory";

const routerSource = ts.createSourceFile("channelInventory.ts", readFileSync(new URL("../client/src/business/platform/front-router-types/server/routers/channelInventory.ts",import.meta.url),"utf8"),ts.ScriptTarget.Latest,true);
const declaration = routerSource.statements.flatMap(node=>ts.isVariableStatement(node)?[...node.declarationList.declarations]:[]).find(node=>node.name.getText(routerSource)==="teamMaterialsSchema");
if (!declaration?.initializer) throw new Error("Actual router input schema declaration missing");
const positiveInt=z.number().int().safe().positive();
const teamMaterialsSchema = new Function("z","positiveInt","expectedContextSchema","businessIndustryCodeSchema","pageSchema","pageSizeSchema",`return ${declaration.initializer.getText(routerSource)}`)(z,positiveInt,{expectedEnterpriseId:positiveInt.optional(),expectedActorUserId:positiveInt.optional()},businessIndustryCodeSchema,z.number().int().safe().min(1).max(1_000_000).default(1),z.number().int().safe().min(1).max(100).default(20)) as z.ZodType;
const scope: ChannelInventoryScope = { enterpriseId: 1, dataOwnerUserId: 99, actorUserId: 10, isOwner: false, inventoryDataScope: "enterprise", permissionSnapshot: true };
const dialect = new MySqlDialect();
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
let sqlite: DatabaseSyncType;
let statements: { sql: string; params: unknown[] }[];
let service: ReturnType<typeof createChannelTeamInventoryService>;
const input = (customerId?: number, extra = {}) => ({ page: 1, pageSize: 20, ...(customerId === undefined ? {} : { customerId }), ...extra });

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:"); statements = [];
  sqlite.exec(`
    CREATE TABLE enterprises (id INTEGER, superAdminUserId INTEGER, crmDataOwnerUserId INTEGER);
    CREATE TABLE users (id INTEGER, loginDisabled INTEGER);
    CREATE TABLE enterprise_members (id INTEGER, enterpriseId INTEGER, userId INTEGER, role TEXT, status TEXT);
    CREATE TABLE enterprise_member_permissions (enterpriseMemberId INTEGER, permissionKey TEXT);
    CREATE TABLE enterprise_teams (id INTEGER, enterpriseId INTEGER, status TEXT);
    CREATE TABLE enterprise_team_members (id INTEGER, enterpriseId INTEGER, teamId INTEGER, userId INTEGER, teamRole TEXT);
    CREATE TABLE enterprise_member_module_access (id INTEGER, enterpriseId INTEGER, userId INTEGER, module TEXT, readAllowed INTEGER, writeAllowed INTEGER, dataScope TEXT, revision INTEGER);
    CREATE TABLE enterprise_team_record_assignments (id INTEGER, enterpriseId INTEGER, recordType TEXT, recordId INTEGER, currentOwnerUserId INTEGER, createdByUserId INTEGER, teamId INTEGER, revision INTEGER);
    CREATE TABLE channel_inventory_channels (id INTEGER, enterprise_id INTEGER, data_owner_user_id INTEGER, responsible_user_id INTEGER, name TEXT, industryCode TEXT);
    CREATE TABLE channel_inventory_materials (id INTEGER, enterprise_id INTEGER, data_owner_user_id INTEGER, responsible_user_id INTEGER, channel_id INTEGER, part_number TEXT, brand TEXT, qty INTEGER, date_code TEXT, price TEXT, currency TEXT, tax_included INTEGER, lead_time TEXT, revision INTEGER, updated_at TEXT, created_at TEXT);
    CREATE TABLE channel_inventory_material_shares (enterprise_id INTEGER, material_id INTEGER, enabled INTEGER, owner_user_id INTEGER, share_team_id INTEGER, assignment_revision INTEGER, owner_membership_id INTEGER);
    CREATE TABLE channel_inventory_material_management (enterprise_id INTEGER, material_id INTEGER, deleted_at TEXT);
    CREATE TABLE channel_inventory_upload_batch_materials (enterprise_id INTEGER, material_id INTEGER, batch_id INTEGER);
    CREATE TABLE channel_inventory_collaboration_notes (enterpriseId INTEGER, materialId INTEGER);
    CREATE TABLE crm_customers (id INTEGER, enterpriseId INTEGER, assignedUserId INTEGER, name TEXT, industryCode TEXT, version INTEGER, archivedAt TEXT);
    CREATE TABLE crm_customer_supply_channels (enterpriseId INTEGER, dataOwnerUserId INTEGER, customerId INTEGER, inventoryResponsibleUserId INTEGER, channelId INTEGER);
    CREATE TABLE crm_customer_contact_primary (enterpriseId INTEGER, customerId INTEGER, primaryContactId TEXT, legacyContactPresent INTEGER);
    CREATE TABLE crm_customer_contacts (customerId INTEGER, contactName TEXT, phone TEXT, isPrimary INTEGER);
    INSERT INTO enterprises VALUES (1,99,99);
    INSERT INTO users VALUES (10,0),(20,0),(30,0);
    INSERT INTO enterprise_members VALUES (1,1,10,'staff','active'),(2,1,20,'staff','active'),(3,1,30,'staff','active');
    INSERT INTO enterprise_member_permissions VALUES (1,'inventory.manage'),(1,'customers.manage'),(2,'inventory.manage');
    INSERT INTO enterprise_teams VALUES (7,1,'active');
    INSERT INTO enterprise_team_members VALUES (11,1,7,10,'member'),(12,1,7,20,'member');
    INSERT INTO enterprise_member_module_access VALUES (1,1,10,'stocks',1,1,'team',1),(2,1,10,'customers',1,1,'self',1),(3,1,20,'stocks',1,1,'team',1);
    INSERT INTO crm_customers VALUES (1,1,10,'客户甲（当前名称）','automotive',3,NULL),(2,1,10,'客户乙','automotive',2,NULL),(3,1,30,'不可读客户','automotive',1,NULL);
    INSERT INTO crm_customer_supply_channels VALUES (1,99,1,10,101),(1,99,1,20,102),(1,99,2,10,104),(1,999,1,10,105),(1,99,1,20,106),(1,99,1,20,107),(2,99,1,10,108),(1,99,3,10,109);
  `);
  const fixtures = [
    [101, 1, 99, 10, 10, true], [102, 1, 99, 20, 10, true],
    [103, 1, 99, 10, 10, true], [104, 1, 99, 10, 10, true],
    [105, 1, 999, 10, 10, true], [106, 1, 99, 20, 20, true],
    [107, 1, 99, 20, 10, false], [108, 2, 99, 10, 10, true], [109, 1, 99, 10, 10, true],
  ] as const;
  for (const [id, enterprise, owner, actor, creator, shared] of fixtures) {
    sqlite.prepare("INSERT INTO channel_inventory_channels VALUES (?,?,?,?,?,?)").run(id, enterprise, owner, actor, "STALE PRIVATE CHANNEL NAME", "automotive");
    sqlite.prepare("INSERT INTO channel_inventory_materials VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id, enterprise, owner, actor, id, "SAME-PART", "TI", 12, "2440", "1.00", "CNY", 1, "现货", 1, "2026-11-13", "2026-11-12");
    sqlite.prepare("INSERT INTO enterprise_team_record_assignments VALUES (?,?,?,?,?,?,?,?)").run(id, enterprise, "channel_material", id, actor, creator, 7, 1);
    if (actor === 20 && shared) sqlite.prepare("INSERT INTO channel_inventory_material_shares VALUES (?,?,?,?,?,?,?)").run(enterprise, id, 1, actor, 7, 1, 12);
  }
  const tx = { rollback: () => { throw new Error("rollback marker"); }, execute: async (query: SQL) => {
    const compiled = dialect.sqlToQuery(query); statements.push(compiled);
    // SQLite only stands in for result execution; production SQL itself is captured
    // unchanged. MySQL current-read lock syntax is the only syntax stripped.
    const executable = compiled.sql.replace(/\s+FOR UPDATE\b/g, "");
    return [sqlite.prepare(executable).all(...compiled.params.map(value => typeof value === "boolean" ? Number(value) : value) as never[])];
  } };
  const db: SqlDatabase = { execute: tx.execute, transaction: async fn => fn(tx) };
  service = createChannelTeamInventoryService({ getDb: async () => db });
});
afterEach(() => sqlite.close());

const ids = (result: Awaited<ReturnType<typeof service.listTeamMaterials>>) => result.items.map(row => row.id).sort((a,b) => a-b);

describe("customer channel inventory server contract (offline real predicates)", () => {
  it("two customers with one enterprise/data owner remain exact, including multiple confirmed upload actors", async () => {
    const a = await service.listTeamMaterials(scope, input(1));
    expect(ids(a)).toEqual([101,102]); expect(a).toMatchObject({ customerId:1,bindingCount:2,total:2,pageCount:1 });
    expect(a.items.every(row => row.canViewSource === true)).toBe(true);
    expect(a.items.map(row => row.company)).toEqual([{id:1,name:"客户甲（当前名称）"},{id:1,name:"客户甲（当前名称）"}]);
    const b = await service.listTeamMaterials(scope, input(2));
    expect(ids(b)).toEqual([104]); expect(b).toMatchObject({customerId:2,bindingCount:1,total:1});
  });
  it("excludes unbound/same model, foreign owner/enterprise, unreadable channel and unreadable source in SQL", async () => {
    const result = await service.listTeamMaterials(scope, input(1));
    expect(ids(result)).not.toContain(103); expect(ids(result)).not.toContain(105); expect(ids(result)).not.toContain(106); expect(ids(result)).not.toContain(107); expect(ids(result)).not.toContain(108);
    const totals = statements.filter(q => q.sql.startsWith("SELECT COUNT(*) AS total"));
    expect(totals).toHaveLength(1);
    expect(totals[0].sql).toContain("customer_inventory_link.customerId = ?");
    expect(totals[0].sql).toContain("customer_inventory_link.channelId = m.channel_id");
    expect(totals[0].sql).toContain("source_a.recordType = 'channel_material'");
    expect(totals[0].sql).not.toContain("inventoryResponsibleUserId");
    expect(totals[0].sql).toContain("FOR UPDATE");
  });
  it("counts readable bindings before filters/pagination, not only rows on the current page", async () => {
    expect(await service.listTeamMaterials(scope,input(1,{partNumber:"NOT-FOUND"}))).toMatchObject({bindingCount:2,total:0,items:[]});
    const page = await service.listTeamMaterials(scope,input(1,{page:2,pageSize:1}));
    expect(page).toMatchObject({bindingCount:2,total:2,page:2,pageSize:1,pageCount:2}); expect(page.items).toHaveLength(1);
  });
  it("no confirmed readable bindings returns a proved empty customer result", async () => {
    sqlite.exec("DELETE FROM crm_customer_supply_channels WHERE customerId=1");
    expect(await service.listTeamMaterials(scope,input(1))).toMatchObject({customerId:1,bindingCount:0,total:0,items:[],pageCount:0});
  });
  it("optional exact channel intersects bindings without requiring the current upload actor", async () => {
    expect(ids(await service.listTeamMaterials(scope,input(1,{channelId:102})))).toEqual([102]);
    for (const channelId of [103,104,106,107]) await expect(service.listTeamMaterials(scope,input(1,{channelId}))).rejects.toMatchObject({code:"FORBIDDEN"});
  });
  it("global mode keeps its original row scope, including source-hidden rows and other companies", async () => {
    const global = await service.listTeamMaterials(scope,input());
    expect(ids(global)).toEqual([101,102,103,104,106,109]); expect(global.total).toBe(6);
    expect(global).not.toHaveProperty("customerId"); expect(global).not.toHaveProperty("bindingCount");
    expect(global.items.find(row => row.id===103)?.company).toBeNull();
    expect(global.items.find(row => row.id===106)).toMatchObject({canViewSource:false,company:null});
    expect(global.items.find(row => row.id===109)).toMatchObject({canViewSource:false,company:null});
    expect(global.items.find(row => row.id===104)?.company).toEqual({id:2,name:"客户乙"});
  });
  it("missing native CRM read hides company projection globally but denies customer mode", async () => {
    sqlite.exec("DELETE FROM enterprise_member_permissions WHERE permissionKey='customers.manage'");
    const global=await service.listTeamMaterials(scope,input());
    expect(global.total).toBe(6); expect(global.items.every(row=>row.company===null)).toBe(true);
    await expect(service.listTeamMaterials(scope,input(1))).rejects.toMatchObject({code:"FORBIDDEN"});
  });
  it("rejects inaccessible CRM record and changed signed customer scope", async () => {
    await expect(service.listTeamMaterials(scope,input(3))).rejects.toMatchObject({code:"NOT_FOUND"});
    await expect(service.listTeamMaterials({...scope,officialActor:{adminAccountId:303,bindingVersion:7,requestId:"signed-test-request",inventoryPermissions:{read:true,write:false,note:false,publish:false,customerScopeRead:false,authorizationVersion:"test"}}},input(1))).rejects.toMatchObject({code:"FORBIDDEN"});
  });
  it("stocks explicit deny and broken shares never become CRM authorization fallbacks", async () => {
    sqlite.exec("UPDATE channel_inventory_material_shares SET assignment_revision=2");
    expect(ids(await service.listTeamMaterials(scope,input(1)))).toEqual([101]);
    sqlite.exec("UPDATE enterprise_member_module_access SET readAllowed=0 WHERE userId=10 AND module='stocks'");
    await expect(service.listTeamMaterials(scope,input(1))).rejects.toMatchObject({code:"FORBIDDEN"});
  });
  it("input validation is strict at BFF, actual router schema and direct service", async () => {
    expect(teamMaterialsSchema.parse({customerId:1})).toEqual(channelInventoryListBusinessInputSchema.parse({customerId:1}));
    for (const customerId of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,"1",null]) {
      expect(teamMaterialsSchema.safeParse({customerId}).success).toBe(false);
      expect(channelInventoryListBusinessInputSchema.safeParse({customerId}).success).toBe(false);
      await expect(service.listTeamMaterials(scope,input(customerId as number))).rejects.toMatchObject({code:"BAD_REQUEST"});
    }
    for (const field of ["dataOwnerUserId","companyName","customerScopeRead","canManageAll"])
      expect(teamMaterialsSchema.safeParse({customerId:1,[field]:true}).success).toBe(false);
    await expect(service.listTeamMaterials(scope,input(1,{expectedActorUserId:20}))).rejects.toMatchObject({code:"FORBIDDEN"});
    expect(dialect.sqlToQuery(customerTeamInventoryBindingPredicate(scope,1)).params).toEqual([1,99,1]);
  });
});
