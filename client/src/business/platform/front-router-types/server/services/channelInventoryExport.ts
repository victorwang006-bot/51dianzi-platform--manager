import { activeChannelMaterial } from "./channelInventoryManagementPersistence";
import { sql } from "drizzle-orm";
import {
  CHANNEL_INVENTORY_TYPES,
  ChannelInventoryError,
  resolveChannelInventoryAuthority,
  type ChannelInventoryScope,
  type ChannelInventoryType,
  type SqlDatabase,
  type SqlResultRow,
} from "./channelInventory";
import { teamMaterialSourceEligibility, SOURCE_FORBIDDEN_MESSAGE } from "./channelInventorySource";
import { linkedCompany } from "./customerSupplyCompany";

export const CHANNEL_INVENTORY_EXPORT_LIMIT = 10_000;
export type ChannelInventoryExportInput = {
  channelId: number;
  expectedEnterpriseId: number;
  expectedActorUserId: number;
};
export type ChannelInventoryExport = {
  channel: { id: number; name: string; type: ChannelInventoryType; active: boolean };
  enterpriseId: number;
  actorUserId: number;
  exportedAt: string;
  total: number;
  items: {
    partNumber: string;
    brand: string;
    qty: number | null;
    dateCode: string | null;
    price: string | null;
    currency: "CNY";
    taxIncluded: boolean | null;
    leadTime: string | null;
    updatedAt: string;
  }[];
};

function resultRows(result: unknown): SqlResultRow[] {
  if (!Array.isArray(result)) throw new Error("Invalid SQL result");
  return (Array.isArray(result[0]) ? result[0] : result) as SqlResultRow[];
}
function boolean(value: unknown): boolean { return value === true || value === 1 || value === "1"; }
function nullableText(value: unknown): string | null { return value == null ? null : String(value); }
function instant(value: unknown): string {
  // Business DATETIME literals are Beijing time, never the visitor/process TZ.
  const text = String(value);
  const date = value instanceof Date ? value : new Date(/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d+)?$/.test(text) ? `${text.replace(" ", "T")}+08:00` : text);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid inventory timestamp");
  return date.toISOString();
}

/** Logical read-only operation: only SELECTs, no share changes, audit writes or storage upload. */
export function createChannelInventoryExportService({ getDb }: { getDb: () => Promise<SqlDatabase | null> }) {
  return {
    async exportChannelMaterials(scope: ChannelInventoryScope, input: ChannelInventoryExportInput): Promise<ChannelInventoryExport> {
      for (const value of [input.channelId, input.expectedEnterpriseId, input.expectedActorUserId]) {
        if (!Number.isSafeInteger(value) || value <= 0) throw new ChannelInventoryError("BAD_REQUEST", "导出参数无效");
      }
      if (input.expectedEnterpriseId !== scope.enterpriseId || input.expectedActorUserId !== scope.actorUserId) {
        throw new ChannelInventoryError("FORBIDDEN", "企业或账号已变化，请刷新后重新下载");
      }
      try {
        const db = await getDb();
        if (!db) throw new Error("Missing database");
        return await db.transaction(async tx => {
          // Use the real authority helper and actual transaction. Membership,
          // grants and module settings are locked until this read completes.
          // Neither owner nor leader ever broadens private channel ownership.
          await resolveChannelInventoryAuthority(tx, scope, "channels", false, true);
          await resolveChannelInventoryAuthority(tx, scope, "stocks", false, true);
          // One SELECT gives channel metadata and ALL authorized materials one
          // consistent statement snapshot, even under READ COMMITTED. No count /
          // page loop can race an insert/update. The extra row detects overflow.
          const found = resultRows(await tx.execute(sql`
            SELECT c.id AS channelId, c.name AS channelName,
                   c.channel_type AS channelType, c.active AS channelActive,
                   m.id AS materialId, m.part_number AS partNumber, m.brand,
                   m.qty, m.date_code AS dateCode, m.price, m.currency,
                   m.tax_included AS taxIncluded, m.lead_time AS leadTime,
                   m.updated_at AS updatedAt, ${teamMaterialSourceEligibility(scope, true)} AS canViewSource
              FROM channel_inventory_channels c
              LEFT JOIN channel_inventory_materials m
                ON m.channel_id = c.id AND m.enterprise_id = c.enterprise_id
               AND m.data_owner_user_id = c.data_owner_user_id
               AND m.responsible_user_id = ${scope.actorUserId} AND ${activeChannelMaterial}
             WHERE c.id = ${input.channelId}
               AND c.enterprise_id = ${scope.enterpriseId}
               AND c.data_owner_user_id = ${scope.dataOwnerUserId}
               AND c.responsible_user_id = ${scope.actorUserId}
             ORDER BY m.id ASC
             LIMIT ${CHANNEL_INVENTORY_EXPORT_LIMIT + 1} FOR UPDATE
          `));
          if (!found.length) throw new ChannelInventoryError("NOT_FOUND", "渠道不存在或无权访问");
          // This export is grouped/titled by a real source. Merely redacting its
          // header would still disclose the material-to-channel link selected by
          // channelId. Reject the whole file if any included stock lacks source
          // authority; do not silently omit rows or expand channel-profile access.
          if (found.some(row => row.materialId != null && !boolean(row.canViewSource))) {
            throw new ChannelInventoryError("FORBIDDEN", `${SOURCE_FORBIDDEN_MESSAGE}：该渠道包含无来源查看权限的库存，整份导出未生成`);
          }
          if (found.length > CHANNEL_INVENTORY_EXPORT_LIMIT) {
            throw new ChannelInventoryError("PRECONDITION_FAILED", `该渠道库存超过 ${CHANNEL_INVENTORY_EXPORT_LIMIT.toLocaleString("en-US")} 条导出上限，未生成文件，请联系管理员分批整理后重试`);
          }
          const first = found[0];
          const type = String(first.channelType) as ChannelInventoryType;
          const company = await linkedCompany(tx, scope, Number(first.channelId));
          if (company.linked && !company.customer) throw new ChannelInventoryError("FORBIDDEN", SOURCE_FORBIDDEN_MESSAGE);
          if (!CHANNEL_INVENTORY_TYPES.includes(type)) throw new Error("Invalid channel type");
          const items: ChannelInventoryExport["items"] = found.filter(row => row.materialId != null).map(row => {
            if (String(row.currency) !== "CNY") throw new Error("Invalid currency");
            const qty = row.qty == null ? null : Number(row.qty);
            if (qty !== null && (!Number.isSafeInteger(qty) || qty < 0 || qty > 2_147_483_647)) throw new Error("Invalid quantity");
            return {
              partNumber: String(row.partNumber), brand: String(row.brand), qty,
              dateCode: nullableText(row.dateCode), price: nullableText(row.price),
              currency: "CNY", taxIncluded: row.taxIncluded == null ? null : boolean(row.taxIncluded),
              leadTime: nullableText(row.leadTime), updatedAt: instant(row.updatedAt),
            };
          });
          return {
            channel: { id: Number(first.channelId), name: company.linked ? String(company.customer?.name) : String(first.channelName), type, active: boolean(first.channelActive) },
            enterpriseId: scope.enterpriseId, actorUserId: scope.actorUserId,
            exportedAt: new Date().toISOString(), total: items.length, items,
          };
        });
      } catch (error) {
        if (error instanceof ChannelInventoryError) throw error;
        throw new ChannelInventoryError("INTERNAL_SERVER_ERROR", "渠道库存导出失败，未生成文件，请稍后重试");
      }
    },
  };
}
