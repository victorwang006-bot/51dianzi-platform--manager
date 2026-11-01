import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, beforeEach, vi } from "vitest";

const { mockGetDb, mockLoadOfficialAccess } = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockLoadOfficialAccess: vi.fn(),
}));

// Isolated service-level tests: never open a real fixture or production connection.
vi.mock("../db", () => ({ getDb: mockGetDb }));
vi.mock("./officialChannelAccess", async importOriginal => {
  const actual =
    await importOriginal<typeof import("./officialChannelAccess")>();
  return { ...actual, loadOfficialAccess: mockLoadOfficialAccess };
});

import { officialChannelLegacyRouter } from "../routers/officialChannelLegacy";
import {
  OfficialChannelLegacyError,
  classifyLegacySource,
  importLegacy,
  officialChannelLegacyTestUtils,
} from "./officialChannelLegacy";

const serviceSource = readFileSync(
  resolve(process.cwd(), "server/services/officialChannelLegacy.ts"),
  "utf8"
);

const actor = { adminUserId: 1001, sessionVersion: 7 };

function callerContext() {
  return {
    user: { id: actor.adminUserId, role: "admin" },
    adminAccount: {
      id: actor.adminUserId,
      sessionVersion: actor.sessionVersion,
      status: "active",
      adminRole: "operation",
    },
    adminPermissions: [],
    req: { headers: {} },
    res: {},
  } as any;
}

type FakeDatabaseOptions = {
  rawResults: Array<unknown>;
  selectResults: Array<unknown>;
  insertIds?: number[];
  updateAffectedRows?: number[];
};

function rawRows(rows: Array<Record<string, unknown>>) {
  return [rows, []];
}

/** A minimal Drizzle-shaped transaction mock with ordered, explicit query results. */
function fakeDatabase(options: FakeDatabaseOptions) {
  const rawResults = [...options.rawResults];
  const selectResults = [...options.selectResults];
  const insertIds = [...(options.insertIds ?? [])];
  const updateAffectedRows = [...(options.updateAffectedRows ?? [])];
  const inserts: unknown[] = [];
  const updates: unknown[] = [];
  const tx: any = {
    execute: vi.fn(async () => {
      const next = rawResults.shift();
      if (next === undefined) throw new Error("unexpected raw query");
      return next;
    }),
    select: vi.fn(() => {
      const next = selectResults.shift();
      const query: any = {
        from: () => query,
        innerJoin: () => query,
        leftJoin: () => query,
        where: () => query,
        limit: () => query,
        orderBy: () => query,
        for: async () => {
          if (next === undefined) throw new Error("unexpected select query");
          return next;
        },
      };
      return query;
    }),
    insert: vi.fn(() => ({
      values: (value: unknown) => {
        inserts.push(value);
        const id = insertIds.shift();
        return { $returningId: async () => (id === undefined ? [] : [{ id }]) };
      },
    })),
    update: vi.fn(() => ({
      set: (value: unknown) => {
        updates.push(value);
        return {
          where: async () => [
            { affectedRows: updateAffectedRows.shift() ?? 1 },
          ],
        };
      },
    })),
  };
  return {
    db: {
      transaction: async (callback: (transaction: unknown) => unknown) =>
        callback(tx),
    },
    tx,
    inserts,
    updates,
  };
}

