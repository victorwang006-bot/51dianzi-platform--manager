import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  adminBusinessStaffBindings,
  adminUsers,
  merchants,
} from "../../drizzle/schema";
import {
  officialChannelAudits,
  officialChannelPublications,
  officialChannelSources,
  officialChannelStocks,
  officialChannelTeamMembers,
  officialChannelTeams,
} from "../../drizzle/officialChannelSchema";
import { platformDatabaseIdentifier } from "../cnRegistrationPolicy";
import { getDb } from "../db";
import {
  loadOfficialAccess,
  type OfficialActor,
  type OfficialDbExecutor,
} from "./officialChannelAccess";

/**
 * Compatibility path for the one verified official historical owner only.
 *
 * This service is deliberately independent from businessRouter, merchant ERP teams,
 * normal inventory tables, and public projections. merchant 30061 is a legacy locator,
 * not an authorization source: every operation first reloads a real local super_admin
 * with `loadOfficialAccess(..., "officialTeams.manage")`.
 */

const LEGACY_MERCHANT_ID = 30061;
const LEGACY_CHANNELS_TABLE = "channel_inventory_channels";
const LEGACY_MATERIALS_TABLE = "channel_inventory_materials";
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const MYSQL_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const SOURCE_TYPES = new Set(["factory", "agent", "trade", "other"]);

type SourceType = "factory" | "agent" | "trade" | "other";
type LegacyTimestamp = Date | string;

type LegacySource = {
  id: number;
  enterpriseId: number;
  dataOwnerUserId: number;
  responsibleUserId: number;
  name: string;
  type: SourceType;
  contactName: string | null;
  phone: string | null;
  wechat: string | null;
  qq: string | null;
  notes: string | null;
  active: boolean;
  createdAt: LegacyTimestamp;
  updatedAt: LegacyTimestamp;
};

type LegacyMaterial = {
  id: number;
  sourceId: number;
  enterpriseId: number;
  dataOwnerUserId: number;
  responsibleUserId: number;
  partNumber: string;
  brand: string;
  qty: number | null;
  dateCode: string | null;
  price: string | null;
  currency: "CNY";
  taxIncluded: boolean | null;
  leadTime: string | null;
  note: string | null;
  createdAt: LegacyTimestamp;
  updatedAt: LegacyTimestamp;
};

type VerifiedLegacyOwner = {
  merchantId: number;
  portalUserId: number;
};

type LegacySnapshot = {
  owner: VerifiedLegacyOwner;
  sources: LegacySource[];
  materials: LegacyMaterial[];
  ownerAdminUserIdByFrontUserId: Map<number, number>;
};

export type OfficialLegacyActor = OfficialActor;

export type OfficialChannelLegacyOverview = {
  /** This endpoint is returned only after a live `officialTeams.manage` check. */
  isSuperAdmin: true;
  legacyMerchantId: number;
  legacyDatabase: string;
  legacyTablesPresent: boolean;
  officialOwnerVerified: boolean;
  legacySourceCount: number;
  legacyStockCount: number;
  importedSourceCount: number;
  importedStockCount: number;
  canImport: boolean;
  /** Super-admin-facing operational state only; it is never reachable by ordinary staff. */
  state:
    | "ready"
    | "nothing_to_import"
    | "legacy_tables_missing"
    | "official_owner_missing_or_invalid"
    | "already_imported_or_conflicted";
};

export type ImportOfficialChannelLegacyInput = {
  requestId: string;
};

export type ImportedLegacySourceDto = {
  legacySourceId: string;
  sourceId: number;
};

export type ImportedLegacyStockDto = {
  legacyMaterialId: string;
  stockId: number;
  ownerAdminUserId: number;
};

export type ImportOfficialChannelLegacyResult = {
  requestId: string;
  importedSources: ImportedLegacySourceDto[];
  importedStocks: ImportedLegacyStockDto[];
  initialTeamId: null;
  sourcePublicationApproved: false;
  stockStatus: "draft";
  /** Old channel tables do not prove an immutable creator. New creator is the importing actor. */
  historicalCreator: "unknown";
  idempotent: boolean;
};

export type ClassifyOfficialChannelLegacySourceInput = {
  sourceId: number;
  teamId: number;
  expectedRevision: number;
  requestId: string;
  reason: string;
};

export type ClassifyOfficialChannelLegacySourceResult = {
  sourceId: number;
  legacySourceId: string;
  teamId: number;
  sourceRevision: number;
  stocks: Array<{ stockId: number; revision: number }>;
  requestId: string;
  idempotent: boolean;
};

export class OfficialChannelLegacyError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "OfficialChannelLegacyError";
  }
}

