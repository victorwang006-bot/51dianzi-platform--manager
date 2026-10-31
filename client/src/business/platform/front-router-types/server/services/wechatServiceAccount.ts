import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../db";

const SERVICE_ACCOUNT_APP_ID = "wx8d27d35165d53406";
const SERVICE_ACCOUNT_SUBSCRIPTION_TEMPLATE_ID =
  "wk1399QxFN0Ln45hEluJTLhnSlQ0bBEqXKNy4XFb_Gg";
const BIND_CODE_TTL_MINUTES = 10;
const SUBSCRIPTION_AUTH_TTL_MINUTES = 15;
const SUBSCRIPTION_MENU_OAUTH_TTL_SECONDS = 5 * 60;
const WECHAT_API_BASE = "https://api.weixin.qq.com";
const DEFAULT_PUBLIC_BASE_URL = "https://51dianzi.com";
export const WECHAT_SERVICE_SUBSCRIPTION_PAGE_PATH =
  "/api/wechat/service-account/subscription/authorize";
export const WECHAT_SERVICE_SUBSCRIPTION_MENU_PATH =
  "/api/wechat/service-account/subscription/menu";

let cachedAccessToken = "";
let cachedAccessTokenExpiresAt = 0;
let cachedJsapiTicket = "";
let cachedJsapiTicketExpiresAt = 0;

type DbRow = Record<string, unknown>;

function rowsOf<T extends DbRow>(result: unknown): T[] {
  return (result as [T[], unknown])?.[0] ?? [];
}

export function serviceAccountAppId(): string {
  return (
    process.env.WECHAT_SERVICE_ACCOUNT_APP_ID ||
    process.env.WECHAT_OA_APP_ID ||
    SERVICE_ACCOUNT_APP_ID
  ).trim();
}

export function serviceAccountAppSecret(): string {
  return (
    process.env.WECHAT_SERVICE_ACCOUNT_APP_SECRET ||
    process.env.WECHAT_OA_APP_SECRET ||
    ""
  ).trim();
}

export function serviceAccountCallbackToken(): string {
  return (
    process.env.WECHAT_SERVICE_ACCOUNT_CALLBACK_TOKEN ||
    process.env.WECHAT_OA_TOKEN ||
    ""
  ).trim();
}

export function serviceAccountSubscriptionTemplateId(): string {
  return (
    process.env.WECHAT_SERVICE_CHAT_TEMPLATE_ID ||
    SERVICE_ACCOUNT_SUBSCRIPTION_TEMPLATE_ID
  ).trim();
}

export function serviceAccountPublicBaseUrl(): string {
  return (process.env.WECHAT_SERVICE_PUBLIC_BASE_URL || DEFAULT_PUBLIC_BASE_URL)
    .trim()
    .replace(/\/+$/, "");
}

export function isServiceAccountApiConfigured(): boolean {
  return Boolean(serviceAccountAppId() && serviceAccountAppSecret());
}

function bindCodeSecret(): string {
  const secret = (process.env.WECHAT_SERVICE_BIND_CODE_SECRET || process.env.JWT_SECRET || "").trim();
  if (!secret) throw new Error("服务号绑定码密钥未配置");
  return secret;
}

function subscriptionMenuOauthStateSignature(payload: string): string {
  return createHmac("sha256", bindCodeSecret())
    .update(`wechat-service-subscription-menu:${payload}`)
    .digest("hex")
    .slice(0, 32);
}

export function createWechatServiceSubscriptionMenuOauthUrl(
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const timestamp = String(Math.floor(nowSeconds)).padStart(10, "0");
  const nonce = randomBytes(12).toString("hex");
  const payload = `${timestamp}${nonce}`;
  const state = `${payload}${subscriptionMenuOauthStateSignature(payload)}`;
  const callbackUrl = new URL(
    WECHAT_SERVICE_SUBSCRIPTION_MENU_PATH,
    `${serviceAccountPublicBaseUrl()}/`,
  );
  if (callbackUrl.protocol !== "https:") throw new Error("服务号网页授权回调必须使用HTTPS");
  const params = new URLSearchParams();
  params.set("appid", serviceAccountAppId());
  params.set("redirect_uri", callbackUrl.toString());
  params.set("response_type", "code");
  params.set("scope", "snsapi_base");
  params.set("state", state);
  return `https://open.weixin.qq.com/connect/oauth2/authorize?${params.toString()}#wechat_redirect`;
}

