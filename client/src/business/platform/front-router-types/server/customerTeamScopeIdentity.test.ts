import { execFileSync } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
const mocks = vi.hoisted(() => ({ db: null as any, policy: vi.fn() }));
vi.mock("./db", () => ({ getDb: async () => mocks.db }));
vi.mock("./services/businessModuleAccess", () => ({ resolveBusinessModuleAccess: mocks.policy, businessBoolean: (v: unknown) => v === true || v === 1 || v === "1" }));
vi.mock("./teamManagement/businessRuntime.mjs", () => ({ createRuntimeTeamBusinessAdapter: () => ({ registerInsertedRecord: vi.fn() }) }));
vi.mock("./customerOwnershipQuota", () => ({ consumeCustomerOwnershipQuota: vi.fn() }));
import { customerListSchema, customerListScopeSchema } from "../../shared/crmCustomers";
import { customerListInputSchema } from "./customerListInput";
import { customerMemberDisplayName, getCustomerContext, listCustomers } from "./services/crmCustomers";

const dialect = new MySqlDialect();
const enterprise = { enterpriseId: 1, actorUserId: 10, canManageAll: false };
const leader = { ...enterprise, actorUserId: 409506 };
const member = { ...enterprise, actorUserId: 407883 };
let statements: ReturnType<typeof dialect.sqlToQuery>[];
let policies: Map<number, any>;
let teams: any[][];
let memberships: any[][];
let people: any[][];
let enterpriseMembers: any[][];
let customers: any[][];
let assignments: any[][];
let preferences: any[][];

/** Execute emitted SELECT SQL in a fresh process-local :memory: fixture, never getDb/network/real DB.
 * FOR UPDATE is irrelevant to an isolated single-request fixture. No production schema is accessed. */
