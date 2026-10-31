/**
 * 对公转账订单的超时关单与收款声明服务。
 *
 * 背景问题（生产实测）：对公转账的待付款订单**没有任何超时机制**，
 * 界面上「请在 24 小时内完成付款」是纯文案、无代码执行，
 * 生产曾有订单挂 283 小时仍为待付款，而下单即扣库存，
 * 导致库存被无成本无限期锁死（已实测到 2 条库存被占到 0）。
 *
 * 本模块提供三件事：
 * 1. 超时关单：未声明转账的对公订单超时后自动取消并回补库存
 * 2. 收款声明：买家点「我已转账」后标记订单，使其**永不自动关单**
 * 3. 关单前提醒：临近超时写入订单轨迹提醒买家
 *
 * 为何声明后必须永不关单：订单号已作为转账附言交给买家，
 * 若关单后款项才到账，钱按该订单号打来而订单已不存在，
 * 只能人工查账退款，买家会认为平台收钱不发货。
 */
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { getServiceUserId } from "./customerService";
import { CORPORATE_TRANSFER_ACCOUNT } from "./corporateTransfer";
import { restoreInventoryStockForOrders } from "./inventoryStock";

/**
 * 对公转账付款时限（分钟），默认 30 分钟。
 *
 * 做成环境变量而非散落硬编码，便于后续按实际付款完成率调整；但生产
 * 未配置覆盖值时必须明确落到 30 分钟，避免待付款订单长期占用可售库存。
 *
 * 变更记录：2026-08-26 根据平台规则从 240 分钟调整为 30 分钟。
 * 微信和支付宝仍各自保持 5 分钟，不复用本配置。
 */
export function corpTransferTimeoutMinutes(): number {
  const raw = Number(process.env.CORP_TRANSFER_TIMEOUT_MINUTES);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 30;
}

/**
 * 关单前提醒的提前量（分钟）。
 *
 * 取时限的 25%（30 分钟 → 提前 7 分钟），且不少于 5 分钟：
 * 时限被调得很短时，固定提前量会导致「刚下单就提醒」的荒谬体验。
 */
export function corpTransferReminderLeadMinutes(): number {
  return Math.max(5, Math.floor(corpTransferTimeoutMinutes() * 0.25));
}

/** 提醒轨迹的固定前缀，用于判重（避免每轮扫描都发一条） */
export const CORP_REMINDER_TRACK_PREFIX = "付款时限提醒";

/** 超时关单写入 statusNote 的固定前缀，便于对账与前端识别 */
export const CORP_TIMEOUT_NOTE_PREFIX = "对公转账超时";

export type CorpSweepResult = {
  /** 扫描到的候选订单数 */
  scanned: number;
  /** 实际关闭的订单数 */
  closed: number;
  /** 发出提醒的订单数 */
  reminded: number;
};

/**
 * 关闭单张超时的对公转账订单，并回补库存。
 *
 * 关键：状态复查放在 UPDATE 的 WHERE 里，而不是先查后改。
 * 买家可能在扫描与关单之间完成付款或点了「我已转账」，
 * 先查后改会把已付款/已声明的订单误关 —— 这是资金级事故。
 * 条件更新使判定与写入成为同一个原子操作。
 */
async function closeOneOrder(orderId: number, minutes: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const note = `${CORP_TIMEOUT_NOTE_PREFIX}（${minutes} 分钟）未付款，订单已取消并释放库存`;

  /*
   * 关单与回补库存必须同事务。
   *
   * 若分两步提交，中间失败会产生「订单已取消但库存未回补」——
   * 库存永久凭空消失，且不报错、无人发现。
   */
  return await db.transaction(async tx => {
    const upd = await tx.execute(sql`
      UPDATE orders
         SET status = 'cancel', statusNote = ${note}
       WHERE id = ${orderId}
         AND status = 'pending'
         AND payMethod = 'corp'
         AND transferDeclaredAt IS NULL
    `);
    const affected = Number(
      (upd as unknown as [{ affectedRows?: number }, unknown])[0]?.affectedRows ?? 0,
    );
    // 没抢到说明订单已被付款/声明/取消，本轮放弃，绝不能回补库存
    if (affected === 0) return false;

    /*
     * 回补只恢复可售数量，不动 qtyStock；若商品此前因售罄被系统下架，
     * 同一事务内自动恢复 published。用户或后台手工下架的商品不会被重上架。
     */
    await restoreInventoryStockForOrders(tx, [orderId]);

    await tx.execute(sql`
      INSERT INTO order_tracks (orderId, content) VALUES (${orderId}, ${note})
    `);
    return true;
  });
}

/** 写入付款时限提醒轨迹（已提醒过则跳过） */
async function remindOneOrder(orderId: number, minutes: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const existing = await db.execute(sql`
    SELECT id FROM order_tracks
     WHERE orderId = ${orderId} AND content LIKE ${CORP_REMINDER_TRACK_PREFIX + "%"}
     LIMIT 1
  `);
  const rows = (existing as unknown as [Array<{ id: number }>, unknown])[0];
  if (rows.length > 0) return false;

  const content =
    `${CORP_REMINDER_TRACK_PREFIX}：请在下单后 ${minutes} 分钟内完成对公转账，` +
    `逾期将自动取消并释放库存；已转账请点击「我已转账，通知卖家」。`;
  await db.execute(sql`
    INSERT INTO order_tracks (orderId, content) VALUES (${orderId}, ${content.slice(0, 255)})
  `);
  return true;
}

