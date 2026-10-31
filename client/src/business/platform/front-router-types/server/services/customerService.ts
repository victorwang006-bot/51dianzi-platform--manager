import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { filterSelectableErpSalesStaff } from "./erpSalesStaffPolicy";
import type { HkRegistrationData, HkDocumentKind } from "../../../shared/hongKongRegistration";

/**
 * 平台客服服务：
 * 1. 维护"平台客服"系统用户（懒创建，username=service_51dianzi）
 * 2. 用户发给客服的消息同步到后台控制台"消息"模块（message.submitMessage，x-portal-key 鉴权）
 * 3. 拉取后台客服回复（message.getMessages）合并写入前台聊一聊会话
 */

const CS_USERNAME = "service_51dianzi";
const CS_NAME = "51小电";

/** 客服主动问候卡片内容（msgType=greeting，前端渲染为卡片） */
export const CS_GREETING_CARD = JSON.stringify({
  title: "您好，我是51小电",
  text: "很高兴为您服务！我可以帮您处理型号询价、订单跟进、ERP开通、平台使用等问题，请直接留言，采购顾问会尽快回复您。",
  tips: ["型号询价 / 报价", "订单与交期跟进", "ERP 开通协助", "平台使用答疑"],
});

/** 新用户主动欢迎使用纯文本，确保尚未升级的小程序也不会显示 greeting JSON。 */
export const NEW_USER_WELCOME_TEXT =
  "欢迎加入51电子网，我是51小电。您好，欢迎加入51电子网！您可以在这里搜索现货、查询参考价、寻找替代型号，也可以把型号、品牌和需求数量直接发给我。需要询价、订单跟进、ERP开通或平台使用帮助时，随时留言，我会尽快协助您。";

const ADMIN_API_BASE = (process.env.ADMIN_API_BASE || "https://51dianzi.com/admin").replace(/\/+$/, "");
const PORTAL_API_KEY = process.env.PORTAL_API_KEY || "";

/**
 * 邮箱格式校验（与后台审核系统的 zod `.email()` 规则对齐）。
 *
 * **为什么不能只判断 `includes("@")`**：
 * 后台对 contactEmail 走严格邮箱校验，收到 `a@b,com`、`a@`、`@b.com`
 * 这类字符串会直接返回 400 BAD_REQUEST，导致整个 ERP 开通申请失败，
 * 而前台只能把 `Admin message API error: 400 Bad Request` 原样弹给用户 ——
 * 用户和客服都无从判断是哪个字段出错。
 *
 * 线上真实案例：某用户注册时把 `qq.com` 打成 `qq,com`（逗号），
 * 因含 `@` 通过了旧的宽松判断，被原样上报后台，ERP 开通连续失败 8 次。
 *
 * 因此这里改为：**格式不合法就视为"没填"**（后台允许省略该字段），
 * 宁可少传一个可选的联系邮箱，也不能让整个申请卡死。
 */
const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

function normalizeEmail(email?: string | null): string | undefined {
  const trimmed = (email ?? "").trim();
  return EMAIL_PATTERN.test(trimmed) ? trimmed : undefined;
}

let cachedCsUserId: number | null = null;

/** 获取（或懒创建）平台客服用户 ID */
export async function getServiceUserId(): Promise<number> {
  if (cachedCsUserId) return cachedCsUserId;
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  const found = await db.execute(sql`
    SELECT id, name FROM users WHERE username = ${CS_USERNAME} LIMIT 1
  `);
  const rows = (found as unknown as [Array<{ id: number; name: string | null }>, unknown])[0];
  if (rows.length > 0) {
    cachedCsUserId = rows[0].id;
    // 幂等改名：历史"平台客服"用户统一更新为新名称
    if (rows[0].name !== CS_NAME) {
      await db.execute(sql`UPDATE users SET name = ${CS_NAME} WHERE id = ${rows[0].id}`);
    }
    return cachedCsUserId;
  }
  await db.execute(sql`
    INSERT INTO users (openId, username, name, role, loginMethod)
    VALUES (${"local:" + CS_USERNAME}, ${CS_USERNAME}, ${CS_NAME}, 'user', 'system')
  `);
  const idResult = await db.execute(sql`SELECT LAST_INSERT_ID() as id`);
  const idRows = (idResult as unknown as [Array<{ id: number }>, unknown])[0];
  cachedCsUserId = Number(idRows[0].id);
  return cachedCsUserId;
}

/** 判断会话是否是客服会话（对方为客服用户） */
export async function isServiceConversation(
  conv: { user1Id: number; user2Id: number },
): Promise<{ isService: boolean; csUserId: number }> {
  const csUserId = await getServiceUserId();
  return {
    isService: conv.user1Id === csUserId || conv.user2Id === csUserId,
    csUserId,
  };
}

/**
 * 确保客服会话存在问候消息：会话内没有任何消息时，以客服身份插入一条
 * msgType='greeting' 的问候卡片（幂等，不影响已有会话）。
 */
export async function ensureGreetingMessage(conversationId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    const csUserId = await getServiceUserId();
    const countResult = await db.execute(sql`
      SELECT COUNT(*) as cnt FROM messages WHERE conversationId = ${conversationId}
    `);
    const cntRows = (countResult as unknown as [Array<{ cnt: number }>, unknown])[0];
    if (Number(cntRows[0]?.cnt ?? 0) > 0) return;
    await db.execute(sql`
      INSERT INTO messages (conversationId, senderId, msgType, content)
      VALUES (${conversationId}, ${csUserId}, 'greeting', ${CS_GREETING_CARD})
    `);
    const preview = "您好，我是51小电，很高兴为您服务！";
    await db.execute(sql`
      UPDATE conversations SET lastMessageAt = NOW(), lastMessagePreview = ${preview}
      WHERE id = ${conversationId}
    `);
  } catch (err) {
    console.error("[customerService] 插入问候消息失败:", err);
  }
}

/**
 * 为真正的新用户创建一条主动欢迎消息。
 *
 * 锁住用户行，并以 `welcome-v1-user-<id>` 作为消息幂等键；注册重试、
 * 微信 bindPhone 重试以及登录补偿都只能产生一条。失败不能回滚建号。
 */