function fail(code: string): never {
  throw new OfficialChannelLegacyError(code);
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function assertRequestId(requestId: string) {
  if (typeof requestId !== "string" || !REQUEST_ID_PATTERN.test(requestId)) {
    fail("OFFICIAL_LEGACY_REQUEST_ID_INVALID");
  }
}

function assertPositiveInt(
  value: unknown,
  code: string
): asserts value is number {
  if (!isPositiveInt(value)) fail(code);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}

function payloadHash(
  action: string,
  actor: OfficialLegacyActor,
  payload: unknown
): string {
  return createHash("sha256")
    .update(
      canonicalJson({ action, actorAdminUserId: actor.adminUserId, payload })
    )
    .digest("hex");
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/** A fixed-size name keeps GET_LOCK within MySQL's 64-character limit. */
function lockName(
  scope: "request" | "import" | "classify",
  key: string
): string {
  return `official-legacy:${scope}:${sha256(key).slice(0, 32)}`;
}

function legacyDatabaseName(): string {
  // platformDatabaseIdentifier validates PLATFORM_DB_NAME before it can become an identifier.
  const database = platformDatabaseIdentifier();
  if (!MYSQL_IDENTIFIER_PATTERN.test(database))
    fail("OFFICIAL_LEGACY_DATABASE_IDENTIFIER_INVALID");
  return database;
}

function legacyDatabaseIdentifier() {
  return sql.identifier(legacyDatabaseName());
}

function rowsFromExecute(result: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(result)) return [];
  if (Array.isArray(result[0]))
    return result[0] as Array<Record<string, unknown>>;
  return result as Array<Record<string, unknown>>;
}

function firstRow(result: unknown): Record<string, unknown> | null {
  return rowsFromExecute(result)[0] ?? null;
}

function parseInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value !== "string" || !/^-?\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parsePositiveInteger(value: unknown): number | null {
  const parsed = parseInteger(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function parseLegacyOwnerId(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{1,15}$/.test(value.trim()))
    return null;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function requiredText(value: unknown, maxLength: number, code: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength)
    fail(code);
  // Preserve the original field exactly; trimming is only a validation predicate.
  return value;
}

function optionalText(
  value: unknown,
  maxLength: number,
  code: string
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > maxLength) fail(code);
  return value;
}

function optionalLegacyText(value: unknown, code: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") fail(code);
  return value;
}

function requiredLegacyTimestamp(
  value: unknown,
  code: string
): LegacyTimestamp {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  // Passing a database timestamp string through the project's custom timestamp type preserves
  // its literal Beijing-time representation instead of coercing it through a JS number/date.
  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(value)
  ) {
    return value;
  }
  fail(code);
}

function timestampForAudit(value: LegacyTimestamp): string {
  return value instanceof Date ? value.toISOString() : value;
}

function strictBoolean(value: unknown, code: string): boolean {
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  fail(code);
}

function nullableBoolean(value: unknown, code: string): boolean | null {
  if (value === null || value === undefined) return null;
  return strictBoolean(value, code);
}

function legacySourceFromRow(row: Record<string, unknown>): LegacySource {
  const id = parsePositiveInteger(row.sourceId);
  const enterpriseId = parsePositiveInteger(row.enterpriseId);
  const dataOwnerUserId = parsePositiveInteger(row.dataOwnerUserId);
  const responsibleUserId = parsePositiveInteger(row.responsibleUserId);
  if (!id || !enterpriseId || !dataOwnerUserId || !responsibleUserId) {
    fail("OFFICIAL_LEGACY_SOURCE_INVALID_IDENTIFIER");
  }
  const rawType = typeof row.type === "string" ? row.type : "";
  if (!SOURCE_TYPES.has(rawType)) fail("OFFICIAL_LEGACY_SOURCE_TYPE_INVALID");
  return {
    id,
    enterpriseId,
    dataOwnerUserId,
    responsibleUserId,
    name: requiredText(row.name, 128, "OFFICIAL_LEGACY_SOURCE_NAME_INVALID"),
    type: rawType as SourceType,
    contactName: optionalText(
      row.contactName,
      128,
      "OFFICIAL_LEGACY_SOURCE_CONTACT_INVALID"
    ),
    phone: optionalText(row.phone, 64, "OFFICIAL_LEGACY_SOURCE_PHONE_INVALID"),
    wechat: optionalText(
      row.wechat,
      128,
      "OFFICIAL_LEGACY_SOURCE_WECHAT_INVALID"
    ),
    qq: optionalText(row.qq, 64, "OFFICIAL_LEGACY_SOURCE_QQ_INVALID"),
    notes: optionalLegacyText(
      row.notes,
      "OFFICIAL_LEGACY_SOURCE_NOTES_INVALID"
    ),
    active: strictBoolean(row.active, "OFFICIAL_LEGACY_SOURCE_ACTIVE_INVALID"),
    createdAt: requiredLegacyTimestamp(
      row.createdAt,
      "OFFICIAL_LEGACY_SOURCE_CREATED_AT_INVALID"
    ),
    updatedAt: requiredLegacyTimestamp(
      row.updatedAt,
      "OFFICIAL_LEGACY_SOURCE_UPDATED_AT_INVALID"
    ),
  };
}

function legacyMaterialFromRow(row: Record<string, unknown>): LegacyMaterial {
  const id = parsePositiveInteger(row.materialId);
  const sourceId = parsePositiveInteger(row.sourceId);
  const enterpriseId = parsePositiveInteger(row.enterpriseId);
  const dataOwnerUserId = parsePositiveInteger(row.dataOwnerUserId);
  const responsibleUserId = parsePositiveInteger(row.responsibleUserId);
  if (
    !id ||
    !sourceId ||
    !enterpriseId ||
    !dataOwnerUserId ||
    !responsibleUserId
  ) {
    fail("OFFICIAL_LEGACY_MATERIAL_INVALID_IDENTIFIER");
  }
  const qtyRaw = row.qty;
  const qty =
    qtyRaw === null || qtyRaw === undefined ? null : parseInteger(qtyRaw);
  if (qtyRaw !== null && qtyRaw !== undefined && (qty === null || qty < 0)) {
    fail("OFFICIAL_LEGACY_MATERIAL_QTY_INVALID");
  }
  const currency = row.currency;
  if (currency !== "CNY") fail("OFFICIAL_LEGACY_MATERIAL_CURRENCY_INVALID");
  return {
    id,
    sourceId,
    enterpriseId,
    dataOwnerUserId,
    responsibleUserId,
    partNumber: requiredText(
      row.partNumber,
      256,
      "OFFICIAL_LEGACY_MATERIAL_PART_NUMBER_INVALID"
    ),
    brand: requiredText(
      row.brand,
      128,
      "OFFICIAL_LEGACY_MATERIAL_BRAND_INVALID"
    ),
    qty,
    dateCode: optionalText(
      row.dateCode,
      64,
      "OFFICIAL_LEGACY_MATERIAL_DATE_CODE_INVALID"
    ),
    // Keep legacy commercial values as text exactly as stored; do not parse or round a price.
    price: optionalText(
      row.price,
      64,
      "OFFICIAL_LEGACY_MATERIAL_PRICE_INVALID"
    ),
    currency,
    taxIncluded: nullableBoolean(
      row.taxIncluded,
      "OFFICIAL_LEGACY_MATERIAL_TAX_INVALID"
    ),
    leadTime: optionalText(
      row.leadTime,
      128,
      "OFFICIAL_LEGACY_MATERIAL_LEAD_TIME_INVALID"
    ),
    note: optionalLegacyText(row.note, "OFFICIAL_LEGACY_MATERIAL_NOTE_INVALID"),
    createdAt: requiredLegacyTimestamp(
      row.createdAt,
      "OFFICIAL_LEGACY_MATERIAL_CREATED_AT_INVALID"
    ),
    updatedAt: requiredLegacyTimestamp(
      row.updatedAt,
      "OFFICIAL_LEGACY_MATERIAL_UPDATED_AT_INVALID"
    ),
  };
}