export function verifyWechatServiceSubscriptionMenuOauthState(
  state: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!/^\d{10}[0-9a-f]{56}$/.test(state)) return false;
  const payload = state.slice(0, 34);
  const actual = Buffer.from(state.slice(34), "utf8");
  const expected = Buffer.from(subscriptionMenuOauthStateSignature(payload), "utf8");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
  const issuedAt = Number(payload.slice(0, 10));
  const age = Math.floor(nowSeconds) - issuedAt;
  return Number.isFinite(issuedAt) && age >= -60 && age <= SUBSCRIPTION_MENU_OAUTH_TTL_SECONDS;
}

export function hashWechatServiceBindCode(code: string): string {
  return createHmac("sha256", bindCodeSecret())
    .update(`wechat-service-bind:${code}`)
    .digest("hex");
}

export function verifyWechatCallbackSignature(input: {
  signature: string;
  timestamp: string;
  nonce: string;
}): boolean {
  const token = serviceAccountCallbackToken();
  if (!token || !input.signature || !input.timestamp || !input.nonce) return false;
  const expected = createHash("sha1")
    .update([token, input.timestamp, input.nonce].sort().join(""))
    .digest("hex");
  const actualBuffer = Buffer.from(input.signature.toLowerCase(), "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function readXmlTag(xml: string, tag: string): string {
  const safeTag = tag.replace(/[^A-Za-z0-9_]/g, "");
  const cdata = new RegExp(`<${safeTag}>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${safeTag}>`, "i");
  const plain = new RegExp(`<${safeTag}>\\s*([^<]*?)\\s*</${safeTag}>`, "i");
  return (xml.match(cdata)?.[1] ?? xml.match(plain)?.[1] ?? "").trim();
}

export interface WechatServiceInboundMessage {
  toUserName: string;
  fromUserName: string;
  createTime: number;
  msgType: string;
  event: string;
  eventKey: string;
  content: string;
  subscriptionItems: Array<{
    templateId: string;
    status: string;
    popupScene: number;
    messageId: string;
    errorCode: string;
  }>;
}

function readSubscriptionItems(xml: string): WechatServiceInboundMessage["subscriptionItems"] {
  const items: WechatServiceInboundMessage["subscriptionItems"] = [];
  const listPattern = /<List>([\s\S]*?)<\/List>/gi;
  let match: RegExpExecArray | null = null;
  while ((match = listPattern.exec(xml)) !== null) {
    const block = match[1] || "";
    items.push({
      templateId: readXmlTag(block, "TemplateId"),
      status: readXmlTag(block, "SubscribeStatusString").toLowerCase(),
      popupScene: Number(readXmlTag(block, "PopupScene") || 0),
      messageId: readXmlTag(block, "MsgID"),
      errorCode: readXmlTag(block, "ErrorCode"),
    });
  }
  return items.filter(item => item.templateId);
}

export function parseWechatServiceXml(xml: string): WechatServiceInboundMessage {
  return {
    toUserName: readXmlTag(xml, "ToUserName"),
    fromUserName: readXmlTag(xml, "FromUserName"),
    createTime: Number(readXmlTag(xml, "CreateTime") || 0),
    msgType: readXmlTag(xml, "MsgType").toLowerCase(),
    event: readXmlTag(xml, "Event").toLowerCase(),
    eventKey: readXmlTag(xml, "EventKey"),
    content: readXmlTag(xml, "Content"),
    subscriptionItems: readSubscriptionItems(xml),
  };
}

function escapeCdata(value: string): string {
  return value.replace(/]]>/g, "]]]]><![CDATA[>");
}

export function renderWechatServiceTextReply(input: {
  toUserName: string;
  fromUserName: string;
  content: string;
  nowSeconds?: number;
}): string {
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  return `<xml><ToUserName><![CDATA[${escapeCdata(input.toUserName)}]]></ToUserName>` +
    `<FromUserName><![CDATA[${escapeCdata(input.fromUserName)}]]></FromUserName>` +
    `<CreateTime>${now}</CreateTime><MsgType><![CDATA[text]]></MsgType>` +
    `<Content><![CDATA[${escapeCdata(input.content)}]]></Content></xml>`;
}

