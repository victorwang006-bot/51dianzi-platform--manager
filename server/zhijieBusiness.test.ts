import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  type ZhijieAccessInput,
  type ZhijieAuditRow,
  type ZhijieSourceMember,
  type ZhijieStaffAccess,
  type ZhijieTeam,
} from "@shared/zhijieBusiness";
import { canAccessModule, scopeOwner, validateAccess } from "./zhijie/policy";
import { registerZhijieRoutes } from "./zhijie/router";
import type { ZhijieSourceAdapter, ZhijieSourceSnapshot } from "./zhijie/source";
import type { ZhijieAccessStore, ZhijieAdminAccount } from "./zhijie/store";

const teams: ZhijieTeam[] = [
  { id: 10, name: "销售一组", leaderUserId: 200, status: "active" },
  { id: 11, name: "归档组", leaderUserId: 201, status: "archived" },
];
const member: ZhijieSourceMember = {
  memberId: 88,
  userId: 200,
  name: "张三",
  status: "active",
  teamId: 10,
  sourcePermissions: ["inventory.manage", "customers.manage"],
  isOwner: false,
};
const employeeMember: ZhijieSourceMember = {
  memberId: 89,
  userId: 201,
  name: "李四",
  status: "active",
  teamId: null,
  sourcePermissions: ["inventory.manage"],
  isOwner: false,
};
const baseAccess: ZhijieStaffAccess = {
  adminUserId: 1,
  sourceMemberId: 88,
  sourceUserId: 200,
  role: "team_manager",
  teamIds: [10],
  grants: { inventory: ["read"], customers: ["read", "maintain"] },
  status: "active",
  revision: 1,
};

class FakeStore implements ZhijieAccessStore {
  access: ZhijieStaffAccess | null = { ...baseAccess };
  grants: Array<{ input: ZhijieAccessInput; actor: number; sourceUserId: number }> = [];
  async getAccessForAdmin(id: number) { return id === 1 ? this.access : null; }
  async listStaff() { return this.access ? [this.access] : []; }
  async listAdminAccounts(): Promise<ZhijieAdminAccount[]> { return [{ id: 1, name: "配置员", status: "active", platformRole: "super_admin" }, { id: 2, name: "员工", status: "active", platformRole: "operation" }]; }
  async getAdminAccount(id: number) { return (await this.listAdminAccounts()).find(account => account.id === id) ?? null; }
  async isSchemaReady() { return true; }
  async grant(input: ZhijieAccessInput, actor: number, sourceUserId: number) {
    this.grants.push({ input, actor, sourceUserId });
    this.access = { ...input, sourceUserId, revision: input.expectedRevision + 1 };
    return input.expectedRevision === 0 ? "created" as const : "updated" as const;
  }
  async listAudits(_limit: number): Promise<ZhijieAuditRow[]> { return []; }
}

const snapshot: ZhijieSourceSnapshot = {
  enterprise: { id: 1, companyName: "任意来源公司名", superAdminUserId: null },
  members: [member, employeeMember],
  teams,
};
class FakeSource implements ZhijieSourceAdapter { async loadSnapshot() { return snapshot; } }

function localContext(id = 1, role = "super_admin") {
  return async () => ({
    adminAccount: { id, status: "active", adminRole: role, sessionVersion: 1 },
    user: { id, openId: `local_admin:${id}`, loginMethod: "password" },
  } as never);
}

async function request(base: string, path: string, init: RequestInit = {}) {
  return fetch(`${base}${path}`, {
    ...init,
    headers: { origin: "https://admin.51dianzi.com", "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

describe("Zhijie access policy", () => {
  it("fails closed for employee team expansion, archived teams, and missing source permissions", () => {
    expect(validateAccess({ ...baseAccess, role: "employee", teamIds: [10] }, member, teams).ok).toBe(false);
    expect(validateAccess({ ...baseAccess, role: "department_manager", teamIds: [11] }, member, teams).ok).toBe(false);
    expect(validateAccess({ ...baseAccess, grants: { "sales-orders": ["read"] } }, member, teams).ok).toBe(false);
  });

  it("uses a manager team scope without granting unlisted ERP modules", () => {
    expect(scopeOwner(baseAccess, teams)).toMatchObject({ kind: "team", teamIds: [10] });
    expect(canAccessModule(baseAccess, member, "inventory", "read")).toBe(true);
    expect(canAccessModule(baseAccess, member, "sales-orders", "read")).toBe(false);
    expect(scopeOwner({ ...baseAccess, status: "disabled" }, teams)).toBeNull();
  });
});

describe("Zhijie REST routes with fakes", () => {
  let server: Server;
  let base = "";
  let store: FakeStore;

  beforeAll(async () => {
    store = new FakeStore();
    const app = express();
    app.use(express.json());
    registerZhijieRoutes(app, { store, source: new FakeSource(), createContext: localContext() });
    server = await new Promise<Server>(resolve => { const value = app.listen(0, "127.0.0.1", () => resolve(value)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });

  it("reports disconnected records as total:null rather than fake zero", async () => {
    const response = await request(base, "/api/zhijie/records/inventory");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ connected: false, items: [], total: null });
    expect(response.headers.get("cache-control")).toContain("private, no-store");
  });

  it("rejects self grant and preserves source-derived user identity on valid grant", async () => {
    const payload = { adminUserId: 1, sourceMemberId: 89, role: "employee", teamIds: [], grants: { inventory: ["read"] }, status: "active", expectedRevision: 0, reason: "配置" };
    expect((await request(base, "/api/zhijie/access", { method: "PUT", body: JSON.stringify(payload) })).status).toBe(403);
    payload.adminUserId = 2;
    const response = await request(base, "/api/zhijie/access", { method: "PUT", body: JSON.stringify(payload) });
    expect(response.status).toBe(201);
    expect(store.grants[0]).toMatchObject({ actor: 1, sourceUserId: 201 });
  });

  it("rejects missing browser origin outside the test exception and all record writes", async () => {
    const originalVitest = process.env.VITEST;
    const originalNodeEnv = process.env.NODE_ENV;
    try {
      delete process.env.VITEST;
      process.env.NODE_ENV = "development";
      const missingOrigin = await fetch(`${base}/api/zhijie/access`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ adminUserId: 2 }),
      });
      expect(missingOrigin.status).toBe(403);
    } finally {
      if (originalVitest === undefined) delete process.env.VITEST;
      else process.env.VITEST = originalVitest;
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
    }
    const write = await request(base, "/api/zhijie/records/inventory", { method: "POST", body: "{}" });
    expect(write.status).toBe(405);
  });
});