async function requireDb() {
  const db = await getDb();
  if (!db) fail("OFFICIAL_LEGACY_DATABASE_NOT_AVAILABLE");
  return db;
}

async function acquireLock(tx: OfficialDbExecutor, name: string) {
  const row = firstRow(
    await tx.execute(sql`SELECT GET_LOCK(${name}, 10) AS acquired`)
  );
  if (Number(row?.acquired) !== 1) fail("OFFICIAL_LEGACY_LOCK_UNAVAILABLE");
}

async function releaseLock(tx: OfficialDbExecutor, name: string) {
  await tx.execute(sql`SELECT RELEASE_LOCK(${name}) AS released`);
}

async function legacyTablesPresent(
  tx: OfficialDbExecutor,
  database: string
): Promise<boolean> {
  const rows = rowsFromExecute(
    await tx.execute(sql`
    SELECT table_name AS tableName
      FROM information_schema.tables
     WHERE table_schema = ${database}
       AND table_name IN (${LEGACY_CHANNELS_TABLE}, ${LEGACY_MATERIALS_TABLE})
  `)
  );
  const found = new Set(rows.map(row => String(row.tableName)));
  return found.has(LEGACY_CHANNELS_TABLE) && found.has(LEGACY_MATERIALS_TABLE);
}

async function loadVerifiedOfficialLegacyOwner(
  tx: OfficialDbExecutor
): Promise<VerifiedLegacyOwner> {
  // Do not use merchants.portalUserId, messageThreads.portalUserId, or any ERP team relation.
  const [merchant] = await tx
    .select({
      id: merchants.id,
      crmOwnerPortalUserId: merchants.crmOwnerPortalUserId,
    })
    .from(merchants)
    .where(eq(merchants.id, LEGACY_MERCHANT_ID))
    .limit(1)
    .for("update");
  const portalUserId = parseLegacyOwnerId(merchant?.crmOwnerPortalUserId);
  if (!merchant || !portalUserId)
    fail("OFFICIAL_LEGACY_OFFICIAL_OWNER_INVALID");
  return { merchantId: merchant.id, portalUserId };
}

async function readLegacySources(
  tx: OfficialDbExecutor,
  owner: VerifiedLegacyOwner
): Promise<LegacySource[]> {
  const legacyDb = legacyDatabaseIdentifier();
  const rows = rowsFromExecute(
    await tx.execute(sql`
    SELECT
      channel.id AS sourceId,
      channel.enterprise_id AS enterpriseId,
      channel.data_owner_user_id AS dataOwnerUserId,
      channel.responsible_user_id AS responsibleUserId,
      channel.name AS name,
      channel.channel_type AS type,
      channel.contact_name AS contactName,
      channel.phone AS phone,
      channel.wechat AS wechat,
      channel.qq AS qq,
      channel.notes AS notes,
      channel.active AS active,
      channel.created_at AS createdAt,
      channel.updated_at AS updatedAt
      FROM ${legacyDb}.${sql.identifier(LEGACY_CHANNELS_TABLE)} AS channel
     WHERE channel.data_owner_user_id = ${owner.portalUserId}
     ORDER BY channel.id ASC
  `)
  );
  const sources = rows.map(legacySourceFromRow);
  for (const source of sources) {
    if (source.dataOwnerUserId !== owner.portalUserId) {
      fail("OFFICIAL_LEGACY_SOURCE_OWNER_MISMATCH");
    }
  }
  return sources;
}

