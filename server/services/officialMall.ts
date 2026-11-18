import { createHash, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNotNull, like, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { officialChannelTeams } from "../../drizzle/officialChannelSchema";
import { materials as materialCatalog } from "../../drizzle/schema";
import { OFFICIAL_MALL_SUGGEST_MIN_CHARS, OFFICIAL_MALL_SUGGEST_RAW_LIMIT, OFFICIAL_MALL_SUGGEST_RESULT_LIMIT, officialMallPrefixPattern } from "../../shared/officialMallSuggestPolicy";
import {
  officialMallMaterials as materials,
  officialMallPublications as publications,
  officialMallRequests as requests,
  type OfficialMallMaterialRow,
} from "../../drizzle/officialMallSchema";
import {
  OFFICIAL_MALL_BULK_LIMIT,
  OFFICIAL_MALL_IMPORT_LIMIT,
  officialMallIdSchema,
  officialMallImportRowSchema,
  officialMallListSchema,
  officialMallMaterialInputSchema,
  officialMallRequestIdSchema,
  officialMallRevisionSchema,
  officialMallRowMutationSchema,
  type OfficialMallAccess,
  type OfficialMallDuplicate,
  type OfficialMallImportResult,
  type OfficialMallMaterial,
  type OfficialMallMaterialInput,
  type OfficialMallMutationResult,
  type OfficialMallPreviewRow,
  type OfficialMallPublicMaterial,
  type OfficialMallSuggestion,
} from "../../shared/officialMall";
import type {
  OfficialAccess,
  OfficialActor,
  OfficialPermission,
  OfficialRecordAction,
} from "./officialChannelAccess";

/** Deliberately inject the native ABI. No front/business APIs or db-module import here. */
export interface OfficialMallDependencies {
  getDb: () => Promise<any>;
  loadOfficialAccess: (
    tx: any,
    actor: OfficialActor,
    permission: OfficialPermission
  ) => Promise<OfficialAccess>;
  assertOfficialRecordAction: (
    access: OfficialAccess,
    record: { teamId: number | null; ownerAdminUserId: number | null },
    action: OfficialRecordAction
  ) => void;
  officialTeamPredicate: (access: OfficialAccess, table: any) => any;
}

export const officialMallCreateSchema = z
  .object({
    requestId: officialMallRequestIdSchema,
    data: officialMallMaterialInputSchema,
    teamId: officialMallIdSchema.optional(),
  })
  .strict();
export const officialMallUpdateSchema = officialMallRowMutationSchema
  .extend({ data: officialMallMaterialInputSchema })
  .strict();
export const officialMallBulkSchema = z
  .object({
    action: z.enum(["publish", "offshelf"]),
    requestId: officialMallRequestIdSchema,
    items: z
      .array(
        z
          .object({
            id: officialMallIdSchema,
            expectedRevision: officialMallRevisionSchema,
          })
          .strict()
      )
      .min(1)
      .max(OFFICIAL_MALL_BULK_LIMIT),
  })
  .strict();
export const officialMallSuggestSchema = z
  .object({
    query: z.string().trim().max(128),
    brand: z.string().trim().max(128).optional(),
  })
  .strict();
export const officialMallPreviewSchema = z
  .object({
    rows: z
      .array(
        z
          .object({ rowNumber: z.number().int().positive(), data: z.unknown() })
          .strict()
      )
      .max(OFFICIAL_MALL_IMPORT_LIMIT),
  })
  .strict();
export const officialMallImportSchema = z
  .object({
    requestId: officialMallRequestIdSchema,
    rows: z
      .array(officialMallImportRowSchema)
      .min(1)
      .max(OFFICIAL_MALL_IMPORT_LIMIT),
    teamId: officialMallIdSchema.optional(),
  })
  .strict();
export const officialMallPublicListSchema = officialMallListSchema.omit({
  status: true,
});
export const officialMallPublicIdSchema = z
  .object({
    publicId: z
      .string()
      .regex(
        /^OM_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      ),
  })
  .strict();
export const officialMallRequestStatusSchema = z
  .object({ requestId: officialMallRequestIdSchema })
  .strict();

function fail(
  message: string,
  code:
    | "BAD_REQUEST"
    | "CONFLICT"
    | "FORBIDDEN"
    | "INTERNAL_SERVER_ERROR" = "BAD_REQUEST"
): never {
  throw new TRPCError({ code, message });
}
function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row)
    .filter(key => row[key] !== undefined)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(row[key])}`)
    .join(",")}}`;
}
function payloadHash(action: string, actor: OfficialActor, payload: unknown) {
  return createHash("sha256")
    .update(
      canonicalJson({ action, actorAdminUserId: actor.adminUserId, payload })
    )
    .digest("hex");
}
function exactPrice(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * BigInt(1000000) + BigInt(fraction.padEnd(6, "0"));
}
/** Server final gate; do not coerce prices or guess stock, tax, MOQ, SPQ or date code. */
export function validateOfficialMallMaterial(
  value: unknown,
  allowExistingStockState: boolean = false
): OfficialMallMaterialInput {
  const result = officialMallMaterialInputSchema.safeParse(value);
  if (!result.success)
    fail(
      result.error.issues
        .map(issue => `${issue.path.join(".") || "物料"}: ${issue.message}`)
        .join("；")
    );
  const data = result.data;
  if (data.priceEx !== null && exactPrice(data.priceEx) <= BigInt(0))
    fail("基础单价必须大于0，面议请留空");
  // MOQ/SPQ constrain a purchase quantity, not the thresholds of a quote ladder.
  let previousPrice = data.priceEx === null ? null : exactPrice(data.priceEx);
  for (const tier of data.ladderPrices) {
    const current = exactPrice(tier.price);
    if (previousPrice !== null && current > previousPrice)
      fail("梯度单价不能随数量增加而上升");
    previousPrice = current;
  }
  // Existing stock can be depleted without rewriting its original lead time.
  // Only an explicit internal true skips this new-claim gate, never a transform context.
  if (
    allowExistingStockState !== true &&
    /(现货|立[即刻]?发|即发|秒发|当天[发出]|当日[发出]|24\s*[hH小时]|当天到)/.test(
      data.leadTime
    ) &&
    !(
      data.qtyOnSale !== null &&
      data.qtyOnSale > 0 &&
      data.qtyStock !== null &&
      data.qtyStock > 0
    )
  ) {
    fail("零库存或数量未确认不能声明现货立发，请填写真实货期或询价");
  }
  return data;
}
/** Publish-only final gate; drafts may still contain unknown quantities or pending lead time. */
function assertPublishable(data: OfficialMallMaterialInput) {
  validateOfficialMallMaterial(data);
  // Confirmed quote catalogs may include genuine zero stock without inventing a lead time.
  // Quantity bounds/relationship and positive prices are enforced by the original validator.
  if (
    data.qtyOnSale !== null && data.qtyOnSale >= 0 &&
    data.qtyStock !== null && data.qtyStock >= 0 &&
    (data.priceEx !== null || data.ladderPrices.length > 0)
  ) return;
  if (!(data.qtyOrder !== null && data.qtyOrder > 0))
    fail("上架须明确填写大于0的可售数量或订货数量");
  if (!data.leadTime.trim()) fail("上架须填写明确货期");
}
function assertRevision(actual: number, expected: number) {
  if (actual !== expected) fail("物料版本已变化，请刷新后重试", "CONFLICT");
  if (actual >= 2147483647) fail("物料版本达到上限，请联系管理员", "CONFLICT");
}
function inputFromRow(row: OfficialMallMaterialRow): OfficialMallMaterialInput {
  return validateOfficialMallMaterial({
    partNumber: row.partNumber,
    brand: row.brand,
    pkg: row.pkg,
    dateCode: row.dateCode,
    qtyOnSale: row.qtyOnSale,
    qtyStock: row.qtyStock,
    qtyOrder: row.qtyOrder,
    leadTime: row.leadTime,
    priceEx: row.priceEx,
    taxIncluded: row.taxIncluded,
    moq: row.moq,
    spq: row.spq,
    ladderPrices: row.ladderPrices,
    note: row.note,
  }, true);
}
function privateMaterial(row: OfficialMallMaterialRow): OfficialMallMaterial {
  // Explicit private output shape too: do not expose internal public IDs / receipt data.
  return {
    ...inputFromRow(row),
    id: row.id,
    revision: row.revision,
    status: row.status,
    teamId: row.teamId,
    ownerAdminUserId: row.ownerAdminUserId,
    createdByAdminUserId: row.createdByAdminUserId,
    updatedByAdminUserId: row.updatedByAdminUserId,
    publishedByAdminUserId: row.publishedByAdminUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt,
  };
}
/** Whitelist constructor used BOTH when writing AND when reading the public snapshot. */
export function publicProjection(
  row: OfficialMallMaterialInput & { publicId: string; revision: number },
  publishedAt: string
): OfficialMallPublicMaterial {
  const data = validateOfficialMallMaterial({
    partNumber: row.partNumber,
    brand: row.brand,
    pkg: row.pkg,
    dateCode: row.dateCode,
    qtyOnSale: row.qtyOnSale,
    qtyStock: row.qtyStock,
    qtyOrder: row.qtyOrder,
    leadTime: row.leadTime,
    priceEx: row.priceEx,
    taxIncluded: row.taxIncluded,
    moq: row.moq,
    spq: row.spq,
    ladderPrices: row.ladderPrices,
    note: "",
  }, true);
  // Inquiry-only catalog: preserve real quotes and tax state, without a purchase flag.
  return {
    sourceType: "official_mall",
    publicId: row.publicId,
    revision: row.revision,
    partNumber: data.partNumber,
    brand: data.brand,
    pkg: data.pkg,
    dateCode: data.dateCode,
    qtyOnSale: data.qtyOnSale,
    qtyStock: data.qtyStock,
    qtyOrder: data.qtyOrder,
    leadTime: data.leadTime,
    priceEx: data.priceEx,
    taxIncluded: data.taxIncluded,
    moq: data.moq,
    spq: data.spq,
    ladderPrices: data.ladderPrices.map(tier => ({
      minQty: tier.minQty,
      price: tier.price,
    })),
    publishedAt,
  };
}
function sameIdentity(
  a: OfficialMallMaterialInput,
  b: Pick<
    OfficialMallMaterialInput,
    "partNumber" | "brand" | "pkg" | "dateCode"
  >
) {
  const normalize = (v: string) => v.normalize("NFKC").trim().toLowerCase();
  return ["partNumber", "brand", "pkg", "dateCode"].every(
    key =>
      normalize(a[key as keyof typeof b]) ===
      normalize(b[key as keyof typeof b])
  );
}
function suggestion(
  row: Pick<OfficialMallMaterialInput, "partNumber" | "brand" | "pkg">
): OfficialMallSuggestion {
  return { partNumber: row.partNumber, brand: row.brand, pkg: row.pkg };
}
function duplicate(row: OfficialMallMaterialRow): OfficialMallDuplicate {
  return {
    id: row.id,
    revision: row.revision,
    partNumber: row.partNumber,
    brand: row.brand,
    pkg: row.pkg,
    dateCode: row.dateCode,
  };
}
function matchStatus(
  data: OfficialMallMaterialInput,
  matches: OfficialMallSuggestion[]
): OfficialMallPreviewRow["matchStatus"] {
  if (matches.length > 1) return "multiple";
  if (
    matches.length === 1 &&
    matches[0].partNumber.toLowerCase() === data.partNumber.toLowerCase() &&
    matches[0].brand.toLowerCase() === data.brand.toLowerCase() &&
    (!data.pkg || matches[0].pkg.toLowerCase() === data.pkg.toLowerCase())
  )
    return "exact";
  return "unmatched";
}
function safeError(error: unknown): string {
  return error instanceof TRPCError
    ? error.message
    : "本地数据操作失败，请刷新核对原请求结果";
}
function throwSecurity(error: unknown) {
  if (
    error instanceof TRPCError &&
    ["FORBIDDEN", "UNAUTHORIZED"].includes(error.code)
  )
    throw error;
}
function likePattern(value: string) {
  return `%${value.replace(/[\\%_]/g, char => `\\${char}`)}%`;
}