/**
 * 扫描并处理超时的对公转账订单。
 *
 * 由 refundWorker（单实例进程 + MySQL 命名锁）调用。
 * 绝不能放进主应用：主应用是 PM2 cluster 4 实例，
 * 4 个实例会同时扫到同一订单并各自回补一次库存。
 */
export async function runCorpTransferSweep(): Promise<CorpSweepResult> {
  const db = await getDb();
  if (!db) return { scanned: 0, closed: 0, reminded: 0 };

  const minutes = corpTransferTimeoutMinutes();
  const lead = corpTransferReminderLeadMinutes();

  /*
   * 候选集：对公转账 + 待付款 + 未声明转账。
   *
   * transferDeclaredAt IS NULL 是最关键的过滤条件：
   * 买家已声明转账的订单必须完全排除在超时机制之外。
   */
  const res = await db.execute(sql`
    SELECT id, orderNo,
           TIMESTAMPDIFF(MINUTE, createdAt, NOW()) AS ageMinutes
      FROM orders
     WHERE status = 'pending'
       AND payMethod = 'corp'
       AND transferDeclaredAt IS NULL
     ORDER BY createdAt ASC
     LIMIT 200
  `);
  const rows = (res as unknown as [
    Array<{ id: number; orderNo: string; ageMinutes: number }>,
    unknown,
  ])[0];

  let closed = 0;
  let reminded = 0;
  for (const row of rows) {
    const age = Number(row.ageMinutes ?? 0);
    if (age >= minutes) {
      if (await closeOneOrder(Number(row.id), minutes)) closed += 1;
    } else if (age >= minutes - lead) {
      if (await remindOneOrder(Number(row.id), minutes)) reminded += 1;
    }
  }
  return { scanned: rows.length, closed, reminded };
}

/** 转账通知回执卡片内容（msgType='transfer_notice'，前端渲染为卡片） */
export type TransferNoticeCard = {
  title: string;
  text: string;
  orderNo: string;
  amount: string;
  payee: string;
  items: Array<{ partNumber: string; qty: number }>;
};

/**
 * 买家声明「我已转账」。
 *
 * 返回 declared=false 表示订单不满足声明条件（非待付款、非对公、或已声明）。
 * 同样用条件更新保证原子性：不能先查后改。
 */
export async function declareCorpTransfer(params: {
  orderId: number;
  userId: number;
  transferNote?: string;
}): Promise<{ declared: boolean; orderNo?: string }> {
  const db = await getDb();
  if (!db) return { declared: false };

  const note = (params.transferNote || "").trim().slice(0, 255) || null;

  /*
   * buyerId 条件不可省略：否则任意登录用户传入他人订单 ID
   * 即可把别人的订单标为已声明转账，使其绕过超时关单永久占用库存。
   */
  const upd = await db.execute(sql`
    UPDATE orders
       SET transferDeclaredAt = NOW(), transferNote = ${note}
     WHERE id = ${params.orderId}
       AND buyerId = ${params.userId}
       AND status = 'pending'
       AND payMethod = 'corp'
       AND transferDeclaredAt IS NULL
  `);
  const affected = Number(
    (upd as unknown as [{ affectedRows?: number }, unknown])[0]?.affectedRows ?? 0,
  );
  if (affected === 0) return { declared: false };

  const info = await db.execute(sql`
    SELECT orderNo, totalAmount, sellerId, sellerName, corpPayeeMode, payeeAccountName
      FROM orders
     WHERE id = ${params.orderId}
     LIMIT 1
  `);
  const infoRows = (info as unknown as [Array<{
    orderNo: string;
    totalAmount: string | null;
    sellerId: number;
    sellerName: string;
    corpPayeeMode: "platform_legacy" | "seller_direct";
    payeeAccountName: string | null;
  }>, unknown])[0];
  const orderInfo = infoRows[0];
  const orderNo = String(orderInfo?.orderNo ?? "");
  const amount = String(orderInfo?.totalAmount ?? "0");
  const sellerDirect = orderInfo?.corpPayeeMode === "seller_direct";

  const trackText = sellerDirect
    ? `买家已声明完成转账，等待卖家确认到账${note ? `；买家备注：${note}` : ""}`
    : `买家已声明完成转账，等待平台核销到账${note ? `；买家备注：${note}` : ""}`;
  await db.execute(sql`
    INSERT INTO order_tracks (orderId, content) VALUES (${params.orderId}, ${trackText.slice(0, 255)})
  `);

  // 站内回执：失败不影响声明结果（订单已不再受超时约束，这才是核心）
  try {
    const customerServiceId = sellerDirect ? null : await getServiceUserId();
    await sendTransferNoticeCard({
      buyerId: params.userId,
      recipientId: sellerDirect ? Number(orderInfo?.sellerId) : Number(customerServiceId),
      senderId: sellerDirect ? params.userId : Number(customerServiceId),
      orderId: params.orderId,
      orderNo,
      amount,
      title: sellerDirect ? "买家已声明完成对公转账" : "已收到您的转账通知",
      text: sellerDirect
        ? "请核对本订单收款账户的银行到账记录，确认后订单将进入待发货状态。"
        : "我们正在核实到账情况，核实完成后将尽快安排发货。如需加急可在本会话留言。",
      payee: sellerDirect
        ? String(orderInfo?.payeeAccountName || orderInfo?.sellerName || "订单卖家")
        : CORPORATE_TRANSFER_ACCOUNT.accountName,
    });
  } catch (err) {
    console.error("[corpTransfer] 回执卡片发送失败:", err);
  }

  return { declared: true, orderNo };
}