async function requestWechatJson<T extends DbRow>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(8_000),
  });
  const body = (await response.json()) as T & { errcode?: number; errmsg?: string };
  if (!response.ok || (body.errcode && body.errcode !== 0)) {
    throw new Error(`WECHAT_API_${body.errcode || response.status}:${body.errmsg || "request failed"}`);
  }
  return body;
}

export async function exchangeWechatServiceOauthCode(code: string): Promise<string> {
  const normalizedCode = String(code || "").trim();
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(normalizedCode)) {
    throw new Error("微信网页授权code无效");
  }
  const appid = serviceAccountAppId();
  const secret = serviceAccountAppSecret();
  if (!appid || !secret) throw new Error("服务号AppID或AppSecret未配置");
  const params = new URLSearchParams({
    appid,
    secret,
    code: normalizedCode,
    grant_type: "authorization_code",
  });
  const result = await requestWechatJson<{ openid: string; scope: string }>(
    `${WECHAT_API_BASE}/sns/oauth2/access_token?${params.toString()}`,
  );
  const openid = String(result.openid || "").trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(openid)) throw new Error("微信网页授权未返回有效OpenID");
  return openid;
}

export async function getWechatServiceAccessToken(forceRefresh = false): Promise<string> {
  const now = Date.now();
  if (!forceRefresh && cachedAccessToken && cachedAccessTokenExpiresAt - now > 60_000) {
    return cachedAccessToken;
  }
  const appid = serviceAccountAppId();
  const secret = serviceAccountAppSecret();
  if (!appid || !secret) throw new Error("服务号AppID或AppSecret未配置");
  const params = new URLSearchParams({ grant_type: "client_credential", appid, secret });
  const result = await requestWechatJson<{ access_token: string; expires_in: number }>(
    `${WECHAT_API_BASE}/cgi-bin/token?${params.toString()}`,
  );
  cachedAccessToken = String(result.access_token || "");
  cachedAccessTokenExpiresAt = now + Math.max(300, Number(result.expires_in || 7200)) * 1000;
  if (!cachedAccessToken) throw new Error("微信未返回access_token");
  return cachedAccessToken;
}

export async function getWechatServiceJsapiTicket(forceRefresh = false): Promise<string> {
  const now = Date.now();
  if (!forceRefresh && cachedJsapiTicket && cachedJsapiTicketExpiresAt - now > 60_000) {
    return cachedJsapiTicket;
  }
  const accessToken = await getWechatServiceAccessToken(forceRefresh);
  const params = new URLSearchParams({ access_token: accessToken, type: "jsapi" });
  const result = await requestWechatJson<{ ticket: string; expires_in: number }>(
    `${WECHAT_API_BASE}/cgi-bin/ticket/getticket?${params.toString()}`,
  );
  cachedJsapiTicket = String(result.ticket || "");
  cachedJsapiTicketExpiresAt = now + Math.max(300, Number(result.expires_in || 7200)) * 1000;
  if (!cachedJsapiTicket) throw new Error("微信未返回jsapi_ticket");
  return cachedJsapiTicket;
}

export function createWechatServiceJsSdkSignature(input: {
  jsapiTicket: string;
  nonceStr: string;
  timestamp: number;
  url: string;
}): string {
  return createHash("sha1")
    .update(
      `jsapi_ticket=${input.jsapiTicket}&noncestr=${input.nonceStr}` +
        `&timestamp=${input.timestamp}&url=${input.url}`,
    )
    .digest("hex");
}

export async function getWechatServiceFollower(openid: string): Promise<{
  subscribed: boolean;
  unionId: string | null;
}> {
  const token = await getWechatServiceAccessToken();
  const params = new URLSearchParams({ access_token: token, openid, lang: "zh_CN" });
  const result = await requestWechatJson<{ subscribe: number; unionid?: string }>(
    `${WECHAT_API_BASE}/cgi-bin/user/info?${params.toString()}`,
  );
  return {
    subscribed: Number(result.subscribe || 0) === 1,
    unionId: result.unionid ? String(result.unionid).slice(0, 64) : null,
  };
}