export async function ensureNewUserWelcome(userId: number): Promise<{
  sent: boolean;
  conversationId: number | null;
}> {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  const csUserId = await getServiceUserId();
  if (userId === csUserId) return { sent: false, conversationId: null };

  return db.transaction(async tx => {
    const userResult = await tx.execute(sql`
      SELECT id, welcomeMessageSentAt FROM users WHERE id = ${userId} LIMIT 1 FOR UPDATE
    `);
    const userRows = (userResult as unknown as [
      Array<{ id: number; welcomeMessageSentAt: Date | null }>,
      unknown,
    ])[0];
    const user = userRows[0];
    if (!user) throw new Error("欢迎消息目标用户不存在");
    if (user.welcomeMessageSentAt) return { sent: false, conversationId: null };

    const u1 = Math.min(userId, csUserId);
    const u2 = Math.max(userId, csUserId);
    await tx.execute(sql`
      INSERT INTO conversations (user1Id, user2Id)
      VALUES (${u1}, ${u2})
      ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), updatedAt = updatedAt
    `);
    const conversationResult = await tx.execute(sql`SELECT LAST_INSERT_ID() AS id`);
    const conversationRows = (conversationResult as unknown as [Array<{ id: number }>, unknown])[0];
    let conversationId = Number(conversationRows[0]?.id ?? 0);
    if (!conversationId) {
      const existingResult = await tx.execute(sql`
        SELECT id FROM conversations WHERE user1Id = ${u1} AND user2Id = ${u2} LIMIT 1
      `);
      const existingRows = (existingResult as unknown as [Array<{ id: number }>, unknown])[0];
      conversationId = Number(existingRows[0]?.id ?? 0);
    }
    if (!conversationId) throw new Error("欢迎会话创建失败");

    await tx.execute(sql`
      INSERT INTO conversation_user_settings (conversationId, userId)
      VALUES (${conversationId}, ${userId})
      ON DUPLICATE KEY UPDATE deleted = 0
    `);
    await tx.execute(sql`
      INSERT INTO conversation_user_settings (conversationId, userId)
      VALUES (${conversationId}, ${csUserId})
      ON DUPLICATE KEY UPDATE deleted = 0
    `);

    const clientMessageId = `welcome-v1-user-${userId}`;
    await tx.execute(sql`
      INSERT IGNORE INTO messages (conversationId, senderId, clientMessageId, msgType, content)
      VALUES (${conversationId}, ${csUserId}, ${clientMessageId}, 'text', ${NEW_USER_WELCOME_TEXT})
    `);
    const messageResult = await tx.execute(sql`
      SELECT id FROM messages
       WHERE senderId = ${csUserId} AND clientMessageId = ${clientMessageId}
       LIMIT 1
    `);
    const messageRows = (messageResult as unknown as [Array<{ id: number }>, unknown])[0];
    const messageId = Number(messageRows[0]?.id ?? 0);
    if (!messageId) throw new Error("欢迎消息写入失败");

    const preview = NEW_USER_WELCOME_TEXT.length > 50
      ? NEW_USER_WELCOME_TEXT.slice(0, 50) + "…"
      : NEW_USER_WELCOME_TEXT;
    await tx.execute(sql`
      UPDATE conversations
         SET lastMessageAt = NOW(), lastMessagePreview = ${preview}, updatedAt = NOW()
       WHERE id = ${conversationId}
    `);
    await tx.execute(sql`
      UPDATE conversation_user_settings
         SET unreadCount = CASE
               WHEN COALESCE(lastReadMessageId, 0) >= ${messageId} THEN 0
               ELSE GREATEST(unreadCount, 1)
             END,
             deleted = 0,
             updatedAt = NOW()
       WHERE conversationId = ${conversationId} AND userId = ${userId}
    `);
    await tx.execute(sql`UPDATE users SET welcomeMessageSentAt = NOW() WHERE id = ${userId}`);
    return { sent: true, conversationId };
  });
}

/** 登录时的轻量补偿入口；已发送或存量用户只读一行后立即返回。 */
export async function compensatePendingNewUserWelcome(userId: number): Promise<void> {
  try {
    await ensureNewUserWelcome(userId);
  } catch (error) {
    console.error("[customerService] 新用户欢迎消息补偿失败:", error);
  }
}

// ── 后台消息模块对接（x-portal-key 鉴权）──

/**
 * 管理端接口错误，保留 HTTP 状态码。
 *
 * 客服同步需要区分 404（后台会话已被删除，应重建）与其他错误（应重试），
 * 因此不能只抛普通 Error。
 */
export class AdminMessageApiError extends Error {
  readonly status: number;

  constructor(status: number, statusText: string, detail?: string) {
    /*
     * 错误文案会一路冒泡到前台弹窗，故优先展示可读的中文诊断。
     * 旧版只抛 `Admin message API error: 400 Bad Request`，
     * 线上曾因此导致用户邮箱写错一个字符（qq,com）而反复提交失败 8 次，
     * 用户与客服均无从定位。
     */
    super(detail || `Admin message API error: ${status} ${statusText}`);
    this.status = status;
    this.name = "AdminMessageApiError";
  }
}

/**
 * 后台字段名 → 用户看得懂的中文名称 + 该在哪里修改。
 *
 * `where` 必须指向用户真实能找到的入口：
 * 邮箱/手机号属于账号资料（个人中心），
 * 其余字段属于开通 ERP 的表单本身。
 */
const ADMIN_FIELD_LABELS: Record<string, { label: string; where: string }> = {
  contactEmail: { label: "邮箱", where: "个人中心 → 账号资料" },
  contactPhone: { label: "手机号", where: "个人中心 → 账号资料" },
  contactName: { label: "联系人姓名", where: "个人中心 → 账号资料" },
  companyName: { label: "公司名称", where: "本页表单" },
  creditCode: { label: "统一社会信用代码", where: "本页表单" },
  businessLicense: { label: "营业执照号", where: "本页表单" },
  legalPersonName: { label: "法定代表人", where: "本页表单" },
  registeredAddress: { label: "注册地址", where: "本页表单" },
  settlementAccountName: { label: "开户名称", where: "本页表单的银行信息" },
  settlementAccount: { label: "银行账号", where: "本页表单的银行信息" },
  settlementBank: { label: "开户银行", where: "本页表单的银行信息" },
  companyType: { label: "企业类型", where: "本页表单" },
  companyRole: { label: "企业角色", where: "本页表单" },
};