function legacyImportRawResults() {
  return [
    rawRows([{ acquired: 1 }]),
    rawRows([{ acquired: 1 }]),
    rawRows([
      { tableName: "channel_inventory_channels" },
      { tableName: "channel_inventory_materials" },
    ]),
    rawRows([
      {
        sourceId: 51,
        enterpriseId: 8001,
        dataOwnerUserId: 30061,
        responsibleUserId: 40001,
        name: "历史工厂来源",
        type: "factory",
        contactName: "保留的内部联系人",
        phone: "13800000000",
        wechat: "legacy-wechat",
        qq: null,
        notes: "仅内部来源备注",
        active: 1,
        createdAt: "2025-08-01 09:10:11.123",
        updatedAt: "2025-09-02 10:11:12.456",
      },
    ]),
    rawRows([
      {
        materialId: 61,
        sourceId: 51,
        enterpriseId: 8001,
        dataOwnerUserId: 30061,
        responsibleUserId: 40001,
        partNumber: "LM358DR",
        brand: "TI",
        qty: 1200,
        dateCode: "2436",
        price: "1.2300",
        currency: "CNY",
        taxIncluded: 1,
        leadTime: "现货",
        note: "仅内部库存备注",
        createdAt: "2025-08-02 09:10:11.123",
        updatedAt: "2025-09-03 10:11:12.456",
      },
    ]),
    rawRows([{ released: 1 }]),
    rawRows([{ released: 1 }]),
  ];
}

function legacyImportSelectResults(
  mappingRows: Array<Record<string, unknown>>
) {
  return [
    [], // no replay audit
    [{ id: 30061, crmOwnerPortalUserId: "30061" }],
    mappingRows,
    [], // no existing imported source
    [], // no existing imported material
  ];
}

beforeEach(() => {
  mockGetDb.mockReset();
  mockLoadOfficialAccess.mockReset();
  mockLoadOfficialAccess.mockResolvedValue({
    adminUserId: actor.adminUserId,
    isSuperAdmin: true,
    teamId: null,
    teamRole: null,
    permissions: [],
  });
  delete process.env.PLATFORM_DB_NAME;
});