type Audit = {
  before: OfficialMallMaterialRow[];
  after: OfficialMallMaterialRow[];
};
type WriteContext = { tx: any; access: OfficialAccess; audit: Audit };
type BulkResult = {
  success: boolean;
  successful: number;
  errors: { id: number; message: string }[];
  idempotent?: boolean;
};

/** Internal facts projection, never a business DTO or public-catalog read. */
export type OfficialMallNewInformationRead = {
  access: OfficialAccess;
  items: Pick<OfficialMallMaterialRow, "id" | "createdAt" | "createdByAdminUserId">[];
};

export function createOfficialMallService(deps: OfficialMallDependencies) {
  async function db() {
    const connection = await deps.getDb();
    if (!connection)
      fail("后台数据库不可用，请稍后核对原请求结果", "INTERNAL_SERVER_ERROR");
    return connection;
  }
  async function withAccess<T>(
    actor: OfficialActor,
    permission: OfficialPermission,
    run: (tx: any, access: OfficialAccess) => Promise<T>
  ): Promise<T> {
    return (await db()).transaction(
      async (tx: any) => {
        const access = await deps.loadOfficialAccess(tx, actor, permission);
        // Fail closed before ANY private SELECT, including for no-team users with a grant.
        deps.officialTeamPredicate(access, materials);
        return run(tx, access);
      },
      { isolationLevel: "repeatable read" }
    );
  }
  /** Reuse native current-account/session/grant/team checks in short transactions.
   * No account/grant/member lock is held across catalog SQL. Recheck before returning:
   * revoke, disable, session/team/role changes discard ALL candidates, fail closed.
   * All business writes still use the original withAccess transaction/locks.
   */
  async function withSuggestAccess<T>(actor: OfficialActor, run: (connection: any, access: OfficialAccess) => Promise<T>): Promise<T> {
    const before = await withAccess(actor, "officialInventory.read", async (_tx, access) => access);
    const result = await run(await db(), before);
    const after = await withAccess(actor, "officialInventory.read", async (_tx, access) => access);
    if (canonicalJson(before) !== canonicalJson(after))
      fail("后台账号权限或官方团队已变化，请刷新后重新查询", "FORBIDDEN");
    return result;
  }
  async function loadMaterial(
    tx: any,
    access: OfficialAccess,
    id: number,
    action: OfficialRecordAction
  ): Promise<OfficialMallMaterialRow> {
    const [row] = await tx
      .select()
      .from(materials)
      .where(
        and(deps.officialTeamPredicate(access, materials), eq(materials.id, id))
      )
      .limit(1)
      .for("update");
    if (!row) fail("官方记录不存在或不在当前团队范围内", "FORBIDDEN");
    deps.assertOfficialRecordAction(access, row, action);
    if (action !== "read") {
      if (!row.teamId) fail("商城物料必须属于有效官方团队", "FORBIDDEN");
      const [team] = await tx
        .select({
          id: officialChannelTeams.id,
          status: officialChannelTeams.status,
        })
        .from(officialChannelTeams)
        .where(eq(officialChannelTeams.id, row.teamId))
        .limit(1)
        .for("update");
      if (!team || team.status !== "active")
        fail("物料所属官方团队不存在或已归档", "FORBIDDEN");
    }
    return row;
  }
  async function chooseTeam(tx: any, access: OfficialAccess, teamId?: number) {
    if (
      !access.isSuperAdmin &&
      teamId !== undefined &&
      teamId !== access.teamId
    )
      fail("普通工作人员不能指定其他官方团队", "FORBIDDEN");
    let selected = teamId ?? access.teamId;
    if (access.isSuperAdmin && teamId === undefined) {
      const teams = await tx.select({ id: officialChannelTeams.id })
        .from(officialChannelTeams).where(eq(officialChannelTeams.status, "active"))
        .orderBy(asc(officialChannelTeams.id)).limit(2).for("update");
      if (!teams.length) fail("没有有效官方团队，请先由超级管理员配置官方团队", "FORBIDDEN");
      if (teams.length > 1) fail("存在多个官方团队，请明确选择归属官方团队", "FORBIDDEN");
      selected = teams[0].id;
    }
    if (!selected)
      fail("当前后台账号未配置有效官方团队，请联系超级管理员配置", "FORBIDDEN");
    const [team] = await tx
      .select({
        id: officialChannelTeams.id,
        status: officialChannelTeams.status,
      })
      .from(officialChannelTeams)
      .where(eq(officialChannelTeams.id, selected))
      .limit(1)
      .for("update");
    if (!team || team.status !== "active")
      fail("官方团队不存在或已归档", "FORBIDDEN");
    return selected;
  }
  async function write<T extends object>(
    actor: OfficialActor,
    action: string,
    input: { requestId: string },
    permission: OfficialPermission,
    recordAction: OfficialRecordAction,
    run: (context: WriteContext) => Promise<T>
  ): Promise<T & { idempotent?: boolean }> {
    // loadOfficialAccess locks the native actor row first. Concurrent same-actor UUIDs
    // serialize even before the unique ledger key; RR is local to this transaction.
    return withAccess(actor, permission, async (tx, access) => {
      const hash = payloadHash(action, actor, input);
      const key = and(
        eq(requests.actorAdminUserId, actor.adminUserId),
        eq(requests.requestId, input.requestId)
      );
      const [receipt] = await tx
        .select()
        .from(requests)
        .where(key)
        .limit(1)
        .for("update");
      if (receipt) {
        if (receipt.action !== action || receipt.payloadHash !== hash)
          fail("原 requestId 已用于不同内容，不得重用", "CONFLICT");
        if (receipt.state !== "completed" || !receipt.result)
          fail(
            "原请求结果尚未确定，请查询 requestStatus，勿自动重发",
            "CONFLICT"
          );
        // Replay is not a stale-permission or stale-team bypass. Revision is deliberately
        // NOT compared to the old expectation: the original committed result is replayed.
        for (const row of (receipt.after ?? []) as OfficialMallMaterialRow[])
          await loadMaterial(tx, access, row.id, recordAction);
        return { ...receipt.result, idempotent: true } as T & {
          idempotent: boolean;
        };
      }
      await tx.insert(requests).values({
        actorAdminUserId: actor.adminUserId,
        requestId: input.requestId,
        action,
        payloadHash: hash,
        state: "pending",
      });
      const audit: Audit = { before: [], after: [] };
      const result = await run({ tx, access, audit });
      await tx
        .update(requests)
        .set({
          state: "completed",
          result: result as Record<string, unknown>,
          before: audit.before,
          after: audit.after,
          completedAt: new Date(),
        })
        .where(key);
      return result;
    });
  }
  async function insertMaterial(
    context: WriteContext,
    actor: OfficialActor,
    teamId: number,
    data: OfficialMallMaterialInput
  ) {
    const created = await context.tx
      .insert(materials)
      .values({
        ...data,
        publicId: `OM_${randomUUID()}`,
        teamId,
        ownerAdminUserId: actor.adminUserId,
        createdByAdminUserId: actor.adminUserId,
        updatedByAdminUserId: actor.adminUserId,
        status: "draft",
        revision: 1,
        publishedByAdminUserId: null,
        publishedAt: null,
      })
      .$returningId();
    const row = await loadMaterial(
      context.tx,
      context.access,
      created[0].id,
      "manage"
    );
    context.audit.after.push(row);
    return row;
  }
  async function updateMaterial(
    context: WriteContext,
    actor: OfficialActor,
    row: OfficialMallMaterialRow,
    revision: number,
    data: OfficialMallMaterialInput
  ) {
    assertRevision(row.revision, revision);
    if (row.status === "published")
      fail("已上架物料必须先显式下架，再编辑保存为待上架", "CONFLICT");
    context.audit.before.push(row);
    await context.tx
      .delete(publications)
      .where(eq(publications.materialId, row.id));
    await context.tx
      .update(materials)
      .set({
        ...data,
        status: "draft",
        revision: row.revision + 1,
        updatedByAdminUserId: actor.adminUserId,
        updatedAt: new Date(),
        publishedByAdminUserId: null,
        publishedAt: null,
      })
      .where(
        and(
          eq(materials.id, row.id),
          eq(materials.revision, row.revision),
          deps.officialTeamPredicate(context.access, materials)
        )
      );
    const after = await loadMaterial(
      context.tx,
      context.access,
      row.id,
      "manage"
    );
    context.audit.after.push(after);
    return after;
  }
  async function changePublication(
    context: WriteContext,
    actor: OfficialActor,
    row: OfficialMallMaterialRow,
    revision: number,
    action: "publish" | "offshelf"
  ) {
    assertRevision(row.revision, revision);
    const data = inputFromRow(row);
    if (action === "publish") assertPublishable(data);
    if (action === "publish" && row.status === "published")
      fail("物料已经上架，请刷新核对", "CONFLICT");
    if (action === "offshelf" && row.status !== "published")
      fail("只有已上架物料可显式下架", "CONFLICT");
    const date = new Date();
    const nextRevision = row.revision + 1;
    const status = action === "publish" ? "published" : "offshelf";
    context.audit.before.push(row);
    await context.tx
      .delete(publications)
      .where(eq(publications.materialId, row.id));
    if (action === "publish") {
      const snapshot = publicProjection(
        { ...data, publicId: row.publicId, revision: nextRevision },
        date.toISOString()
      );
      await context.tx.insert(publications).values({
        materialId: row.id,
        publicId: row.publicId,
        revision: nextRevision,
        partNumber: snapshot.partNumber,
        brand: snapshot.brand,
        snapshot,
        publishedAt: date,
      });
    }
    await context.tx
      .update(materials)
      .set({
        status,
        revision: nextRevision,
        updatedByAdminUserId: actor.adminUserId,
        updatedAt: date,
        publishedByAdminUserId: action === "publish" ? actor.adminUserId : null,
        publishedAt: action === "publish" ? date : null,
      })
      .where(
        and(
          eq(materials.id, row.id),
          eq(materials.revision, row.revision),
          deps.officialTeamPredicate(context.access, materials)
        )
      );
    const after = await loadMaterial(
      context.tx,
      context.access,
      row.id,
      "publish"
    );
    context.audit.after.push(after);
    return after;
  }
  const resultFor = (
    row: OfficialMallMaterialRow
  ): OfficialMallMutationResult => ({
    success: true,
    id: row.id,
    revision: row.revision,
    status: row.status,
  });
  async function findDuplicates(
    tx: any,
    access: OfficialAccess,
    data: OfficialMallMaterialInput
  ): Promise<OfficialMallMaterialRow[]> {
    // Scope is part of SQL BEFORE metadata is selected. Date code is never inferred.
    return tx
      .select()
      .from(materials)
      .where(
        and(
          deps.officialTeamPredicate(access, materials),
          eq(materials.partNumber, data.partNumber),
          eq(materials.brand, data.brand),
          eq(materials.pkg, data.pkg),
          eq(materials.dateCode, data.dateCode)
        )
      )
      .orderBy(asc(materials.id))
      .for("update");
  }
  async function suggestions(
    tx: any,
    access: OfficialAccess,
    query: string,
    brand?: string
  ): Promise<OfficialMallSuggestion[]> {
    if (query.length < OFFICIAL_MALL_SUGGEST_MIN_CHARS) return [];
    const normalize = (value: string) => value.normalize("NFKC").trim().toLowerCase();
    async function candidates(exact: boolean) {
      const rows = await tx.select({
        partNumber: materials.partNumber, brand: materials.brand, pkg: materials.pkg,
      }).from(materials).where(and(
        deps.officialTeamPredicate(access, materials),
        exact ? eq(materials.partNumber, query) : like(materials.partNumber, officialMallPrefixPattern(query)),
        brand ? eq(materials.brand, brand) : undefined,
      )).limit(OFFICIAL_MALL_SUGGEST_RAW_LIMIT);
      // Bound the INDEXED model window BEFORE enabled/brand filtering. A residual
      // status/brand SQL filter could otherwise inspect an unbounded prefix range.
      // Never fetch price, stock, notes, customer IDs or other transaction fields.
      const catalogRows = await tx.select({
        partNumber: materialCatalog.partNumber, brand: materialCatalog.brand,
        pkg: materialCatalog.package, status: materialCatalog.status,
      }).from(materialCatalog, { forceIndex: ["idx_materials_partNumber"] })
        .where(exact ? eq(materialCatalog.partNumber, query) : like(materialCatalog.partNumber, officialMallPrefixPattern(query)))
        .limit(OFFICIAL_MALL_SUGGEST_RAW_LIMIT);
      const enabled = catalogRows.filter((row: any) => row.status === "enabled" &&
        (!brand || row.brand && normalize(row.brand) === normalize(brand)));
      const merged = new Map<string, OfficialMallSuggestion>();
      for (const row of [...rows, ...enabled]) {
        if (!row.partNumber?.trim() || !row.brand?.trim()) continue;
        const candidate = suggestion({ ...row, pkg: row.pkg ?? "" });
        const key = canonicalJson([candidate.partNumber, candidate.brand, candidate.pkg].map(normalize));
        if (!merged.has(key)) merged.set(key, candidate);
        if (merged.size === OFFICIAL_MALL_SUGGEST_RESULT_LIMIT) break;
      }
      return Array.from(merged.values());
    }
    const exact = await candidates(true);
    // Full model hits must not wait for or compete with broad prefix candidates.
    return exact.length ? exact : candidates(false);
  }
  function publicJoin() {
    return and(
      eq(publications.materialId, materials.id),
      eq(publications.publicId, materials.publicId),
      eq(publications.revision, materials.revision),
      eq(materials.status, "published")
    );
  }
  function readSnapshot(row: {
    snapshot: OfficialMallPublicMaterial;
    publicId: string;
    revision: number;
    publishedAt: Date;
  }): OfficialMallPublicMaterial {
    return publicProjection(
      {
        ...row.snapshot,
        note: "",
        publicId: row.publicId,
        revision: row.revision,
      },
      row.publishedAt.toISOString()
    );
  }

  return {
    async status(actor: OfficialActor): Promise<OfficialMallAccess> {
      try {
        return await withAccess(
          actor,
          "officialInventory.read",
          async (tx, access) => ({
            available: true,
            permissions: {
              read: access.permissions.includes("officialInventory.read"),
              write: access.permissions.includes("officialInventory.write"),
              publish: access.permissions.includes("officialInventory.publish"),
            },
            scope: {
              adminUserId: access.adminUserId,
              teamId: access.teamId,
              teamRole: access.teamRole,
              isSuperAdmin: access.isSuperAdmin,
            },
            ...(access.isSuperAdmin
              ? {
                  teams: await tx
                    .select({
                      id: officialChannelTeams.id,
                      name: officialChannelTeams.name,
                    })
                    .from(officialChannelTeams)
                    .where(eq(officialChannelTeams.status, "active"))
                    .orderBy(asc(officialChannelTeams.id)),
                }
              : {}),
          })
        );
      } catch (error) {
        if (
          !(error instanceof TRPCError) ||
          !["FORBIDDEN", "UNAUTHORIZED"].includes(error.code)
        )
          throw error;
        return {
          available: false,
          permissions: { read: false, write: false, publish: false },
          scope: {
            adminUserId: actor.adminUserId,
            teamId: null,
            teamRole: null,
            isSuperAdmin: false,
          },
          message: error.message,
        };
      }
    },
    /**
     * One authority-fenced RR transaction, no writes, pagination or mutable fields.
     * Reuses the native account/session/grant/team algorithm exactly as private list.
     * undefined IDs means ALL current authorized rows; [] means an empty intersection.
     */
    async readNewInformationFacts(
      actor: OfficialActor,
      ids?: readonly number[]
    ): Promise<OfficialMallNewInformationRead> {
      if (ids !== undefined && (ids.length > 100 || ids.some(id => !Number.isSafeInteger(id) || id <= 0 || id > 2147483647)))
        fail("商城物料事实引用无效");
      return withAccess(actor, "officialInventory.read", async (tx, access) => {
        const items = await tx
          .select({
            id: materials.id,
            createdAt: materials.createdAt,
            createdByAdminUserId: materials.createdByAdminUserId,
          })
          .from(materials)
          .where(and(
            deps.officialTeamPredicate(access, materials),
            ids === undefined ? undefined : ids.length ? inArray(materials.id, [...ids]) : sql`1 = 0`
          ))
          .orderBy(asc(materials.id));
        return { access, items };
      });
    },
    async list(
      actor: OfficialActor,
      value: z.input<typeof officialMallListSchema>
    ) {
      const input = officialMallListSchema.parse(value);
      return withAccess(actor, "officialInventory.read", async (tx, access) => {
        const where = and(
          deps.officialTeamPredicate(access, materials),
          input.partNumber
            ? like(materials.partNumber, likePattern(input.partNumber))
            : undefined,
          input.brand
            ? like(materials.brand, likePattern(input.brand))
            : undefined,
          input.status ? eq(materials.status, input.status) : undefined
        );
        const [{ total }] = await tx
          .select({ total: sql<number>`count(*)` })
          .from(materials)
          .where(where);
        const rows = await tx
          .select()
          .from(materials)
          .where(where)
          .orderBy(desc(materials.id))
          .limit(input.pageSize)
          .offset((input.page - 1) * input.pageSize);
        return {
          items: rows.map(privateMaterial),
          total: Number(total),
          page: input.page,
          pageSize: input.pageSize,
        };
      });
    },
    async create(
      actor: OfficialActor,
      value: z.input<typeof officialMallCreateSchema>
    ) {
      const input = officialMallCreateSchema.parse(value);
      input.data = validateOfficialMallMaterial(input.data);
      return write(
        actor,
        "create",
        input,
        "officialInventory.write",
        "manage",
        async context =>
          resultFor(
            await insertMaterial(
              context,
              actor,
              await chooseTeam(context.tx, context.access, input.teamId),
              input.data
            )
          )
      );
    },
    async update(
      actor: OfficialActor,
      value: z.input<typeof officialMallUpdateSchema>
    ) {
      const input = officialMallUpdateSchema.parse(value);
      input.data = validateOfficialMallMaterial(input.data);
      return write(
        actor,
        "update",
        input,
        "officialInventory.write",
        "manage",
        async context =>
          resultFor(
            await updateMaterial(
              context,
              actor,
              await loadMaterial(
                context.tx,
                context.access,
                input.id,
                "manage"
              ),
              input.expectedRevision,
              input.data
            )
          )
      );
    },
    async publish(
      actor: OfficialActor,
      value: z.input<typeof officialMallRowMutationSchema>
    ) {
      const input = officialMallRowMutationSchema.parse(value);
      return write(
        actor,
        "publish",
        input,
        "officialInventory.publish",
        "publish",
        async context =>
          resultFor(
            await changePublication(
              context,
              actor,
              await loadMaterial(
                context.tx,
                context.access,
                input.id,
                "publish"
              ),
              input.expectedRevision,
              "publish"
            )
          )
      );
    },
    async offshelf(
      actor: OfficialActor,
      value: z.input<typeof officialMallRowMutationSchema>
    ) {
      const input = officialMallRowMutationSchema.parse(value);
      return write(
        actor,
        "offshelf",
        input,
        "officialInventory.publish",
        "publish",
        async context =>
          resultFor(
            await changePublication(
              context,
              actor,
              await loadMaterial(
                context.tx,
                context.access,
                input.id,
                "publish"
              ),
              input.expectedRevision,
              "offshelf"
            )
          )
      );
    },
    async bulkAction(
      actor: OfficialActor,
      value: z.input<typeof officialMallBulkSchema>
    ): Promise<BulkResult> {
      const input = officialMallBulkSchema.parse(value);
      if (new Set(input.items.map(item => item.id)).size !== input.items.length)
        fail("批量操作包含重复物料 ID");
      return write(
        actor,
        `bulk_${input.action}`,
        input,
        "officialInventory.publish",
        "publish",
        async context => {
          const locked = new Map<number, OfficialMallMaterialRow>();
          // SECURITY PRECHECK for ALL rows before the first change. A role/scope failure
          // aborts the whole transaction, never a partly-successful permission bypass.
          for (const item of [...input.items].sort((a, b) => a.id - b.id))
            locked.set(
              item.id,
              await loadMaterial(context.tx, context.access, item.id, "publish")
            );
          const result: BulkResult = {
            success: true,
            successful: 0,
            errors: [],
          };
          for (const item of input.items) {
            const row = locked.get(item.id)!;
            try {
              assertRevision(row.revision, item.expectedRevision);
              const data = inputFromRow(row);
              if (input.action === "publish") assertPublishable(data);
              if (input.action === "publish" && row.status === "published")
                fail("物料已经上架", "CONFLICT");
              if (input.action === "offshelf" && row.status !== "published")
                fail("只有已上架物料可下架", "CONFLICT");
            } catch (error) {
              throwSecurity(error);
              result.errors.push({ id: item.id, message: safeError(error) });
              continue;
            }
            // SQL failures are NOT caught per-row: they roll back mutations + receipt.
            await changePublication(
              context,
              actor,
              row,
              item.expectedRevision,
              input.action
            );
            result.successful++;
          }
          result.success = result.errors.length === 0;
          return result;
        }
      );
    },
    async requestStatus(
      actor: OfficialActor,
      value: z.input<typeof officialMallRequestStatusSchema>
    ): Promise<{
      state: "completed" | "not_found" | "pending";
      result: Record<string, unknown> | null;
    }> {
      const input = officialMallRequestStatusSchema.parse(value);
      return withAccess(actor, "officialInventory.read", async tx => {
        const [receipt] = await tx
          .select({ state: requests.state, result: requests.result })
          .from(requests)
          .where(
            and(
              eq(requests.actorAdminUserId, actor.adminUserId),
              eq(requests.requestId, input.requestId)
            )
          )
          .limit(1);
        if (!receipt) return { state: "not_found", result: null };
        return {
          state: receipt.state,
          result: receipt.state === "completed" ? receipt.result : null,
        };
      });
    },
    async suggest(
      actor: OfficialActor,
      value: z.input<typeof officialMallSuggestSchema>
    ) {
      const input = officialMallSuggestSchema.parse(value);
      return withSuggestAccess(
        actor,
        async (tx, access) => ({
          items: await suggestions(tx, access, input.query, input.brand),
        })
      );
    },
    async importPreview(
      actor: OfficialActor,
      value: z.input<typeof officialMallPreviewSchema>
    ): Promise<{ rows: OfficialMallPreviewRow[] }> {
      const input = officialMallPreviewSchema.parse(value);
      return withAccess(actor, "officialInventory.read", async (tx, access) => {
        const rows: OfficialMallPreviewRow[] = [];
        const seen = new Map<string, number>();
        const rowNumbers = new Set<number>();
        for (const row of input.rows) {
          const preview: OfficialMallPreviewRow = {
            rowNumber: row.rowNumber,
            errors: [],
            duplicates: [],
            matches: [],
            matchStatus: "unmatched",
          };
          if (rowNumbers.has(row.rowNumber))
            preview.errors.push("导入行号重复");
          rowNumbers.add(row.rowNumber);
          try {
            preview.data = validateOfficialMallMaterial(row.data);
          } catch (error) {
            preview.errors.push(safeError(error));
            rows.push(preview);
            continue;
          }
          const data = preview.data;
          const key = canonicalJson(
            [data.partNumber, data.brand, data.pkg, data.dateCode].map(v =>
              v.normalize("NFKC").toLowerCase()
            )
          );
          const firstRow = seen.get(key);
          if (firstRow !== undefined)
            preview.errors.push(
              `与本次导入第 ${firstRow} 行型号/品牌/封装/批次重复，请明确选择跳过、更新原 ID 或另建记录`
            );
          else seen.set(key, row.rowNumber);
          preview.duplicates = (await findDuplicates(tx, access, data)).map(
            duplicate
          );
          preview.matches = await suggestions(
            tx,
            access,
            data.partNumber,
            data.brand
          );
          preview.matchStatus = matchStatus(data, preview.matches);
          rows.push(preview);
        }
        return { rows };
      });
    },
    async importRows(
      actor: OfficialActor,
      value: z.input<typeof officialMallImportSchema>
    ): Promise<OfficialMallImportResult> {
      const input = officialMallImportSchema.parse(value);
      return write(
        actor,
        "import",
        input,
        "officialInventory.write",
        "manage",
        async context => {
          const teamId = await chooseTeam(
            context.tx,
            context.access,
            input.teamId
          );
          const result: OfficialMallImportResult = {
            success: true,
            imported: 0,
            updated: 0,
            skipped: 0,
            errors: [],
            ids: [],
          };
          const updates = new Map<number, OfficialMallMaterialRow>();
          // Prelock all real update IDs and check roles/scope before creating ANY rows.
          for (const id of Array.from(
            new Set(
              input.rows
                .filter(row => row.duplicatePolicy === "update")
                .map(row => row.duplicateId!)
            )
          ).sort((a, b) => a - b))
            updates.set(
              id,
              await loadMaterial(context.tx, context.access, id, "manage")
            );
          const rowNumbers = new Set<number>();
          const updatedIds = new Set<number>();
          for (const row of input.rows) {
            let data: OfficialMallMaterialInput;
            let target: OfficialMallMaterialRow | undefined;
            try {
              if (rowNumbers.has(row.rowNumber)) fail("导入行号重复");
              rowNumbers.add(row.rowNumber);
              data = validateOfficialMallMaterial(row.data);
              if (row.duplicatePolicy === "update") {
                target = updates.get(row.duplicateId!)!;
                if (target.teamId !== teamId)
                  fail("更新记录不在所选官方团队范围", "FORBIDDEN");
                if (!sameIdentity(data, target))
                  fail(
                    "更新原 ID 的型号、品牌、封装及批次必须一致；另建记录请显式选择 new"
                  );
                if (updatedIds.has(target.id))
                  fail("同一导入请求不能多次更新同一原 ID");
                assertRevision(target.revision, row.expectedRevision!);
                if (target.status === "published")
                  fail("重复物料已上架，须先显式下架后更新", "CONFLICT");
              }
            } catch (error) {
              throwSecurity(error);
              result.errors.push({
                rowNumber: row.rowNumber,
                message: safeError(error),
              });
              continue;
            }
            if (row.duplicatePolicy === "skip") {
              const existing = await findDuplicates(
                context.tx,
                context.access,
                data!
              );
              if (existing.length) {
                result.skipped++;
                continue;
              }
            }
            if (target) {
              const after = await updateMaterial(
                context,
                actor,
                target,
                row.expectedRevision!,
                data!
              );
              result.updated++;
              result.ids.push(after.id);
              updatedIds.add(after.id);
            } else {
              const after = await insertMaterial(context, actor, teamId, data!);
              result.imported++;
              result.ids.push(after.id);
            }
          }
          result.success = result.errors.length === 0;
          return result;
        }
      );
    },
    async publicList(value: z.input<typeof officialMallPublicListSchema>) {
      const input = officialMallPublicListSchema.parse(value);
      const connection = await db();
      const where = and(
        input.partNumber
          ? like(publications.partNumber, likePattern(input.partNumber))
          : undefined,
        input.brand
          ? like(publications.brand, likePattern(input.brand))
          : undefined
      );
      // One consistent read-only snapshot for total/items, without any account dependency.
      return connection.transaction(
        async (tx: any) => {
          const [{ total }] = await tx
            .select({ total: sql<number>`count(*)` })
            .from(publications)
            .innerJoin(materials, publicJoin())
            .where(where);
          const rows = await tx
            .select({
              snapshot: publications.snapshot,
              publicId: publications.publicId,
              revision: publications.revision,
              publishedAt: publications.publishedAt,
            })
            .from(publications)
            .innerJoin(materials, publicJoin())
            .where(where)
            .orderBy(desc(publications.materialId))
            .limit(input.pageSize)
            .offset((input.page - 1) * input.pageSize);
          return {
            items: rows.map(readSnapshot),
            total: Number(total),
            page: input.page,
            pageSize: input.pageSize,
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" }
      );
    },
    async publicDetail(
      value: z.input<typeof officialMallPublicIdSchema>
    ): Promise<{ item: OfficialMallPublicMaterial | null }> {
      const input = officialMallPublicIdSchema.parse(value);
      const [row] = await (
        await db()
      )
        .select({
          snapshot: publications.snapshot,
          publicId: publications.publicId,
          revision: publications.revision,
          publishedAt: publications.publishedAt,
        })
        .from(publications)
        .innerJoin(materials, publicJoin())
        .where(eq(publications.publicId, input.publicId))
        .limit(1);
      return { item: row ? readSnapshot(row) : null };
    },
  };
}

export const officialMallTestUtils = {
  canonicalJson,
  payloadHash,
  exactPrice,
  assertRevision,
  sameIdentity,
  matchStatus,
  publicProjection,
};