/** 把一条 zod 校验错误翻译成「哪个字段 + 错在哪」的中文描述 */
function describeIssue(issue: { path?: unknown[]; message?: string; code?: string }): {
  text: string;
  where: string;
} {
  const field = String(issue.path?.[0] ?? "");
  const known = ADMIN_FIELD_LABELS[field];
  const label = known?.label || field || "某项资料";
  const where = known?.where || "本页表单";
  const raw = String(issue.message ?? "");

  let reason: string;
  if (/email/i.test(raw)) {
    reason = "格式不对（正确格式如 name@example.com，请检查是否把小数点打成了逗号、或漏了字符）";
  } else if (/required|undefined|received nothing|invalid_type/i.test(raw)) {
    reason = "没有填写";
  } else if (/too_small|at least|min/i.test(raw)) {
    reason = "内容太短";
  } else if (/too_big|at most|max/i.test(raw)) {
    reason = "内容太长";
  } else {
    reason = "填写格式不对";
  }
  return { text: `${label}${reason}`, where };
}

/**
 * 从后台 tRPC 错误响应中提炼可读诊断。
 *
 * 后台参数校验失败时，message 是一段 zod 错误的 JSON 字符串，
 * 形如 `[{"path":["contactEmail"],"message":"Invalid email address"}]`。
 * 这里把它解成「联系邮箱格式不正确」这类人话。
 */
function describeAdminError(rawBody: string, status: number): string | undefined {
  try {
    const parsed = JSON.parse(rawBody);
    const entry = Array.isArray(parsed) ? parsed[0] : parsed?.["0"] ?? parsed;
    const message: unknown = entry?.error?.json?.message ?? entry?.error?.message;
    if (typeof message !== "string") return undefined;

    // zod 校验失败：message 本身又是一段 JSON
    try {
      const issues = JSON.parse(message);
      if (Array.isArray(issues) && issues.length > 0) {
        const described = issues.map(describeIssue);
        const problems = described.map((d) => d.text).join("；");
        // 多个字段出错时可能分属不同页面，去重后全部告知
        const places = Array.from(new Set(described.map((d) => d.where))).join("、");
        return `提交失败：${problems}。请到「${places}」修改后重新提交。`;
      }
    } catch {
      // message 不是 JSON，当普通文案处理
    }
    return `提交失败：${message}`;
  } catch {
    return status === 400
      ? "提交失败：资料格式有误，请检查公司名称、信用代码、邮箱、手机号等是否填写正确。"
      : undefined;
  }
}

async function adminMessageApi<T>(
  procedure: string,
  input: Record<string, unknown>,
  method: "query" | "mutation",
): Promise<T> {
  if (!PORTAL_API_KEY) throw new Error("PORTAL_API_KEY 未配置，无法同步后台消息");
  const headers = {
    "Content-Type": "application/json",
    "x-portal-key": PORTAL_API_KEY,
  };
  let res: Response;
  if (method === "query") {
    const encodedInput = encodeURIComponent(JSON.stringify({ "0": { json: input } }));
    res = await fetch(
      `${ADMIN_API_BASE}/api/trpc/${procedure}?batch=1&input=${encodedInput}`,
      { headers, signal: AbortSignal.timeout(8000) },
    );
  } else {
    res = await fetch(`${ADMIN_API_BASE}/api/trpc/${procedure}?batch=1`, {
      method: "POST",
      headers,
      body: JSON.stringify({ "0": { json: input } }),
      signal: AbortSignal.timeout(8000),
    });
  }
  if (!res.ok) {
    // 先把响应体读成文本，从中提炼具体是哪个字段不合法，便于用户自行修正
    const rawBody = await res.text().catch(() => "");
    const detail = describeAdminError(rawBody, res.status);
    console.error("[customerService] 后台接口错误", {
      procedure,
      status: res.status,
      body: rawBody.slice(0, 500),
    });
    throw new AdminMessageApiError(res.status, res.statusText, detail);
  }
  const body = (await res.json()) as Array<{ result: { data: { json: T } } }>;
  return body[0].result.data.json;
}

type SubmitMessageResult = { threadNo: string };
export type AdminOnboardingLeadResult = {
  status: "created" | "deduplicated" | "already_enabled";
  threadNo: string | null;
  threadId: number | null;
  messageId: number | null;
};
export type AdminCrmStatus = "none" | "pending" | "enabled" | "disabled" | "rejected";
export type AdminCrmApplicationResult = {
  accepted: boolean;
  created: boolean;
  code: string;
  crmStatus: AdminCrmStatus;
  message?: string | null;
  merchantId?: number;
  merchantNo?: string;
};
export type AdminCrmAccessResult = {
  allowed: boolean;
  code: string;
  crmStatus: AdminCrmStatus;
  message?: string | null;
  merchantNo?: string;
  crmThreadNo?: string | null;
};
export type AdminCrmBindingResult = {
  found: boolean;
  creditCode: string;
  crmStatus: AdminCrmStatus;
  crmOwnerPortalUserId: string | null;
  merchantId?: number;
  merchantNo?: string;
  companyName?: string;
};
export type AdminCrmOwnerRebindResult = {
  success: boolean;
  idempotent?: boolean;
  enterpriseId?: number;
  superAdminUserId?: number;
  [key: string]: unknown;
};
type PortalThreadMessages = {
  threadNo: string;
  subject: string | null;
  status: string;
  messages: Array<{
    id: number;
    senderType: "portal" | "admin";
    senderName: string | null;
    content: string;
    createdAt: string | Date;
  }>;
};

/**
 * 用户发给客服的消息 → 同步到后台"消息"模块。
 * 首次同步会创建后台会话并把 threadNo 写回 conversations.adminThreadNo。
 * 同步失败不阻塞前台聊天（记录日志）。
 */
export async function syncMessageToAdmin(params: {
  conversationId: number;
  content: string;
  user: { id: number; name?: string | null; phone?: string | null; email?: string | null };
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    const convResult = await db.execute(sql`
      SELECT adminThreadNo FROM conversations WHERE id = ${params.conversationId} LIMIT 1
    `);
    const convRows = (convResult as unknown as [Array<{ adminThreadNo: string | null }>, unknown])[0];
    const existingThreadNo = convRows[0]?.adminThreadNo ?? null;

    const result = await adminMessageApi<SubmitMessageResult>(
      "portal.submitMessage",
      {
        threadNo: existingThreadNo,
        subject: existingThreadNo ? undefined : `在线客服咨询 - ${params.user.name || `用户#${params.user.id}`}`,
        contactName: params.user.name || `用户#${params.user.id}`,
        contactPhone: params.user.phone || undefined,
        contactEmail: params.user.email || undefined,
        portalUserId: String(params.user.id),
        content: params.content,
      },
      "mutation",
    );
    if (!existingThreadNo && result?.threadNo) {
      await db.execute(sql`
        UPDATE conversations SET adminThreadNo = ${result.threadNo}
        WHERE id = ${params.conversationId}
      `);
    }
  } catch (err) {
    console.error("[customerService] 同步消息到后台失败:", err);
  }
}

