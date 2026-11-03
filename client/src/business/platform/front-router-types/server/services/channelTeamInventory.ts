import { sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { ChannelInventoryError, resolveChannelInventoryAuthority, type ChannelInventoryScope, type SqlDatabase, type SqlExecutor, type SqlResultRow } from "./channelInventory";
import { resolveBusinessModuleAccess } from "./businessModuleAccess";

/** Deliberately independent of the private, source-bearing Material record. */
export type TeamChannelMaterial = {
  id: number; partNumber: string; brand: string; qty: number | null; dateCode: string | null;
  price: string | null; currency: "CNY"; taxIncluded: boolean | null; leadTime: string | null;
  revision: number; updatedAt: Date | string; createdAt: Date | string;
  isMine: boolean; canEdit: boolean; readOnly: boolean;
  channelSource: { id: number; name: string } | null; canViewSource: boolean;
};
export type TeamMaterialsInput = {
  expectedEnterpriseId?: number; expectedActorUserId?: number;
  partNumber?: string; brand?: string; channelId?: number; page: number; pageSize: number;
  sortBy?: "qty" | "dateCode"; sortDirection?: "asc" | "desc";
};
const rows = (result: unknown): SqlResultRow[] => {
  if (Array.isArray(result)) return (Array.isArray(result[0]) ? result[0] : result) as SqlResultRow[];
  return result && typeof result === "object" && "rows" in result && Array.isArray(result.rows) ? result.rows as SqlResultRow[] : [];
};
const bool = (v: unknown) => v === true || v === 1 || v === "1";
const text = (v: unknown) => v == null ? null : String(v);
const all = (p: SQL[]) => sql.join(p, sql` AND `);
const literal = (v: string) => `%${v.replace(/([=%_])/g, "=$1")}%`;
const fail = (code: "BAD_REQUEST" | "FORBIDDEN" | "INTERNAL_SERVER_ERROR", message: string): never => { throw new ChannelInventoryError(code, message); };
const FROM = sql`FROM channel_inventory_materials m INNER JOIN channel_inventory_channels c
 ON c.id = m.channel_id AND c.enterprise_id = m.enterprise_id
 AND c.data_owner_user_id = m.data_owner_user_id AND c.responsible_user_id = m.responsible_user_id`;

export function teamMaterialFrom(row: SqlResultRow, canWrite: boolean, leader: boolean): TeamChannelMaterial {
  if (String(row.currency) !== "CNY") fail("INTERNAL_SERVER_ERROR", "库存币种无效");
  const isMine = bool(row.isMine);
  const canViewSource = isMine || leader;
  const canEdit = isMine && canWrite;
  return {
    id: Number(row.id), partNumber: String(row.partNumber), brand: String(row.brand),
    qty: row.qty == null ? null : Number(row.qty), dateCode: text(row.dateCode), price: text(row.price), currency: "CNY",
    taxIncluded: row.taxIncluded == null ? null : bool(row.taxIncluded), leadTime: text(row.leadTime),
    revision: Number(row.revision), updatedAt: row.updatedAt as Date | string, createdAt: row.createdAt as Date | string,
    isMine, canEdit, readOnly: !canEdit, canViewSource,
    channelSource: canViewSource ? { id: Number(row.sourceId), name: String(row.sourceName) } : null,
  };
}
function expected(scope: ChannelInventoryScope, input: { expectedEnterpriseId?: number; expectedActorUserId?: number }) {
  if ((input.expectedEnterpriseId !== undefined && input.expectedEnterpriseId !== scope.enterpriseId)
    || (input.expectedActorUserId !== undefined && input.expectedActorUserId !== scope.actorUserId)) fail("FORBIDDEN", "企业或账号上下文不匹配，请刷新后重试");
}

/** All fragments are fixed SQL; only bound parameters contain user values. */
export function teamMaterialOrder(input: Pick<TeamMaterialsInput, "sortBy" | "sortDirection">): SQL {
  if (input.sortBy !== undefined && !["qty", "dateCode"].includes(input.sortBy)) fail("BAD_REQUEST", "排序字段无效");
  if (input.sortDirection !== undefined && !["asc", "desc"].includes(input.sortDirection)) fail("BAD_REQUEST", "排序方向无效");
  const dir = input.sortDirection === "desc" ? sql`DESC` : sql`ASC`;
  if (input.sortBy === "qty") return sql`m.qty IS NULL ASC, m.qty ${dir}, m.id DESC`;
  if (input.sortBy === "dateCode") {
    const value = sql`TRIM(COALESCE(m.date_code, ''))`;
    const unknown = sql`(LOWER(${value}) IN ('', '待查', '未知', 'unknown', 'n/a', 'na', '?', '-'))`;
    // YYWW / YY+ use year then week, preserving the original value in the DTO.
    // Remaining text uses prefix + first numeric token + suffix natural ordering.
    const calendar = sql`(${value} REGEXP '^[0-9]{4}$' AND CAST(RIGHT(${value}, 2) AS UNSIGNED) BETWEEN 1 AND 53) OR ${value} REGEXP '^[0-9]{2}[+]$'`;
    const key = sql`CASE WHEN ${calendar} THEN CONCAT('20', LEFT(${value}, 2), LPAD(CASE WHEN RIGHT(${value}, 1) = '+' THEN 0 ELSE CAST(RIGHT(${value}, 2) AS UNSIGNED) END, 2, '0')) ELSE LOWER(${value}) END`;
    return sql`${unknown} ASC,
      REGEXP_REPLACE(${key}, '[0-9].*$', '') ${dir},
      CAST(COALESCE(NULLIF(REGEXP_SUBSTR(${key}, '[0-9]+'), ''), '0') AS UNSIGNED) ${dir},
      REGEXP_REPLACE(${key}, '^[^0-9]*[0-9]+', '') ${dir}, ${key} ${dir}, m.id DESC`;
  }
  return sql`m.id DESC`;
}

export function createChannelTeamInventoryService({ getDb }: { getDb: () => Promise<SqlDatabase | null> }) {
  async function visible(db: SqlExecutor, scope: ChannelInventoryScope) {
    const access = await resolveChannelInventoryAuthority(db, scope, "stocks");
    // Do not infer leadership from native adminRole, enterprise role or cached context.
    const memberships = rows(await db.execute(sql`SELECT tm.id, tm.teamId, tm.teamRole FROM enterprise_team_members tm
      INNER JOIN enterprise_teams t ON t.id = tm.teamId AND t.enterpriseId = tm.enterpriseId AND t.status = 'active'
      WHERE tm.enterpriseId = ${scope.enterpriseId} AND tm.userId = ${scope.actorUserId}`));
    const member = memberships.length === 1 && ["leader", "member"].includes(String(memberships[0].teamRole)) ? memberships[0] : null;
    const leader = member?.teamRole === "leader";
    const peer = member ? sql`EXISTS (SELECT 1 FROM channel_inventory_material_shares s
      INNER JOIN enterprise_team_record_assignments a ON a.enterpriseId = s.enterprise_id
       AND a.recordType = 'channel_material' AND a.recordId = s.material_id
       AND a.currentOwnerUserId = s.owner_user_id AND a.teamId = s.share_team_id AND a.revision = s.assignment_revision
      INNER JOIN enterprise_team_members owner_tm ON owner_tm.enterpriseId = s.enterprise_id
       AND owner_tm.userId = s.owner_user_id AND owner_tm.teamId = s.share_team_id AND owner_tm.id = s.owner_membership_id
       AND owner_tm.teamRole IN ('leader', 'member')
      INNER JOIN enterprise_teams t ON t.id = s.share_team_id AND t.enterpriseId = s.enterprise_id AND t.status = 'active'
      INNER JOIN enterprise_team_members reader_tm ON reader_tm.enterpriseId = s.enterprise_id
       AND reader_tm.teamId = s.share_team_id AND reader_tm.userId = ${scope.actorUserId} AND reader_tm.id = ${Number(member.id)}
      INNER JOIN enterprise_members owner_em ON owner_em.enterpriseId = s.enterprise_id AND owner_em.userId = s.owner_user_id AND owner_em.status = 'active'
      INNER JOIN users owner_u ON owner_u.id = owner_em.userId AND owner_u.loginDisabled = 0
      WHERE s.enterprise_id = m.enterprise_id AND s.material_id = m.id AND s.enabled = 1
       AND s.owner_user_id = m.responsible_user_id AND s.share_team_id = ${Number(member.teamId)}
       AND (EXISTS (SELECT 1 FROM enterprise_member_permissions p WHERE p.enterpriseMemberId = owner_em.id AND p.permissionKey = 'inventory.manage')
        OR (owner_em.role = 'super_admin' AND EXISTS (SELECT 1 FROM enterprises e WHERE e.id = s.enterprise_id AND e.superAdminUserId = owner_em.userId))))` : sql`FALSE`;
    const base = [sql`m.enterprise_id = ${scope.enterpriseId}`, sql`m.data_owner_user_id = ${scope.dataOwnerUserId}`];
    const eligible: number[] = [];
    if (member) {
      const owners = rows(await db.execute(sql`SELECT DISTINCT m.responsible_user_id AS ownerUserId ${FROM}
        WHERE ${all([...base, sql`m.responsible_user_id <> ${scope.actorUserId}`, peer])}`));
      for (const owner of owners) {
        const id = Number(owner.ownerUserId);
        try {
          const grant = await resolveBusinessModuleAccess(id, scope.enterpriseId, "stocks", db);
          if (grant.read && grant.write) eligible.push(id);
        } catch (error) {
          if (!(error instanceof TRPCError) || error.code !== "FORBIDDEN") throw error;
        }
      }
    }
    const shared = eligible.length ? sql`(${peer} AND m.responsible_user_id IN (${sql.join(eligible.map(id => sql`${id}`), sql`, `)}))` : sql`FALSE`;
    return { access, leader, predicates: [...base, sql`(m.responsible_user_id = ${scope.actorUserId} OR ${shared})`] };
  }
  async function database(): Promise<SqlDatabase> { const db = await getDb(); if (!db) throw new ChannelInventoryError("INTERNAL_SERVER_ERROR", "渠道库存服务暂不可用，请稍后重试"); return db; }
  return {
    async listTeamMaterials(scope: ChannelInventoryScope, input: TeamMaterialsInput) {
      expected(scope, input);
      const allowed = new Set(["expectedEnterpriseId", "expectedActorUserId", "partNumber", "brand", "channelId", "page", "pageSize", "sortBy", "sortDirection"]);
      if (Object.keys(input).some(k => !allowed.has(k))) fail("BAD_REQUEST", "库存筛选字段无效");
      if (!Number.isInteger(input.page) || input.page < 1 || input.page > 1_000_000 || !Number.isInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 100) fail("BAD_REQUEST", "分页参数无效");
      const order = teamMaterialOrder(input);
      const db = await database();
      const { access, leader, predicates } = await visible(db, scope);
      if (input.channelId !== undefined) {
        if (!leader) fail("FORBIDDEN", "无权查看渠道来源筛选");
        if (!Number.isSafeInteger(input.channelId) || input.channelId < 1) fail("BAD_REQUEST", "渠道来源无效");
        predicates.push(sql`m.channel_id = ${input.channelId}`);
      }
      if (input.partNumber) predicates.push(sql`m.part_number LIKE ${literal(input.partNumber)} ESCAPE '='`);
      if (input.brand) predicates.push(sql`m.brand LIKE ${literal(input.brand)} ESCAPE '='`);
      const where = all(predicates);
      const total = Number(rows(await db.execute(sql`SELECT COUNT(*) AS total ${FROM} WHERE ${where}`))[0]?.total ?? 0);
      const items = rows(await db.execute(sql`SELECT m.id, m.part_number AS partNumber, m.brand, m.qty, m.date_code AS dateCode,
        m.price, m.currency, m.tax_included AS taxIncluded, m.lead_time AS leadTime, m.revision,
        m.updated_at AS updatedAt, m.created_at AS createdAt, (m.responsible_user_id = ${scope.actorUserId}) AS isMine,
        CASE WHEN m.responsible_user_id = ${scope.actorUserId} OR ${leader} THEN c.id ELSE NULL END AS sourceId,
        CASE WHEN m.responsible_user_id = ${scope.actorUserId} OR ${leader} THEN c.name ELSE NULL END AS sourceName
        ${FROM} WHERE ${where} ORDER BY ${order} LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize}`))
        .map(row => teamMaterialFrom(row, access.write, leader));
      return { items, total, page: input.page, pageSize: input.pageSize, pageCount: Math.ceil(total / input.pageSize), canWrite: access.write, canFilterSource: leader };
    },
    async listTeamSourceOptions(scope: ChannelInventoryScope, input: { expectedEnterpriseId?: number; expectedActorUserId?: number } = {}) {
      expected(scope, input);
      if (Object.keys(input).some(k => !["expectedEnterpriseId", "expectedActorUserId"].includes(k))) fail("BAD_REQUEST", "来源筛选参数无效");
      const db = await database();
      const { leader, predicates } = await visible(db, scope);
      if (!leader) return { canFilterSource: false, items: [] as { id: number; name: string }[] };
      const items = rows(await db.execute(sql`SELECT DISTINCT c.id, c.name ${FROM} WHERE ${all(predicates)} ORDER BY c.name ASC, c.id ASC`))
        .map(row => ({ id: Number(row.id), name: String(row.name) }));
      return { canFilterSource: true, items };
    },
  };
}