const program = `import sqlite3,json,sys
p=json.load(sys.stdin)
db=sqlite3.connect(':memory:')
db.row_factory=sqlite3.Row
db.create_function('CONCAT',-1,lambda *args: ''.join(str(x) for x in args))
db.executescript('''
CREATE TABLE enterprises(id INTEGER,superAdminUserId INTEGER);
CREATE TABLE users(id INTEGER,name TEXT,username TEXT,loginDisabled INTEGER);
CREATE TABLE enterprise_members(id INTEGER,enterpriseId INTEGER,userId INTEGER,role TEXT,status TEXT);
CREATE TABLE enterprise_member_permissions(enterpriseMemberId INTEGER,permissionKey TEXT);
CREATE TABLE enterprise_teams(id INTEGER,enterpriseId INTEGER,name TEXT,status TEXT);
CREATE TABLE enterprise_team_members(id INTEGER,enterpriseId INTEGER,teamId INTEGER,userId INTEGER,teamRole TEXT);
CREATE TABLE enterprise_team_record_assignments(enterpriseId INTEGER,teamId INTEGER,recordType TEXT,recordId INTEGER);
CREATE TABLE crm_customers(id INTEGER,enterpriseId INTEGER,assignedUserId INTEGER,createdByUserId INTEGER,name TEXT,industryCode TEXT,province TEXT,city TEXT,district TEXT,address TEXT,scale TEXT,grade TEXT,stage TEXT,source TEXT,nextFollowUpAt TEXT,lastFollowUpAt TEXT,archivedAt TEXT,archiveReason TEXT,createdAt TEXT,updatedAt TEXT,version INTEGER);
CREATE TABLE crm_customer_contacts(customerId INTEGER,isPrimary INTEGER,contactName TEXT,phone TEXT,email TEXT);
CREATE TABLE crm_customer_star_preferences(enterpriseId INTEGER,userId INTEGER,customerId INTEGER,starred INTEGER,revision INTEGER);
''')
for table,rows in p['tables'].items():
 for row in rows: db.execute('INSERT INTO '+table+' VALUES ('+','.join('?' for _ in row)+')',row)
print(json.dumps([dict(r) for r in db.execute(p['sql'].replace('FOR UPDATE',''),p['params'])]))`;
function fixtureRows(query: ReturnType<typeof dialect.sqlToQuery>) {
  return JSON.parse(execFileSync("python3", ["-c", program], { encoding: "utf8", input: JSON.stringify({ ...query, tables: {
    enterprises: [[1, 99], [12, 407883]], users: people, enterprise_members: enterpriseMembers,
    enterprise_member_permissions: [[1, "customers.manage_all"], [99, "customers.manage_all"]],
    enterprise_teams: teams, enterprise_team_members: memberships,
    enterprise_team_record_assignments: assignments, crm_customers: customers,
    crm_customer_contacts: customers.map(c => [c[0], 1, "黄紫银", "1234567", ""]),
    crm_customer_star_preferences: preferences,
  } }) }));
}
function customer(id: number, assignedUserId: number, enterpriseId = 1, updatedAt = "2026-11-15 12:00:00") {
  return [id, enterpriseId, assignedUserId, 407883, `客户${id}`, "semiconductor", "", "", "", "", "unknown", "C", "new", "", null, null, null, null, "2026-01-01 00:00:00", updatedAt, 1];
}
function listReads() { return statements.filter(q => /COUNT\(\*\) AS total|SELECT c.id, c.enterpriseId/.test(q.sql)); }
beforeEach(() => {
  statements = [];
  teams = [[1, 1, "智捷团队1", "active"], [2, 1, "二团队", "active"], [3, 1, "归档团队", "archived"], [1, 12, "其他企业团队", "active"]];
  people = [[10, "企业查看者", "enterprise-reader", 0], [407883, "黄紫银", "GIN", 0], [409506, "莫66", "莫盛明", 0], [30, "禁读", "denied", 0], [40, "禁登录", "disabled", 1], [50, "暂停", "suspended", 0], [60, "别组", "other-team", 0], [99, "企业主", "owner", 0]];
  enterpriseMembers = people.map((p, i) => [p[0] === 99 ? 99 : i + 1, 1, p[0], p[0] === 99 ? "super_admin" : "member", p[0] === 50 ? "suspended" : "active"]);
  enterpriseMembers.push([100, 12, 407883, "super_admin", "active"]);
  memberships = [[1, 1, 2, 10, "member"], [2, 1, 1, 407883, "member"], [3, 1, 1, 409506, "leader"], [4, 1, 1, 30, "member"], [5, 1, 1, 40, "member"], [6, 1, 1, 50, "member"], [7, 1, 2, 60, "member"], [8, 12, 1, 407883, "leader"]];
  policies = new Map(people.map(p => [Number(p[0]), { read: p[0] !== 30, write: false, scope: p[0] === 10 || p[0] === 99 ? "enterprise" : p[0] === 409506 ? "team" : "self", teamId: p[0] === 10 || p[0] === 60 ? 2 : 1, teamRole: p[0] === 409506 ? "leader" : "member", explicit: true }]));
  mocks.policy.mockReset().mockImplementation(async (userId: number) => policies.get(userId));
  customers = [customer(1, 407883), customer(2, 60), customer(3, 407883), customer(4, 407883), customer(5, 407883, 12), customer(6, 409506), customer(7, 409506), customer(8, 407883), customer(9, 407883), customer(10, 407883), customer(11, 407883, 1, "2026-11-16 00:00:00")];
  assignments = [[1, 1, "customer", 1], [1, 1, "customer", 2], [1, 2, "customer", 3], [12, 1, "customer", 5], [1, 1, "customer", 6], [1, 2, "customer", 7], [1, 3, "customer", 8], [1, 1, "demand", 9], [12, 1, "customer", 10], [1, 1, "customer", 11]];
  for (let id = 101; id <= 125; id++) { customers.push(customer(id, 407883)); assignments.push([1, 1, "customer", id]); }
  preferences = customers.filter(c => c[2] === 407883 && Number(c[0]) % 2 === 1).map(c => [c[1], c[2], c[0], 1, 2]);
  const db = { async transaction<T>(run: (tx: any) => Promise<T>) { return run(db); }, async execute(query: SQL) {
    const q = dialect.sqlToQuery(query); statements.push(q); return [fixtureRows(q), []];
  } };
  mocks.db = db;
});