/** 后台启用的销售人员条目；只含展示必需字段，不暴露后台账号。 */
export type AdminSalesStaff = {
  staffCode: string;
  displayName: string;
};

/**
 * 拉取后台启用的销售负责人列表。
 *
 * 前端绝不能硬编码员工姓名：人员变动后就会指向已离职同事，
 * 且自由文本输入无法与后台真实销售建立对应关系。
 * 失败时向上抛出，由调用方决定是否降级（保存环节必须阻断）。
 */
export async function listAdminSalesStaff(): Promise<AdminSalesStaff[]> {
  const staff = await adminMessageApi<AdminSalesStaff[]>("portal.listSalesStaff", {}, "query");
  return filterSelectableErpSalesStaff(staff);
}

/**
 * 快速询价：把询价单以独立会话形式提交到后台"消息"模块。
 * 与客服聊天会话独立（每次询价新建一个 thread），返回后台单号。
 */
export async function submitAdminComplaint(params: {
  reportId: number;
  reason: "fraud" | "harassment" | "false_inventory" | "illegal" | "other";
  detail?: string | null;
  conversationId: number;
  reporter: { userId: number; name: string; phone?: string | null; wechatId?: string | null; companyName?: string | null };
  reported: { userId: number; name: string; phone?: string | null; wechatId?: string | null; companyName?: string | null };
}): Promise<{ threadNo: string }> {
  const result = await adminMessageApi<SubmitMessageResult>(
    "portal.submitComplaint",
    params,
    "mutation",
  );
  if (!result?.threadNo) throw new Error("后台未返回举报投诉线程编号");
  return { threadNo: result.threadNo };
}

export async function submitAdminInquiry(params: {
  content: string;
  subject: string;
  /** 后台会话类型；默认 inquiry，使询价单与普通留言分开归类 */
  threadType?: string;
  user: { id: number; name?: string | null; phone?: string | null; email?: string | null };
}): Promise<{ threadNo: string } | null> {
  try {
    const result = await adminMessageApi<SubmitMessageResult>(
      "portal.submitMessage",
      {
        threadNo: null,
        subject: params.subject,
        contactName: params.user.name || `用户#${params.user.id}`,
        contactPhone: params.user.phone || undefined,
        contactEmail: params.user.email || undefined,
        portalUserId: String(params.user.id),
        threadType: params.threadType ?? "inquiry",
        content: params.content,
      },
      "mutation",
    );
    return result?.threadNo ? { threadNo: result.threadNo } : null;
  } catch (err) {
    console.error("[customerService] 快速询价同步后台失败:", err);
    return null;
  }
}

/**
 * CRM开通/企业资料提交 → 同步到后台"消息"模块（subject 前缀"企业开通申请 - "），
 * 失败不阻塞主流程，返回后台单号（失败返回 null）。
 * 注意（2026-07-29 用户规则调整）：CRM开通申请只进后台"商户管理"（见 submitAdminMerchant），
 * 本函数已不再被 company.save 调用，保留以备后续需要。后台"消息"模块只接收"联系客服"类消息。
 */
export async function submitAdminCompanyApplication(params: {
  company: {
    companyName: string;
    creditCode?: string | null;
    companyType?: string | null;
    legalPerson?: string | null;
    companyRole?: string | null;
    regAddress?: string | null;
    salesOwner?: string | null;
    licenseUrl?: string | null;
  };
  user: { id: number; name?: string | null; phone?: string | null; email?: string | null };
}): Promise<{ threadNo: string } | null> {
  const c = params.company;
  const lines = [
    `企业名称：${c.companyName}`,
    `统一社会信用代码：${c.creditCode || "未填写"}`,
    `企业类型：${c.companyType || "未填写"}`,
    `法定代表人：${c.legalPerson || "未填写"}`,
    `企业角色：${c.companyRole || "未填写"}`,
    `注册地址：${c.regAddress || "未填写"}`,
    `销售负责人：${c.salesOwner || "未填写"}`,
    `营业执照：${c.licenseUrl || "未上传"}`,
    `提交用户：${params.user.name || `用户#${params.user.id}`}（ID: ${params.user.id}）`,
  ];
  return submitAdminInquiry({
    subject: `企业开通申请 - ${c.companyName}`,
    content: lines.join("\n"),
    user: params.user,
  });
}

/**
 * 啄木鸟检测合作专题咨询。
 *
 * 后台使用独立 threadType，便于渠道经理单独筛选、统计和跟进；它与 ERP
 * 开通消息完全分离，因此已开通 ERP 的用户同样可以提交检测咨询。
 */
export async function submitAdminZhuomuniaoCooperationLead(params: {
  clientMessageId: string;
  portalUserId: number;
  contactName: string;
  contactPhone?: string | null;
  contactEmail?: string | null;
  companyProfile?: {
    companyName?: string | null;
    creditCode?: string | null;
    companyType?: string | null;
    legalPerson?: string | null;
    companyRole?: string | null;
    regAddress?: string | null;
    certLevel?: string | null;
  } | null;
  content: string;
}): Promise<{ threadNo: string; deduplicated: boolean }> {
  const result = await adminMessageApi<SubmitMessageResult & { deduplicated?: boolean }>(
    "portal.submitMessage",
    {
      threadNo: null,
      clientMessageId: params.clientMessageId,
      subject: `啄木鸟检测合作咨询 - ${params.contactName}`,
      contactName: params.contactName,
      contactPhone: params.contactPhone ?? undefined,
      contactEmail: normalizeEmail(params.contactEmail),
      portalUserId: String(params.portalUserId),
      threadType: "zhuomuniao_cooperation",
      companyProfile: params.companyProfile ?? null,
      content: params.content,
    },
    "mutation",
  );
  if (!result?.threadNo) throw new Error("后台未返回啄木鸟检测合作咨询编号");
  return { threadNo: result.threadNo, deduplicated: Boolean(result.deduplicated) };
}

