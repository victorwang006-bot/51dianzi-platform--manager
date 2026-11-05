import { randomBytes } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { publishFactoryMaterialSchema, publishFactoryMaterialResultSchema, type PublishFactoryMaterialInput, type PublishFactoryMaterialResult } from "../../../shared/channelFactoryPublication";
import { ChannelInventoryError, channelInventoryPayloadHash, resolveChannelInventoryAuthority, type ChannelInventoryScope, type SqlDatabase, type SqlExecutor, type SqlResultRow } from "./channelInventory";
import { currentReadExecutor, linkedCompany, linkedCompanyReadGate } from "./customerSupplyCompany";
import { decodePublication } from "./factoryChannelSnapshot";
import type { OfficialChannelPublicationReadRow } from "../adminDb";

const rows = (result: unknown): SqlResultRow[] => Array.isArray(result) ? (Array.isArray(result[0]) ? result[0] : result) as SqlResultRow[] : [];
function fail(code: ConstructorParameters<typeof ChannelInventoryError>[0], message: string): never { throw new ChannelInventoryError(code, message); }
const bool = (v: unknown) => v === true || v === 1 || v === "1";
const suffix = (lock: boolean) => lock ? sql` FOR UPDATE` : sql``;

/** No native read/write/note or ERP inventory.manage grant can imply publish. */
export function hasFactoryPublishProof(scope: ChannelInventoryScope): boolean {
  return Boolean(scope.officialActor && scope.officialActor.inventoryPermissions?.read === true
    && scope.officialActor.inventoryPermissions?.publish === true);
}

/** All joins/fences use constants; no client identity or SQL is admitted. */
const SOURCE_FROM = sql`FROM channel_inventory_materials m
  INNER JOIN channel_inventory_channels c ON c.id = m.channel_id AND c.enterprise_id = m.enterprise_id
    AND c.data_owner_user_id = m.data_owner_user_id AND c.responsible_user_id = m.responsible_user_id
  INNER JOIN enterprises source_e ON source_e.id = m.enterprise_id AND source_e.crmDataOwnerUserId = m.data_owner_user_id
  INNER JOIN enterprise_team_record_assignments source_a ON source_a.enterpriseId = m.enterprise_id
    AND source_a.recordType = 'channel_material' AND source_a.recordId = m.id AND source_a.currentOwnerUserId = m.responsible_user_id
  INNER JOIN enterprise_team_members source_owner ON source_owner.enterpriseId = m.enterprise_id
    AND source_owner.userId = m.responsible_user_id AND source_owner.teamId = source_a.teamId
  INNER JOIN enterprise_teams source_t ON source_t.enterpriseId = m.enterprise_id AND source_t.id = source_a.teamId
  INNER JOIN enterprise_members source_em ON source_em.enterpriseId = m.enterprise_id AND source_em.userId = m.responsible_user_id
  INNER JOIN users source_u ON source_u.id = source_em.userId`;

/** Also used by public reads: current owner/account/team, not historic creator. */
function sourceValid(lock: boolean): SQL {
  return sql`c.active = 1 AND source_t.status = 'active' AND source_a.revision >= 1
    AND source_owner.teamRole IN ('leader', 'member') AND source_em.status = 'active' AND source_u.loginDisabled = 0
    AND NOT EXISTS (SELECT 1 FROM enterprise_team_members duplicate_owner
      WHERE duplicate_owner.enterpriseId = m.enterprise_id AND duplicate_owner.userId = m.responsible_user_id
        AND duplicate_owner.id <> source_owner.id${suffix(lock)})
    AND NOT EXISTS (SELECT 1 FROM channel_inventory_material_management deleted_material
      WHERE deleted_material.enterprise_id = m.enterprise_id AND deleted_material.material_id = m.id
        AND deleted_material.deleted_at IS NOT NULL${suffix(lock)})
    AND NOT EXISTS (SELECT 1 FROM crm_customer_supply_channels invalid_link
      LEFT JOIN crm_customers live_customer ON live_customer.enterpriseId = invalid_link.enterpriseId
        AND live_customer.id = invalid_link.customerId
      WHERE invalid_link.enterpriseId = c.enterprise_id AND invalid_link.dataOwnerUserId = c.data_owner_user_id
        AND invalid_link.channelId = c.id AND (live_customer.id IS NULL OR live_customer.archivedAt IS NOT NULL)${suffix(lock)})`;
}

