import { sql, type SQL } from "drizzle-orm";
import { getDb } from "../db";

export const SOLD_OUT_REASON = "sold_out";

export type InventoryQuantity = {
  inventoryId: number;
  qty: number;
};

export class InventoryReservationError extends Error {
  constructor(public readonly inventoryId: number) {
    super(`库存预留失败：${inventoryId}`);
    this.name = "InventoryReservationError";
  }
}

type SqlExecutor = {
  execute(query: SQL): Promise<unknown>;
};

function affectedRows(result: unknown): number {
  return Number(
    (result as unknown as [{ affectedRows?: number }, unknown])?.[0]?.affectedRows ?? 0,
  );
}

function rowsOf<T>(result: unknown): T[] {
  return (result as unknown as [T[], unknown])?.[0] ?? [];
}

function normalizeQuantities(items: InventoryQuantity[]): InventoryQuantity[] {
  const totals = new Map<number, number>();
  for (const item of items) {
    if (!Number.isInteger(item.inventoryId) || item.inventoryId <= 0) {
      throw new Error("库存记录无效");
    }
    if (!Number.isInteger(item.qty) || item.qty <= 0) {
      throw new Error("库存数量无效");
    }
    totals.set(item.inventoryId, (totals.get(item.inventoryId) ?? 0) + item.qty);
  }
  return Array.from(totals, ([inventoryId, qty]) => ({ inventoryId, qty })).sort(
    (a, b) => a.inventoryId - b.inventoryId,
  );
}

/**
 * 原子预占可售库存。
 *
 * 每条 UPDATE 同时完成「状态校验 + 数量校验 + 扣减 + 售罄系统下架」。
 * affectedRows=0 表示商品已下架或数量不足，由上层事务整体回滚订单与其他库存变更。
 */
export async function reserveInventoryStock(
  tx: SqlExecutor,
  items: InventoryQuantity[],
): Promise<void> {
  for (const item of normalizeQuantities(items)) {
    const result = await tx.execute(sql`
      UPDATE inventories
         SET status = IF(qtyOnSale - ${item.qty} = 0, 'offshelf', status),
             publishedAt = IF(qtyOnSale - ${item.qty} = 0, NULL, publishedAt),
             offshelfBy = IF(qtyOnSale - ${item.qty} = 0, 'system', offshelfBy),
             offshelfReason = IF(qtyOnSale - ${item.qty} = 0, ${SOLD_OUT_REASON}, offshelfReason),
             qtyOnSale = qtyOnSale - ${item.qty}
       WHERE id = ${item.inventoryId}
         AND status = 'published'
         AND qtyOnSale >= ${item.qty}
    `);
    if (affectedRows(result) !== 1) {
      throw new InventoryReservationError(item.inventoryId);
    }
  }
}

/** 查询订单项并按库存聚合，避免同一库存跨拆单或重复项被逐次回补。 */
export async function getReservedStockForOrders(
  tx: SqlExecutor,
  orderIds: number[],
): Promise<InventoryQuantity[]> {
  const ids = Array.from(new Set(orderIds.filter(id => Number.isInteger(id) && id > 0)));
  if (ids.length === 0) return [];
  const idList = sql.join(ids.map(id => sql`${id}`), sql`, `);
  const result = await tx.execute(sql`
    SELECT inventoryId, SUM(qty) AS qty
      FROM order_items
     WHERE orderId IN (${idList})
     GROUP BY inventoryId
  `);
  return normalizeQuantities(
    rowsOf<Array<{ inventoryId: number; qty: number | string }>[number]>(result).map(row => ({
      inventoryId: Number(row.inventoryId),
      qty: Number(row.qty),
    })),
  );
}

/**
 * 释放已预占库存。
 *
 * 只有系统因 sold_out 进入 offshelf 的记录会自动恢复 published；用户或管理员手工下架
 * 的记录仅增加可售数量，不改变其状态，防止取消订单覆盖人工运营决定。
 */
export async function restoreInventoryStock(
  tx: SqlExecutor,
  items: InventoryQuantity[],
): Promise<void> {
  for (const item of normalizeQuantities(items)) {
    await tx.execute(sql`
      UPDATE inventories
         SET qtyOnSale = qtyOnSale + ${item.qty},
             status = IF(offshelfBy = 'system' AND offshelfReason = ${SOLD_OUT_REASON}, 'published', status),
             publishedAt = IF(offshelfBy = 'system' AND offshelfReason = ${SOLD_OUT_REASON}, NOW(), publishedAt),
             offshelfBy = IF(offshelfBy = 'system' AND offshelfReason = ${SOLD_OUT_REASON}, NULL, offshelfBy),
             offshelfReason = IF(offshelfReason = ${SOLD_OUT_REASON}, NULL, offshelfReason)
       WHERE id = ${item.inventoryId}
    `);
  }
}

export async function restoreInventoryStockForOrders(
  tx: SqlExecutor,
  orderIds: number[],
): Promise<void> {
  const items = await getReservedStockForOrders(tx, orderIds);
  await restoreInventoryStock(tx, items);
}

/**
 * 买家主动取消待付款对公订单。
 *
 * 订单状态抢占、库存释放和轨迹写入处于同一事务；并发重复请求只有一次能把
 * pending 改为 cancel。已声明转账的订单不能自行取消，避免钱在途但订单已关闭。
 */
export async function cancelPendingCorpOrderAndRestore(input: {
  orderId: number;
  buyerId: number;
  reason: string;
}): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");
  const reason = input.reason.trim().slice(0, 255) || "买家主动取消";
  return db.transaction(async tx => {
    const result = await tx.execute(sql`
      UPDATE orders
         SET status = 'cancel', statusNote = ${reason}
       WHERE id = ${input.orderId}
         AND buyerId = ${input.buyerId}
         AND status = 'pending'
         AND payMethod = 'corp'
         AND transferDeclaredAt IS NULL
    `);
    if (affectedRows(result) !== 1) return false;
    await restoreInventoryStockForOrders(tx, [input.orderId]);
    await tx.execute(sql`
      INSERT INTO order_tracks (orderId, content)
      VALUES (${input.orderId}, ${`订单已取消（${reason}）`.slice(0, 255)})
    `);
    return true;
  });
}

/**
 * 卖家取消待付款对公订单。
 *
 * 与买家取消不同：卖家在买家已声明转账后仍可关闭订单，避免货被长期占用。
 * 若买家其实已打款，需由卖家自行退回，轨迹里写明取消原因。
 */
export async function cancelPendingSellerCorpOrderAndRestore(input: {
  orderId: number;
  sellerId: number;
  reason: string;
}): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");
  const reason = input.reason.trim().slice(0, 255) || "卖家取消订单";
  return db.transaction(async tx => {
    const result = await tx.execute(sql`
      UPDATE orders
         SET status = 'cancel', statusNote = ${reason}
       WHERE id = ${input.orderId}
         AND sellerId = ${input.sellerId}
         AND status = 'pending'
         AND payMethod = 'corp'
    `);
    if (affectedRows(result) !== 1) return false;
    await restoreInventoryStockForOrders(tx, [input.orderId]);
    await tx.execute(sql`
      INSERT INTO order_tracks (orderId, content)
      VALUES (${input.orderId}, ${`订单已取消（${reason}）`.slice(0, 255)})
    `);
    return true;
  });
}