async function upsertServiceBinding(input: {
  userId: number;
  openid: string;
  unionId: string | null;
  source: "union_id" | "bind_code" | "subscription_auth";
  followsAccount?: boolean;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  const byOpenid = rowsOf<{ userId: number }>(await db.execute(sql`
    SELECT userId FROM wechat_service_account_bindings WHERE openid = ${input.openid} LIMIT 1
  `))[0];
  if (byOpenid && Number(byOpenid.userId) !== input.userId) {
    throw new Error("该服务号微信已绑定其他51电子网账号");
  }
  const byUser = rowsOf<{ openid: string }>(await db.execute(sql`
    SELECT openid FROM wechat_service_account_bindings WHERE userId = ${input.userId} LIMIT 1
  `))[0];
  if (byUser && String(byUser.openid) !== input.openid) {
    throw new Error("该51电子网账号已绑定其他服务号微信");
  }
  await db.execute(sql`
    INSERT INTO wechat_service_account_bindings
      (userId, openid, unionId, subscribed, reminderEnabled, source,
       lastSubscribedAt, unsubscribedAt)
    VALUES
      (${input.userId}, ${input.openid}, ${input.unionId}, ${input.followsAccount === false ? 0 : 1},
       1, ${input.source}, ${input.followsAccount === false ? null : new Date()}, NULL)
    ON DUPLICATE KEY UPDATE
      unionId = COALESCE(VALUES(unionId), unionId),
      subscribed = IF(VALUES(subscribed) = 1, 1, subscribed),
      reminderEnabled = 1,
      source = VALUES(source),
      lastSubscribedAt = IF(VALUES(subscribed) = 1, NOW(), lastSubscribedAt),
      unsubscribedAt = NULL,
      updatedAt = NOW()
  `);
}

export async function bindWechatServiceFollowerByUnionId(openid: string): Promise<{
  bound: boolean;
  userId?: number;
  reason?: string;
}> {
  if (!isServiceAccountApiConfigured()) return { bound: false, reason: "NO_APP_SECRET" };
  const follower = await getWechatServiceFollower(openid);
  if (!follower.subscribed) return { bound: false, reason: "NOT_SUBSCRIBED" };
  if (!follower.unionId) return { bound: false, reason: "NO_UNION_ID" };
  const db = await getDb();
  if (!db) return { bound: false, reason: "NO_DB" };
  const miniBinding = rowsOf<{ userId: number }>(await db.execute(sql`
    SELECT userId
      FROM wechat_account_bindings
     WHERE unionId = ${follower.unionId}
     ORDER BY id ASC
     LIMIT 1
  `))[0];
  if (!miniBinding) return { bound: false, reason: "NO_PLATFORM_MATCH" };
  const userId = Number(miniBinding.userId);
  await upsertServiceBinding({ userId, openid, unionId: follower.unionId, source: "union_id" });
  return { bound: true, userId };
}

export async function createWechatServiceBindCode(userId: number): Promise<{
  code: string;
  expiresAt: Date;
  expiresInSeconds: number;
}> {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  await db.execute(sql`
    UPDATE wechat_service_bind_codes
       SET status = 'expired'
     WHERE userId = ${userId} AND status = 'pending'
  `);
  const expiresAt = new Date(Date.now() + BIND_CODE_TTL_MINUTES * 60_000);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = String(randomInt(100000, 1_000_000));
    const codeHash = hashWechatServiceBindCode(code);
    try {
      await db.execute(sql`
        INSERT INTO wechat_service_bind_codes (userId, codeHash, status, expiresAt)
        VALUES (${userId}, ${codeHash}, 'pending', ${expiresAt})
      `);
      return { code, expiresAt, expiresInSeconds: BIND_CODE_TTL_MINUTES * 60 };
    } catch (error) {
      if (!String(error).includes("Duplicate entry") && !String(error).includes("ER_DUP_ENTRY")) {
        throw error;
      }
    }
  }
  throw new Error("生成绑定码失败，请稍后重试");
}

