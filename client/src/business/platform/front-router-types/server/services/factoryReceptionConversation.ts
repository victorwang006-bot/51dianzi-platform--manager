import { sql } from "drizzle-orm";
import type { SqlExecutor } from "./channelInventory";
import { FACTORY_RECEPTION } from "./factoryInventoryReception";
export type FactoryConversationReception = {
  receptionKind?: "factory_channel"; receptionBrand?: "51电子网"; receptionLabel?: string;
  receptionScope: (typeof FACTORY_RECEPTION & { mixedInquirySources: boolean }) | null;
};
const errorCode = (error: unknown): string | undefined => {
  if (!error || typeof error !== "object") return undefined;
  const e = error as { code?: string; cause?: unknown };
  return e.code ?? errorCode(e.cause);
};
/** Call ONLY after conversation authorization. Source/brand are server-owned DB
 * fields, never inferred from message JSON (a chat user can forge that content).
 * Mixed enterprise conversations keep their actual counterparty identity; the
 * factory brand remains a distinct, visible inquiry scope rather than a rename.
 */
export async function factoryConversationReceptionScopes(db: SqlExecutor, authorizedConversationIds: number[], buyerUserId: number) {
  const map = new Map<number, FactoryConversationReception>();
  if (!authorizedConversationIds.length) return map;
  try {
    const result = await db.execute(sql`SELECT conversationId,
      SUM(buyerUserId = ${buyerUserId} AND sourceKind IN ('channel_material','official_admin_inventory') AND receptionKind = 'factory_channel' AND receptionBrand = '51电子网') AS factoryCount,
      SUM(sourceKind = 'inventory' OR receptionKind IS NULL OR buyerUserId <> ${buyerUserId}) AS ordinaryCount
      FROM inventory_inquiries WHERE conversationId IN (${sql.join(authorizedConversationIds.map(id => sql`${id}`), sql`, `)})
      GROUP BY conversationId`);
    const rows = (result as unknown as [Array<{ conversationId: number; factoryCount: number; ordinaryCount: number }>, unknown])[0];
    for (const row of rows) {
      if (Number(row.factoryCount) <= 0) continue;
      const mixed = Number(row.ordinaryCount) > 0;
      map.set(Number(row.conversationId), {
        ...(mixed ? {} : FACTORY_RECEPTION),
        receptionScope: { ...FACTORY_RECEPTION, mixedInquirySources: mixed },
      });
    }
  } catch (error) {
    // Additive schema rollout: ordinary chats remain usable before migration.
    // Other failures propagate instead of masking an unavailable authority store.
    if (!["ER_BAD_FIELD_ERROR", "ER_NO_SUCH_TABLE"].includes(errorCode(error) ?? "")) throw error;
  }
  return map;
}