async function readLegacyMaterials(
  tx: OfficialDbExecutor,
  owner: VerifiedLegacyOwner,
  sources: readonly LegacySource[]
): Promise<LegacyMaterial[]> {
  if (sources.length === 0) return [];
  const legacyDb = legacyDatabaseIdentifier();
  // The channel join scopes every inspected material to a source that already belongs to the
  // one verified official owner. Rows with bad owner/enterprise linkage are read only to fail
  // the import; they can never be copied.
  const rows = rowsFromExecute(
    await tx.execute(sql`
    SELECT
      material.id AS materialId,
      material.channel_id AS sourceId,
      material.enterprise_id AS enterpriseId,
      material.data_owner_user_id AS dataOwnerUserId,
      material.responsible_user_id AS responsibleUserId,
      material.part_number AS partNumber,
      material.brand AS brand,
      material.qty AS qty,
      material.date_code AS dateCode,
      material.price AS price,
      material.currency AS currency,
      material.tax_included AS taxIncluded,
      material.lead_time AS leadTime,
      material.note AS note,
      material.created_at AS createdAt,
      material.updated_at AS updatedAt
      FROM ${legacyDb}.${sql.identifier(LEGACY_MATERIALS_TABLE)} AS material
      INNER JOIN ${legacyDb}.${sql.identifier(LEGACY_CHANNELS_TABLE)} AS channel
        ON channel.id = material.channel_id
     WHERE channel.data_owner_user_id = ${owner.portalUserId}
     ORDER BY material.id ASC
  `)
  );
  const bySourceId = new Map(sources.map(source => [source.id, source]));
  const materials = rows.map(legacyMaterialFromRow);
  for (const material of materials) {
    const source = bySourceId.get(material.sourceId);
    if (!source) fail("OFFICIAL_LEGACY_MATERIAL_SOURCE_MISMATCH");
    if (
      material.dataOwnerUserId !== owner.portalUserId ||
      material.enterpriseId !== source.enterpriseId
    ) {
      fail("OFFICIAL_LEGACY_MATERIAL_OWNER_OR_ENTERPRISE_MISMATCH");
    }
  }
  return materials;
}

async function verifyResponsibleMappings(
  tx: OfficialDbExecutor,
  sources: readonly LegacySource[],
  materials: readonly LegacyMaterial[]
): Promise<Map<number, number>> {
  const frontUserIds = Array.from(
    new Set([
      ...sources.map(source => source.responsibleUserId),
      ...materials.map(material => material.responsibleUserId),
    ])
  );
  if (frontUserIds.length === 0) return new Map();
  const rows = await tx
    .select({
      frontUserId: adminBusinessStaffBindings.frontUserId,
      adminUserId: adminBusinessStaffBindings.adminUserId,
      bindingStatus: adminBusinessStaffBindings.status,
      adminStatus: adminUsers.status,
    })
    .from(adminBusinessStaffBindings)
    .innerJoin(
      adminUsers,
      eq(adminUsers.id, adminBusinessStaffBindings.adminUserId)
    )
    .where(
      and(
        inArray(adminBusinessStaffBindings.frontUserId, frontUserIds),
        eq(adminBusinessStaffBindings.status, "active"),
        eq(adminUsers.status, "active")
      )
    )
    .for("update");
  const map = new Map<number, number>();
  for (const row of rows) {
    if (isPositiveInt(row.frontUserId) && isPositiveInt(row.adminUserId)) {
      map.set(row.frontUserId, row.adminUserId);
    }
  }
  for (const frontUserId of frontUserIds) {
    if (!map.has(frontUserId))
      fail("OFFICIAL_LEGACY_RESPONSIBLE_BINDING_UNVERIFIED");
  }
  return map;
}

async function loadLegacySnapshot(
  tx: OfficialDbExecutor
): Promise<LegacySnapshot> {
  const owner = await loadVerifiedOfficialLegacyOwner(tx);
  const sources = await readLegacySources(tx, owner);
  const materials = await readLegacyMaterials(tx, owner, sources);
  const ownerAdminUserIdByFrontUserId = await verifyResponsibleMappings(
    tx,
    sources,
    materials
  );
  return { owner, sources, materials, ownerAdminUserIdByFrontUserId };
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value))
    return value as Record<string, unknown>;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function replayAudit<T extends Record<string, unknown>>(
  tx: OfficialDbExecutor,
  input: {
    action: string;
    targetId: string;
    actor: OfficialLegacyActor;
    requestId: string;
    hash: string;
  }
): Promise<T | null> {
  const [prior] = await tx
    .select({
      action: officialChannelAudits.action,
      targetId: officialChannelAudits.targetId,
      actorAdminUserId: officialChannelAudits.actorAdminUserId,
      payloadHash: officialChannelAudits.payloadHash,
      afterData: officialChannelAudits.afterData,
    })
    .from(officialChannelAudits)
    .where(eq(officialChannelAudits.requestId, input.requestId))
    .limit(1)
    .for("update");
  if (!prior) return null;
  if (
    prior.action !== input.action ||
    prior.targetId !== input.targetId ||
    prior.actorAdminUserId !== input.actor.adminUserId ||
    prior.payloadHash !== input.hash
  ) {
    fail("OFFICIAL_LEGACY_REQUEST_ID_REUSED");
  }
  const result = jsonObject(prior.afterData)?.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    fail("OFFICIAL_LEGACY_AUDIT_REPLAY_INVALID");
  }
  return result as T;
}

async function appendAudit(
  tx: OfficialDbExecutor,
  input: {
    action: string;
    targetId: string;
    actor: OfficialLegacyActor;
    requestId: string;
    hash: string;
    beforeData: Record<string, unknown> | null;
    afterData: Record<string, unknown>;
  }
) {
  await tx.insert(officialChannelAudits).values({
    action: input.action,
    targetId: input.targetId,
    actorAdminUserId: input.actor.adminUserId,
    requestId: input.requestId,
    payloadHash: input.hash,
    beforeData: input.beforeData,
    afterData: input.afterData,
  });
}

function sourceProvenance(source: LegacySource, ownerAdminUserId: number) {
  return {
    legacySourceId: String(source.id),
    enterpriseId: source.enterpriseId,
    historicalResponsibleFrontUserId: source.responsibleUserId,
    verifiedCurrentOwnerAdminUserId: ownerAdminUserId,
    legacyCreatedAt: timestampForAudit(source.createdAt),
    legacyUpdatedAt: timestampForAudit(source.updatedAt),
    originalCreator: "unknown:not_represented_by-legacy-channel-columns",
  };
}

