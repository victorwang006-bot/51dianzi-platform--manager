import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
const runtime = vi.hoisted(() => ({
  database: null as any,
  access: null as any,
  inTransaction: false,
  fenced: false,
  remote: vi.fn(),
  fence: vi.fn(),
  authorityMutation: null as (() => void) | null,
}));
vi.mock("../db", () => ({ getDb: async () => runtime.database }));
vi.mock("./officialChannelAccess", () => ({
  loadOfficialAccess: async () => runtime.access,
  assertOfficialRecordAction: vi.fn(),
  officialTeamPredicate: () => undefined,
}));
vi.mock("../businessAuthorizationFence", () => ({
  withBusinessAuthorizationFence: async (
    key: unknown,
    operation: () => Promise<unknown>
  ) => {
    runtime.fence(key);
    runtime.fenced = true;
    try {
      return await operation();
    } finally {
      runtime.fenced = false;
    }
  },
}));
vi.mock("../platformBusinessApi", () => ({
  getPlatformBusinessContext: (...args: unknown[]) => runtime.remote(...args),
}));
import {
  configureOfficialChannelReception,
  getOfficialChannelReception,
  publishOfficialChannelStock,
  transferOfficialChannelStockOwner,
} from "./officialChannelInventory";
const dialect = new MySqlDialect();
const actor = { adminUserId: 900, sessionVersion: 2 };
let state: ReturnType<typeof fixture>;
function fixture() {
  return {
    stock: {
      id: 11,
      sourceId: 21,
      teamId: 7,
      ownerAdminUserId: 101,
      createdByAdminUserId: 900,
      revision: 3,
      status: "draft",
      partNumber: "SYNTHETIC-MODEL",
      brand: "TEST",
      qty: 10,
      dateCode: null,
      price: "1",
      currency: "CNY",
      taxIncluded: null,
      leadTime: null,
    },
    config: {
      stockId: 11,
      merchantId: 30061,
      sellerEnterpriseId: 31,
      routingMode: "owner",
      recipientAdminUserId: null as number | null,
      responsibilityVersion: 4,
    } as any,
    source: {
      id: 21,
      teamId: 7,
      active: true,
      publicationApproved: true,
      everPublished: true,
      revision: 5,
    },
    publication: null as any,
    writes: [] as { table: string; values: any; operation: string }[],
    audits: [] as any[],
    authority: {
      ownerStatus: "active",
      ownerRole: "operation",
      ownerTeamId: 7,
      recipientStatus: "active",
      recipientRole: "operation",
      recipientName: "SYNTHETIC-STAFF",
      recipientTeamId: 7,
      recipientSessionVersion: 2,
      teamStatus: "active",
      bindingStatus: "active",
      frontUserId: 7001,
      bindingVersion: 2,
      scopeStatus: "active",
      scopeVersion: 2,
      modulePermissions: [
        "business.context.read",
        "business.inquiries.read",
        "business.inquiries.write",
      ],
      id: 30061,
      merchantNo: "TEST",
      companyName: "可信企业",
      crmStatus: "enabled",
      registrationRegion: "CN",
      registrationIdentifier: null,
      businessLicense: "91310000123456789X",
      crmOwnerPortalUserId: "8001",
    },
  };
}
function fakeDatabase() {
  const api: any = {
    transaction: async (callback: (tx: any) => Promise<unknown>) => {
      runtime.inTransaction = true;
      try {
        return await callback(api);
      } finally {
        runtime.inTransaction = false;
      }
    },
    execute: async (query: any) => {
      const rendered = dialect.sqlToQuery(query);
      if (rendered.sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
      if (rendered.sql.includes("RELEASE_LOCK")) return [[{ released: 1 }]];
      if (!rendered.sql.includes("FROM official_channel_team_members"))
        throw new Error(`Unexpected fixture SQL: ${rendered.sql}`);
      return [[structuredClone(state.authority)]];
    },
    select: (selection: any) => {
      let table = "",
        condition: any;
      const query: any = {
        from: (value: any) => {
          table = getTableName(value);
          return query;
        },
        where: (value: any) => {
          condition = value;
          return query;
        },
        innerJoin: () => query,
        leftJoin: () => query,
        limit: () => query,
        for: () => query,
        then: (resolve: any, reject: any) => {
          let rows: any[];
          if (table === "official_channel_stocks")
            rows = [structuredClone(state.stock)];
          else if (table === "official_channel_stock_reception")
            rows = state.config ? [structuredClone(state.config)] : [];
          else if (table === "official_channel_sources")
            rows = [structuredClone(state.source)];
          else if (table === "official_channel_publications")
            rows = state.publication
              ? [structuredClone(state.publication)]
              : [];
          else if (table === "official_channel_audits") {
            const id = dialect.sqlToQuery(condition).params[0];
            rows = state.audits.filter(row => row.requestId === id);
          } else if (table === "official_channel_team_members")
            rows = selection?.id
              ? [
                  {
                    id: 202,
                    displayName: "SYNTHETIC-NEXT-OWNER",
                    username: "target",
                  },
                ]
              : [{ adminUserId: state.stock.ownerAdminUserId }];
          else throw new Error(`Unexpected fixture table: ${table}`);
          return Promise.resolve(rows).then(resolve, reject);
        },
      };
      return query;
    },
    insert: (table: any) => ({
      values: async (values: any) => {
        const name = getTableName(table);
        state.writes.push({ table: name, values, operation: "insert" });
        if (name === "official_channel_publications")
          state.publication = { ...values };
        else if (name === "official_channel_audits")
          state.audits.push({ ...values });
        else if (name === "official_channel_stock_reception")
          state.config = { ...values };
        else throw new Error(`Unexpected fixture write: ${name}`);
        return [{ affectedRows: 1 }];
      },
    }),
    update: (table: any) => ({
      set: (values: any) => ({
        where: async () => {
          const name = getTableName(table);
          state.writes.push({ table: name, values, operation: "update" });
          if (name === "official_channel_stocks") {
            const { revision: _revision, ...patch } = values;
            Object.assign(state.stock, patch);
            state.stock.revision++;
          } else if (name === "official_channel_stock_reception")
            Object.assign(state.config, values);
          else if (name === "official_channel_publications") {
            if (state.publication) {
              const { revision: _revision, ...patch } = values;
              Object.assign(state.publication, patch);
              state.publication.revision++;
            }
          } else if (name === "official_channel_sources")
            state.source.revision++;
          else throw new Error(`Unexpected fixture write: ${name}`);
          return [{ affectedRows: 1 }];
        },
      }),
    }),
  };
  return api;
}
beforeEach(() => {
  vi.stubEnv("BUSINESS_WORKBENCH_MERCHANT_IDS", "30061");
  state = fixture();
  runtime.database = fakeDatabase();
  runtime.inTransaction = false;
  runtime.fenced = false;
  runtime.authorityMutation = null;
  runtime.fence.mockReset();
  runtime.remote.mockReset();
  runtime.access = {
    adminUserId: 900,
    isSuperAdmin: true,
    teamId: 7,
    permissions: [
      "officialInventory.read",
      "officialInventory.write",
      "officialInventory.publish",
    ],
  };
  runtime.remote.mockImplementation(
    async (_binding: unknown, metadata: any) => {
      expect(runtime.inTransaction).toBe(false);
      expect(runtime.fenced).toBe(true);
      const context = {
        enterpriseId: 31,
        ownerUserId: 8001,
        dataOwnerUserId: 8001,
        companyName: "可信企业",
        staffPrincipal: {
          status: "ready",
          frontendUserId: 7001,
          enterpriseId: 31,
          adminAccountId: metadata.adminAccountId,
          bindingVersion: 2,
          user: { id: 7001, name: "SYNTHETIC-STAFF", loginDisabled: false },
        },
        workbenchCapabilities: ["inquiry.receive"],
        sessionCapabilities: { chat: false, receptionReady: true },
      };
      runtime.authorityMutation?.();
      return context;
    }
  );
});
afterEach(() => vi.unstubAllEnvs());
describe("official publication/reception in-memory DI transactions (no native MySQL/network)", () => {
  it("published stale receipt stays pending on read and is never silently repaired", async () => {
    await publishOfficialChannelStock(actor, { stockId: 11, expectedRevision: 3, requestId: "fixture-publish-stale-read" });
    state.publication.reception.bindingVersion = 1;
    const writes = state.writes.length;
    const result = await getOfficialChannelReception(actor, 11);
    expect(result.reception).toMatchObject({ status: "pending", reason: "RECEPTION_PROJECTION_REFRESH_REQUIRED" });
    expect(state.publication.reception.bindingVersion).toBe(1);
    expect(state.writes).toHaveLength(writes);
  });
  it("admin publish persists the real owner, separate private projection and safe public snapshot", async () => {
    const result = await publishOfficialChannelStock(actor, {
      stockId: 11,
      expectedRevision: 3,
      requestId: "fixture-publish-01",
    });
    expect(result).toMatchObject({
      revision: 4,
      status: "published",
      reception: {
        status: "ready",
        recipientAdminUserId: 101,
        stockRevision: 4,
        responsibilityVersion: 4,
      },
    });
    expect(state.publication.reception.recipientAdminUserId).not.toBe(
      actor.adminUserId
    );
    expect(state.publication.snapshot).not.toHaveProperty("reception");
    expect(state.publication.snapshot).not.toHaveProperty(
      "recipientAdminUserId"
    );
    expect(runtime.fence).toHaveBeenCalledWith({
      adminUserId: 101,
      merchantId: 30061,
    });
  });
  it("old unconfigured stock publishes pending, never a fake successful reception", async () => {
    state.config = null;
    const result = await publishOfficialChannelStock(actor, {
      stockId: 11,
      expectedRevision: 3,
      requestId: "fixture-publish-02",
    });
    expect(result.reception).toMatchObject({
      status: "pending",
      recipientFrontendUserId: null,
      responsibilityVersion: 0,
    });
    expect(runtime.remote).not.toHaveBeenCalled();
  });
  it.each(["stock", "config", "binding", "scope", "merchant"])(
    "rejects concurrent %s change before publication writes",
    async kind => {
      runtime.authorityMutation = () => {
        if (kind === "stock") state.stock.revision++;
        if (kind === "config") state.config.responsibilityVersion++;
        if (kind === "binding") state.authority.bindingVersion++;
        if (kind === "scope") state.authority.scopeVersion++;
        if (kind === "merchant") state.authority.crmOwnerPortalUserId = "9999";
      };
      await expect(
        publishOfficialChannelStock(actor, {
          stockId: 11,
          expectedRevision: 3,
          requestId: "fixture-publish-change",
        })
      ).rejects.toThrow(/REVISION_CONFLICT/);
      expect(state.writes).toHaveLength(0);
    }
  );
  it("replay preserves originally assigned recipient after source responsibility changes", async () => {
    const input = {
      stockId: 11,
      expectedRevision: 3,
      requestId: "fixture-publish-replay",
    };
    const first = await publishOfficialChannelStock(actor, input);
    const count = state.writes.length;
    state.stock.ownerAdminUserId = 202;
    state.stock.revision++;
    state.config.responsibilityVersion++;
    const replay = await publishOfficialChannelStock(actor, input);
    expect(replay).toMatchObject({
      idempotent: true,
      publicId: first.publicId,
      reception: { recipientAdminUserId: 101 },
    });
    expect(state.writes).toHaveLength(count);
  });
  it.each(["owner", "explicit"])(
    "handoff updates responsibility/projection but preserves %s mode and never writes inquiry tables",
    async mode => {
      state.stock.status = "published";
      state.publication = {
        stockId: 11,
        publicId: `ocp_${"a".repeat(32)}`,
        revision: 1,
      };
      state.config.routingMode = mode;
      state.config.recipientAdminUserId = mode === "explicit" ? 101 : null;
      const result = await transferOfficialChannelStockOwner(actor, {
        stockId: 11,
        targetAdminUserId: 202,
        reason: "真实责任交接",
        expectedRevision: 3,
        requestId: `fixture-transfer-${mode}`,
      });
      expect(result).toMatchObject({
        revision: 4,
        ownerAdminUserId: 202,
        historicalInquiriesChanged: false,
        reception: {
          routingMode: mode,
          recipientAdminUserId: mode === "explicit" ? 101 : 202,
          responsibilityVersion: 5,
          stockRevision: 4,
        },
      });
      expect(state.config.routingMode).toBe(mode);
      expect(state.config.recipientAdminUserId).toBe(
        mode === "explicit" ? 101 : null
      );
      expect(state.stock.createdByAdminUserId).toBe(900);
      expect(state.stock.teamId).toBe(7);
      expect(
        state.writes.every(write => write.table.startsWith("official_channel_"))
      ).toBe(true);
    }
  );
  it("explicit config requires current stock/config CAS and records reason without changing old inquiries", async () => {
    const result = await configureOfficialChannelReception(actor, {
      stockId: 11,
      merchantId: 30061,
      routingMode: "explicit",
      recipientAdminUserId: 202,
      expectedRevision: 3,
      expectedResponsibilityVersion: 4,
      reason: "明确确认企业分工覆盖未来默认",
      requestId: "fixture-configure",
    });
    expect(result).toMatchObject({
      revision: 4,
      historicalInquiriesChanged: false,
      reception: { recipientAdminUserId: 202, responsibilityVersion: 5 },
    });
    expect(state.config).toMatchObject({
      sellerEnterpriseId: 31,
      routingMode: "explicit",
      recipientAdminUserId: 202,
    });
    expect(state.audits[0].afterData.reason).toBe(
      "明确确认企业分工覆盖未来默认"
    );
  });
  it("does not silently overwrite an already explicit config with a stale version", async () => {
    state.config.routingMode = "explicit";
    state.config.recipientAdminUserId = 202;
    await expect(
      configureOfficialChannelReception(actor, {
        stockId: 11,
        merchantId: 30061,
        routingMode: "owner",
        expectedRevision: 3,
        expectedResponsibilityVersion: 3,
        reason: "stale caller",
        requestId: "fixture-configure-stale",
      })
    ).rejects.toThrow("OFFICIAL_CHANNEL_RECEPTION_REVISION_CONFLICT");
    expect(state.writes).toHaveLength(0);
    expect(state.config.recipientAdminUserId).toBe(202);
  });
});