/**
 * 企业申请 → 同步写入后台"商户管理"列表（portal.submitMerchant，x-portal-key 鉴权）。
 * 后台 merchants 表要求 contactEmail/businessLicense 必填，缺失时用占位值兜底。
 * 失败不阻塞主流程（记录日志），返回后台商户编号（失败返回 null）。
 */
export async function submitAdminMerchant(params: {
  company: {
    companyName: string;
    creditCode?: string | null;
    legalPerson?: string | null;
    regAddress?: string | null;
    salesOwner?: string | null;
    licenseUrl?: string | null;
  };
  user: { id: number; name?: string | null; phone?: string | null; email?: string | null };
}): Promise<{ merchantNo: string } | null> {
  const c = params.company;
  try {
    // 联系人姓名：优先"销售负责人"客户填写的对接人不适用，联系人应为提交用户本人
    const contactName = params.user.name || `用户#${params.user.id}`;
    const licenseImageUrl =
      c.licenseUrl && /^https?:\/\//.test(c.licenseUrl) ? c.licenseUrl : undefined;
    const result = await adminMessageApi<{ merchantNo?: string; id?: number }>(
      "portal.submitMerchant",
      {
        companyName: c.companyName,
        contactName,
        contactPhone: params.user.phone || "00000",
        // 该接口 contactEmail 必填，故非法格式回退为平台占位邮箱（不能原样透传脏数据）
        contactEmail: normalizeEmail(params.user.email) ?? `user${params.user.id}@51dianzi.com`,
        businessLicense: c.creditCode || `UNKNOWN-${params.user.id}`,
        licenseImageUrl,
        registeredAddress: c.regAddress || undefined,
        legalPersonName: c.legalPerson || undefined,
        salesOwner: c.salesOwner || undefined,
      },
      "mutation",
    );
    return result?.merchantNo ? { merchantNo: result.merchantNo } : null;
  } catch (err) {
    console.error("[customerService] 企业申请同步后台商户管理失败:", err);
    return null;
  }
}

/**
 * CRM 开通申请的权威入口：建立前台账号与后台商户的唯一绑定，并返回后台审核状态。
 * 与旧 portal.submitMerchant 不同，本接口会携带 portalUserId，不能异步吞掉失败。
 * 跨仓发布必须先部署后台的 licenseObjectKey 字段与接口，再部署本主站协议版本。
 */
export async function submitAdminCrmApplication(params: {
  company: {
    companyName: string;
    creditCode: string;
    companyType: string;
    legalPerson: string;
    companyRole: string;
    regAddress: string;
    bankAccountName: string;
    bankAccountNumber: string;
    bankName: string;
    salesOwner?: string | null;
    /**
     * 销售负责人工号，必须一并上报。
     * 后台以工号（而非姓名）作为商户归属的唯一依据与数据可见范围过滤键，
     * 只传姓名会导致 merchants.salesOwnerCode 为空，销售在后台看不到名下客户。
     */
    salesOwnerCode?: string | null;
    licenseObjectKey?: string | null;
    licenseUrl?: string | null;
    /** 与前台版本化接受记录一致的协议凭据，供后台维护审核摘要状态。 */
    agreementAccepted: true;
    agreementVersion: string;
    agreementHash: string;
  };
  user: { id: number; name?: string | null; phone?: string | null; email?: string | null };
}): Promise<AdminCrmApplicationResult> {
  const c = params.company;
  const licenseObjectKey = c.licenseObjectKey?.trim() || undefined;
  const licenseImageUrl = !licenseObjectKey && c.licenseUrl && /^https?:\/\//.test(c.licenseUrl)
    ? c.licenseUrl
    : undefined;
  const result = await adminMessageApi<AdminCrmApplicationResult>(
    "portal.submitCrmApplication",
    {
      companyName: c.companyName,
      creditCode: c.creditCode,
      companyType: c.companyType,
      companyRole: c.companyRole,
      contactName: params.user.name || `用户#${params.user.id}`,
      contactPhone: params.user.phone || undefined,
      // 可选字段：格式不合法直接省略，避免后台严格校验返回 400 卡死整个申请
      contactEmail: normalizeEmail(params.user.email),
      legalPersonName: c.legalPerson,
      registeredAddress: c.regAddress,
      settlementAccountName: c.bankAccountName,
      settlementAccount: c.bankAccountNumber,
      settlementBank: c.bankName,
      licenseObjectKey,
      licenseImageUrl,
      portalUserId: String(params.user.id),
      // 工号是归属关系的唯一可靠依据；姓名仅供后台展示与旧客户端兼容。
      salesOwner: c.salesOwner || undefined,
      salesOwnerCode: c.salesOwnerCode || undefined,
      note: c.salesOwner ? `平台销售负责人：${c.salesOwner}` : undefined,
      agreementAccepted: c.agreementAccepted,
      agreementVersion: c.agreementVersion,
      agreementHash: c.agreementHash,
    },
    "mutation",
  );

  const acknowledged = result.accepted
    || result.code === "CRM_APPLICATION_PENDING"
    || result.code === "CRM_ALREADY_ENABLED";
  if (!acknowledged) {
    throw new Error(result.message || "后台未接受 ERP 开通申请，请联系平台客服");
  }
  return result;
}

/** 当前登录账号按统一社会信用代码读取后台权威 CRM 状态。 */
export async function getAdminCrmAccess(params: {
  creditCode: string;
  portalUserId: number;
}): Promise<AdminCrmAccessResult> {
  return adminMessageApi<AdminCrmAccessResult>(
    "portal.getCrmAccess",
    {
      creditCode: params.creditCode,
      portalUserId: String(params.portalUserId),
    },
    "query",
  );
}

/**
 * 首页免费入驻线索的权威入口。后台在同一事务内判断 ERP 是否已开通并创建
 * threadType=onboarding 的“开通消息”，避免先查状态再发消息的跨系统竞态。
 */