function materialProvenance(
  material: LegacyMaterial,
  ownerAdminUserId: number
) {
  return {
    legacyMaterialId: String(material.id),
    legacySourceId: String(material.sourceId),
    enterpriseId: material.enterpriseId,
    historicalResponsibleFrontUserId: material.responsibleUserId,
    verifiedCurrentOwnerAdminUserId: ownerAdminUserId,
    legacyCreatedAt: timestampForAudit(material.createdAt),
    legacyUpdatedAt: timestampForAudit(material.updatedAt),
    originalCreator: "unknown:not_represented-by-legacy-material-columns",
  };
}

function legacyStockCreateRequestId(materialId: number): string {
  // This is separate from the import audit request. It is stable per immutable legacy row
  // and cannot exceed the target `createRequestId` varchar(64) column.
  return `legacy-material-${materialId}`;
}

function legacyStockCreatePayloadHash(
  material: LegacyMaterial,
  sourceId: number,
  ownerAdminUserId: number
): string {
  return sha256({
    action: "official.legacy.material.import",
    legacyMaterialId: material.id,
    sourceId,
    ownerAdminUserId,
    partNumber: material.partNumber,
    brand: material.brand,
    qty: material.qty,
    dateCode: material.dateCode,
    price: material.price,
    currency: material.currency,
    taxIncluded: material.taxIncluded,
    leadTime: material.leadTime,
    note: material.note,
    createdAt: timestampForAudit(material.createdAt),
    updatedAt: timestampForAudit(material.updatedAt),
  });
}

async function assertLegacyRowsNotPreviouslyImported(
  tx: OfficialDbExecutor,
  sources: readonly LegacySource[],
  materials: readonly LegacyMaterial[]
) {
  const legacySourceIds = sources.map(source => String(source.id));
  const legacyMaterialIds = materials.map(material => String(material.id));
  if (legacySourceIds.length > 0) {
    const existing = await tx
      .select({ legacySourceId: officialChannelSources.legacySourceId })
      .from(officialChannelSources)
      .where(inArray(officialChannelSources.legacySourceId, legacySourceIds))
      .for("update");
    if (existing.length > 0)
      fail("OFFICIAL_LEGACY_SOURCE_ALREADY_IMPORTED_OR_CONFLICTED");
  }
  if (legacyMaterialIds.length > 0) {
    const existing = await tx
      .select({ legacyMaterialId: officialChannelStocks.legacyMaterialId })
      .from(officialChannelStocks)
      .where(inArray(officialChannelStocks.legacyMaterialId, legacyMaterialIds))
      .for("update");
    if (existing.length > 0)
      fail("OFFICIAL_LEGACY_MATERIAL_ALREADY_IMPORTED_OR_CONFLICTED");
  }
}

/**
 * Super-admin-only preview. It deliberately has no ordinary-user fallback: even counts and
 * compatibility readiness could reveal legacy official operations, so the native super-admin
 * check is performed before the merchant locator or legacy schema is queried.
 */
export async function overviewLegacy(
  actor: OfficialLegacyActor
): Promise<OfficialChannelLegacyOverview> {
  assertPositiveInt(actor?.adminUserId, "OFFICIAL_LEGACY_ACTOR_REQUIRED");
  assertPositiveInt(actor?.sessionVersion, "OFFICIAL_LEGACY_ACTOR_REQUIRED");
  const db = await requireDb();
  return db.transaction(async tx => {
    const access = await loadOfficialAccess(tx, actor, "officialTeams.manage");
    if (!access.isSuperAdmin) fail("OFFICIAL_LEGACY_SUPER_ADMIN_REQUIRED");
    const database = legacyDatabaseName();
    const tablesPresent = await legacyTablesPresent(tx, database);
    if (!tablesPresent) {
      return {
        isSuperAdmin: true,
        legacyMerchantId: LEGACY_MERCHANT_ID,
        legacyDatabase: database,
        legacyTablesPresent: false,
        officialOwnerVerified: false,
        legacySourceCount: 0,
        legacyStockCount: 0,
        importedSourceCount: 0,
        importedStockCount: 0,
        canImport: false,
        state: "legacy_tables_missing",
      };
    }

    let owner: VerifiedLegacyOwner;
    try {
      owner = await loadVerifiedOfficialLegacyOwner(tx);
    } catch (error) {
      if (error instanceof OfficialChannelLegacyError) {
        return {
          isSuperAdmin: true,
          legacyMerchantId: LEGACY_MERCHANT_ID,
          legacyDatabase: database,
          legacyTablesPresent: true,
          officialOwnerVerified: false,
          legacySourceCount: 0,
          legacyStockCount: 0,
          importedSourceCount: 0,
          importedStockCount: 0,
          canImport: false,
          state: "official_owner_missing_or_invalid",
        };
      }
      throw error;
    }

    const legacyDb = legacyDatabaseIdentifier();
    const sourceCountRow = firstRow(
      await tx.execute(sql`
      SELECT COUNT(*) AS count
        FROM ${legacyDb}.${sql.identifier(LEGACY_CHANNELS_TABLE)} AS channel
       WHERE channel.data_owner_user_id = ${owner.portalUserId}
    `)
    );
    const stockCountRow = firstRow(
      await tx.execute(sql`
      SELECT COUNT(*) AS count
        FROM ${legacyDb}.${sql.identifier(LEGACY_MATERIALS_TABLE)} AS material
        INNER JOIN ${legacyDb}.${sql.identifier(LEGACY_CHANNELS_TABLE)} AS channel
          ON channel.id = material.channel_id
       WHERE channel.data_owner_user_id = ${owner.portalUserId}
    `)
    );
    const [importedSources] = await tx
      .select({ count: sql<number>`COUNT(*)` })
      .from(officialChannelSources)
      .where(sql`${officialChannelSources.legacySourceId} IS NOT NULL`);
    const [importedStocks] = await tx
      .select({ count: sql<number>`COUNT(*)` })
      .from(officialChannelStocks)
      .where(sql`${officialChannelStocks.legacyMaterialId} IS NOT NULL`);

    const legacySourceCount = Number(sourceCountRow?.count ?? 0);
    const legacyStockCount = Number(stockCountRow?.count ?? 0);
    const importedSourceCount = Number(importedSources?.count ?? 0);
    const importedStockCount = Number(importedStocks?.count ?? 0);
    const hasLegacyRows = legacySourceCount > 0 || legacyStockCount > 0;
    const hasImportedRows = importedSourceCount > 0 || importedStockCount > 0;
    return {
      isSuperAdmin: true,
      legacyMerchantId: LEGACY_MERCHANT_ID,
      legacyDatabase: database,
      legacyTablesPresent: true,
      officialOwnerVerified: true,
      legacySourceCount,
      legacyStockCount,
      importedSourceCount,
      importedStockCount,
      canImport: hasLegacyRows && !hasImportedRows,
      state: !hasLegacyRows
        ? "nothing_to_import"
        : hasImportedRows
          ? "already_imported_or_conflicted"
          : "ready",
    };
  });
}