function actorBoundary(scope: ChannelInventoryScope, teamScope: boolean, lock: boolean): SQL {
  return sql`EXISTS (SELECT 1 FROM enterprise_team_members publish_actor
    WHERE publish_actor.enterpriseId = m.enterprise_id AND publish_actor.userId = ${scope.actorUserId}
      AND publish_actor.teamId = source_a.teamId AND publish_actor.teamRole IN ('leader', 'member')
      AND (m.responsible_user_id = ${scope.actorUserId} OR (${teamScope} AND publish_actor.teamRole = 'leader'))
      AND NOT EXISTS (SELECT 1 FROM enterprise_team_members duplicate_actor
        WHERE duplicate_actor.enterpriseId = publish_actor.enterpriseId AND duplicate_actor.userId = publish_actor.userId
          AND duplicate_actor.id <> publish_actor.id${suffix(lock)})${suffix(lock)})`;
}

/** p is an internal projection. All identities are only predicates, never output. */
const PROJECTION_MATCH = sql`p.status = 'published' AND p.material_revision = m.revision
  AND p.data_owner_user_id = m.data_owner_user_id AND p.channel_id = c.id AND p.channel_revision = c.revision
  AND p.owner_user_id = m.responsible_user_id AND p.assignment_id = source_a.id
  AND p.assignment_revision = source_a.revision AND p.team_id = source_a.teamId
  AND p.owner_membership_id = source_owner.id`;

/** Reuses the exact existing decoder whitelist and positive-decimal null policy. */
export function buildFactoryMaterialSnapshot(material: SqlResultRow, publicId: string): Record<string, unknown> {
  const snapshot = {
    listingKind: "factory_channel", label: "工厂渠道", assistanceLabel: "平台协助询价", publicId,
    partNumber: material.partNumber, brand: material.brand,
    qty: material.qty == null ? null : Number(material.qty),
    dateCode: null,
    price: typeof material.price === "string" ? material.price : null,
    currency: material.currency,
    taxIncluded: null,
    leadTime: null,
  };
  const decoded = decodePublication({ publicId, snapshot, publishedAt: new Date(0) });
  if (!decoded) fail("PRECONDITION_FAILED", "型号、品牌、数量或公开库存字段无效，请完善后再发布");
  // Construct rather than spread: never persist channelCode, timestamps or private fields.
  return { listingKind: decoded.listingKind, label: decoded.label, assistanceLabel: decoded.assistanceLabel,
    publicId: decoded.publicId, partNumber: decoded.partNumber, brand: decoded.brand, qty: decoded.qty,
    dateCode: decoded.dateCode, price: decoded.price, currency: decoded.currency,
    taxIncluded: decoded.taxIncluded, leadTime: decoded.leadTime };
}

/** Batch DTO enrichment. No source fields, actor IDs or public IDs enter list DTOs. */
export async function factoryMaterialPublicationMetadata(
  tx: SqlExecutor, scope: ChannelInventoryScope, materialIds: number[], teamScope: boolean,
): Promise<Map<number, { canPublish: boolean; publicationStatus: "unpublished" | "published" }>> {
  const result = new Map<number, { canPublish: boolean; publicationStatus: "unpublished" | "published" }>();
  if (!materialIds.length) return result;
  const companyGate = hasFactoryPublishProof(scope) ? await linkedCompanyReadGate(tx, scope) : sql`FALSE`;
  const found = rows(await tx.execute(sql`SELECT m.id,
      ${hasFactoryPublishProof(scope)} AND ${actorBoundary(scope, teamScope, true)} AND ${companyGate} AS canPublish,
      m.part_number AS partNumber, m.brand, m.qty, m.date_code AS dateCode, m.price, m.currency,
      m.tax_included AS taxIncluded, m.lead_time AS leadTime,
      EXISTS (SELECT 1 FROM channel_material_publications p
        WHERE p.enterprise_id = m.enterprise_id AND p.material_id = m.id AND ${PROJECTION_MATCH} FOR UPDATE) AS published
    ${SOURCE_FROM} WHERE m.enterprise_id = ${scope.enterpriseId} AND m.data_owner_user_id = ${scope.dataOwnerUserId}
      AND m.id IN (${sql.join(materialIds.map(id => sql`${id}`), sql`, `)}) AND ${sourceValid(true)} FOR UPDATE`));
  for (const row of found) {
    let valid = true;
    try { buildFactoryMaterialSnapshot(row, `ocp_${"0".repeat(32)}`); } catch { valid = false; }
    result.set(Number(row.id), { canPublish: bool(row.canPublish) && valid, publicationStatus: bool(row.published) ? "published" : "unpublished" });
  }
  return result;
}