export async function submitAdminOnboardingLead(params: {
  clientMessageId: string;
  portalUserId: number;
  crmPortalUserId: number;
  contactName: string;
  contactPhone?: string | null;
  contactEmail?: string | null;
  companyProfile?: {
    companyName?: string | null;
    creditCode?: string | null;
    companyType?: string | null;
    legalPerson?: string | null;
    companyRole?: string | null;
    regAddress?: string | null;
    certLevel?: string | null;
  } | null;
  content: string;
}): Promise<AdminOnboardingLeadResult> {
  return adminMessageApi<AdminOnboardingLeadResult>(
    "portal.submitOnboardingLead",
    {
      ...params,
      portalUserId: String(params.portalUserId),
      crmPortalUserId: String(params.crmPortalUserId),
      contactEmail: normalizeEmail(params.contactEmail),
    },
    "mutation",
  );
}

/** 服务端读取后台权威 CRM owner，用于专用换绑后的企业角色对账；不得直接透传给浏览器。 */
export async function getAdminCrmBinding(creditCode: string): Promise<AdminCrmBindingResult> {
  return adminMessageApi<AdminCrmBindingResult>(
    "portal.getCrmBinding",
    { creditCode },
    "query",
  );
}

/** 独立香港协议；不得把8位BRN或HK:身份写入旧creditCode参数。 */
export function getAdminHkRegistrationCapabilities() {
  return adminMessageApi<{ version: number; enabled: boolean }>("portal.hkRegistrationCapabilities", {}, "query");
}

export async function submitAdminHkCrmApplication(input: {
  registrationIdentifier: string;
  submissionId: string;
  payloadHash: string;
  registrationData: HkRegistrationData;
  documents: Record<"BR" | "BANK", { objectKey: string; fileName: string }> & Partial<Record<"CI", { objectKey: string; fileName: string }>>;
  documentVerification: Record<string, { documentId: string; ocrStatus: string; recognizedType: string | null; classification: string }>;
  portalUserId: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  salesOwner?: string;
  salesOwnerCode?: string;
  agreementAccepted: true;
  agreementVersion: string;
  agreementHash: string;
}): Promise<AdminCrmApplicationResult> {
  const result = await adminMessageApi<AdminCrmApplicationResult>("portal.submitHkCrmApplication", {
    ...input, contactEmail: normalizeEmail(input.contactEmail),
  }, "mutation");
  if (!result.accepted) {
    throw new Error(result.message || "后台未接受香港企业申请");
  }
  return result;
}

export function getAdminHkCrmAccess(input: { registrationIdentifier: string; portalUserId: number }) {
  return adminMessageApi<AdminCrmAccessResult>("portal.getHkCrmAccess", {
    ...input, portalUserId: String(input.portalUserId),
  }, "query");
}

export function getAdminHkCrmBinding(registrationIdentifier: string) {
  return adminMessageApi<AdminCrmBindingResult & { registrationIdentifier: string }>("portal.getHkCrmBinding", { registrationIdentifier }, "query");
}

/**
 * 企业所有者主动发起的 CRM owner 换绑。后台先持久化权威绑定，再回调
 * internalCrm.completeRebind 原子切换本地企业角色；网站绝不能提前自行换角色。
 */
export async function rebindCrmOwnerByEnterpriseOwner(params: {
  creditCode?: string;
  registrationIdentifier?: string;
  expectedPortalUserId: string;
  newPortalUserId: string;
  reason: string;
  requestId: string;
  actorName?: string;
}): Promise<AdminCrmOwnerRebindResult> {
  return adminMessageApi<AdminCrmOwnerRebindResult>(
    params.registrationIdentifier ? "portal.rebindHkCrmOwnerByEnterpriseOwner" : "portal.rebindCrmOwnerByEnterpriseOwner",
    params,
    "mutation",
  );
}

/** 快速询价卡片：单个料号 */
export type QuickInquiryCardContent = {
  kind?: "quick";
  companyName?: string;
  partNumber: string;
  brand?: string;
  /** 新库存询价使用结构化数量；null 表示后续聊天确认。 */
  requestedQty?: number | null;
  unit?: "片";
  /** 历史快速询价卡片兼容字段。 */
  quantity?: string;
  targetPrice?: string;
  remark?: string;
  threadNo?: string;
};

/** BOM 询价单中的单行物料 */
export type BomInquiryCardItem = {
  excelRow: number;
  partNumber: string;
  quantity: number;
  brand?: string;
  pkg?: string;
  reference?: string;
  note?: string;
  referencePrice?: string;
  /** 历史BOM询价卡片兼容字段。 */
  aiPrice?: string;
};

/** BOM 批量询价卡片：多行物料 + 询价 Excel 附件 */
export type BomInquiryCardContent = {
  kind: "bom";
  totalItems: number;
  items: BomInquiryCardItem[];
  threadNo?: string;
  fileName: string;
  fileUrl: string;
};

/**
 * 询价卡片内容。以 `kind` 区分快速询价与 BOM 批量询价：
 * 历史数据不带 `kind`，按快速询价处理，保证旧消息仍能正常渲染。
 */
export type InquiryCardContent = QuickInquiryCardContent | BomInquiryCardContent;

/** 判定是否为 BOM 询价卡片（历史数据无 kind 字段，视为快速询价） */
export function isBomInquiryCard(
  card: InquiryCardContent,
): card is BomInquiryCardContent {
  return (card as BomInquiryCardContent).kind === "bom";
}

/**
 * 快速询价 → 聊一聊自动触发：
 * 1. 获取/创建 用户↔平台客服 会话
 * 2. 以用户身份写入一条询价消息卡片（msgType=inquiry）
 * 3. 以客服身份自动回复"您的询价消息已收到"
 * 失败不阻塞询价主流程（记录日志），返回会话 ID（失败返回 null）。
 */