/**
 * Explicit one-shot import. It never updates legacy tables and does not accept a source owner,
 * stock owner, or official team from the browser. A failed source/material/mapping validation
 * aborts the entire transaction, leaving the legacy database and official tables unchanged.
 */
export async function importLegacy(
  actor: OfficialLegacyActor,
  input: ImportOfficialChannelLegacyInput
): Promise<ImportOfficialChannelLegacyResult> {
  assertPositiveInt(actor?.adminUserId, "OFFICIAL_LEGACY_ACTOR_REQUIRED");
  assertPositiveInt(actor?.sessionVersion, "OFFICIAL_LEGACY_ACTOR_REQUIRED");
  assertRequestId(input?.requestId);
  const db = await requireDb();
  const hash = payloadHash("official.legacy.import", actor, {
    requestId: input.requestId,
  });
  return db.transaction(async tx => {
    const requestLock = lockName("request", input.requestId);
    const importLock = lockName("import", "official-merchant-30061-v1");
    await acquireLock(tx, requestLock);
    try {
      await acquireLock(tx, importLock);
      try {
        const access = await loadOfficialAccess(
          tx,
          actor,
          "officialTeams.manage"
        );
        if (!access.isSuperAdmin) fail("OFFICIAL_LEGACY_SUPER_ADMIN_REQUIRED");
        const replay = await replayAudit<ImportOfficialChannelLegacyResult>(
          tx,
          {
            action: "official.legacy.import",
            targetId: `merchant:${LEGACY_MERCHANT_ID}`,
            actor,
            requestId: input.requestId,
            hash,
          }
        );
        if (replay) return { ...replay, idempotent: true };

        const database = legacyDatabaseName();
        if (!(await legacyTablesPresent(tx, database)))
          fail("OFFICIAL_LEGACY_TABLES_MISSING");
        const snapshot = await loadLegacySnapshot(tx);
        await assertLegacyRowsNotPreviouslyImported(
          tx,
          snapshot.sources,
          snapshot.materials
        );

        const newSourceIdByLegacySourceId = new Map<number, number>();
        const importedSources: ImportedLegacySourceDto[] = [];
        for (const source of snapshot.sources) {
          const ownerAdminUserId = snapshot.ownerAdminUserIdByFrontUserId.get(
            source.responsibleUserId
          );
          if (!ownerAdminUserId)
            fail("OFFICIAL_LEGACY_RESPONSIBLE_BINDING_UNVERIFIED");
          const [created] = await tx
            .insert(officialChannelSources)
            .values({
              teamId: null,
              name: source.name,
              type: source.type,
              contactName: source.contactName,
              phone: source.phone,
              wechat: source.wechat,
              qq: source.qq,
              // Legacy source notes remain private official-source notes; never public projection data.
              notes: source.notes,
              active: source.active,
              publicationApproved: false,
              everPublished: false,
              // Legacy tables do not prove the historic creator: record the actual importing actor.
              createdByAdminUserId: actor.adminUserId,
              revision: 1,
              legacySourceId: String(source.id),
              createdAt: source.createdAt as any,
              updatedAt: source.updatedAt as any,
            })
            .$returningId();
          if (!created?.id) fail("OFFICIAL_LEGACY_SOURCE_CREATE_FAILED");
          newSourceIdByLegacySourceId.set(source.id, created.id);
          importedSources.push({
            legacySourceId: String(source.id),
            sourceId: created.id,
          });
        }

        const importedStocks: ImportedLegacyStockDto[] = [];
        for (const material of snapshot.materials) {
          const sourceId = newSourceIdByLegacySourceId.get(material.sourceId);
          const ownerAdminUserId = snapshot.ownerAdminUserIdByFrontUserId.get(
            material.responsibleUserId
          );
          if (!sourceId) fail("OFFICIAL_LEGACY_MATERIAL_SOURCE_MISMATCH");
          if (!ownerAdminUserId)
            fail("OFFICIAL_LEGACY_RESPONSIBLE_BINDING_UNVERIFIED");
          const [created] = await tx
            .insert(officialChannelStocks)
            .values({
              sourceId,
              teamId: null,
              // The actual importing backend actor is the only provable new creator.
              createdByAdminUserId: actor.adminUserId,
              ownerAdminUserId,
              partNumber: material.partNumber,
              brand: material.brand,
              qty: material.qty,
              dateCode: material.dateCode,
              price: material.price,
              currency: material.currency,
              taxIncluded: material.taxIncluded,
              leadTime: material.leadTime,
              // Legacy material note is private operational data and is not sent to a public projection.
              note: material.note,
              status: "draft",
              revision: 1,
              createRequestId: legacyStockCreateRequestId(material.id),
              createPayloadHash: legacyStockCreatePayloadHash(
                material,
                sourceId,
                ownerAdminUserId
              ),
              publishedAt: null,
              legacyMaterialId: String(material.id),
              createdAt: material.createdAt as any,
              updatedAt: material.updatedAt as any,
            })
            .$returningId();
          if (!created?.id) fail("OFFICIAL_LEGACY_MATERIAL_CREATE_FAILED");
          importedStocks.push({
            legacyMaterialId: String(material.id),
            stockId: created.id,
            ownerAdminUserId,
          });
        }

        const result: ImportOfficialChannelLegacyResult = {
          requestId: input.requestId,
          importedSources,
          importedStocks,
          initialTeamId: null,
          sourcePublicationApproved: false,
          stockStatus: "draft",
          historicalCreator: "unknown",
          idempotent: false,
        };
        await appendAudit(tx, {
          action: "official.legacy.import",
          targetId: `merchant:${LEGACY_MERCHANT_ID}`,
          actor,
          requestId: input.requestId,
          hash,
          beforeData: null,
          afterData: {
            result,
            legacyDatabase: database,
            legacyMerchantId: snapshot.owner.merchantId,
            crmOwnerPortalUserId: String(snapshot.owner.portalUserId),
            provenance: {
              originalCreator:
                "unknown: legacy channel/material tables do not contain immutable creator evidence",
              copiedHistoricalNotesTable: false,
              sources: snapshot.sources.map(source =>
                sourceProvenance(
                  source,
                  snapshot.ownerAdminUserIdByFrontUserId.get(
                    source.responsibleUserId
                  )!
                )
              ),
              materials: snapshot.materials.map(material =>
                materialProvenance(
                  material,
                  snapshot.ownerAdminUserIdByFrontUserId.get(
                    material.responsibleUserId
                  )!
                )
              ),
            },
          },
        });
        return result;
      } finally {
        await releaseLock(tx, importLock);
      }
    } finally {
      await releaseLock(tx, requestLock);
    }
  });
}