function subscriptionStateHash(reserved: string): string {
  return createHash("sha256").update(`wechat-service-subscription:${reserved}`).digest("hex");
}

async function createSubscriptionAuthorization(input: {
  userId: number;
  openid?: string | null;
}): Promise<{
  authorizeUrl: string;
  expiresInSeconds: number;
  scene: number;
}> {
  const templateId = serviceAccountSubscriptionTemplateId();
  if (!templateId) throw new Error("服务号订阅通知模板尚未配置");
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  await db.execute(sql`
    UPDATE wechat_service_subscription_grants
       SET status = 'expired', updatedAt = NOW()
     WHERE userId = ${input.userId}
       AND templateId = ${templateId}
       AND status = 'pending'
  `);
  const expiresAt = new Date(Date.now() + SUBSCRIPTION_AUTH_TTL_MINUTES * 60_000);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const scene = randomInt(1000, 10001);
    const reserved = randomBytes(24).toString("base64url");
    const stateHash = subscriptionStateHash(reserved);
    try {
      await db.execute(sql`
        INSERT INTO wechat_service_subscription_grants
          (userId, openid, templateId, scene, stateHash, status, source, expiresAt)
        VALUES
          (${input.userId}, ${input.openid || null}, ${templateId}, ${scene}, ${stateHash},
           'pending', ${input.openid ? "service_chat_h5" : "authorize_url"}, ${expiresAt})
      `);
      const params = new URLSearchParams({ state: reserved });
      return {
        authorizeUrl:
          `${serviceAccountPublicBaseUrl()}${WECHAT_SERVICE_SUBSCRIPTION_PAGE_PATH}?${params.toString()}`,
        expiresInSeconds: SUBSCRIPTION_AUTH_TTL_MINUTES * 60,
        scene,
      };
    } catch (error) {
      if (!String(error).includes("Duplicate entry") && !String(error).includes("ER_DUP_ENTRY")) {
        throw error;
      }
    }
  }
  throw new Error("生成订阅授权失败，请稍后重试");
}

export async function createWechatServiceSubscriptionAuthorizationForOpenid(openid: string) {
  const normalizedOpenid = String(openid || "").trim();
  if (!normalizedOpenid) throw new Error("服务号用户标识无效");
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  const binding = rowsOf<{ userId: number }>(await db.execute(sql`
    SELECT userId
      FROM wechat_service_account_bindings
     WHERE openid = ${normalizedOpenid}
     LIMIT 1
  `))[0];
  if (!binding) throw new Error("请先使用小程序生成的6位绑定码完成账号绑定");
  return createSubscriptionAuthorization({
    userId: Number(binding.userId),
    openid: normalizedOpenid,
  });
}

function validSubscriptionState(reserved: string): boolean {
  return /^[A-Za-z0-9_-]{32}$/.test(reserved);
}

export async function getWechatServiceSubscriptionAuthorizationState(reserved: string): Promise<{
  valid: boolean;
  status: "pending" | "available" | "cancelled" | "expired" | "unavailable";
  templateId?: string;
  expiresAt?: Date;
}> {
  if (!validSubscriptionState(reserved)) return { valid: false, status: "unavailable" };
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  const stateHash = subscriptionStateHash(reserved);
  await db.execute(sql`
    UPDATE wechat_service_subscription_grants
       SET status = 'expired', updatedAt = NOW()
     WHERE stateHash = ${stateHash} AND status = 'pending' AND expiresAt <= NOW()
  `);
  const grant = rowsOf<{ status: string; templateId: string; expiresAt: Date }>(await db.execute(sql`
    SELECT status, templateId, expiresAt
      FROM wechat_service_subscription_grants
     WHERE stateHash = ${stateHash}
     LIMIT 1
  `))[0];
  if (!grant) return { valid: false, status: "unavailable" };
  const supported = new Set(["pending", "available", "cancelled", "expired"]);
  const status = supported.has(String(grant.status))
    ? String(grant.status) as "pending" | "available" | "cancelled" | "expired"
    : "unavailable";
  return {
    valid: true,
    status,
    templateId: String(grant.templateId),
    expiresAt: new Date(grant.expiresAt),
  };
}