export async function postInquiryToChat(params: {
  card: InquiryCardContent;
  user: { id: number };
}): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const csUserId = await getServiceUserId();
    const userId = params.user.id;
    const u1 = Math.min(userId, csUserId);
    const u2 = Math.max(userId, csUserId);

    // 获取或创建客服会话
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

    // 1) 用户侧：询价消息卡片
    const cardJson = JSON.stringify(params.card);
    await db.execute(sql`
      INSERT INTO messages (conversationId, senderId, msgType, content)
      VALUES (${conversationId}, ${userId}, 'inquiry', ${cardJson})
    `);

    // 2) 客服侧：自动确认回复（BOM 询价按项数提示，单料号询价按型号提示）
    const ackSubject = isBomInquiryCard(params.card)
      ? `共 ${params.card.totalItems} 项的 BOM 询价`
      : `「${params.card.partNumber}」的询价`;
    const ackText = `您好，您关于${ackSubject}消息已收到，采购顾问将尽快为您报价，请留意本会话消息。`;
    await db.execute(sql`
      INSERT INTO messages (conversationId, senderId, msgType, content)
      VALUES (${conversationId}, ${csUserId}, 'text', ${ackText})
    `);

    // 3) 会话预览与未读：用户能看到客服回复的未读提醒
    const preview = ackText.length > 50 ? ackText.slice(0, 50) + "…" : ackText;
    await db.execute(sql`
      UPDATE conversations SET lastMessageAt = NOW(), lastMessagePreview = ${preview}
      WHERE id = ${conversationId}
    `);
    await db.execute(sql`
      UPDATE conversation_user_settings SET unreadCount = unreadCount + 1, deleted = 0
      WHERE conversationId = ${conversationId} AND userId = ${userId}
    `);
    await db.execute(sql`
      UPDATE conversation_user_settings SET deleted = 0
      WHERE conversationId = ${conversationId} AND userId = ${csUserId}
    `);
    return conversationId;
  } catch (err) {
    console.error("[customerService] 询价写入聊一聊失败:", err);
    return null;
  }
}

/**
 * 拉取后台客服回复并合并写入前台会话（幂等：按后台消息 id 去重，
 * 借助 messages.adminMsgId 列记录已同步的后台消息）。
 * 返回是否有新回复写入。
 */
export async function pullAdminReplies(conversationId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    const convResult = await db.execute(sql`
      SELECT adminThreadNo, user1Id, user2Id FROM conversations WHERE id = ${conversationId} LIMIT 1
    `);
    const convRows = (convResult as unknown as [
      Array<{ adminThreadNo: string | null; user1Id: number; user2Id: number }>,
      unknown,
    ])[0];
    const conv = convRows[0];
    if (!conv?.adminThreadNo) return false;

    const csUserId = await getServiceUserId();
    const userId = conv.user1Id === csUserId ? conv.user2Id : conv.user1Id;

    const thread = await adminMessageApi<PortalThreadMessages>(
      "portal.getMessages",
      { threadNo: conv.adminThreadNo },
      "query",
    );
    const adminReplies = (thread?.messages ?? [])
      .filter(m => m.senderType === "admin")
      .sort((a, b) => {
        const timeDiff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        return timeDiff || Number(a.id) - Number(b.id);
      });
    if (adminReplies.length === 0) return false;

    // 已同步的后台消息 id
    const syncedResult = await db.execute(sql`
      SELECT adminMsgId FROM messages
      WHERE conversationId = ${conversationId} AND adminMsgId IS NOT NULL
    `);
    const syncedRows = (syncedResult as unknown as [Array<{ adminMsgId: number }>, unknown])[0];
    const synced = new Set(syncedRows.map(r => Number(r.adminMsgId)));

    let wroteCount = 0;
    let lastPreview = "";
    let lastReplyAt: Date | null = null;
    for (const reply of adminReplies) {
      if (synced.has(Number(reply.id))) continue;
      const parsedCreatedAt = new Date(reply.createdAt);
      const replyCreatedAt = Number.isNaN(parsedCreatedAt.getTime()) ? new Date() : parsedCreatedAt;
      await db.execute(sql`
        INSERT INTO messages (conversationId, senderId, msgType, content, adminMsgId, createdAt)
        VALUES (${conversationId}, ${csUserId}, 'text', ${reply.content}, ${reply.id}, ${replyCreatedAt})
      `);
      wroteCount += 1;
      lastReplyAt = replyCreatedAt;
      lastPreview = reply.content.length > 50 ? reply.content.slice(0, 50) + "…" : reply.content;
    }
    if (wroteCount > 0 && lastReplyAt) {
      await db.execute(sql`
        UPDATE conversations
        SET lastMessagePreview = CASE
              WHEN lastMessageAt <= ${lastReplyAt} THEN ${lastPreview}
              ELSE lastMessagePreview
            END,
            lastMessageAt = GREATEST(lastMessageAt, ${lastReplyAt})
        WHERE id = ${conversationId}
      `);
      await db.execute(sql`
        UPDATE conversation_user_settings
        SET unreadCount = unreadCount + ${wroteCount}, deleted = 0
        WHERE conversationId = ${conversationId} AND userId = ${userId}
      `);
    }
    return wroteCount > 0;
  } catch (err) {
    console.error("[customerService] 拉取后台回复失败:", err);
    return false;
  }
}


// ── chatSyncWorker 专用同步实现 ──
//
// 与上方 syncMessageToAdmin / pullAdminReplies 的区别：
//   1. 不吞异常 —— 失败必须抛出，由 outbox 记录 lastError 并按退避重试；
//   2. 校验更严 —— 只允许带 clientMessageId 的文本客服消息进入后台；
//   3. 并发更安全 —— 拉取在事务内用 FOR UPDATE 锁住已同步集合。
//
// 上方两个函数保留给请求内的兼容路径（旧客户端仍会走到），不要删除。

/**
 * 把一条前台客服消息推送到管理端消息中心（worker 用）。
 *
 * 首次推送会在管理端创建会话，并把 threadNo 回写到 conversations.adminThreadNo。
 * 若本地记录的 threadNo 在管理端已不存在（404），会自动重建一个新会话，
 * 避免因后台删除会话导致该用户的客服消息永久卡死在队列里。
 */