function classifyInputIsValid(input: ClassifyOfficialChannelLegacySourceInput) {
  assertPositiveInt(input?.sourceId, "OFFICIAL_LEGACY_SOURCE_ID_INVALID");
  assertPositiveInt(input?.teamId, "OFFICIAL_LEGACY_TEAM_ID_INVALID");
  if (
    !Number.isSafeInteger(input?.expectedRevision) ||
    input.expectedRevision < 1
  ) {
    fail("OFFICIAL_LEGACY_SOURCE_REVISION_INVALID");
  }
  assertRequestId(input?.requestId);
  if (
    typeof input?.reason !== "string" ||
    !input.reason.trim() ||
    input.reason.length > 1000
  ) {
    fail("OFFICIAL_LEGACY_CLASSIFICATION_REASON_INVALID");
  }
}

async function assertClassifiableTargetTeam(
  tx: OfficialDbExecutor,
  teamId: number,
  ownerAdminUserIds: readonly number[]
) {
  const [team] = await tx
    .select({
      id: officialChannelTeams.id,
      status: officialChannelTeams.status,
    })
    .from(officialChannelTeams)
    .where(eq(officialChannelTeams.id, teamId))
    .limit(1)
    .for("update");
  if (!team || team.status !== "active")
    fail("OFFICIAL_LEGACY_TARGET_TEAM_NOT_ACTIVE");
  if (ownerAdminUserIds.length === 0) return;
  const members = await tx
    .select({ adminUserId: officialChannelTeamMembers.adminUserId })
    .from(officialChannelTeamMembers)
    .innerJoin(
      adminUsers,
      eq(adminUsers.id, officialChannelTeamMembers.adminUserId)
    )
    .innerJoin(
      officialChannelTeams,
      eq(officialChannelTeams.id, officialChannelTeamMembers.teamId)
    )
    .where(
      and(
        eq(officialChannelTeamMembers.teamId, teamId),
        inArray(officialChannelTeamMembers.adminUserId, ownerAdminUserIds),
        eq(adminUsers.status, "active"),
        eq(officialChannelTeams.status, "active")
      )
    )
    .for("update");
  const activeMemberIds = new Set(
    members.map((member: { adminUserId: number }) => member.adminUserId)
  );
  if (
    ownerAdminUserIds.some(adminUserId => !activeMemberIds.has(adminUserId))
  ) {
    fail("OFFICIAL_LEGACY_OWNER_NOT_ACTIVE_IN_TARGET_TEAM");
  }
}

/**
 * One-time initialization of a single imported source. This is intentionally not a generic
 * team reassignment API: it refuses already-classified sources/stocks, published history, and
 * owners not currently active members of the target official team.
 */