export async function createWechatServiceSubscriptionJsSdkConfig(input: {
  reserved: string;
  url: string;
}): Promise<{
  appId: string;
  timestamp: number;
  nonceStr: string;
  signature: string;
}> {
  const state = await getWechatServiceSubscriptionAuthorizationState(input.reserved);
  if (!state.valid || state.status !== "pending") throw new Error("订阅授权已失效");
  const pageUrl = new URL(input.url);
  const publicBase = new URL(serviceAccountPublicBaseUrl());
  if (
    pageUrl.protocol !== "https:" ||
    pageUrl.origin !== publicBase.origin ||
    pageUrl.pathname !== WECHAT_SERVICE_SUBSCRIPTION_PAGE_PATH ||
    pageUrl.searchParams.get("state") !== input.reserved
  ) {
    throw new Error("订阅页面地址无效");
  }
  pageUrl.hash = "";
  const timestamp = Math.floor(Date.now() / 1000);
  const nonceStr = randomBytes(16).toString("hex");
  const jsapiTicket = await getWechatServiceJsapiTicket();
  return {
    appId: serviceAccountAppId(),
    timestamp,
    nonceStr,
    signature: createWechatServiceJsSdkSignature({
      jsapiTicket,
      nonceStr,
      timestamp,
      url: pageUrl.toString(),
    }),
  };
}

export async function recordWechatServiceSubscriptionEvent(input: {
  openid: string;
  templateId: string;
  status: "accept" | "reject";
  source: "popup" | "settings";
}): Promise<void> {
  const db = await getDb();
  if (!db || !input.openid || !input.templateId) return;
  if (input.status === "reject") {
    if (input.source === "settings") {
      await db.execute(sql`
        UPDATE wechat_service_subscription_grants
           SET status = 'revoked', updatedAt = NOW()
         WHERE openid = ${input.openid}
           AND templateId = ${input.templateId}
           AND status IN ('pending', 'available', 'claimed')
      `);
    } else {
      await db.execute(sql`
        UPDATE wechat_service_subscription_grants
           SET status = 'cancelled', updatedAt = NOW()
         WHERE openid = ${input.openid}
           AND templateId = ${input.templateId}
           AND status = 'pending'
         ORDER BY id DESC
         LIMIT 1
      `);
    }
    return;
  }
  const binding = rowsOf<{ userId: number }>(await db.execute(sql`
    SELECT userId FROM wechat_service_account_bindings WHERE openid = ${input.openid} LIMIT 1
  `))[0];
  if (!binding) return;
  await db.execute(sql`
    UPDATE wechat_service_subscription_grants
       SET openid = ${input.openid}, status = 'available',
           authorizedAt = COALESCE(authorizedAt, NOW()), source = ${input.source}, updatedAt = NOW()
     WHERE userId = ${Number(binding.userId)}
       AND templateId = ${input.templateId}
       AND status = 'pending'
       AND expiresAt > NOW()
     ORDER BY id DESC
     LIMIT 1
  `);
}

