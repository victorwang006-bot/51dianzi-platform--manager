/**
 * 退款通知模块：站内信 + 短信双通道。
 *
 * 设计原则：通知永远不能阻断退款主流程。
 * 退款是资金动作，一旦渠道已出款，本地状态必须落库成功；
 * 若因为一条短信发不出去就抛异常回滚，会造成"钱退了但系统不知道"的
 * 最严重的资金不一致。因此本模块所有导出函数都自行吞掉异常，
 * 只记日志，绝不向上抛。
 *
 * 短信降级：阿里云短信是模板制，每种业务通知都需单独申请模板并审核。
 * 卖家收到的退款申请与买家收到的退款成功通知语义不同，必须使用不同模板：
 * - ALIYUN_SMS_REFUND_REQUEST_TEMPLATE_CODE：退款申请，收件人为卖家；
 * - ALIYUN_SMS_REFUND_TEMPLATE_CODE：退款成功，收件人为买家。
 * 任一模板未配置时，仅该事件降级为站内信，不影响退款资金主流程。
 */
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { getServiceUserId } from "./customerService";
import { sendAliyunSms } from "./smsService";

/**
 * 发送站内信：借用客服账号向目标用户推送系统消息。
 *
 * 复用「聊一聊」的客服会话，而不是新建一套消息表——买家和卖家本来就
 * 习惯在聊一聊里看平台通知，退款进度出现在同一处，不必学习新入口。
 *
 * 会话查找与 customerService.postInquiryToChat 保持一致：
 * user1Id/user2Id 按大小排序保证唯一。
 */
async function sendSiteMessage(userId: number, text: string): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;
    const csUserId = await getServiceUserId();
    // 客服账号自己不需要收到通知，否则会话里出现自言自语
    if (userId === csUserId) return false;
    const u1 = Math.min(userId, csUserId);
    const u2 = Math.max(userId, csUserId);
    const existing = await db.execute(sql`
      SELECT id FROM conversations WHERE user1Id = ${u1} AND user2Id = ${u2} LIMIT 1
    `);
    const existingRows = (existing as unknown as [Array<{ id: number }>, unknown])[0];
    let conversationId: number;
    if (existingRows.length > 0) {
      conversationId = Number(existingRows[0].id);
    } else {
      await db.execute(sql`
        INSERT INTO conversations (user1Id, user2Id) VALUES (${u1}, ${u2})
      `);
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
    // 以客服身份发出，接收方看到的是平台通知
    await db.execute(sql`
      INSERT INTO messages (conversationId, senderId, msgType, content)
      VALUES (${conversationId}, ${csUserId}, 'text', ${text})
    `);
    const preview = text.length > 50 ? text.slice(0, 50) + "…" : text;
    await db.execute(sql`
      UPDATE conversations SET lastMessageAt = NOW(), lastMessagePreview = ${preview}
      WHERE id = ${conversationId}
    `);
    // 未读数 +1 并复活会话：买家若曾删除会话，退款通知必须让其重新可见
    await db.execute(sql`
      UPDATE conversation_user_settings SET unreadCount = unreadCount + 1, deleted = 0
      WHERE conversationId = ${conversationId} AND userId = ${userId}
    `);
    await db.execute(sql`
      UPDATE conversation_user_settings SET deleted = 0
      WHERE conversationId = ${conversationId} AND userId = ${csUserId}
    `);
    return true;
  } catch (err) {
    console.error("[refundNotify] 站内信发送失败:", err);
    return false;
  }
}

/** 卖家取消订单等非退款通知，复用同一套51小电通道。 */
export async function notifyUserBySiteMessage(userId: number, text: string): Promise<boolean> {
  return sendSiteMessage(userId, text);
}

/** 取用户手机号，用于短信通道 */
async function getUserPhone(userId: number): Promise<string | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    const res = await db.execute(sql`SELECT phone FROM users WHERE id = ${userId} LIMIT 1`);
    const rows = (res as unknown as [Array<{ phone: string | null }>, unknown])[0];
    const phone = rows[0]?.phone;
    return phone && String(phone).trim() ? String(phone).trim() : null;
  } catch {
    return null;
  }
}

export type RefundNotifyEvent =
  | "requested"
  | "agreed_return"
  | "succeeded"
  | "rejected"
  | "manual_review"
  | "pending_offline";

type RefundSmsEvent = Extract<RefundNotifyEvent, "requested" | "succeeded">;

/** 按收件人语义选择模板，禁止退款申请误用买家退款成功文案。 */
export function refundSmsTemplateCode(event: RefundSmsEvent): string {
  const key = event === "requested"
    ? "ALIYUN_SMS_REFUND_REQUEST_TEMPLATE_CODE"
    : "ALIYUN_SMS_REFUND_TEMPLATE_CODE";
  return (process.env[key] || "").trim();
}