/** ERP materials never enter official_channel_sources/stocks or their approval gate. */
export async function readChannelMaterialPublications(db: SqlExecutor): Promise<OfficialChannelPublicationReadRow[]> {
  const found = rows(await db.execute(sql`SELECT p.public_id AS publicId, p.snapshot, p.published_at AS publishedAt
    ${SOURCE_FROM} INNER JOIN channel_material_publications p ON p.enterprise_id = m.enterprise_id AND p.material_id = m.id
    WHERE ${PROJECTION_MATCH} AND ${sourceValid(false)}
    ORDER BY p.published_at DESC, p.public_id ASC LIMIT 10001`));
  if (found.length >= 10001) throw new Error("CHANNEL_MATERIAL_PUBLICATION_READ_CAP_EXCEEDED");
  return found.map(row => ({ publicId: String(row.publicId), snapshot: row.snapshot, publishedAt: row.publishedAt as Date | string }));
}

/** Only the exact native InnoDB full-transaction rollback is automatically retried. */
function deadlock(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 6 && current && typeof current === "object"; depth++) {
    const e = current as { errno?: number; code?: string; sqlState?: string; cause?: unknown };
    if (e.errno === 1213 && e.code === "ER_LOCK_DEADLOCK" && e.sqlState === "40001") return true;
    current = e.cause;
  }
  return false;
}

