import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { acquireFactoryReceptionAdminLease, type FactoryReceptionAdminLease } from "../adminDb";
import { readChannelMaterialReceptionSource } from "./channelFactoryPublication";
import { decodePublication } from "./factoryChannelSnapshot";
import type { SqlExecutor, SqlResultRow } from "./channelInventory";
import type { FactoryMaterialReceptionSummary } from "../../../shared/channelFactoryPublication";

export const FACTORY_RECEPTION = { receptionKind: "factory_channel", receptionBrand: "51电子网", receptionLabel: "51电子网 · 工厂渠道接待" } as const;
export const factoryPublicIdSchema = z.string().regex(/^ocp_[a-f0-9]{32}$/);
export const startFactoryInventoryInquiryInput = z.object({
  publicId: factoryPublicIdSchema,
  initiatorUserId: z.number().int().positive(), inquiryProtocol: z.literal("buyer-bound-v3"),
  qty: z.number().int().positive().max(1e9).nullable(),
  clientMessageId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/), source: z.literal("factory_channel").optional(),
}).strict();
const receptionProjectionSchema = z.object({
  schemaVersion: z.literal(1), status: z.literal("ready"), reason: z.null(),
  sellerEnterpriseId: z.number().int().positive(), sellerMerchantId: z.number().int().positive(),
  businessOwnerAdminUserId: z.number().int().positive(), recipientAdminUserId: z.number().int().positive(),
  recipientFrontendUserId: z.number().int().positive(), bindingVersion: z.number().int().positive(),
  responsibilityVersion: z.number().int().positive(), stockRevision: z.number().int().positive(),
  routingMode: z.enum(["owner", "explicit"]), recipientName: z.string().nullable(),
}).strict();
const records = (result: unknown): SqlResultRow[] => Array.isArray(result) && Array.isArray(result[0]) ? result[0] : [];
const json = (v: unknown): unknown => { if (typeof v !== "string") return v; try { return JSON.parse(v); } catch { return null; } };
const positive = (n: unknown) => Number.isSafeInteger(Number(n)) && Number(n) > 0;
function pending(message = "工厂库存接待待配置，请联系平台完善企业、员工绑定与接待权限"): never { throw new TRPCError({ code: "PRECONDITION_FAILED", message }); }
function fingerprint(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export type FactoryInquirySource = {
  sourceKind: "channel_material" | "official_admin_inventory"; sourceId: number; publicId: string;
  enterpriseId: number; sellerUserId: number; ownerUserId: number; assigneeUserId: number;
  adminUserId: number; bindingVersion: number; responsibilityVersion: number; responsibilitySnapshot: string;
  sourceFactoryName: string; sourceLabel: string; partNumber: string; brand: string; pkg: null; moq: null; qtyOnSale: number; companyName: string;
  id: null;
  /** Live bound frontend employee name, never a historic publication label. */
  recipientName?: string | null;
};
export type FactoryReceptionLease = { source: FactoryInquirySource; verify(tx: SqlExecutor): Promise<void>; close(): Promise<void> };
export type FactoryReceptionDependencies = {
  acquireAdminLease(): Promise<FactoryReceptionAdminLease>;
  readChannelSource(db: SqlExecutor, publicId: string, lock: boolean): Promise<SqlResultRow | null>;
};

/** A scope with explicit reception grants must never inherit inventory grants. */
export function adminReceptionScopeReady(raw: unknown): boolean {
  const modules = json(raw);
  if (!Array.isArray(modules) || !modules.includes("business.context.read")) return false;
  const explicit = modules.some(key => typeof key === "string" && key.startsWith("business.inquiries."));
  return explicit
    ? modules.includes("business.inquiries.read") && modules.includes("business.inquiries.write")
    : modules.includes("business.inventory.read") && modules.includes("business.inventory.write");
}

// SELECT-only constant statements: caller publicId is a bound parameter, never a source ID.
const OFFICIAL_SOURCE_SQL = `SELECT p.publicId, p.snapshot, p.publishedAt, p.revision AS publicationRevision, p.reception,
  s.id AS sourceId, s.revision AS stockRevision, s.ownerAdminUserId, s.teamId,
  c.revision AS sourceRevision, c.name AS sourceFactoryName, r.merchantId, r.sellerEnterpriseId, r.routingMode,
  r.recipientAdminUserId AS explicitRecipientAdminUserId, r.responsibilityVersion
 FROM official_channel_publications p
 INNER JOIN official_channel_stocks s ON s.id = p.stockId
 INNER JOIN official_channel_sources c ON c.id = s.sourceId
 LEFT JOIN official_channel_stock_reception r ON r.stockId = s.id
 WHERE p.publicId = ? AND s.status = 'published' AND c.active = 1 AND c.publicationApproved = 1
 LIMIT 2 LOCK IN SHARE MODE`;
const AUTHORITY_SQL = `SELECT a.id AS adminUserId, a.status AS adminStatus, a.adminRole, a.sessionVersion,
 b.frontUserId, b.status AS bindingStatus, b.bindingVersion, scope.status AS scopeStatus,
 scope.scopeVersion, scope.modulePermissions, m.id AS merchantId, m.crmStatus,
 m.businessLicense, m.registrationRegion, m.registrationIdentifier, m.crmOwnerPortalUserId,
 owner.status AS ownerStatus, owner.adminRole AS ownerRole,
 otm.teamId AS ownerTeamId, rtm.teamId AS recipientTeamId, t.status AS teamStatus
 FROM admin_business_staff_bindings b
 INNER JOIN admin_users a ON a.id = b.adminUserId
 INNER JOIN admin_business_merchant_scopes scope ON scope.adminUserId = a.id
 INNER JOIN merchants m ON m.id = scope.merchantId
 LEFT JOIN admin_users owner ON owner.id = ?
 LEFT JOIN official_channel_team_members otm ON otm.adminUserId = owner.id
 LEFT JOIN official_channel_team_members rtm ON rtm.adminUserId = a.id
 LEFT JOIN official_channel_teams t ON t.id = otm.teamId
 WHERE b.frontUserId = ? AND b.status = 'active' AND scope.merchantId = ?
 LIMIT 2 LOCK IN SHARE MODE`;

/** Current front permission rows are locking reads, not a historic projection's authority. */
async function frontAuthority(db: SqlExecutor, enterpriseId: number, userId: number, lock: boolean): Promise<SqlResultRow & { recipientName: string | null }> {
  const suffix = lock ? sql` FOR UPDATE` : sql``;
  const e = records(await db.execute(sql`SELECT id, companyName, creditCode, registrationRegion,
    registrationIdentifier, superAdminUserId, crmDataOwnerUserId FROM enterprises WHERE id = ${enterpriseId} LIMIT 1${suffix}`))[0];
  if (!e) pending();
  const members = records(await db.execute(sql`SELECT em.id, em.userId, em.status, u.loginDisabled, u.lastSignedIn, u.name AS recipientName
    FROM enterprise_members em INNER JOIN users u ON u.id = em.userId
    WHERE em.enterpriseId = ${enterpriseId} AND em.userId IN (${userId}, ${Number(e.superAdminUserId)})${suffix}`));
  for (const id of Array.from(new Set([userId, Number(e.superAdminUserId)]))) {
    const member = members.find(m => Number(m.userId) === id);
    if (!member || member.status !== "active" || Number(member.loginDisabled) !== 0 || !member.lastSignedIn) pending();
  }
  const recipient = members.find(m => Number(m.userId) === userId)!;
  const permissions = records(await db.execute(sql`SELECT permissionKey FROM enterprise_member_permissions
    WHERE enterpriseMemberId = ${Number(recipient.id)} AND permissionKey = 'inquiry.receive'${suffix}`));
  if (userId !== Number(e.superAdminUserId) && !permissions.length) pending("工厂库存当前员工无询价接待权限，接待待配置");
  return { ...e, recipientName: typeof recipient.recipientName === "string" ? recipient.recipientName.trim() || null : null };
}
function assertLegalMerchant(e: SqlResultRow, a: SqlResultRow) {
  if (a.crmStatus !== "enabled" || Number(a.crmOwnerPortalUserId) !== Number(e.superAdminUserId)) pending();
  const hk = a.registrationRegion === "HK";
  const legal = hk ? String(a.registrationIdentifier ?? "").trim().toUpperCase() : String(a.businessLicense ?? "").trim().toUpperCase();
  if ((hk && (!/^HK:\d{8}$/.test(legal) || e.registrationRegion !== "HK" || String(e.registrationIdentifier).toUpperCase() !== legal))
    || (!hk && (!/^[A-Z0-9]{18}$/.test(legal) || e.registrationRegion === "HK" || String(e.creditCode).toUpperCase() !== legal))) pending("工厂库存可信卖方企业映射待配置");
}

/** Status cannot claim ready while persistence is unconfigured or incompatible. */
async function requireFactoryInquirySchema(db: SqlExecutor) {
  const required: Record<string, [string, number | null, boolean]> = {
    inventoryId: ["int", null, true], sourceKind: ["varchar", 32, false], sourcePublicId: ["varchar", 64, true],
    sourceRecordId: ["int", null, true], responsibilityVersion: ["int", null, true], responsibilitySnapshot: ["varchar", 64, true],
    receptionAdminUserId: ["int", null, true], receptionBindingVersion: ["int", null, true],
    receptionKind: ["varchar", 32, true], receptionBrand: ["varchar", 32, true], factorySourceSnapshot: ["json", null, true],
  };
  const columns = records(await db.execute(sql`SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE, COLUMN_DEFAULT
    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventory_inquiries'`));
  for (const name of Object.keys(required)) {
    const c = columns.find(c => c.COLUMN_NAME === name), [type, length, nullable] = required[name];
    if (!c || c.DATA_TYPE !== type || (length !== null && Number(c.CHARACTER_MAXIMUM_LENGTH) !== length)
      || (c.IS_NULLABLE === "YES") !== nullable || (name === "sourceKind" && c.COLUMN_DEFAULT !== "inventory")) {
      pending("工厂库存询价接待schema尚未兼容配置，请联系平台完成配置");
    }
  }
}

export function createFactoryInventoryReceptionService(deps: FactoryReceptionDependencies = {
  acquireAdminLease: acquireFactoryReceptionAdminLease, readChannelSource: readChannelMaterialReceptionSource,
}) {
  return {
    async open(db: SqlExecutor, publicId: string): Promise<FactoryReceptionLease> {
      factoryPublicIdSchema.parse(publicId);
      await requireFactoryInquirySchema(db);
      let admin: FactoryReceptionAdminLease;
      try { admin = await deps.acquireAdminLease(); } catch { pending("工厂库存后台绑定或一致性门禁暂不可用，接待待配置"); }
      const load = async (front: SqlExecutor, lock: boolean): Promise<FactoryInquirySource> => {
        const channel = await deps.readChannelSource(front, publicId, lock);
        const officialRows = await admin.query<SqlResultRow>(OFFICIAL_SOURCE_SQL, [publicId]);
        if (officialRows.length > 1 || (channel && officialRows.length)) pending("工厂库存公开来源不唯一，接待待配置");
        const native = channel ?? officialRows[0];
        if (!native) throw new TRPCError({ code: "NOT_FOUND", message: "该工厂库存已下架或责任版本已变化" });
        const decoded = decodePublication({ publicId, snapshot: native.snapshot, publishedAt: native.publishedAt as Date | string });
        if (!decoded) pending("工厂库存公开资料无效，接待待配置");
        let enterpriseId: number, userId: number, merchantId: number, ownerAdminId: number;
        let receipt: z.infer<typeof receptionProjectionSchema> | null = null;
        if (channel) {
          enterpriseId = Number(channel.enterpriseId); userId = Number(channel.ownerUserId);
          // Exact legal merchant is selected by enterprise identity; names never participate.
          const e = await frontAuthority(front, enterpriseId, userId, lock);
          const merchants = await admin.query<SqlResultRow>(`SELECT id FROM merchants
            WHERE crmStatus = 'enabled' AND crmOwnerPortalUserId = ? AND
              ((registrationRegion = 'CN' AND businessLicense = ?) OR
               (registrationRegion = 'HK' AND registrationIdentifier = ?))
            LIMIT 2 LOCK IN SHARE MODE`, [String(e.superAdminUserId), e.creditCode ?? "", e.registrationIdentifier ?? ""]);
          if (merchants.length !== 1) pending();
          merchantId = Number(merchants[0].id); ownerAdminId = 0;
        } else {
          const parsed = receptionProjectionSchema.safeParse(json(native.reception));
          if (!parsed.success) pending(); receipt = parsed.data;
          enterpriseId = receipt.sellerEnterpriseId; userId = receipt.recipientFrontendUserId;
          merchantId = receipt.sellerMerchantId; ownerAdminId = Number(native.ownerAdminUserId);
          const recipientAdminId = native.routingMode === "owner" ? ownerAdminId : Number(native.explicitRecipientAdminUserId);
          if (receipt.businessOwnerAdminUserId !== ownerAdminId || receipt.recipientAdminUserId !== recipientAdminId
            || receipt.sellerEnterpriseId !== Number(native.sellerEnterpriseId) || merchantId !== Number(native.merchantId)
            || receipt.stockRevision !== Number(native.stockRevision) || receipt.responsibilityVersion !== Number(native.responsibilityVersion)
            || receipt.routingMode !== native.routingMode) pending("工厂库存接待责任版本已变化，请重新配置");
        }
        if (![enterpriseId, userId, merchantId, native.sourceId].every(positive)) pending();
        const authorities = await admin.query<SqlResultRow>(AUTHORITY_SQL, [ownerAdminId, userId, merchantId]);
        if (authorities.length !== 1) pending();
        const authority = authorities[0];
        if (authority.adminStatus !== "active" || authority.adminRole === "super_admin"
          || authority.bindingStatus !== "active" || !positive(authority.bindingVersion)
          || authority.scopeStatus !== "active" || !adminReceptionScopeReady(authority.modulePermissions)) pending();
        if (receipt && (Number(authority.adminUserId) !== receipt.recipientAdminUserId
          || Number(authority.bindingVersion) !== receipt.bindingVersion || authority.ownerStatus !== "active"
          || authority.ownerRole === "super_admin" || authority.teamStatus !== "active"
          || Number(authority.ownerTeamId) !== Number(native.teamId) || Number(authority.recipientTeamId) !== Number(native.teamId))) pending();
        const enterprise = await frontAuthority(front, enterpriseId, userId, lock);
        assertLegalMerchant(enterprise, authority);
        // Include current account/scope/team versions; never trust recipientName as identity.
        const responsibilitySnapshot = fingerprint({ native, authority, enterpriseId, userId });
        return { id: null, sourceKind: channel ? "channel_material" : "official_admin_inventory",
          sourceId: Number(native.sourceId), publicId, enterpriseId, sellerUserId: Number(enterprise.crmDataOwnerUserId),
          ownerUserId: channel ? Number(channel.ownerUserId) : userId, assigneeUserId: userId,
          adminUserId: Number(authority.adminUserId), bindingVersion: Number(authority.bindingVersion),
          responsibilityVersion: Number(native.responsibilityVersion), responsibilitySnapshot,
          sourceFactoryName: String(native.sourceFactoryName ?? ""), sourceLabel: "工厂渠道",
          partNumber: decoded.partNumber, brand: decoded.brand, pkg: null, moq: null, qtyOnSale: decoded.qty,
          companyName: String(enterprise.companyName), recipientName: enterprise.recipientName };
      };
      try {
        const source = await load(db, false);
        return { source, async verify(tx) {
          const current = await load(tx, true);
          if (current.responsibilitySnapshot !== source.responsibilitySnapshot) throw new TRPCError({ code: "CONFLICT", message: "工厂库存责任、绑定或接待权限已变化，请重试" });
        }, close: () => admin.release() };
      } catch (error) {
        await admin.release().catch(() => undefined);
        if (error instanceof TRPCError) throw error;
        pending("工厂库存接待配置或跨库一致性门禁不可用，请联系平台配置");
      }
    },
    /** A short-lived independent SELECT-only lease for a selected authorized material.
     * This is evidence, not a routing capability: creation still opens its own lease
     * and performs both existing transaction rechecks. No enquiry/publication writes. */
    async previewChannelMaterial(db: SqlExecutor, publicId: string, expected: {
      materialId: number; enterpriseId: number; responsibilityVersion: number;
    }): Promise<FactoryMaterialReceptionSummary> {
      let lease: FactoryReceptionLease | undefined;
      try {
        lease = await this.open(db, publicId);
        const source = lease.source;
        if (source.sourceKind !== "channel_material" || source.sourceId !== expected.materialId
          || source.enterpriseId !== expected.enterpriseId || source.responsibilityVersion !== expected.responsibilityVersion)
          pending("工厂库存责任版本已变化，请刷新后重新核验接待");
        const name = source.recipientName?.trim();
        if (!name || name.length > 128) pending("当前接待员工姓名尚未完善，接待待配置");
        return { status: "ready", recipientName: name, responsibilityVersion: source.responsibilityVersion, reason: null };
      } catch (error) {
        return { status: "pending", recipientName: null, responsibilityVersion: expected.responsibilityVersion,
          reason: error instanceof TRPCError ? error.message : "工厂库存接待核验暂不可用，请稍后重新核验" };
      } finally { if (lease) await lease.close(); }
    },
    async status(db: SqlExecutor, publicId: string): Promise<{ ready: boolean; message?: string; receiverLabel?: string }> {
      try { const lease = await this.open(db, publicId); await lease.close(); return { ready: true, receiverLabel: FACTORY_RECEPTION.receptionLabel }; }
      catch (error) { return { ready: false, message: error instanceof TRPCError ? error.message : "工厂库存接待待配置" }; }
    },
  };
}
export const factoryInventoryReception = createFactoryInventoryReceptionService();