describe("官方旧资料兼容服务隔离回归（mock transaction，不连接生产或 fixture）", () => {
  it("实际导入路径只在完成 owner/绑定核验后创建未分组的 private/draft 官方记录并写 provenance 审计", async () => {
    const fake = fakeDatabase({
      rawResults: legacyImportRawResults(),
      selectResults: legacyImportSelectResults([
        {
          frontUserId: 40001,
          adminUserId: 2001,
          bindingStatus: "active",
          adminStatus: "active",
        },
      ]),
      insertIds: [701, 901],
    });
    mockGetDb.mockResolvedValue(fake.db);

    const result = await importLegacy(actor, {
      requestId: "legacy-import-mock-01",
    });

    expect(mockLoadOfficialAccess).toHaveBeenCalledWith(
      fake.tx,
      actor,
      "officialTeams.manage"
    );
    expect(result).toMatchObject({
      requestId: "legacy-import-mock-01",
      importedSources: [{ legacySourceId: "51", sourceId: 701 }],
      importedStocks: [
        { legacyMaterialId: "61", stockId: 901, ownerAdminUserId: 2001 },
      ],
      initialTeamId: null,
      sourcePublicationApproved: false,
      stockStatus: "draft",
      historicalCreator: "unknown",
      idempotent: false,
    });
    expect(fake.inserts).toHaveLength(3);
    expect(fake.inserts[0]).toMatchObject({
      teamId: null,
      legacySourceId: "51",
      createdByAdminUserId: actor.adminUserId,
      publicationApproved: false,
      everPublished: false,
      notes: "仅内部来源备注",
      createdAt: "2025-08-01 09:10:11.123",
      updatedAt: "2025-09-02 10:11:12.456",
    });
    expect(fake.inserts[1]).toMatchObject({
      sourceId: 701,
      teamId: null,
      createdByAdminUserId: actor.adminUserId,
      ownerAdminUserId: 2001,
      legacyMaterialId: "61",
      status: "draft",
      publishedAt: null,
      dateCode: "2436",
      price: "1.2300",
      note: "仅内部库存备注",
      createdAt: "2025-08-02 09:10:11.123",
      updatedAt: "2025-09-03 10:11:12.456",
    });
    expect(fake.inserts[2]).toMatchObject({
      action: "official.legacy.import",
      targetId: "merchant:30061",
      actorAdminUserId: actor.adminUserId,
      requestId: "legacy-import-mock-01",
    });
    expect((fake.inserts[2] as any).afterData.provenance).toMatchObject({
      copiedHistoricalNotesTable: false,
      originalCreator: expect.stringContaining("unknown"),
      sources: [
        expect.objectContaining({
          historicalResponsibleFrontUserId: 40001,
          verifiedCurrentOwnerAdminUserId: 2001,
        }),
      ],
      materials: [
        expect.objectContaining({
          historicalResponsibleFrontUserId: 40001,
          verifiedCurrentOwnerAdminUserId: 2001,
        }),
      ],
    });
  });

  it("任一历史负责人缺当前 active binding 时，在首次 insert 前整体失败", async () => {
    const fake = fakeDatabase({
      rawResults: legacyImportRawResults(),
      selectResults: legacyImportSelectResults([]),
    });
    mockGetDb.mockResolvedValue(fake.db);

    await expect(
      importLegacy(actor, { requestId: "legacy-import-mock-02" })
    ).rejects.toMatchObject({
      code: "OFFICIAL_LEGACY_RESPONSIBLE_BINDING_UNVERIFIED",
    });
    expect(fake.inserts).toEqual([]);
  });

  it("同一 actor、payload 和 requestId 命中原生审计时实际重放，不再读取旧表或重复写入", async () => {
    const requestId = "legacy-import-replay-01";
    const hash = officialChannelLegacyTestUtils.payloadHash(
      "official.legacy.import",
      actor,
      { requestId }
    );
    const savedResult = {
      requestId,
      importedSources: [{ legacySourceId: "51", sourceId: 701 }],
      importedStocks: [
        { legacyMaterialId: "61", stockId: 901, ownerAdminUserId: 2001 },
      ],
      initialTeamId: null,
      sourcePublicationApproved: false,
      stockStatus: "draft",
      historicalCreator: "unknown",
      idempotent: false,
    };
    const fake = fakeDatabase({
      rawResults: [
        rawRows([{ acquired: 1 }]),
        rawRows([{ acquired: 1 }]),
        rawRows([{ released: 1 }]),
        rawRows([{ released: 1 }]),
      ],
      selectResults: [
        [
          {
            action: "official.legacy.import",
            targetId: "merchant:30061",
            actorAdminUserId: actor.adminUserId,
            payloadHash: hash,
            afterData: { result: savedResult },
          },
        ],
      ],
    });
    mockGetDb.mockResolvedValue(fake.db);

    await expect(importLegacy(actor, { requestId })).resolves.toEqual({
      ...savedResult,
      idempotent: true,
    });
    expect(fake.inserts).toEqual([]);
    expect(fake.tx.execute).toHaveBeenCalledTimes(4);
  });

  it("实际首次归类仅 CAS 写入同一 legacy 来源及其库存 team 快照，不改负责人或创建人", async () => {
    const source = {
      id: 701,
      legacySourceId: "51",
      teamId: null,
      revision: 1,
      everPublished: false,
      publicationApproved: false,
      createdByAdminUserId: actor.adminUserId,
    };
    const stock = {
      id: 901,
      sourceId: source.id,
      teamId: null,
      ownerAdminUserId: 2001,
      createdByAdminUserId: actor.adminUserId,
      revision: 1,
      status: "draft",
    };
    const fake = fakeDatabase({
      rawResults: [
        rawRows([{ acquired: 1 }]),
        rawRows([{ acquired: 1 }]),
        rawRows([{ released: 1 }]),
        rawRows([{ released: 1 }]),
      ],
      selectResults: [
        [], // no replay audit
        [source],
        [stock],
        [], // no public projection
        [{ id: 9, status: "active" }],
        [{ adminUserId: 2001 }],
      ],
      updateAffectedRows: [1, 1],
    });
    mockGetDb.mockResolvedValue(fake.db);

    const result = await classifyLegacySource(actor, {
      sourceId: source.id,
      teamId: 9,
      expectedRevision: 1,
      requestId: "legacy-classify-mock-01",
      reason: "超管核验后首次归类",
    });

    expect(result).toMatchObject({
      sourceId: 701,
      legacySourceId: "51",
      teamId: 9,
      sourceRevision: 2,
      stocks: [{ stockId: 901, revision: 2 }],
      idempotent: false,
    });
    expect(fake.updates).toEqual([
      expect.objectContaining({ teamId: 9 }),
      expect.objectContaining({ teamId: 9 }),
    ]);
    expect(
      fake.updates.flatMap(value =>
        Object.keys(value as Record<string, unknown>)
      )
    ).not.toEqual(
      expect.arrayContaining([
        "ownerAdminUserId",
        "createdByAdminUserId",
        "name",
        "type",
      ])
    );
  });

  it("请求哈希绑定真实后台主体、动作和规范化 payload", () => {
    const first = officialChannelLegacyTestUtils.payloadHash(
      "official.legacy.classify",
      actor,
      { sourceId: 12, teamId: 3, expectedRevision: 1, reason: "历史首次归类" }
    );
    const reordered = officialChannelLegacyTestUtils.payloadHash(
      "official.legacy.classify",
      actor,
      { reason: "历史首次归类", expectedRevision: 1, teamId: 3, sourceId: 12 }
    );
    const changedActor = officialChannelLegacyTestUtils.payloadHash(
      "official.legacy.classify",
      { adminUserId: 1002, sessionVersion: 7 },
      { sourceId: 12, teamId: 3, expectedRevision: 1, reason: "历史首次归类" }
    );
    expect(first).toBe(reordered);
    expect(changedActor).not.toBe(first);
  });

  it("严格识别 crmOwnerPortalUserId，使用受限旧库数据路径并保持请求锁在 MySQL 上限内", () => {
    expect(officialChannelLegacyTestUtils.parseLegacyOwnerId("30061")).toBe(
      30061
    );
    for (const invalid of [null, "", "0", "-1", "1.5", "owner-a", "1 OR 1=1"]) {
      expect(
        officialChannelLegacyTestUtils.parseLegacyOwnerId(invalid)
      ).toBeNull();
    }
    const requestLock = officialChannelLegacyTestUtils.lockName(
      "request",
      "legacy-import-request-1001"
    );
    expect(requestLock.length).toBeLessThanOrEqual(64);
    expect(serviceSource).toContain(
      "crmOwnerPortalUserId: merchants.crmOwnerPortalUserId"
    );
    expect(serviceSource).toContain(
      "channel.data_owner_user_id = ${owner.portalUserId}"
    );
    expect(serviceSource).toContain(
      "material.enterpriseId !== source.enterpriseId"
    );
  });

  it("浏览器不能为导入伪造 owner/team/creator，也不能为首次分类夹带任意字段", async () => {
    const caller = officialChannelLegacyRouter.createCaller(callerContext());
    await expect(
      caller.importLegacy({
        requestId: "legacy-import-input-01",
        teamId: 9,
        ownerAdminUserId: 2002,
        createdByAdminUserId: 3003,
      } as any)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.classifyLegacySource({
        sourceId: 7,
        teamId: 4,
        expectedRevision: 1,
        requestId: "legacy-classify-input-01",
        reason: "核验后首次归类",
        ownerAdminUserId: 2002,
        sourceName: "不允许改名",
      } as any)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("服务错误类型保持可枚举的内部错误码，路由可安全映射", () => {
    expect(
      new OfficialChannelLegacyError("OFFICIAL_LEGACY_TABLES_MISSING")
    ).toMatchObject({
      code: "OFFICIAL_LEGACY_TABLES_MISSING",
      name: "OfficialChannelLegacyError",
    });
  });
});