export function createChannelFactoryPublicationService({ getDb }: { getDb: () => Promise<SqlDatabase | null> }) {
  return {
    async publishFactoryMaterial(scope: ChannelInventoryScope, raw: PublishFactoryMaterialInput): Promise<PublishFactoryMaterialResult> {
      const parsed = publishFactoryMaterialSchema.safeParse(raw);
      if (!parsed.success) fail("BAD_REQUEST", "发布请求字段无效");
      const input = parsed.data;
      if ((input.expectedEnterpriseId !== undefined && input.expectedEnterpriseId !== scope.enterpriseId)
        || (input.expectedActorUserId !== undefined && input.expectedActorUserId !== scope.actorUserId)) fail("FORBIDDEN", "企业或账号上下文不匹配");
      if (!hasFactoryPublishProof(scope)) fail("FORBIDDEN", "未获明确的官方库存发布权限");
      const hash = channelInventoryPayloadHash({ action: "publishFactoryMaterial", materialId: input.materialId, expectedRevision: input.expectedRevision });
      let db: SqlDatabase | null;
      try { db = await getDb(); } catch { return fail("SERVICE_UNAVAILABLE", "发布服务暂不可用"); }
      if (!db) fail("SERVICE_UNAVAILABLE", "发布服务暂不可用");
      for (let attempt = 1; ; attempt++) {
        let observedDeadlock = false, rejected = false, operationError: unknown;
        try {
          return await db.transaction(async nativeTx => {
            const tx = currentReadExecutor({ execute: async query => {
              try { return await nativeTx.execute(query); }
              catch (error) { observedDeadlock ||= deadlock(error); throw error; }
            } });
            try {
              // Read/module/team authority is current; stock WRITE is intentionally not required.
              const access = await resolveChannelInventoryAuthority(tx, scope, "stocks", false, true);
              await tx.execute(sql`SELECT material_id FROM channel_inventory_material_management
                WHERE enterprise_id = ${scope.enterpriseId} AND material_id = ${input.materialId} FOR UPDATE`);
              const current = rows(await tx.execute(sql`SELECT m.id, m.revision, c.id AS channelId, c.revision AS channelRevision,
                m.responsible_user_id AS ownerUserId, source_a.id AS assignmentId, source_a.revision AS assignmentRevision,
                source_a.teamId, source_owner.id AS ownerMembershipId,
                m.part_number AS partNumber, m.brand, m.qty, m.date_code AS dateCode, m.price, m.currency,
                m.tax_included AS taxIncluded, m.lead_time AS leadTime
                ${SOURCE_FROM} WHERE m.id = ${input.materialId} AND m.enterprise_id = ${scope.enterpriseId}
                  AND m.data_owner_user_id = ${scope.dataOwnerUserId} AND ${sourceValid(true)}
                  AND ${actorBoundary(scope, access.scope === "team", true)} LIMIT 1 FOR UPDATE`))[0];
              if (!current) fail("FORBIDDEN", "仅当前负责人或所属有效团队组长可发布有效库存");
              const company = await linkedCompany(tx, scope, Number(current.channelId));
              if (company.linked && (!company.customer || company.customer.archivedAt != null)) fail("FORBIDDEN", "关联客户不存在或无当前CRM访问权限");
              const prior = rows(await tx.execute(sql`SELECT material_id AS materialId, material_revision AS revision, public_id AS publicId, payload_hash AS payloadHash
                FROM channel_material_publication_requests WHERE enterprise_id = ${scope.enterpriseId}
                  AND data_owner_user_id = ${scope.dataOwnerUserId} AND actor_user_id = ${scope.actorUserId}
                  AND request_id = ${input.requestId} LIMIT 1 FOR UPDATE`))[0];
              if (prior && (String(prior.payloadHash) !== hash || Number(prior.materialId) !== input.materialId)) fail("CONFLICT", "请求号已用于不同发布内容");
              // A replay never re-publishes a subsequently changed/restored/reassigned source.
              if (Number(current.revision) !== input.expectedRevision) fail("CONFLICT", "库存已变化，请刷新后重新确认发布");
              const publication = rows(await tx.execute(sql`SELECT p.public_id AS publicId, ${PROJECTION_MATCH} AS matchesCurrent
                ${SOURCE_FROM} INNER JOIN channel_material_publications p ON p.enterprise_id = m.enterprise_id AND p.material_id = m.id
                WHERE m.id = ${input.materialId} AND m.enterprise_id = ${scope.enterpriseId}
                  AND m.data_owner_user_id = ${scope.dataOwnerUserId} LIMIT 1 FOR UPDATE`))[0];
              if (prior) {
                if (!publication || !bool(publication.matchesCurrent) || String(publication.publicId) !== String(prior.publicId)) fail("CONFLICT", "原发布已失效，不能重放请求");
                return publishFactoryMaterialResultSchema.parse({ materialId: input.materialId, publicId: String(prior.publicId), status: "published", revision: input.expectedRevision });
              }
              const publicId = publication && bool(publication.matchesCurrent) ? String(publication.publicId) : `ocp_${randomBytes(16).toString("hex")}`;
              const snapshot = buildFactoryMaterialSnapshot(current, publicId);
              if (!publication || !bool(publication.matchesCurrent)) {
                if (publication) {
                  await tx.execute(sql`UPDATE channel_material_publications SET
                    data_owner_user_id = ${scope.dataOwnerUserId}, material_revision = ${input.expectedRevision},
                    channel_id = ${Number(current.channelId)}, channel_revision = ${Number(current.channelRevision)},
                    owner_user_id = ${Number(current.ownerUserId)}, assignment_id = ${Number(current.assignmentId)},
                    assignment_revision = ${Number(current.assignmentRevision)}, team_id = ${Number(current.teamId)},
                    owner_membership_id = ${Number(current.ownerMembershipId)}, public_id = ${publicId},
                    status = 'published', snapshot = ${JSON.stringify(snapshot)}, published_at = CURRENT_TIMESTAMP(3)
                    WHERE enterprise_id = ${scope.enterpriseId} AND material_id = ${input.materialId}`);
                } else {
                  await tx.execute(sql`INSERT INTO channel_material_publications
                  (enterprise_id, material_id, data_owner_user_id, material_revision, channel_id, channel_revision, owner_user_id,
                   assignment_id, assignment_revision, team_id, owner_membership_id, public_id, status, snapshot, published_at)
                  VALUES (${scope.enterpriseId}, ${input.materialId}, ${scope.dataOwnerUserId}, ${input.expectedRevision}, ${Number(current.channelId)},
                    ${Number(current.channelRevision)}, ${Number(current.ownerUserId)}, ${Number(current.assignmentId)}, ${Number(current.assignmentRevision)},
                    ${Number(current.teamId)}, ${Number(current.ownerMembershipId)}, ${publicId}, 'published', ${JSON.stringify(snapshot)}, CURRENT_TIMESTAMP(3))`);
                }
              }
              // Immutable NEW internal audit, never change old audits, responsibility or recorder identity.
              await tx.execute(sql`INSERT INTO channel_material_publication_requests
                (enterprise_id, data_owner_user_id, actor_user_id, actor_admin_account_id, material_id, material_revision,
                 request_id, payload_hash, public_id, authorization_version, binding_version)
                VALUES (${scope.enterpriseId}, ${scope.dataOwnerUserId}, ${scope.actorUserId}, ${scope.officialActor!.adminAccountId},
                  ${input.materialId}, ${input.expectedRevision}, ${input.requestId}, ${hash}, ${publicId},
                  ${scope.officialActor!.inventoryPermissions!.authorizationVersion}, ${scope.officialActor!.bindingVersion})`);
              return { materialId: input.materialId, publicId, status: "published", revision: input.expectedRevision };
            } catch (error) { rejected = true; operationError = error; throw error; }
          });
        } catch (error) {
          if (attempt < 3 && observedDeadlock && rejected && error === operationError
            && !(error instanceof ChannelInventoryError && ["FORBIDDEN", "CONFLICT", "NOT_FOUND", "BAD_REQUEST"].includes(error.code))) continue;
          if (error instanceof ChannelInventoryError) throw error;
          if (error instanceof TRPCError) fail(error.code === "FORBIDDEN" ? "FORBIDDEN" : "SERVICE_UNAVAILABLE", error.message);
          // Timeout/network/commit uncertainty: no automatic replay and no success claim.
          fail("SERVICE_UNAVAILABLE", "发布结果暂无法确认；请使用原请求号重试，不要生成新请求号");
        }
      }
    },
  };
}
