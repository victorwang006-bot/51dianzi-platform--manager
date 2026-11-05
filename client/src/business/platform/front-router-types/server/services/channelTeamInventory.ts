import { materialUploadBatchId } from "./channelInventoryManagementPersistence";
import { sql, type SQL } from "drizzle-orm";
import { BUSINESS_INDUSTRY_CODES, businessIndustryCodeSchema, type BusinessIndustryCode } from "../../../shared/businessIndustry";
import { officialMaterialRecorderAdminAccountId } from "./channelInventoryOriginalActor";
import { ChannelInventoryError, type ChannelInventoryScope, type SqlDatabase, type SqlResultRow } from "./channelInventory";
import { resolveTeamInventoryVisibility as visible, TEAM_MATERIAL_FROM as FROM } from "./channelTeamInventoryAccess";
import { teamMaterialSourceEligibility } from "./channelInventorySource";
import { customerReadPolicy, linkedCompany, linkedCompanyReadGate } from "./customerSupplyCompany";
import { crmCustomerPolicyWhere } from "./crmCustomers";

/** Deliberately independent of the private, source-bearing Material record. */
export type TeamChannelMaterial = {
  id: number; uploadBatchId: number | null; canDelete: boolean; partNumber: string; brand: string; qty: number | null; dateCode: string | null;
  price: string | null; currency: "CNY"; taxIncluded: boolean | null; leadTime: string | null;
  industryCode: BusinessIndustryCode | null;
  revision: number; updatedAt: Date | string; createdAt: Date | string;
  isMine: boolean; canEdit: boolean; readOnly: boolean; noteCount: number; canAddNote: boolean;
  channelSource: { id: number; name: string } | null; canViewSource: boolean;
  originalRecorderName: string | null; recorderAdminAccountId: number | null;
};
export type TeamMaterialsInput = {
  expectedEnterpriseId?: number; expectedActorUserId?: number;
  partNumber?: string; brand?: string; channelId?: number; uploadBatchId?: number; page: number; pageSize: number;
  industryCode?: BusinessIndustryCode | "unset";
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
export function teamMaterialFrom(row: SqlResultRow, canWrite: boolean, leader: boolean): TeamChannelMaterial {
  if (String(row.currency) !== "CNY") fail("INTERNAL_SERVER_ERROR", "库存币种无效");
  const isMine = bool(row.isMine);
  const canViewSource = bool(row.canViewSource);
  const canEdit = (isMine || leader) && canWrite;
  const industry = businessIndustryCodeSchema.safeParse(row.industryCode);
  return {
    id: Number(row.id), uploadBatchId: row.uploadBatchId == null ? null : Number(row.uploadBatchId), canDelete: canEdit, partNumber: String(row.partNumber), brand: String(row.brand),
    qty: row.qty == null ? null : Number(row.qty), dateCode: text(row.dateCode), price: text(row.price), currency: "CNY",
    taxIncluded: row.taxIncluded == null ? null : bool(row.taxIncluded), leadTime: text(row.leadTime),
    industryCode: industry.success ? industry.data : null,
    revision: Number(row.revision), updatedAt: row.updatedAt as Date | string, createdAt: row.createdAt as Date | string,
    isMine, canEdit, readOnly: !canEdit, canViewSource, noteCount: Number(row.noteCount ?? 0), canAddNote: true,
    channelSource: null, originalRecorderName: null, recorderAdminAccountId: null,
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
  async function database(): Promise<SqlDatabase> { const db = await getDb(); if (!db) throw new ChannelInventoryError("INTERNAL_SERVER_ERROR", "渠道库存服务暂不可用，请稍后重试"); return db; }
  return {
    async listTeamMaterials(scope: ChannelInventoryScope, input: TeamMaterialsInput) {
      expected(scope, input);
      const allowed = new Set(["expectedEnterpriseId", "expectedActorUserId", "partNumber", "brand", "channelId", "uploadBatchId", "industryCode", "page", "pageSize", "sortBy", "sortDirection"]);
      if (Object.keys(input).some(k => !allowed.has(k))) fail("BAD_REQUEST", "库存筛选字段无效");
      if (input.industryCode !== undefined && input.industryCode !== "unset" && !businessIndustryCodeSchema.safeParse(input.industryCode).success) fail("BAD_REQUEST", "库存行业筛选无效");
      if (!Number.isInteger(input.page) || input.page < 1 || input.page > 1_000_000 || !Number.isInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 100) fail("BAD_REQUEST", "分页参数无效");
      const order = teamMaterialOrder(input);
      const db = await database();
      return db.transaction(async tx => {
      const { access, leader, predicates } = await visible(tx, scope, { lock: true });
      if (input.channelId !== undefined) {
        if (!Number.isSafeInteger(input.channelId) || input.channelId < 1) fail("BAD_REQUEST", "渠道来源无效");
        predicates.push(sql`m.channel_id = ${input.channelId}`);
        predicates.push(teamMaterialSourceEligibility(scope, true, leader));
        predicates.push(await linkedCompanyReadGate(tx, scope));
        if (!leader) {
          predicates.push(sql`c.responsible_user_id = ${scope.actorUserId}`, sql`c.data_owner_user_id = ${scope.dataOwnerUserId}`);
          const ownExact = rows(await tx.execute(sql`SELECT m.id ${FROM} WHERE ${all(predicates)} LIMIT 1 FOR UPDATE`))[0];
          if (!ownExact) fail("FORBIDDEN", "无权查看该精确渠道来源");
        }
      }
      if (input.uploadBatchId !== undefined) {
        if (!Number.isSafeInteger(input.uploadBatchId) || input.uploadBatchId < 1) fail("BAD_REQUEST", "上传批次无效");
        predicates.push(sql`${materialUploadBatchId} = ${input.uploadBatchId}`);
      }
      if (input.partNumber) predicates.push(sql`m.part_number LIKE ${literal(input.partNumber)} ESCAPE '='`);
      if (input.brand) predicates.push(sql`m.brand LIKE ${literal(input.brand)} ESCAPE '='`);
      if (input.industryCode !== undefined) {
        // Match the existing public projection: linked customer industry is current
        // and CRM-authorized; never filter on the stale channel copy or private source.
        const policy = await customerReadPolicy(tx, scope);
        const link = sql`FROM crm_customer_supply_channels industry_link WHERE industry_link.enterpriseId = c.enterprise_id
          AND industry_link.dataOwnerUserId = c.data_owner_user_id AND industry_link.channelId = c.id`;
        const industry = sql`CASE WHEN EXISTS (SELECT 1 ${link} FOR UPDATE) THEN
          (SELECT industry_customer.industryCode FROM crm_customer_supply_channels industry_link
            INNER JOIN crm_customers industry_customer ON industry_customer.enterpriseId = industry_link.enterpriseId AND industry_customer.id = industry_link.customerId
            WHERE industry_link.enterpriseId = c.enterprise_id AND industry_link.dataOwnerUserId = c.data_owner_user_id AND industry_link.channelId = c.id
              AND ${policy ? crmCustomerPolicyWhere(scope, policy, "industry_customer") : sql`FALSE`} LIMIT 1 FOR UPDATE)
          ELSE c.industryCode END`;
        const known = sql`BINARY (${industry}) IN (${sql.join(BUSINESS_INDUSTRY_CODES.map(code => sql`${code}`), sql`, `)})`;
        predicates.push(input.industryCode === "unset"
          ? sql`COALESCE((${known}), FALSE) = FALSE`
          : sql`BINARY (${industry}) = ${input.industryCode}`);
      }
      const where = all(predicates);
      const total = Number(rows(await tx.execute(sql`SELECT COUNT(*) AS total ${FROM} WHERE ${where} FOR UPDATE`))[0]?.total ?? 0);
      const items = rows(await tx.execute(sql`SELECT m.id, ${materialUploadBatchId} AS uploadBatchId, m.part_number AS partNumber, m.brand, m.qty, m.date_code AS dateCode,
        m.price, m.currency, m.tax_included AS taxIncluded, m.lead_time AS leadTime, m.revision, c.industryCode AS industryCode, c.id AS companyChannelId,
        (SELECT COUNT(*) FROM channel_inventory_collaboration_notes cn WHERE cn.enterpriseId = m.enterprise_id AND cn.materialId = m.id) AS noteCount,
        m.updated_at AS updatedAt, m.created_at AS createdAt, (m.responsible_user_id = ${scope.actorUserId}) AS isMine,
        ${teamMaterialSourceEligibility(scope, true)} AS canViewSource,
        ${scope.officialActor ? officialMaterialRecorderAdminAccountId(true) : sql`NULL`} AS recorderAdminAccountId
        ${FROM} WHERE ${where} ORDER BY ${order} LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize} FOR UPDATE`))
        ;
      const projected = [];
      for (const row of items) {
        const company = await linkedCompany(tx, scope, Number(row.companyChannelId));
        if (company.linked) { row.industryCode = company.customer?.industryCode ?? null; row.canViewSource = bool(row.canViewSource) && company.customer !== null; }
        projected.push({ ...teamMaterialFrom(row, access.write, leader), canDelete: access.write && (bool(row.isMine) || leader) && (!company.linked || company.customer !== null), recorderAdminAccountId: row.recorderAdminAccountId == null ? null : Number(row.recorderAdminAccountId), canAddNote: scope.officialActor?.inventoryPermissions ? scope.officialActor.inventoryPermissions.note : true });
      }
      return { items: projected, total, page: input.page, pageSize: input.pageSize, pageCount: Math.ceil(total / input.pageSize), canWrite: access.write, canFilterSource: leader };
      });
    },
    async listTeamSourceOptions(scope: ChannelInventoryScope, input: { expectedEnterpriseId?: number; expectedActorUserId?: number } = {}) {
      expected(scope, input);
      if (Object.keys(input).some(k => !["expectedEnterpriseId", "expectedActorUserId"].includes(k))) fail("BAD_REQUEST", "来源筛选参数无效");
      const db = await database();
      return db.transaction(async tx => {
        const { leader, predicates } = await visible(tx, scope, { lock: true });
        if (!leader) return { canFilterSource: false, items: [] as { id: number; name: string }[] };
        const items = rows(await tx.execute(sql`SELECT DISTINCT c.id, c.name ${FROM}
          WHERE ${all([...predicates, teamMaterialSourceEligibility(scope, true, true), await linkedCompanyReadGate(tx, scope)])} ORDER BY c.name ASC, c.id ASC FOR UPDATE`))
          .map(row => ({ id: Number(row.id), name: String(row.name) }));
        for (const item of items) { const company = await linkedCompany(tx, scope, item.id); if (company.linked) item.name = String(company.customer?.name ?? ""); }
        items.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
        return { canFilterSource: true, items };
      });
    },
  };
}