export async function consumeWechatServiceBindCode(input: {
  openid: string;
  code: string;
  unionId?: string | null;
}): Promise<{ bound: boolean; userId?: number; message: string }> {
  const db = await getDb();
  if (!db) return { bound: false, message: "系统繁忙，请稍后重试" };
  const codeHash = hashWechatServiceBindCode(input.code);
  const result = await db.transaction(async tx => {
    const codeRow = rowsOf<{ id: number; userId: number }>(await tx.execute(sql`
      SELECT id, userId
        FROM wechat_service_bind_codes
       WHERE codeHash = ${codeHash}
         AND status = 'pending'
         AND expiresAt > NOW()
       LIMIT 1
       FOR UPDATE
    `))[0];
    if (!codeRow) return null;

    const userId = Number(codeRow.userId);
    const mini = rowsOf<{ unionId: string | null }>(await tx.execute(sql`
      SELECT unionId FROM wechat_account_bindings WHERE userId = ${userId} LIMIT 1
    `))[0];
    const unionId = (input.unionId || mini?.unionId || null)?.slice(0, 64) ?? null;

    const byOpenid = rowsOf<{ userId: number }>(await tx.execute(sql`
      SELECT userId FROM wechat_service_account_bindings WHERE openid = ${input.openid} LIMIT 1
    `))[0];
    if (byOpenid && Number(byOpenid.userId) !== userId) {
      throw new Error("该服务号微信已绑定其他51电子网账号");
    }
    const byUser = rowsOf<{ openid: string }>(await tx.execute(sql`
      SELECT openid FROM wechat_service_account_bindings WHERE userId = ${userId} LIMIT 1
    `))[0];
    if (byUser && String(byUser.openid) !== input.openid) {
      throw new Error("该51电子网账号已绑定其他服务号微信");
    }

    await tx.execute(sql`
      INSERT INTO wechat_service_account_bindings
        (userId, openid, unionId, subscribed, reminderEnabled, source,
         lastSubscribedAt, unsubscribedAt)
      VALUES
        (${userId}, ${input.openid}, ${unionId}, 1, 1, 'bind_code', NOW(), NULL)
      ON DUPLICATE KEY UPDATE
        unionId = COALESCE(VALUES(unionId), unionId),
        subscribed = 1,
        reminderEnabled = 1,
        source = 'bind_code',
        lastSubscribedAt = NOW(),
        unsubscribedAt = NULL,
        updatedAt = NOW()
    `);
    await tx.execute(sql`
      UPDATE wechat_service_bind_codes
         SET status = 'used', usedAt = NOW()
       WHERE id = ${Number(codeRow.id)} AND status = 'pending'
    `);
    return userId;
  });
  if (!result) return { bound: false, message: "绑定码无效或已过期，请在小程序重新生成" };
  return { bound: true, userId: result, message: "绑定成功，聊一聊未读提醒已开启" };
}

export async function markWechatServiceUnsubscribed(openid: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.execute(sql`
    UPDATE wechat_service_account_bindings
       SET subscribed = 0,
           reminderEnabled = 0,
           unsubscribedAt = NOW(),
           updatedAt = NOW()
     WHERE openid = ${openid}
  `);
}

export async function getWechatServiceBindingStatus(userId: number): Promise<{
  bound: boolean;
  subscribed: boolean;
  reminderEnabled: boolean;
  accountName: string;
  availableCredits: number;
  subscriptionTemplateReady: boolean;
}> {
  const db = await getDb();
  if (!db) return {
    bound: false,
    subscribed: false,
    reminderEnabled: false,
    accountName: "51电子网-MINI",
    availableCredits: 0,
    subscriptionTemplateReady: Boolean(serviceAccountSubscriptionTemplateId()),
  };
  const row = rowsOf<{ subscribed: number; reminderEnabled: number }>(await db.execute(sql`
    SELECT subscribed, reminderEnabled
      FROM wechat_service_account_bindings
     WHERE userId = ${userId}
     LIMIT 1
  `))[0];
  const credits = rowsOf<{ value: number }>(await db.execute(sql`
    SELECT COUNT(*) AS value
      FROM wechat_service_subscription_grants
     WHERE userId = ${userId}
       AND templateId = ${serviceAccountSubscriptionTemplateId()}
       AND status = 'available'
  `))[0];
  return {
    bound: Boolean(row),
    subscribed: Number(row?.subscribed || 0) === 1,
    reminderEnabled: Number(row?.reminderEnabled || 0) === 1,
    accountName: "51电子网-MINI",
    availableCredits: Number(credits?.value || 0),
    subscriptionTemplateReady: Boolean(serviceAccountSubscriptionTemplateId()),
  };
}

export async function setWechatServiceReminderEnabled(
  userId: number,
  enabled: boolean,
): Promise<{ enabled: boolean }> {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  const result = await db.execute(sql`
    UPDATE wechat_service_account_bindings
       SET reminderEnabled = ${enabled ? 1 : 0}, updatedAt = NOW()
     WHERE userId = ${userId}
  `);
  const header = (result as unknown as [{ affectedRows?: number }, unknown])?.[0];
  if (Number(header?.affectedRows || 0) < 1) throw new Error("请先绑定或订阅51电子网-MINI提醒");
  return { enabled };
}