export async function classifyLegacySource(
  actor: OfficialLegacyActor,
  input: ClassifyOfficialChannelLegacySourceInput
): Promise<ClassifyOfficialChannelLegacySourceResult> {
  assertPositiveInt(actor?.adminUserId, "OFFICIAL_LEGACY_ACTOR_REQUIRED");
  assertPositiveInt(actor?.sessionVersion, "OFFICIAL_LEGACY_ACTOR_REQUIRED");
  classifyInputIsValid(input);
  const db = await requireDb();
  const hash = payloadHash("official.legacy.classify", actor, {
    sourceId: input.sourceId,
    teamId: input.teamId,
    expectedRevision: input.expectedRevision,
    reason: input.reason,
  });
  return db.transaction(async tx => {
    const requestLock = lockName("request", input.requestId);
    const sourceLock = lockName("classify", String(input.sourceId));
    await acquireLock(tx, requestLock);
    try {
      await acquireLock(tx, sourceLock);
      try {
        const access = await loadOfficialAccess(
          tx,
          actor,
          "officialTeams.manage"
        );
        if (!access.isSuperAdmin) fail("OFFICIAL_LEGACY_SUPER_ADMIN_REQUIRED");
        const replay =
          await replayAudit<ClassifyOfficialChannelLegacySourceResult>(tx, {
            action: "official.legacy.classify",
            targetId: `source:${input.sourceId}`,
            actor,
            requestId: input.requestId,
            hash,
          });
        if (replay) return { ...replay, idempotent: true };

        const [source] = await tx
          .select()
          .from(officialChannelSources)
          .where(
            and(
              eq(officialChannelSources.id, input.sourceId),
              isNull(officialChannelSources.teamId)
            )
          )
          .limit(1)
          .for("update");
        if (!source || !source.legacySourceId)
          fail("OFFICIAL_LEGACY_SOURCE_NOT_UNCLASSIFIED_LEGACY");
        if (source.revision !== input.expectedRevision)
          fail("OFFICIAL_LEGACY_SOURCE_REVISION_CONFLICT");
        if (source.everPublished)
          fail("OFFICIAL_LEGACY_SOURCE_PUBLISHED_HISTORY");

        const stocks = await tx
          .select()
          .from(officialChannelStocks)
          .where(eq(officialChannelStocks.sourceId, source.id))
          .for("update");
        if (stocks.some(stock => stock.teamId !== null)) {
          fail("OFFICIAL_LEGACY_STOCK_ALREADY_CLASSIFIED");
        }
        const stockIds = stocks.map(stock => stock.id);
        if (stockIds.length > 0) {
          const publications = await tx
            .select({ stockId: officialChannelPublications.stockId })
            .from(officialChannelPublications)
            .where(inArray(officialChannelPublications.stockId, stockIds))
            .for("update");
          if (
            publications.length > 0 ||
            stocks.some(stock => stock.status === "published")
          ) {
            fail("OFFICIAL_LEGACY_STOCK_PUBLISHED_HISTORY");
          }
        }

        const ownerAdminUserIds = Array.from(
          new Set(stocks.map(stock => stock.ownerAdminUserId))
        );
        if (ownerAdminUserIds.some(id => !isPositiveInt(id)))
          fail("OFFICIAL_LEGACY_STOCK_OWNER_INVALID");
        await assertClassifiableTargetTeam(tx, input.teamId, ownerAdminUserIds);

        const sourceUpdate = await tx
          .update(officialChannelSources)
          .set({
            teamId: input.teamId,
            revision: sql`${officialChannelSources.revision} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(officialChannelSources.id, source.id),
              eq(officialChannelSources.revision, source.revision),
              isNull(officialChannelSources.teamId)
            )
          );
        if (Number((sourceUpdate as any)[0]?.affectedRows ?? 0) !== 1) {
          fail("OFFICIAL_LEGACY_SOURCE_REVISION_CONFLICT");
        }

        const classifiedStocks: Array<{ stockId: number; revision: number }> =
          [];
        for (const stock of stocks) {
          const stockUpdate = await tx
            .update(officialChannelStocks)
            .set({
              teamId: input.teamId,
              revision: sql`${officialChannelStocks.revision} + 1`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(officialChannelStocks.id, stock.id),
                eq(officialChannelStocks.revision, stock.revision),
                isNull(officialChannelStocks.teamId)
              )
            );
          if (Number((stockUpdate as any)[0]?.affectedRows ?? 0) !== 1) {
            fail("OFFICIAL_LEGACY_STOCK_REVISION_CONFLICT");
          }
          classifiedStocks.push({
            stockId: stock.id,
            revision: stock.revision + 1,
          });
        }

        const result: ClassifyOfficialChannelLegacySourceResult = {
          sourceId: source.id,
          legacySourceId: source.legacySourceId,
          teamId: input.teamId,
          sourceRevision: source.revision + 1,
          stocks: classifiedStocks,
          requestId: input.requestId,
          idempotent: false,
        };
        await appendAudit(tx, {
          action: "official.legacy.classify",
          targetId: `source:${source.id}`,
          actor,
          requestId: input.requestId,
          hash,
          beforeData: {
            legacySourceId: source.legacySourceId,
            source: {
              id: source.id,
              teamId: source.teamId,
              revision: source.revision,
              everPublished: source.everPublished,
              publicationApproved: source.publicationApproved,
              createdByAdminUserId: source.createdByAdminUserId,
            },
            stocks: stocks.map(stock => ({
              id: stock.id,
              teamId: stock.teamId,
              ownerAdminUserId: stock.ownerAdminUserId,
              createdByAdminUserId: stock.createdByAdminUserId,
              revision: stock.revision,
              status: stock.status,
            })),
          },
          afterData: {
            result,
            reason: input.reason,
            operation: "one-time-legacy-team-initialization",
            // Explicitly state what this initialization does not mutate.
            immutableFieldsPreserved: [
              "source.name",
              "source.type",
              "stock.createdByAdminUserId",
              "stock.ownerAdminUserId",
            ],
          },
        });
        return result;
      } finally {
        await releaseLock(tx, sourceLock);
      }
    } finally {
      await releaseLock(tx, requestLock);
    }
  });
}

/** Pure helpers exposed solely for isolated regression tests. */
export const officialChannelLegacyTestUtils = {
  canonicalJson,
  legacyDatabaseName,
  lockName,
  parseLegacyOwnerId,
  payloadHash,
};