describe("customer team scope schema and scoped display identity", () => {
  it("preserves legacy defaults and requires teamId only for team, including server safeExtend", () => {
    for (const schema of [customerListSchema, customerListInputSchema, customerListScopeSchema]) {
      expect(schema.parse({})).toMatchObject({ scope: "mine" });
      expect(schema.parse({ scope: "all" })).toMatchObject({ scope: "all" });
      expect(schema.parse({ scope: "team", teamId: 1 })).toMatchObject({ scope: "team", teamId: 1 });
      for (const input of [{ scope: "team" }, { scope: "mine", teamId: 1 }, { scope: "all", teamId: 1 }, { scope: "team", teamId: "1" }, { scope: "team", teamId: 0 }, { scope: "team", teamId: 1.2 }, { scope: "team", teamId: Number.MAX_SAFE_INTEGER + 1 }]) expect(schema.safeParse(input).success).toBe(false);
    }
    expect(customerListInputSchema.safeParse({ scope: "team", teamId: 1, updatedFrom: "2026-11-16", updatedTo: "2026-11-15" }).success).toBe(false);
  });
  it("binds approved aliases to enterprise+stable ID, not login, name matching or other enterprises", () => {
    expect(customerMemberDisplayName(1, 407883, "黄紫银")).toBe("黄紫银（jean）");
    expect(customerMemberDisplayName(1, 409506, "莫66")).toBe("莫66（ocean）");
    expect(customerMemberDisplayName(12, 407883, "黄紫银")).toBe("黄紫银");
    expect(customerMemberDisplayName(7, 409506, "莫66")).toBe("莫66");
    expect(customerMemberDisplayName(1, 20, "黄紫银")).toBe("黄紫银");
    expect(customerMemberDisplayName(1, 407883, "新名称")).toBe("新名称（jean）");
  });
  it("exposes actual active enterprise teams, prioritizes own membership, and excludes unreadable/unavailable team members", async () => {
    const context = await getCustomerContext(enterprise);
    expect(context).toMatchObject({ canManageAll: false, canReadAll: true, canReadEnterprise: true, canReadTeam: true, defaultTeamId: 2 });
    expect(context.teams.map(t => [t.teamId, t.name])).toEqual([[2, "二团队"], [1, "智捷团队1"]]);
    expect(context.teams[1].members).toEqual([{ userId: 407883, name: "黄紫银（jean）" }, { userId: 409506, name: "莫66（ocean）" }]);
    expect(context.members).toEqual([{ userId: 10, name: "企业查看者" }]);
    expect(context.teams.flatMap(t => t.members).every(m => Object.keys(m).sort().join() === "name,userId")).toBe(true);
    expect(people.find(p => p[0] === 407883)?.[2]).toBe("GIN");
    expect(people.find(p => p[0] === 409506)?.[2]).toBe("莫盛明");
  });
  it("leader defaults only to own active team; ordinary member has no team reading", async () => {
    expect(await getCustomerContext(leader)).toMatchObject({ canManageAll: false, canReadAll: true, canReadEnterprise: false, canReadTeam: true, defaultTeamId: 1, teams: [{ teamId: 1, name: "智捷团队1" }] });
    expect(await getCustomerContext(member)).toMatchObject({ canReadAll: false, canReadEnterprise: false, canReadTeam: false, teams: [], defaultTeamId: null, members: [{ userId: 407883, name: "黄紫银（jean）" }] });
    teams[0][3] = "archived";
    expect(await getCustomerContext(leader)).toMatchObject({ canReadTeam: false, teams: [], defaultTeamId: null });
  });
  it("enterprise readers without membership default to first active team, single-team is exactly team 1", async () => {
    expect((await getCustomerContext({ ...enterprise, actorUserId: 99 })).defaultTeamId).toBe(1);
    teams[1][3] = "archived";
    expect((await getCustomerContext(enterprise)).defaultTeamId).toBe(1);
    for (const t of teams) if (t[1] === 1) t[3] = "archived";
    expect(await getCustomerContext(enterprise)).toMatchObject({ canReadEnterprise: true, canReadTeam: false, teams: [], defaultTeamId: null });
  });
});