export function isRefundSmsConfigured(event: RefundSmsEvent): boolean {
  return Boolean(
    refundSmsTemplateCode(event) &&
      process.env.ALIYUN_SMS_ACCESS_KEY_ID &&
      process.env.ALIYUN_SMS_ACCESS_KEY_SECRET &&
      process.env.ALIYUN_SMS_SIGN_NAME,
  );
}

type NotifyContext = {
  orderNo: string;
  refundNo: string;
  amount: string;
  reason?: string;
  rejectReason?: string;
  shippingDeducted?: boolean;
};

/**
 * 通知文案。
 *
 * 已发货扣运费时必须在文案里说清扣除原因和金额，否则买家看到
 * 到账金额少于订单金额会直接判定平台乱扣钱，产生客诉。
 */
function buildMessage(event: RefundNotifyEvent, ctx: NotifyContext): { text: string; sms: boolean } {
  switch (event) {
    case "requested":
      return {
        // 24 小时未处理将自动退款，直接影响卖家资金，必须短信触达
        text:
          `【退款申请】订单 ${ctx.orderNo} 的买家申请退款 ¥${ctx.amount}` +
          `${ctx.reason ? `，原因：${ctx.reason}` : ""}。` +
          `请在 24 小时内处理，逾期系统将自动退款。可在订单中点击"通过售后"提前放款。`,
        sms: true,
      };
    case "agreed_return":
      return {
        text:
          `【退货通知】订单 ${ctx.orderNo} 的退款申请（${ctx.refundNo}）卖家已同意退货，` +
          `请尽快将商品寄回并在订单中填写退货运单号。卖家确认收货后将为您办理退款。`,
        sms: false,
      };
    case "succeeded":
      return {
        // 资金已到账，必须短信告知
        text:
          `【退款成功】订单 ${ctx.orderNo} 的退款 ¥${ctx.amount} 已提交至原支付渠道` +
          `${ctx.shippingDeducted ? "（商品已发货，运费不予退还，仅退货款及税额）" : ""}，` +
          `预计 1-3 个工作日到账，请留意原支付账户。`,
        sms: true,
      };
    case "rejected":
      return {
        text:
          `【退款未通过】订单 ${ctx.orderNo} 的退款申请未通过` +
          `${ctx.rejectReason ? `，卖家说明：${ctx.rejectReason}` : ""}。` +
          `如有疑问可在本会话联系客服协助处理。`,
        sms: false,
      };
    case "pending_offline":
      return {
        text:
          `【退款处理中】订单 ${ctx.orderNo} 的退款 ¥${ctx.amount} 已审核通过。` +
          // 对外统一口径为 1-3 个工作日，与微信/支付宝一致：
          // 一是避免买家因支付方式不同看到不同承诺而困惑；
          // 二是给财务留缓冲（周末、对账延迟），承诺宽于实际才不会失信。
          // 内部卡单告警仍用 24 小时阈值，与对外口径分离。
          `因该订单为对公转账支付，需财务人工打款，预计 1-3 个工作日内完成，请留意收款账户。`,
        sms: false,
      };
    case "manual_review":
      return {
        text:
          `【退款处理中】订单 ${ctx.orderNo} 的退款 ¥${ctx.amount} 正在人工核实中，` +
          `客服将尽快与您联系。如需加急可在本会话留言。`,
        sms: false,
      };
  }
}

/**
 * 发送退款通知。
 *
 * 返回各通道结果仅用于日志与测试断言，调用方无需处理失败——
 * 本函数保证不抛异常。
 */
export async function notifyRefund(params: {
  userId: number;
  event: RefundNotifyEvent;
  ctx: NotifyContext;
}): Promise<{ site: boolean; sms: boolean; smsSkipped?: string }> {
  const { text, sms: needSms } = buildMessage(params.event, params.ctx);
  const site = await sendSiteMessage(params.userId, text);

  if (!needSms) return { site, sms: false };
  // buildMessage 只对这两个事件返回 sms=true；保留显式收窄，避免未来新增
  // 短信事件时意外复用错误模板。
  if (params.event !== "requested" && params.event !== "succeeded") {
    return { site, sms: false, smsSkipped: "NO_EVENT_TEMPLATE" };
  }
  const templateCode = refundSmsTemplateCode(params.event);
  if (!isRefundSmsConfigured(params.event)) {
    // 降级路径：模板未申请时不重复刷日志噪音，只标记原因
    return { site, sms: false, smsSkipped: "NO_TEMPLATE" };
  }
  try {
    const phone = await getUserPhone(params.userId);
    if (!phone) return { site, sms: false, smsSkipped: "NO_PHONE" };
    const res = await sendAliyunSms(
      phone,
      {
        orderNo: params.ctx.orderNo,
        amount: params.ctx.amount,
      },
      { templateCode },
    );
    if (!res.ok) {
      console.error(`[refundNotify] 短信发送失败 ${res.code}: ${res.message}`);
    }
    return { site, sms: res.ok };
  } catch (err) {
    console.error("[refundNotify] 短信通道异常:", err);
    return { site, sms: false };
  }
}