/** seller_direct 由买家通知卖家；历史订单继续由 51小电向买家发回执。 */
async function sendTransferNoticeCard(params: {
  buyerId: number;
  recipientId: number;
  senderId: number;
  orderId: number;
  orderNo: string;
  amount: string;
  title: string;
  text: string;
  payee: string;
}): Promise<void> {
  const db = await getDb();
  if (!db || !params.recipientId || params.senderId === params.recipientId) return;

  const itemsRes = await db.execute(sql`
    SELECT partNumber, qty FROM order_items WHERE orderId = ${params.orderId} LIMIT 20
  `);
  const itemRows = (itemsRes as unknown as [
    Array<{ partNumber: string; qty: number }>,
    unknown,
  ])[0];

  const card: TransferNoticeCard = {
    title: params.title,
    text: params.text,
    orderNo: params.orderNo,
    amount: params.amount,
    payee: params.payee,
    items: itemRows.map(r => ({ partNumber: String(r.partNumber), qty: Number(r.qty) })),
  };

  const u1 = Math.min(params.buyerId, params.recipientId);
  const u2 = Math.max(params.buyerId, params.recipientId);
  const existing = await db.execute(sql`
    SELECT id FROM conversations WHERE user1Id = ${u1} AND user2Id = ${u2} LIMIT 1
  `);
  const existingRows = (existing as unknown as [Array<{ id: number }>, unknown])[0];
  let conversationId: number;
  if (existingRows.length > 0) {
    conversationId = Number(existingRows[0].id);
  } else {
    await db.execute(sql`INSERT INTO conversations (user1Id, user2Id) VALUES (${u1}, ${u2})`);
    const idResult = await db.execute(sql`SELECT LAST_INSERT_ID() as id`);
    const idRows = (idResult as unknown as [Array<{ id: number }>, unknown])[0];
    conversationId = Number(idRows[0].id);
    await db.execute(sql`
      INSERT INTO conversation_user_settings (conversationId, userId) VALUES (${conversationId}, ${u1})
    `);
    await db.execute(sql`
      INSERT INTO conversation_user_settings (conversationId, userId) VALUES (${conversationId}, ${u2})
    `);
  }

  await db.execute(sql`
    INSERT INTO messages (conversationId, senderId, msgType, content)
    VALUES (${conversationId}, ${params.senderId}, 'transfer_notice', ${JSON.stringify(card)})
  `);
  const preview = `订单 ${params.orderNo} 的对公转账等待确认到账`;
  await db.execute(sql`
    UPDATE conversations SET lastMessageAt = NOW(), lastMessagePreview = ${preview}
    WHERE id = ${conversationId}
  `);
  await db.execute(sql`
    UPDATE conversation_user_settings SET unreadCount = unreadCount + 1, deleted = 0
    WHERE conversationId = ${conversationId} AND userId = ${params.recipientId}
  `);
  await db.execute(sql`
    UPDATE conversation_user_settings SET deleted = 0
    WHERE conversationId = ${conversationId} AND userId = ${params.buyerId}
  `);
}

/** 卖家原子确认对公货款到账；线上支付订单不进入本流程。 */
export async function confirmSellerCorpPayment(params: {
  orderId: number;
  sellerId: number;
  voucher?: string;
}): Promise<{ confirmed: boolean; paidAt?: Date }> {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");
  const voucher = params.voucher?.trim().slice(0, 120);

  return db.transaction(async tx => {
    const paidAt = new Date();
    const updateResult = await tx.execute(sql`
      UPDATE orders
         SET status = 'paid', paidAt = ${paidAt}
       WHERE id = ${params.orderId}
         AND sellerId = ${params.sellerId}
         AND status = 'pending'
         AND payMethod = 'corp'
    `);
    const affected = Number(
      (updateResult as unknown as [{ affectedRows?: number }, unknown])[0]?.affectedRows ?? 0,
    );
    if (affected === 0) return { confirmed: false };

    const track = voucher
      ? `卖家已确认对公转账到账（凭证：${voucher}），订单进入待发货状态`
      : "卖家已确认对公转账到账，订单进入待发货状态";
    await tx.execute(sql`
      INSERT INTO order_tracks (orderId, content)
      VALUES (${params.orderId}, ${track.slice(0, 255)})
    `);
    return { confirmed: true, paidAt };
  });
}