describe("real generated SQL customer team isolation, local fixtures only", () => {
  it("ANDs frozen team assignment and original policy, excludes unassigned/other-tenant/type/team rows but includes transferred owner", async () => {
    const result = await listCustomers(leader, customerListInputSchema.parse({ scope: "team", teamId: 1, pageSize: 100 }));
    expect(result.items.map(c => c.id).sort((a, b) => a - b)).toEqual([1, 2, 6, 11, ...Array.from({ length: 25 }, (_, i) => 101 + i)]);
    expect(result.items.find(c => c.id === 2)?.assignedUserId).toBe(60);
    const row = result.items.find(c => c.id === 1)!;
    expect(row.assignedName).toBe("黄紫银（jean）");
    expect(row.contactName).toBe("黄紫银"); expect(row.createdByName).toBe("黄紫银");
    for (const q of listReads()) {
      expect(q.sql).toContain("crm_assignment.teamId = ?");
      expect(q.sql).toContain("list_team_assignment.recordType = 'customer'");
      expect(q.sql).toContain("list_team_assignment.enterpriseId = c.enterpriseId");
      expect(q.sql).toContain("list_team_assignment.recordId = c.id");
      expect(q.sql).not.toContain("currentOwnerUserId");
    }
  });
  it("enterprise reader selects either own enterprise team but never archived/cross enterprise/guessed team", async () => {
    expect((await listCustomers(enterprise, customerListInputSchema.parse({ scope: "team", teamId: 2 }))).items.map(c => c.id).sort()).toEqual([3, 7]);
    for (const teamId of [3, 99]) await expect(listCustomers(enterprise, customerListInputSchema.parse({ scope: "team", teamId }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    teams[0][1] = 12;
    await expect(listCustomers(enterprise, customerListInputSchema.parse({ scope: "team", teamId: 1 }))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("ordinary members and revoked/nonexplicit leaders cannot opt into team or query count/page", async () => {
    for (const actor of [member, leader]) {
      if (actor === leader) policies.get(409506).explicit = false;
      statements = [];
      await expect(listCustomers(actor, customerListInputSchema.parse({ scope: "team", teamId: 1 }))).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(listReads()).toEqual([]);
    }
    policies.get(409506).explicit = true;
    memberships[2][4] = "member";
    statements = [];
    await expect(listCustomers(leader, customerListInputSchema.parse({ scope: "team", teamId: 1 }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(listReads()).toEqual([]);
  });
  it("legacy all remains original team policy including own nonteam rows, never enterprise widening; mine remains native assignee", async () => {
    const legacy = await listCustomers(leader, customerListInputSchema.parse({ scope: "all", pageSize: 100 }));
    expect(legacy.items.some(c => c.id === 7)).toBe(true);
    expect(legacy.items.some(c => c.id === 3 || c.id === 5 || c.id === 4)).toBe(false);
    const mine = await listCustomers(member, customerListInputSchema.parse({ scope: "all", pageSize: 100 }));
    expect(mine.items.every(c => c.enterpriseId === 1 && c.assignedUserId === 407883)).toBe(true);
    expect(mine.items.some(c => c.id === 4)).toBe(true);
  });
  it("dates, assignee and assignee-star privacy filter the full set before identical count and page WHERE", async () => {
    const input = { scope: "team" as const, teamId: 1, assignedUserId: 407883, starMode: "assignee" as const, starredOnly: true, updatedFrom: "2026-11-15", updatedTo: "2026-11-15", pageSize: 5 };
    const pages = [];
    for (const page of [1, 2, 3]) pages.push(await listCustomers(leader, customerListInputSchema.parse({ ...input, page })));
    const ids = [1, ...Array.from({ length: 25 }, (_, i) => 101 + i)].filter(id => id % 2 === 1).sort((a, b) => b - a);
    expect(pages.flatMap(p => p.items.map(c => c.id))).toEqual(ids);
    expect(pages.every(p => p.total === ids.length)).toBe(true);
    expect(pages.flatMap(p => p.items).every(c => c.starUserId === 407883 && c.canSetStar && c.isStarred)).toBe(true);
    const [count, page] = listReads();
    const start = (q: string) => q.slice(q.indexOf("WHERE c.enterpriseId"));
    expect(start(page.sql).split("ORDER BY COALESCE")[0].trim()).toBe(start(count.sql).trim());
    expect(count.sql).toContain("star_filter.userId = c.assignedUserId");
    expect(count.sql).toContain("AND c.updatedAt >= ? AND c.updatedAt < ?");
    expect(statements.some(q => /^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE)/.test(q.sql))).toBe(false);
  });
  it("direct service rejects invalid scope/team combinations and stale identity before any SQL", async () => {
    for (const extra of [{ scope: "team" }, { scope: "all", teamId: 1 }, { scope: "mine", teamId: 1 }, { scope: "team", teamId: -1 }]) {
      await expect(listCustomers(leader, { ...customerListInputSchema.parse({}), ...extra } as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    await expect(listCustomers(leader, customerListInputSchema.parse({ scope: "team", teamId: 1, expectedEnterpriseId: 12 }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(statements).toEqual([]);
  });
});