export async function pushServiceMessageToAdmin(messageId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  const messageResult = await db.execute(sql`
    SELECT message_rows.id, message_rows.conversationId, message_rows.senderId,
           message_rows.clientMessageId, message_rows.msgType, message_rows.content,
           message_rows.recalledAt,
           conversation_rows.user1Id, conversation_rows.user2Id, conversation_rows.adminThreadNo,
           user_rows.name, user_rows.phone, user_rows.email
      FROM messages message_rows
      INNER JOIN conversations conversation_rows ON conversation_rows.id = message_rows.conversationId
      INNER JOIN users user_rows ON user_rows.id = message_rows.senderId
     WHERE message_rows.id = ${messageId}
     LIMIT 1
  `);
  const rows = (messageResult as unknown as [
    Array<{
      id: number;
      conversationId: number;
      senderId: number;
      clientMessageId: string | null;
      msgType: string;
      content: string;
      recalledAt: Date | null;
      user1Id: number;
      user2Id: number;
      adminThreadNo: string | null;
      name: string | null;
      phone: string | null;
      email: string | null;
    }>,
    unknown,
  ])[0];
  const message = rows[0];
  if (!message) throw new Error("待同步客服消息不存在");
  if (message.recalledAt) throw new Error("待同步客服消息已撤回");
  // 报价单与问候卡片是前台专有的结构化内容，后台消息中心只接文本。
  if (message.msgType !== "text") throw new Error("仅文本消息允许同步后台客服");
  // 没有幂等键就无法防止重复投递，宁可失败也不能重复推送给客服。
  if (!message.clientMessageId) throw new Error("待同步客服消息缺少 clientMessageId");

  const { isService } = await isServiceConversation(message);
  if (!isService) throw new Error("待同步消息不属于客服会话");

  const contactName = message.name || `用户#${message.senderId}`;
  const submit = (threadNo: string | null) =>
    adminMessageApi<SubmitMessageResult>(
      "portal.submitMessage",
      {
        threadNo,
        clientMessageId: message.clientMessageId,
        subject: threadNo ? undefined : `在线客服咨询 - ${contactName}`,
        contactName,
        contactPhone: message.phone || undefined,
        contactEmail: message.email || undefined,
        portalUserId: String(message.senderId),
        // 仅创建新线程时指定在线客服；已有开通消息线程必须保留 onboarding 类型。
        threadType: threadNo ? undefined : "service",
        content: message.content,
      },
      "mutation",
    );

  let result: SubmitMessageResult;
  try {
    result = await submit(message.adminThreadNo);
  } catch (error) {
    // 只有"本地有 threadNo 但后台返回 404"才算会话失效，其余错误交给重试。
    const staleThread =
      Boolean(message.adminThreadNo) &&
      error instanceof AdminMessageApiError &&
      error.status === 404;
    if (!staleThread) throw error;
    result = await submit(null);
  }
  if (!result?.threadNo) throw new Error("后台客服未返回 threadNo");

  // CASE 判断确保并发推送不会互相覆盖 threadNo：
  // 只有当本地仍为空、或仍是本次推送时读到的旧值时才写入。
  await db.execute(sql`
    UPDATE conversations
       SET adminThreadNo = CASE
             WHEN adminThreadNo IS NULL OR adminThreadNo = ${message.adminThreadNo}
               THEN ${result.threadNo}
             ELSE adminThreadNo
           END,
           updatedAt = NOW()
     WHERE id = ${message.conversationId}
  `);
}

/**
 * 拉取管理端客服回复并写入前台会话（worker 用）。
 *
 * 与请求内版本的关键差异：整个"查已同步集合 → 插入新回复 → 更新未读"过程
 * 在同一事务内完成，并对已同步集合加 FOR UPDATE 锁。否则两个 worker 实例
 * 同时拉取同一会话时，会各自认为回复未同步而重复插入。
 *
 * @returns 是否有新回复写入
 */
export async function pullAdminRepliesForWorker(conversationId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  const convResult = await db.execute(sql`
    SELECT adminThreadNo, user1Id, user2Id FROM conversations WHERE id = ${conversationId} LIMIT 1
  `);
  const convRows = (convResult as unknown as [
    Array<{ adminThreadNo: string | null; user1Id: number; user2Id: number }>,
    unknown,
  ])[0];
  const conv = convRows[0];
  // 尚未推送过任何消息的会话没有后台 threadNo，无需拉取。
  if (!conv?.adminThreadNo) return false;

  const csUserId = await getServiceUserId();
  const userId = conv.user1Id === csUserId ? conv.user2Id : conv.user1Id;

  const thread = await adminMessageApi<PortalThreadMessages>(
    "portal.getMessages",
    { threadNo: conv.adminThreadNo },
    "query",
  );
  const adminReplies = (thread?.messages ?? [])
    .filter(reply => reply.senderType === "admin")
    .sort((a, b) => {
      const timeDiff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      // 同一秒内的多条回复按 id 兜底排序，保证写入顺序稳定。
      return timeDiff || Number(a.id) - Number(b.id);
    });
  if (adminReplies.length === 0) return false;

  return db.transaction(async tx => {
    const syncedResult = await tx.execute(sql`
      SELECT adminMsgId FROM messages
       WHERE conversationId = ${conversationId} AND adminMsgId IS NOT NULL
       FOR UPDATE
    `);
    const syncedRows = (syncedResult as unknown as [Array<{ adminMsgId: number }>, unknown])[0];
    const synced = new Set(syncedRows.map(row => Number(row.adminMsgId)));

    const pendingReplies = adminReplies.filter(reply => !synced.has(Number(reply.id)));
    if (pendingReplies.length === 0) return false;

    let lastReplyAt = new Date(0);
    for (const reply of pendingReplies) {
      const parsedCreatedAt = new Date(reply.createdAt);
      // 后台时间格式异常时退回当前时间，避免写入 Invalid Date。
      const replyCreatedAt = Number.isNaN(parsedCreatedAt.getTime())
        ? new Date()
        : parsedCreatedAt;
      if (replyCreatedAt > lastReplyAt) lastReplyAt = replyCreatedAt;
      await tx.execute(sql`
        INSERT INTO messages (conversationId, senderId, msgType, content, adminMsgId, createdAt)
        VALUES (${conversationId}, ${csUserId}, 'text', ${reply.content}, ${reply.id}, ${replyCreatedAt})
      `);
    }

    const lastReply = pendingReplies[pendingReplies.length - 1];
    const lastPreview =
      lastReply.content.length > 50 ? `${lastReply.content.slice(0, 50)}…` : lastReply.content;

    // 只有当后台回复确实比现有最后一条消息更新时才覆盖预览，
    // 否则用户刚发出的消息预览会被较早的客服回复顶掉。
    await tx.execute(sql`
      UPDATE conversations
         SET lastMessagePreview = CASE
               WHEN lastMessageAt <= ${lastReplyAt} THEN ${lastPreview}
               ELSE lastMessagePreview
             END,
             lastMessageAt = GREATEST(lastMessageAt, ${lastReplyAt}),
             updatedAt = NOW()
       WHERE id = ${conversationId}
    `);
    // deleted = 0：用户软删除过的会话在客服回复后重新出现在列表中。
    await tx.execute(sql`
      UPDATE conversation_user_settings
         SET unreadCount = unreadCount + ${pendingReplies.length}, deleted = 0, updatedAt = NOW()
       WHERE conversationId = ${conversationId} AND userId = ${userId}
    `);

    return true;
  });
}
