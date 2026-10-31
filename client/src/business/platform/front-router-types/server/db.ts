import { marketPackagingLookupKeys, resolveMarketPackagingGroup, isMarketPackagingBrandCompatible, isMarketPackagingPackageCompatible, marketPackagingLabel, normalizeMarketPartNumber } from "../../shared/marketPackaging";
import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, getTableColumns, gt, gte, inArray, isNull, like, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";
import {
  addresses,
  agreementSignatures,
  cartItems,
  checkoutSessions,
  companies,
  enterpriseServiceAgreementAcceptances,
  invoiceTitles,
  InsertAddress,
  type InsertInvoiceTitle,
  InsertAgreementSignature,
  InsertCompany,
  type InsertEnterpriseServiceAgreementAcceptance,
  InsertInventory,
  InsertOrder,
  InsertOrderItem,
  type InsertOrderContractDownload,
  type InsertOrderContractRecord,
  InsertUser,
  inventories,
  inventorySpotVerifications,
  recommendationInventoryScores,
  enterpriseMembers,
  enterprises,
  orderItems,
  orders,
  orderContractDownloads,
  orderContractRecords,
  orderTracks,
  sellerPickupPoints,
  type InsertSellerPickupPoint,
  supplierFollows,
  users,
  forumMessageChanges,
  forumMessages,
  forumSupplierQuotes,
  userModerationAudits,
  logisticsSnapshots,
  type InsertLogisticsSnapshot,
  waybillOcrRecords,
  type InsertWaybillOcrRecord,
  type InventoryPhoto,
  type LadderTier,
  wechatAccountBindings,
  type InsertWechatAccountBinding,
  userUsernameHistory,
} from "../drizzle/schema";
import { SUPPLIER_NAME_FALLBACK } from "../../shared/supplierDisplayName";
import { hasInventoryLeadTime } from "../../shared/inventoryLeadTime";
import { canPublishInventoryAvailability } from "../../shared/inventoryAvailability";
import { maskForbiddenWords } from "../../shared/contentModeration";
import { INVENTORY_BULK_ACTION_LIMIT } from "../../shared/inventoryBulk";
import {
  INVENTORY_LIST_DEFAULT_PAGE_SIZE,
  INVENTORY_LIST_MAX_PAGE_SIZE,
} from "../../shared/inventorySafetyLimits";
import {
  getInventoryQuota,
  inventoryPublishedLimitMessage,
  isInventoryQuotaExceeded,
} from "./services/inventoryQuota";
import { groupBrandFacets } from "./services/brandFacets";
import {
  companyCatalogVisibleCondition,
  normalizeExactInventoryKeyword,
  searchDiscoverableCondition,
} from "./services/inventoryVisibility";
import { packagingSearchLookupKeys, verifiedSearchPackagingEquivalent } from "../../shared/partNumber";
import { ENV } from './_core/env';
import {
  buildRecommendationReasons,
  diversifyTopChannels,
  EMPTY_BROWSE_SUPPLIER_BATCH_SIZE,
  FRESHNESS_WEIGHT,
  PRICE_HALF_LIFE,
  PRICE_WEIGHT,
  TENURE_WEIGHT,
  TRADE_SATURATION_COUNT,
  TRADE_WEIGHT,
  UNTAXED_TO_TAX_INCLUDED_MULTIPLIER,
} from './services/searchRanking';
import {
  SPOT_VERIFICATION_MAX_BOOST,
  SPOT_VERIFICATION_VALID_DAYS,
  spotVerificationInventoryFingerprint,
  spotVerificationMatchFingerprint,
  type SpotInventoryMatch,
  normalizeSpotPartNumber,
  selectSpotInventoryCandidates,
  spotVerificationSearchPartNumbers,
} from '../../shared/spotInventoryVerification';
import { materialSearchSupplierNameSql } from "./services/publicCompanyName";

/**
 * 供应商展示名的统一 SQL 片段（全站唯一口径，见 shared/supplierDisplayName.ts）。
 *
 * 调用方必须已 leftJoin companies 与 users，否则字段引用会报错。
 * 新增任何展示供应商名的查询都必须复用本片段，不得再自行拼 COALESCE——
 * 历史上各处口径不一，同一卖家在搜索页显示企业名、BOM 配单显示个人名（如 victor）、
 * 购物车又是另一种，采购方无法确认交易对象。
 *
 * 2026-08-17 自营平权：原先的 CASE WHEN 自营别名分支已移除，
 * 自营主体与第三方卖家走完全相同的回退链，一律展示工商全称。
 */
const supplierDisplayNameSql = sql<string>`COALESCE(${companies.companyName}, ${users.name}, ${users.username}, ${SUPPLIER_NAME_FALLBACK})`;

let _db: ReturnType<typeof drizzle> | null = null;

/**
 * 业务时区偏移，必须与库内 DATETIME 的存储口径一致。
 *
 * 生产库所有 DATETIME 均以**北京时间字面值**存储（已于 2026-08-18 对
 * orders / messages / users / order_tracks / inventories 共 6000+ 条抽样核对，
 * 无一条落在 NOW() 之后，可确认不存在按 UTC 字面值写入的混用数据）。
 *
 * mysql2 默认 `timezone: 'local'`，会按进程所在时区解释这些字面值。
 * 生产进程未设置 TZ，实际表现为把北京时间当 UTC，于是读出的时间戳凭空多 8 小时：
 * 库内 `14:26:34`（北京）被序列化成 `"2026-08-18T14:26:34.000Z"`，
 * 后台再按北京时间格式化就显示成 22:26 —— 正是后台订单时间偏 8 小时的根因。
 *
 * 此处显式声明 +08:00，让驱动按北京时间解释字面值，读写两端口径统一。
 * 修改本值会同时改变全部 timestamp 字段的读写含义，务必先核对库内存储口径。
 */
const DB_TIMEZONE = "+08:00";

/**
 * 给连接串补上 timezone 参数。
 *
 * 保留连接串中已显式声明的 timezone（运维可能出于排障需要临时覆盖），
 * 只在缺失时补默认值，避免静默改写运维的显式配置。
 */
function withTimezone(databaseUrl: string): string {
  try {
    const parsed = new URL(databaseUrl);
    if (!parsed.searchParams.has("timezone")) {
      parsed.searchParams.set("timezone", DB_TIMEZONE);
    }
    return parsed.toString();
  } catch {
    // 连接串非标准 URL 时不做处理，交由驱动自行报错，避免掩盖配置错误
    return databaseUrl;
  }
}

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(withTimezone(process.env.DATABASE_URL));
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

/**
 * 关闭连接池。
 *
 * 仅供常驻工作进程（如 chatSyncWorker）优雅退出时调用；
 * 不调用会因连接池保持活动而让进程无法自行退出，
 * 导致 PM2 reload 必须等到超时才能强杀。HTTP 服务进程无需调用。
 */
export async function closeDb(): Promise<void> {
  const db = _db;
  _db = null;
  if (!db) return;
  await db.$client.promise().end();
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};
    let normalizedEmail: string | null | undefined;

    const textFields = ["name", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.email !== undefined) {
      normalizedEmail = user.email?.trim().toLowerCase() || null;
      values.email = normalizedEmail;
    }

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.transaction(async tx => {
      // 先用唯一 openId 建档或取得行锁，随后基于锁定前的旧邮箱决定是否保留验证状态。
      // 不依赖 MySQL ON DUPLICATE KEY UPDATE 的赋值顺序，避免新邮箱继承旧验证标记。
      await tx.insert(users).values(values).onDuplicateKeyUpdate({
        set: { openId: sql`${users.openId}` },
      });
      const lockedRows = await tx
        .select({ email: users.email, emailVerifiedAt: users.emailVerifiedAt })
        .from(users)
        .where(eq(users.openId, user.openId))
        .limit(1)
        .for("update");
      const locked = lockedRows[0];
      if (!locked) throw new Error("User row missing after upsert");

      if (normalizedEmail !== undefined) {
        const oldEmail = locked.email?.trim().toLowerCase() || null;
        updateSet.email = normalizedEmail;
        updateSet.emailVerifiedAt = oldEmail === normalizedEmail ? locked.emailVerifiedAt : null;
      }
      await tx.update(users).set(updateSet).where(eq(users.openId, user.openId));
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ============ 自定义账号 ============

export async function getUserByUsername(username: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

/** 注册时检查独立账号与永久保留的历史用户名命名空间。 */
export async function isUsernameUnavailable(username: string): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("database not available");
  const [primary, historical] = await Promise.all([
    db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1),
    db
      .select({ id: userUsernameHistory.id })
      .from(userUsernameHistory)
      .where(eq(userUsernameHistory.oldUsername, username))
      .limit(1),
  ]);
  return Boolean(primary[0] || historical[0]);
}

export const PHONE_ACCOUNT_CONFLICT_MESSAGE = "该手机号存在历史账号冲突，请联系管理员处理";

export async function getUserByPhone(phone: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(users)
    .where(eq(users.phone, phone))
    .orderBy(asc(users.id))
    .limit(2);
  if (result.length > 1) {
    throw new Error(PHONE_ACCOUNT_CONFLICT_MESSAGE);
  }
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createLocalUser(user: InsertUser) {
  const db = await getDb();
  if (!db) throw new Error("database not available");
  await db.insert(users).values(user);
  return getUserByOpenId(user.openId);
}

/**
 * 经当前绑定手机号验证后暂存新邮箱。新地址在完成邮箱验证码前不替换已验证邮箱，
 * 因而不能用于找回密码或规避已有账号的可信渠道。
 */
export async function stageUserEmail(userId: number, email: string) {
  const db = await getDb();
  if (!db) throw new Error("database not available");
  const normalized = email.trim().toLowerCase();
  return db.transaction(async tx => {
    const currentRows = await tx.select().from(users).where(eq(users.id, userId)).limit(1).for("update");
    const current = currentRows[0];
    if (!current) throw new Error("用户不存在");
    if (current.email?.trim().toLowerCase() === normalized) {
      throw new Error("新邮箱不能与当前邮箱相同");
    }
    const conflict = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, normalized), ne(users.id, userId)))
      .limit(1)
      .for("update");
    if (conflict[0]) throw new Error("该邮箱已绑定其他账号");
    await tx
      .update(users)
      .set({ pendingEmail: normalized })
      .where(eq(users.id, userId));
    return { pendingEmail: normalized };
  });
}

export async function updateUserProfile(
  userId: number,
  data: Partial<Pick<InsertUser, "name" | "email" | "jobTitle" | "wechatId" | "qqId">>
) {
  const db = await getDb();
  if (!db) throw new Error("database not available");
  await db.transaction(async tx => {
    const currentRows = await tx
      .select({ email: users.email, emailVerifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .for("update");
    const current = currentRows[0];
    if (!current) throw new Error("用户不存在");

    const updateData: typeof data & { emailVerifiedAt?: Date | null } = { ...data };
    if (data.email !== undefined) {
      const normalizedEmail = data.email?.trim().toLowerCase() || null;
      const currentEmail = current.email?.trim().toLowerCase() || null;
      updateData.email = normalizedEmail;
      if (normalizedEmail !== currentEmail) updateData.emailVerifiedAt = null;
    }
    await tx.update(users).set(updateData).where(eq(users.id, userId));
  });
}

export const USERNAME_CHANGE_COOLDOWN_DAYS = 30;

export type UsernameChangeResult = {
  oldUsername: string;
  newUsername: string;
  changedAt: Date;
};

/**
 * 原子修改主账号登录用户名。
 *
 * users.openId 是会话使用的稳定身份键，不能随 username 改动；这里只更新
 * users.username，并把旧用户名写入永久保留历史，防止他人冒用历史身份。
 */
export async function changePrimaryUsername(
  userId: number,
  newUsername: string,
): Promise<UsernameChangeResult> {
  const db = await getDb();
  if (!db) throw new Error("database not available");

  return db.transaction(async tx => {
    const currentRows = await tx
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .for("update");
    const current = currentRows[0];
    if (!current?.username) throw new Error("当前账号没有可修改的登录用户名");
    if (current.username.toLowerCase() === newUsername.toLowerCase()) {
      throw new Error("新用户名不能与当前用户名相同");
    }

    const [primaryConflict] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.username, newUsername), ne(users.id, userId)))
      .limit(1);
    const [historicalConflict] = await tx
      .select({ id: userUsernameHistory.id })
      .from(userUsernameHistory)
      .where(eq(userUsernameHistory.oldUsername, newUsername))
      .limit(1);
    if (primaryConflict || historicalConflict) {
      throw new Error("用户名已被使用或属于历史保留名称");
    }

    const [lastChange] = await tx
      .select({ changedAt: userUsernameHistory.changedAt })
      .from(userUsernameHistory)
      .where(eq(userUsernameHistory.userId, userId))
      .orderBy(desc(userUsernameHistory.changedAt))
      .limit(1);
    // 微信首次建号产生的 wx_ 临时名可立即修改；完成第一次修改后进入正常冷却。
    if (lastChange || !/^wx_/i.test(current.username)) {
      const changedAt = lastChange?.changedAt;
      if (changedAt) {
        const nextAllowedAt = new Date(
          changedAt.getTime() + USERNAME_CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000,
        );
        if (nextAllowedAt.getTime() > Date.now()) {
          throw new Error(
            `用户名修改后 ${USERNAME_CHANGE_COOLDOWN_DAYS} 天内不能再次修改`,
          );
        }
      }
    }

    const changedAt = new Date();
    await tx.insert(userUsernameHistory).values({
      userId,
      oldUsername: current.username,
      newUsername,
      changedAt,
    });
    await tx.update(users).set({ username: newUsername }).where(eq(users.id, userId));
    return { oldUsername: current.username, newUsername, changedAt };
  });
}

/**
 * 更新主账号绑定手机号。
 *
 * 路由层负责双验证码与当前手机号校验；数据库唯一索引负责并发请求下
 * “一个手机号只能属于一个账号”的最终仲裁。
 */
export async function updateUserPhone(userId: number, phone: string) {
  const db = await getDb();
  if (!db) throw new Error("database not available");
  await db.update(users).set({ phone }).where(eq(users.id, userId));
}

/** 每日头像更换次数上限 */
export const AVATAR_DAILY_LIMIT = 5;

/**
 * 当前北京日期（YYYY-MM-DD）。
 *
 * 必须显式指定时区：生产进程未设 TZ，若用本地日期，“每日”的分界
 * 会与用户感知错位；与全站北京时间口径（见 schema.ts beijingTime）保持一致。
 */
export function currentBeijingDate(): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * 更新用户头像，并按北京日期统计当日更换次数。
 *
 * 频繁换头像会干扰交易对手对商家的识别，故限额。
 * 返回剩余次数供前端提示；超限抛错，错误文案直接面向用户。
 */
export async function updateUserAvatar(userId: number, avatarUrl: string) {
  const db = await getDb();
  if (!db) throw new Error("database not available");
  const today = currentBeijingDate();
  const current = await getUserById(userId);
  if (!current) throw new Error("用户不存在");
  /* 跨天后旧计数作废，不需要定时任务清零 */
  const sameDay = current.avatarChangeDate === today;
  const used = sameDay ? current.avatarChangeCount : 0;
  if (used >= AVATAR_DAILY_LIMIT) {
    throw new Error(
      `今天已经换过 ${AVATAR_DAILY_LIMIT} 次头像，请明天再试`,
    );
  }
  await db
    .update(users)
    .set({
      avatarUrl,
      avatarChangeCount: used + 1,
      avatarChangeDate: today,
    })
    .where(eq(users.id, userId));
  return { remaining: AVATAR_DAILY_LIMIT - used - 1 };
}

export async function touchLastSignedIn(userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, userId));
}

/** 同步用户 CRM 权限兼容缓存；后台 CRM 状态仍是最终事实源。 */
export async function setCrmAccess(userId: number, enabled: boolean) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ crmAccess: enabled }).where(eq(users.id, userId));
}

/** 兼容旧调用：仅开通 CRM 使用权限。 */
export async function grantCrmAccess(userId: number) {
  return setCrmAccess(userId, true);
}

export type AdminCrmSyncAction = "approve" | "reject" | "revoke" | "noop";

/** 只有后台已确认当前 portalUserId 归属时，才允许改变前台本地 CRM 门禁。 */
export function deriveAdminCrmSyncAction(result: {
  allowed: boolean;
  code: string;
  crmStatus: "none" | "pending" | "enabled" | "disabled" | "rejected";
}): AdminCrmSyncAction {
  if (result.allowed && result.code === "CRM_ACCESS_GRANTED" && result.crmStatus === "enabled") {
    return "approve";
  }
  if (result.code === "CRM_BINDING_REQUIRED") {
    return "noop";
  }
  if (result.code === "CRM_APPLICATION_REJECTED" && result.crmStatus === "rejected") {
    return "reject";
  }
  if (result.code === "CRM_ACCESS_DISABLED" && result.crmStatus === "disabled") {
    return "revoke";
  }
  return "noop";
}

/**
 * 将后台已确认且归属当前账号的 CRM 状态映射到前台本地门禁。
 * CRM_BINDING_REQUIRED / 已绑定其他账号等结果不会触碰本地权限。
 */
export async function applyAdminCrmAccess(
  userId: number,
  result: {
    allowed: boolean;
    code: string;
    crmStatus: "none" | "pending" | "enabled" | "disabled" | "rejected";
    message?: string | null;
  },
) {
  const db = await getDb();
  if (!db) throw new Error("database not available");
  const company = await getCompanyByUserId(userId);
  if (!company) return;
  const action = deriveAdminCrmSyncAction(result);

  if (company.registrationRegion === "HK") {
    // HK registration promotion is an explicit audited backend transaction.
    // An already-enabled owner status never implies approval of a new draft.
    if (action === "approve" || action === "revoke" || action === "reject") {
      await db.update(users).set({ crmAccess: action === "approve" }).where(eq(users.id, userId));
    }
    return;
  }

  if (action === "approve") {
    if (company.reviewStatus !== "approved") {
      await reviewCompany(company.id, "approve");
    } else {
      await db.update(users).set({ crmAccess: true }).where(eq(users.id, userId));
    }
    return;
  }

  if (action === "revoke" || action === "reject") {
    await db.update(users).set({ crmAccess: false }).where(eq(users.id, userId));
    if (action === "reject") {
      await db.update(companies).set({
        reviewStatus: "rejected",
        rejectReason: result.message || "后台审核未通过",
        reviewedAt: new Date(),
      }).where(eq(companies.id, company.id));
    }
  }
}

/** 更新用户密码 */
export async function updateUserPassword(userId: number, passwordHash: string) {
  const db = await getDb();
  if (!db) throw new Error("database not available");
  await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
}

// ============ 协议签署存证 ============

/** 写入用户协议在线签署记录（注册时电子签名存证） */
export async function createAgreementSignature(data: InsertAgreementSignature) {
  const db = await getDb();
  if (!db) throw new Error("database not available");
  await db.insert(agreementSignatures).values(data);
}

/** 查询用户的协议签署记录 */
export async function getAgreementSignaturesByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(agreementSignatures)
    .where(eq(agreementSignatures.userId, userId))
    .orderBy(desc(agreementSignatures.signedAt));
}

/** 当前版本企业服务协议是否已由该账号明确接受。 */
export async function hasEnterpriseServiceAgreementAcceptance(
  userId: number,
  agreementVersion: string,
  agreementHash: string,
) {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .select({ id: enterpriseServiceAgreementAcceptances.id })
    .from(enterpriseServiceAgreementAcceptances)
    .where(and(
      eq(enterpriseServiceAgreementAcceptances.userId, userId),
      eq(enterpriseServiceAgreementAcceptances.agreementVersion, agreementVersion),
      eq(enterpriseServiceAgreementAcceptances.agreementHash, agreementHash),
    ))
    .limit(1);
  return rows.length > 0;
}

/**
 * 保存企业服务协议接受记录。唯一键保证浏览器重试或双击不会生成重复证据；
 * 已存在时不覆盖首次同意时间、IP、设备或企业快照。
 */
export async function recordEnterpriseServiceAgreementAcceptance(
  data: InsertEnterpriseServiceAgreementAcceptance,
) {
  const db = await getDb();
  if (!db) throw new Error("database not available");
  await db
    .insert(enterpriseServiceAgreementAcceptances)
    .values(data)
    .onDuplicateKeyUpdate({
      set: { agreementName: data.agreementName },
    });
  return hasEnterpriseServiceAgreementAcceptance(
    data.userId,
    data.agreementVersion,
    data.agreementHash,
  );
}

// ============ 企业信息 ============

export async function getCompanyByUserId(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(companies).where(eq(companies.userId, userId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function upsertCompany(userId: number, data: Omit<InsertCompany, "userId" | "id">) {
  const db = await getDb();
  if (!db) throw new Error("database not available");
  const existing = await getCompanyByUserId(userId);
  if (existing) {
    await db.update(companies).set(data).where(eq(companies.userId, userId));
  } else {
    await db.insert(companies).values({ ...data, userId });
  }
  return getCompanyByUserId(userId);
}

/** 待审核草稿的字段结构（与表单一致） */
export type CompanyDraft = {
  companyName: string;
  creditCode: string;
  companyType: string;
  legalPerson: string;
  companyRole: string | null;
  bankAccountName: string;
  bankAccountNumber: string;
  bankName: string;
  regAddress: string;
  establishedAt: string | null;
  salesOwner: string | null;
  /** 销售负责人工号；旧草稿可能没有此字段，故为可选 */
  salesOwnerCode?: string | null;
};

/**
 * 提交企业资料（人工审核流程）：
 * - 首次提交 / 尚未通过审核的企业：直接写入生效字段，reviewStatus=pending
 * - 已通过审核（approved）的企业修改资料：生效字段保持不变，新内容存入 pendingDraft，
 *   reviewStatus=pending，审核通过后草稿才替换生效字段
 */
export async function submitCompanyForReview(userId: number, draft: CompanyDraft) {
  const db = await getDb();
  if (!db) throw new Error("database not available");
  const existing = await getCompanyByUserId(userId);
  const now = new Date();
  if (existing && existing.reviewStatus === "approved" && existing.companyName) {
    // 已生效企业修改资料：维持原信息，新内容进草稿
    await db
      .update(companies)
      .set({
        pendingDraft: JSON.stringify(draft),
        reviewStatus: "pending",
        rejectReason: null,
        submittedAt: now,
      })
      .where(eq(companies.userId, userId));
  } else if (existing) {
    // 首次提交或此前未通过：直接写生效字段
    await db
      .update(companies)
      .set({
        ...draft,
        pendingDraft: null,
        reviewStatus: "pending",
        rejectReason: null,
        submittedAt: now,
      })
      .where(eq(companies.userId, userId));
  } else {
    await db.insert(companies).values({
      ...draft,
      userId,
      reviewStatus: "pending",
      submittedAt: now,
    });
  }
  return getCompanyByUserId(userId);
}

// ============ 企业认证审核 ============

/** 管理员：按状态列出企业认证申请（联表提交用户信息） */
export async function listCompaniesForReview(status?: "pending" | "approved" | "rejected") {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      company: companies,
      userName: users.name,
      userUsername: users.username,
      userPhone: users.phone,
      userEmail: users.email,
      userCrmAccess: users.crmAccess,
    })
    .from(companies)
    .leftJoin(users, eq(companies.userId, users.id))
    .where(status ? eq(companies.reviewStatus, status) : undefined)
    .orderBy(desc(companies.updatedAt));
  return rows;
}

/**
 * 管理员审核企业认证：
 * - approve：reviewStatus=approved、certLevel 升为 certified（premium 不降级）、开通该用户 crmAccess；
 *   若存在 pendingDraft（已生效企业的修改申请），审核通过时草稿内容替换生效字段
 * - reject：reviewStatus=rejected、记录驳回原因；不回收已开通的 crmAccess（修改资料重审被驳回时保留原权限）
 */
export async function reviewCompany(
  companyId: number,
  action: "approve" | "reject",
  rejectReason?: string,
) {
  const db = await getDb();
  if (!db) throw new Error("database not available");
  const found = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (found.length === 0) throw new Error("company not found");
  const company = found[0];
  if (company.registrationRegion === "HK") throw new Error("香港资料只可通过后台独立BR／CI审核事务处理");
  if (action === "approve") {
    const approvedAt = new Date();
    // 审核通过：如有待审核草稿，先把草稿应用为生效字段
    let draftFields: Partial<CompanyDraft> = {};
    if (company.pendingDraft) {
      try {
        draftFields = JSON.parse(company.pendingDraft) as CompanyDraft;
      } catch {
        draftFields = {};
      }
    }
    await db
      .update(companies)
      .set({
        ...draftFields,
        pendingDraft: null,
        reviewStatus: "approved",
        rejectReason: null,
        reviewedAt: approvedAt,
        // 首次审核通过即确立入驻日期；资料复审不得覆盖原始入驻时间。
        merchantSinceAt: company.merchantSinceAt ?? approvedAt,
        certLevel: company.certLevel === "premium" ? "premium" : "certified",
      })
      .where(eq(companies.id, companyId));
    await db.update(users).set({ crmAccess: true }).where(eq(users.id, company.userId));
  } else {
    await db
      .update(companies)
      .set({
        reviewStatus: "rejected",
        rejectReason: rejectReason || "资料不符合认证要求",
        // 驳回：清除草稿（原生效信息保持不变），用户可修改后重新提交
        pendingDraft: null,
        reviewedAt: new Date(),
      })
      .where(eq(companies.id, companyId));
  }
  const updated = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  return updated[0];
}

// ============ 库存 ============

/**
 * 商户自己的库存列表。
 *
 * 排序按 updatedAt 的「最近一次变动」倒序，而非建立时间。
 * 该字段能被 (userId, status, updatedAt, id) 复合索引覆盖；末尾再按 id
 * 倒序，保证时间相同时顺序稳定，避免服务端分页重复或遗漏。
 */
export type InventoryListInput = {
  status?: "draft" | "published" | "offshelf";
  partNumber?: string;
  brand?: string;
  category?: string;
  page?: number;
  pageSize?: number;
};

function inventoryLikePattern(value: string) {
  return `%${value.replace(/[\\%_]/g, match => `\\${match}`)}%`;
}

/**
 * Inventory management always receives an enterprise selected and authorized by
 * the request layer.  Old rows with a NULL enterpriseId are compatible only
 * while their data owner has exactly one enterprise, proven at query time.
 * They are never treated as belonging to every enterprise of the same owner.
 */
type InventoryEnterpriseScope = Readonly<{
  enterpriseId: number;
  includeVerifiedLegacyNull: boolean;
}>;

function assertInventoryEnterpriseId(enterpriseId: number | undefined): asserts enterpriseId is number {
  if (typeof enterpriseId !== "number" || !Number.isSafeInteger(enterpriseId) || enterpriseId <= 0) {
    throw new Error("库存企业范围缺失，拒绝操作");
  }
}

async function resolveInventoryEnterpriseScope(
  database: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  userId: number,
  enterpriseId: number | undefined,
): Promise<InventoryEnterpriseScope> {
  assertInventoryEnterpriseId(enterpriseId);
  const assignments = await database
    .select({ id: enterprises.id })
    .from(enterprises)
    .where(eq(enterprises.crmDataOwnerUserId, userId))
    .orderBy(asc(enterprises.id))
    .limit(2);
  const selected = assignments.some(enterprise => enterprise.id === enterpriseId);
  if (!selected) {
    throw new Error("库存企业范围与数据所有者不匹配，拒绝操作");
  }
  return {
    enterpriseId,
    includeVerifiedLegacyNull: assignments.length === 1,
  };
}

function inventoryEnterpriseCondition(scope: InventoryEnterpriseScope) {
  return scope.includeVerifiedLegacyNull
    ? or(eq(inventories.enterpriseId, scope.enterpriseId), isNull(inventories.enterpriseId))
    : eq(inventories.enterpriseId, scope.enterpriseId);
}

export async function listInventories(
  userId: number,
  enterpriseId: number | undefined,
  input: InventoryListInput = {},
  ownerUserId?: number,
) {
  const page = Math.max(1, Math.trunc(input.page ?? 1));
  const pageSize = Math.min(
    INVENTORY_LIST_MAX_PAGE_SIZE,
    Math.max(1, Math.trunc(input.pageSize ?? INVENTORY_LIST_DEFAULT_PAGE_SIZE)),
  );
  const db = await getDb();
  if (!db) return { items: [], total: 0, page, pageSize, pageCount: 1 };
  const scope = await resolveInventoryEnterpriseScope(db, userId, enterpriseId);
  const conditions = [
    eq(inventories.userId, userId),
    inventoryEnterpriseCondition(scope),
  ];
  if (input.status) conditions.push(eq(inventories.status, input.status));
  if (ownerUserId) conditions.push(eq(inventories.ownerUserId, ownerUserId));
  const normalizedPartNumber = input.partNumber?.normalize("NFKC").trim().toUpperCase();
  if (normalizedPartNumber) {
    conditions.push(like(inventories.partNumberNormalized, inventoryLikePattern(normalizedPartNumber)));
  }
  const brand = input.brand?.trim();
  if (brand) conditions.push(like(inventories.brand, inventoryLikePattern(brand)));
  const category = input.category?.trim();
  if (category) conditions.push(eq(inventories.category, category));
  const condition = and(...conditions);
  const [summary] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(inventories)
    .where(condition);
  const total = Number(summary?.count ?? 0);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const items = await db
    .select()
    .from(inventories)
    .where(condition)
    .orderBy(desc(inventories.updatedAt), desc(inventories.id))
    .limit(pageSize)
    .offset((safePage - 1) * pageSize);
  return { items, total, page: safePage, pageSize, pageCount };
}

/** 搜索与核验页统一使用的库存快照指纹SQL；价格变化不使核验失效。 */
const inventorySpotFingerprintSql = sql<string>`SHA2(CONCAT_WS(CHAR(10),
  UPPER(TRIM(${inventories.partNumber})),
  CAST(${inventories.qtyOnSale} AS CHAR),
  CAST(${inventories.qtyStock} AS CHAR),
  COALESCE(UPPER(TRIM(${inventories.dateCode})), ''),
  COALESCE(UPPER(TRIM(${inventories.grade})), ''),
  COALESCE(UPPER(TRIM(${inventories.source})), ''),
  COALESCE(UPPER(TRIM(${inventories.warehouseAddress})), '')
), 256)`;

/** Only packaging audit rows use a manufacturer-bound v1 fingerprint. */
const inventorySpotPackagingFingerprintSql = sql<string>`SHA2(CONCAT_WS(CHAR(10),
  'spot-packaging-v1', ${inventorySpotFingerprintSql}, UPPER(TRIM(${inventories.brand}))
), 256)`;
function spotAuditFingerprintSql(alias: "spot" | "verification") {
  return sql<string>`CASE WHEN ${sql.raw(alias + ".matchRule")} = 'packaging'
    THEN ${inventorySpotPackagingFingerprintSql} ELSE ${inventorySpotFingerprintSql} END`;
}

export type SpotVerificationInventoryRow = {
  id: number;
  partNumber: string;
  brand: string;
  dateCode: string | null;
  qtyOnSale: number;
  refreshedAt: Date | null;
  spotVerifiedAt: Date | null;
  spotVerificationExpiresAt: Date | null;
  spotVerificationStatus: "verified" | "expired" | "inventory_changed" | "unverified";
};

/** 当前权限范围内的在售库存及最近一次现货核验状态。 */
export async function listSpotVerificationInventories(
  dataOwnerUserId: number,
  enterpriseId: number,
  ownerUserId?: number,
): Promise<SpotVerificationInventoryRow[]> {
  const database = await getDb();
  if (!database) return [];
  const scope = await resolveInventoryEnterpriseScope(database, dataOwnerUserId, enterpriseId);
  const enterpriseCondition = scope.includeVerifiedLegacyNull
    ? sql`AND (${inventories.enterpriseId} = ${scope.enterpriseId} OR ${inventories.enterpriseId} IS NULL)`
    : sql`AND ${inventories.enterpriseId} = ${scope.enterpriseId}`;
  const ownerCondition = ownerUserId
    ? sql`AND ${inventories.ownerUserId} = ${ownerUserId}`
    : sql``;
  const result = await database.execute(sql`
    SELECT ${inventories.id} AS id,
           ${inventories.partNumber} AS partNumber,
           ${inventories.brand} AS brand,
           ${inventories.dateCode} AS dateCode,
           ${inventories.qtyOnSale} AS qtyOnSale,
           COALESCE(${inventories.refreshedAt}, ${inventories.publishedAt}, ${inventories.createdAt}) AS refreshedAt,
           CASE
             WHEN verification.expiresAt > NOW()
              AND verification.inventoryFingerprint = ${spotAuditFingerprintSql("verification")}
             THEN verification.verifiedAt ELSE NULL
           END AS spotVerifiedAt,
           verification.expiresAt AS spotVerificationExpiresAt,
           CASE
             WHEN verification.id IS NULL THEN 'unverified'
             WHEN verification.inventoryFingerprint <> ${spotAuditFingerprintSql("verification")}
             THEN 'inventory_changed'
             WHEN verification.expiresAt > NOW()
             THEN 'verified'
             ELSE 'expired'
           END AS spotVerificationStatus
      FROM ${inventories}
      LEFT JOIN ${inventorySpotVerifications} verification
        ON verification.id = (
          SELECT MAX(latestVerification.id)
            FROM ${inventorySpotVerifications} latestVerification
           WHERE latestVerification.inventoryId = ${inventories.id}
        )
     WHERE ${inventories.userId} = ${dataOwnerUserId}
       ${enterpriseCondition}
       AND ${inventories.status} = 'published'
       AND ${inventories.qtyOnSale} > 0
       ${ownerCondition}
     ORDER BY spotVerifiedAt IS NULL ASC, spotVerifiedAt DESC,
              COALESCE(${inventories.refreshedAt}, ${inventories.updatedAt}) DESC,
              ${inventories.id} DESC
  `);
  const rows = (result as unknown as [Record<string, unknown>[], unknown])[0] ?? [];
  return rows.map(row => ({
    id: Number(row.id),
    partNumber: String(row.partNumber || ""),
    brand: String(row.brand || ""),
    dateCode: typeof row.dateCode === "string" ? row.dateCode : null,
    qtyOnSale: Number(row.qtyOnSale || 0),
    refreshedAt: (row.refreshedAt as Date | null) ?? null,
    spotVerifiedAt: (row.spotVerifiedAt as Date | null) ?? null,
    spotVerificationExpiresAt: (row.spotVerificationExpiresAt as Date | null) ?? null,
    spotVerificationStatus:
      row.spotVerificationStatus === "verified"
        ? "verified"
        : row.spotVerificationStatus === "expired"
          ? "expired"
          : row.spotVerificationStatus === "inventory_changed"
            ? "inventory_changed"
          : "unverified",
  }));
}

export type SpotInventoryCandidateRow = {
  id: number;
  partNumber: string;
  brand: string;
  dateCode: string | null;
  qtyOnSale: number;
  qtyStock: number;
  grade: string | null;
  source: string | null;
  warehouseAddress: string | null;
};

/** Only scoped exact lookup keys, never load the enterprise's entire inventory. */
export async function listSpotInventoryCandidateRows(
  dataOwnerUserId: number,
  enterpriseId: number,
  ownerUserId: number | undefined,
  partNumbers: string[],
): Promise<SpotInventoryCandidateRow[]> {
  const keys = Array.from(new Set(partNumbers.map(normalizeSpotPartNumber).filter(Boolean)));
  if (!keys.length || keys.length > 6 || keys.some(key => key.length > 128)) return [];
  const database = await getDb();
  if (!database) throw new Error("SPOT_DATABASE_UNAVAILABLE");
  const scope = await resolveInventoryEnterpriseScope(database, dataOwnerUserId, enterpriseId);
  return database.select({
    id: inventories.id,
    partNumber: inventories.partNumber,
    brand: inventories.brand,
    dateCode: inventories.dateCode,
    qtyOnSale: inventories.qtyOnSale,
    qtyStock: inventories.qtyStock,
    grade: inventories.grade,
    source: inventories.source,
    warehouseAddress: inventories.warehouseAddress,
  }).from(inventories).where(and(
    eq(inventories.userId, dataOwnerUserId),
    inventoryEnterpriseCondition(scope),
    eq(inventories.status, "published"),
    gt(inventories.qtyOnSale, 0),
    ownerUserId ? eq(inventories.ownerUserId, ownerUserId) : undefined,
    inArray(inventories.partNumberNormalized, keys),
  )).orderBy(asc(inventories.id)).limit(30);
}

export async function findSpotInventoryVerification(input: {
  enterpriseId: number;
  verifiedByUserId: number;
  requestId: string;
  photoSha256: string;
}) {
  const database = await getDb();
  if (!database) return null;
  const rows = await database
    .select({
      inventoryId: inventorySpotVerifications.inventoryId,
      inventoryPartNumber: inventorySpotVerifications.inventoryPartNumber,
      recognizedPartNumber: inventorySpotVerifications.recognizedPartNumber,
      matchRule: inventorySpotVerifications.matchRule,
      verifiedAt: inventorySpotVerifications.verifiedAt,
      expiresAt: inventorySpotVerifications.expiresAt,
      requestId: inventorySpotVerifications.requestId,
      photoSha256: inventorySpotVerifications.photoSha256,
      enterpriseId: inventorySpotVerifications.enterpriseId,
      verifiedByUserId: inventorySpotVerifications.verifiedByUserId,
    })
    .from(inventorySpotVerifications)
    .where(
      or(
        and(
          eq(inventorySpotVerifications.enterpriseId, input.enterpriseId),
          eq(inventorySpotVerifications.verifiedByUserId, input.verifiedByUserId),
          eq(inventorySpotVerifications.requestId, input.requestId),
        ),
        eq(inventorySpotVerifications.photoSha256, input.photoSha256),
      ),
    )
    .limit(2);
  const requestMatch = rows.find(row => row.requestId === input.requestId
    && row.enterpriseId === input.enterpriseId
    && row.verifiedByUserId === input.verifiedByUserId);
  if (requestMatch) {
    return {
      kind: requestMatch.photoSha256 === input.photoSha256 ? "idempotent" as const : "request_conflict" as const,
      row: requestMatch,
    };
  }
  return rows[0] ? { kind: "duplicate_photo" as const, row: rows[0] } : null;
}

export type CreateSpotVerificationInput = {
  inventoryId: number;
  dataOwnerUserId: number;
  enterpriseId: number;
  verifiedByUserId: number;
  ownerUserId?: number;
  match: SpotInventoryMatch;
  photo: { key: string; sha256: string };
  requestId: string;
  modelName: string;
  verifiedAt: Date;
  expiresAt: Date;
  expectedFingerprint?: string;
  expectedBrand?: string;
  requireSelectedInventory?: boolean;
  requireUniqueCandidate?: boolean;
};

/** 核验成功后追加审计记录；同一照片全局只能成功一次。 */
export async function createSpotInventoryVerification(input: CreateSpotVerificationInput) {
  const database = await getDb();
  if (!database) return { ok: false as const, reason: "database" as const };
  const scope = await resolveInventoryEnterpriseScope(
    database,
    input.dataOwnerUserId,
    input.enterpriseId,
  );
  return database.transaction(async tx => {
    const existingRequest = (
      await tx
        .select({
          inventoryId: inventorySpotVerifications.inventoryId,
          inventoryPartNumber: inventorySpotVerifications.inventoryPartNumber,
          recognizedPartNumber: inventorySpotVerifications.recognizedPartNumber,
          matchRule: inventorySpotVerifications.matchRule,
          photoSha256: inventorySpotVerifications.photoSha256,
          verifiedAt: inventorySpotVerifications.verifiedAt,
          expiresAt: inventorySpotVerifications.expiresAt,
        })
        .from(inventorySpotVerifications)
        .where(
          and(
            eq(inventorySpotVerifications.enterpriseId, input.enterpriseId),
            eq(inventorySpotVerifications.verifiedByUserId, input.verifiedByUserId),
            eq(inventorySpotVerifications.requestId, input.requestId),
          ),
        )
        .limit(1)
    )[0];
    if (existingRequest) {
      if (existingRequest.photoSha256 !== input.photo.sha256) {
        return { ok: false as const, reason: "request_conflict" as const };
      }
      if (input.requireSelectedInventory && existingRequest.inventoryId !== input.inventoryId) {
        return { ok: false as const, reason: "request_conflict" as const };
      }
      return {
        ok: true as const,
        idempotent: true as const,
        inventoryId: existingRequest.inventoryId,
        partNumber: existingRequest.inventoryPartNumber,
        recognizedPartNumber: existingRequest.recognizedPartNumber,
        matchRule: existingRequest.matchRule,
        verifiedAt: existingRequest.verifiedAt,
        expiresAt: existingRequest.expiresAt,
      };
    }
    if (input.requireUniqueCandidate) {
      // REPEATABLE READ + indexed locking read keeps matching range inserts/updates
      // behind this transaction; never infer uniqueness from a truncated result.
      const keys = spotVerificationSearchPartNumbers(input.match.recognizedPartNumber)
        .map(normalizeSpotPartNumber).filter(Boolean);
      if (!keys.length || keys.length > 6 || keys.some(key => key.length > 128)) {
        return { ok: false as const, reason: "inventory_changed" as const };
      }
      const candidates = await tx.select({
        id: inventories.id,
        partNumber: inventories.partNumber,
        brand: inventories.brand,
        qtyOnSale: inventories.qtyOnSale,
      }).from(inventories, { forceIndex: input.ownerUserId
        ? "inventories_spot_candidate_owner_idx" : "inventories_spot_candidate_idx" }).where(and(
        eq(inventories.userId, input.dataOwnerUserId),
        inventoryEnterpriseCondition(scope),
        eq(inventories.status, "published"),
        input.ownerUserId ? eq(inventories.ownerUserId, input.ownerUserId) : undefined,
        inArray(inventories.partNumberNormalized, keys),
      )).orderBy(asc(inventories.partNumberNormalized), asc(inventories.id)).limit(30).for("update");
      const uniqueMatches = selectSpotInventoryCandidates(input.match.recognizedPartNumber,
        candidates.filter(candidate => candidate.qtyOnSale > 0), 5);
      if (candidates.length >= 30 || uniqueMatches.length !== 1
        || uniqueMatches[0]?.inventoryId !== input.inventoryId) {
        return { ok: false as const, reason: "inventory_changed" as const };
      }
    }
    const inventory = (
      await tx
        .select({
          id: inventories.id,
          partNumber: inventories.partNumber,
          qtyOnSale: inventories.qtyOnSale,
          qtyStock: inventories.qtyStock,
          dateCode: inventories.dateCode,
          grade: inventories.grade,
          source: inventories.source,
          warehouseAddress: inventories.warehouseAddress,
          brand: inventories.brand,
        })
        .from(inventories)
        .where(
          and(
            eq(inventories.id, input.inventoryId),
            eq(inventories.userId, input.dataOwnerUserId),
            inventoryEnterpriseCondition(scope),
            eq(inventories.status, "published"),
            gt(inventories.qtyOnSale, 0),
            input.ownerUserId ? eq(inventories.ownerUserId, input.ownerUserId) : undefined,
          ),
        )
        .limit(1)
        .for("update")
    )[0];
    if (!inventory) return { ok: false as const, reason: "inventory" as const };

    const duplicatePhoto = (
      await tx
        .select({ id: inventorySpotVerifications.id })
        .from(inventorySpotVerifications)
        .where(eq(inventorySpotVerifications.photoSha256, input.photo.sha256))
        .limit(1)
    )[0];
    if (duplicatePhoto) return { ok: false as const, reason: "duplicate_photo" as const };

    const inventoryFingerprint = spotVerificationMatchFingerprint({
      partNumber: inventory.partNumber,
      qtyOnSale: inventory.qtyOnSale,
      qtyStock: inventory.qtyStock,
      dateCode: inventory.dateCode,
      grade: inventory.grade,
      source: inventory.source,
      warehouseAddress: inventory.warehouseAddress,
      brand: inventory.brand,
    }, input.match.rule === "packaging" ? "packaging" : "exact");
    if (input.requireSelectedInventory) {
      const freshMatch = selectSpotInventoryCandidates(input.match.recognizedPartNumber, [inventory], 1)[0];
      if (!input.expectedFingerprint || inventoryFingerprint !== input.expectedFingerprint
        || inventory.brand !== input.expectedBrand || !freshMatch
        || freshMatch.rule !== input.match.rule
        || freshMatch.inventoryPartNumber !== input.match.inventoryPartNumber) {
        return { ok: false as const, reason: "inventory_changed" as const };
      }
    }
    await tx.insert(inventorySpotVerifications).values({
      inventoryId: inventory.id,
      enterpriseId: input.enterpriseId,
      dataOwnerUserId: input.dataOwnerUserId,
      verifiedByUserId: input.verifiedByUserId,
      recognizedPartNumber: input.match.recognizedPartNumber,
      inventoryPartNumber: inventory.partNumber,
      matchRule: input.match.rule,
      matchScore: input.match.score.toFixed(4),
      photoKey: input.photo.key,
      photoSha256: input.photo.sha256,
      requestId: input.requestId,
      inventoryFingerprint,
      modelName: input.modelName,
      verifiedAt: input.verifiedAt,
      expiresAt: input.expiresAt,
    });
    return {
      ok: true as const,
      idempotent: false as const,
      inventoryId: inventory.id,
      partNumber: inventory.partNumber,
      verifiedAt: input.verifiedAt,
      expiresAt: input.expiresAt,
    };
  }, input.requireUniqueCandidate ? { isolationLevel: "repeatable read" } : undefined);
}

export type PublishedInventoryPriceCandidate = {
  id: number;
  partNumber: string;
  brand: string;
  category: string;
  pkg: string | null;
  priceEx: string | null;
  taxIncluded: boolean;
  ladderPrices: unknown;
  moq: number | null;
  qtyOnSale: number;
};

/**
 * 数据通查价使用的真实在售价格候选。
 *
 * 只允许完整订购型号精确匹配：忽略大小写与首尾空格，但保留 `/3Z`、
 * `/1Z`、`K` 等订购后缀，避免同族不同物料串价。下架、草稿和零库存
 * 都不能影响公开参考价。
 */
export async function listPublishedInventoryPriceCandidates(
  partNumber: string,
): Promise<PublishedInventoryPriceCandidate[]> {
  const db = await getDb();
  if (!db) return [];
  const normalized = partNumber.normalize("NFKC").trim().toUpperCase();
  if (!normalized) return [];
  const rows = await db
    .select({
      id: inventories.id,
      partNumber: inventories.partNumber,
      brand: inventories.brand,
      category: inventories.category,
      pkg: inventories.pkg,
      priceEx: inventories.priceEx,
      taxIncluded: inventories.taxIncluded,
      ladderPrices: inventories.ladderPrices,
      moq: inventories.moq,
      qtyOnSale: inventories.qtyOnSale,
    })
    .from(inventories)
    .where(
      and(
        eq(inventories.status, "published"),
        gt(inventories.qtyOnSale, 0),
        resolveMarketPackagingGroup(normalized)
          ? inArray(inventories.partNumberNormalized, marketPackagingLookupKeys(normalized))
          : sql`UPPER(TRIM(${inventories.partNumber})) = ${normalized}`,
      ),
    );
  return rows.filter(row => !resolveMarketPackagingGroup(normalized) || (isMarketPackagingBrandCompatible(row.partNumber, row.brand) && isMarketPackagingPackageCompatible(row.partNumber, row.pkg)));
}

/**
 * 库存一键刷新的冷却时长：每个商户 24 小时只能成功刷新一次。
 *
 * 刷新会直接抬高搜索排名的新鲜度得分，不限频率等于开放刷榜。
 */
export const INVENTORY_REFRESH_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export type InventoryRefreshStatus = {
  /** 当前已发布库存条数 */
  publishedCount: number;
  /** 最近一次刷新时间（派生自 refreshedAt / publishedAt / createdAt） */
  lastRefreshedAt: Date | null;
  canRefresh: boolean;
  /** 下一次允许刷新的时间点 */
  nextAllowedAt: Date | null;
};

/** 把聚合查询行换算为刷新状态（db 查询与命名锁分支共用同一判定口径）。 */
function inventoryRefreshStatusFromRow(row: {
  publishedCount: number | string | null;
  lastRefreshedAt: Date | string | null;
}): InventoryRefreshStatus {
  const publishedCount = Number(row.publishedCount ?? 0);
  const lastRefreshedAt = row.lastRefreshedAt ? new Date(row.lastRefreshedAt) : null;
  const nextAllowedAt = lastRefreshedAt
    ? new Date(lastRefreshedAt.getTime() + INVENTORY_REFRESH_COOLDOWN_MS)
    : null;
  return {
    publishedCount,
    lastRefreshedAt,
    canRefresh: publishedCount > 0 && (!nextAllowedAt || nextAllowedAt.getTime() <= Date.now()),
    nextAllowedAt,
  };
}

/** 查询当前商户的库存刷新状态与下次可操作时间。 */
export async function getInventoryRefreshStatus(
  userId: number,
  enterpriseId: number | undefined,
  ownerUserId?: number,
): Promise<InventoryRefreshStatus> {
  const db = await getDb();
  if (!db) throw new Error("database not available");
  const scope = await resolveInventoryEnterpriseScope(db, userId, enterpriseId);
  const [row] = await db
    .select({
      publishedCount: sql<number>`COUNT(*)`,
      lastRefreshedAt: sql<Date | null>`MAX(COALESCE(${inventories.refreshedAt}, ${inventories.publishedAt}, ${inventories.createdAt}))`,
    })
    .from(inventories)
    .where(
      and(
        eq(inventories.userId, userId),
        inventoryEnterpriseCondition(scope),
        eq(inventories.status, "published"),
        ownerUserId ? eq(inventories.ownerUserId, ownerUserId) : undefined,
      ),
    );
  return inventoryRefreshStatusFromRow({
    publishedCount: Number(row?.publishedCount ?? 0),
    lastRefreshedAt: row?.lastRefreshedAt ?? null,
  });
}

/**
 * 一键确认全部已发布库存仍有效（只更新 refreshedAt）。
 *
 * 用 MySQL 命名锁而不用事务：UPDATE 是整个商户的批量更新，
 * 事务锁范围过大且容易与发布、下架等操作互锁；
 * 命名锁按商户隔离，10 秒超时避免请求堆积。
 * 冷却判定必须在拿到锁之后复查，否则并发请求能绕过 24 小时限制。
 */
export async function refreshPublishedInventories(
  userId: number,
  enterpriseId: number | undefined,
  ownerUserId?: number,
): Promise<
  InventoryRefreshStatus & {
    refreshedCount: number;
    /** null 为刷新成功；empty 无可刷新库存；cooldown 冷却未过 */
    reason: "empty" | "cooldown" | null;
  }
> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("database not available");
  const db = await getDb();
  if (!db) throw new Error("database not available");
  const scope = await resolveInventoryEnterpriseScope(db, userId, enterpriseId);
  const connection = await mysql.createConnection(withTimezone(databaseUrl));
  const lockName = `dianzi51_inventory_refresh_${scope.enterpriseId}_${userId}_${ownerUserId ?? "all"}`;
  let locked = false;
  try {
    const [lockRows] = await connection.query<RowDataPacket[]>(
      "SELECT GET_LOCK(?, 10) AS acquired",
      [lockName]
    );
    locked = Number(lockRows[0]?.acquired ?? 0) === 1;
    if (!locked) throw new Error("库存刷新操作繁忙，请稍后重试");

    const enterpriseClause = scope.includeVerifiedLegacyNull
      ? " AND (enterpriseId = ? OR enterpriseId IS NULL)"
      : " AND enterpriseId = ?";
    const ownerClause = ownerUserId ? " AND ownerUserId = ?" : "";
    const queryParams = ownerUserId
      ? [userId, scope.enterpriseId, ownerUserId]
      : [userId, scope.enterpriseId];
    const [statusRows] = await connection.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS publishedCount,
              MAX(COALESCE(refreshedAt, publishedAt, createdAt)) AS lastRefreshedAt
         FROM inventories
        WHERE userId = ?${enterpriseClause} AND status = 'published'${ownerClause}`,
      queryParams,
    );
    const status = inventoryRefreshStatusFromRow({
      publishedCount: statusRows[0]?.publishedCount ?? 0,
      lastRefreshedAt: statusRows[0]?.lastRefreshedAt ?? null,
    });
    if (status.publishedCount === 0) {
      return { ...status, refreshedCount: 0, reason: "empty" };
    }
    if (!status.canRefresh) {
      return { ...status, refreshedCount: 0, reason: "cooldown" };
    }

    const now = new Date();
    const [result] = await connection.execute<import("mysql2").ResultSetHeader>(
      `UPDATE inventories SET refreshedAt = ? WHERE userId = ?${enterpriseClause} AND status = 'published'${ownerClause}`,
      ownerUserId
        ? [now, userId, scope.enterpriseId, ownerUserId]
        : [now, userId, scope.enterpriseId],
    );
    return {
      publishedCount: status.publishedCount,
      lastRefreshedAt: now,
      canRefresh: false,
      nextAllowedAt: new Date(now.getTime() + INVENTORY_REFRESH_COOLDOWN_MS),
      refreshedCount: Number(result.affectedRows ?? 0),
      reason: null,
    };
  } finally {
    if (locked) {
      await connection.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => undefined);
    }
    await connection.end();
  }
}

export async function getInventoryById(
  id: number,
  userId: number,
  enterpriseId: number | undefined,
  ownerUserId?: number,
) {
  const db = await getDb();
  if (!db) return undefined;
  const scope = await resolveInventoryEnterpriseScope(db, userId, enterpriseId);
  const result = await db
    .select()
    .from(inventories)
    .where(
      and(
        eq(inventories.id, id),
        eq(inventories.userId, userId),
        inventoryEnterpriseCondition(scope),
        ownerUserId ? eq(inventories.ownerUserId, ownerUserId) : undefined,
      ),
    )
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export const DUPLICATE_INVENTORY_MESSAGE =
  "您已发布相同产品，请勿重复发布，如有更改请在下架编辑后重新发布";

export type InventoryPublishOutcome = {
  id: number;
  partNumber: string;
  success: boolean;
  reason?: "duplicate" | "limit" | "unavailable";
  message?: string;
  errorCode?: string;
  errorFields?: string[];
  duplicateInventoryId?: number;
  savedAsDraft?: boolean;
};

export function normalizeInventoryPartNumber(partNumber: string) {
  return partNumber.normalize("NFKC").trim().toUpperCase();
}

async function countPublishedInventories(userId: number, scope: InventoryEnterpriseScope) {
  const db = await getDb();
  if (!db) throw new Error("database not available");
  const [summary] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(inventories)
    .where(
      and(
        eq(inventories.userId, userId),
        inventoryEnterpriseCondition(scope),
        eq(inventories.status, "published"),
      ),
    );
  return Number(summary?.count ?? 0);
}

function inventoryPublishLockName(userId: number, enterpriseId: number) {
  const digest = createHash("sha256")
    .update(`${enterpriseId}:${userId}`)
    .digest("hex")
    .slice(0, 32);
  return `dianzi51_inventory_publish_${digest}`;
}

export async function withInventoryPublisherLock<T>(
  userId: number,
  enterpriseId: number | undefined,
  operation: () => Promise<T>,
  sharedConnection?: Connection,
) {
  assertInventoryEnterpriseId(enterpriseId);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("database not available");
  const ownsConnection = !sharedConnection;
  const connection = sharedConnection ?? await mysql.createConnection(withTimezone(databaseUrl));
  const lockName = inventoryPublishLockName(userId, enterpriseId);
  let locked = false;
  try {
    const [rows] = await connection.query<RowDataPacket[]>(
      "SELECT GET_LOCK(?, 10) AS acquired",
      [lockName],
    );
    locked = Number(rows[0]?.acquired ?? 0) === 1;
    if (!locked) throw new Error("库存发布操作繁忙，请稍后重试");
    return await operation();
  } finally {
    if (locked) {
      await connection.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => undefined);
    }
    if (ownsConnection) await connection.end();
  }
}

async function findPublishedDuplicate(
  userId: number,
  scope: InventoryEnterpriseScope,
  partNumber: string,
  excludeId?: number,
) {
  const db = await getDb();
  if (!db) throw new Error("database not available");
  const normalized = normalizeInventoryPartNumber(partNumber);
  const conditions = [
    eq(inventories.userId, userId),
    inventoryEnterpriseCondition(scope),
    eq(inventories.status, "published" as const),
    sql`UPPER(TRIM(${inventories.partNumber})) = ${normalized}`,
  ];
  if (excludeId) conditions.push(ne(inventories.id, excludeId));
  const [duplicate] = await db
    .select({ id: inventories.id })
    .from(inventories)
    .where(and(...conditions))
    .limit(1);
  return duplicate;
}

async function lockActiveInventoryOwner(tx: any, data: InsertInventory) {
  const enterpriseId = Number(data.enterpriseId ?? 0);
  const ownerUserId = Number(data.ownerUserId ?? 0);
  if (!enterpriseId || !ownerUserId) return;
  const owner = (
    await tx
      .select({ id: enterpriseMembers.id })
      .from(enterpriseMembers)
      .where(
        and(
          eq(enterpriseMembers.enterpriseId, enterpriseId),
          eq(enterpriseMembers.userId, ownerUserId),
          eq(enterpriseMembers.status, "active"),
        ),
      )
      .limit(1)
      .for("update")
  )[0];
  if (!owner) throw new Error("库存负责人状态已变化，请刷新后重试");
}

export async function createInventory(data: InsertInventory) {
  const db = await getDb();
  if (!db) throw new Error("database not available");
  await resolveInventoryEnterpriseScope(db, Number(data.userId), data.enterpriseId ?? undefined);
  return db.transaction(async tx => {
    await lockActiveInventoryOwner(tx, data);
    return tx.insert(inventories).values(data);
  });
}

async function recordInventoryPublishFailure(input: {
  id: number;
  userId: number;
  scope: InventoryEnterpriseScope;
  code: string;
  message: string;
  fields: string[];
  actorUserId?: number;
  ownerUserId?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("database not available");
  await db
    .update(inventories)
    .set({
      publishErrorCode: input.code,
      publishErrorMessage: input.message.slice(0, 255),
      publishErrorFields: input.fields,
      publishFailedAt: new Date(),
      publishAttemptedByUserId: input.actorUserId ?? null,
      publishAttemptCount: sql`${inventories.publishAttemptCount} + 1`,
    })
    .where(
      and(
        eq(inventories.id, input.id),
        eq(inventories.userId, input.userId),
        inventoryEnterpriseCondition(input.scope),
        input.ownerUserId ? eq(inventories.ownerUserId, input.ownerUserId) : undefined,
        inArray(inventories.status, ["draft", "offshelf"]),
      ),
    );
}

/**
 * 单条“直接发布”先保存草稿，再尝试发布。
 * 发布失败时草稿与错误均保留；同一 requestId 重试不会重复建草稿。
 */
export async function createDraftThenPublishInventory(
  data: InsertInventory,
  input: { requestId: string; actorUserId: number; ownerUserId?: number },
): Promise<InventoryPublishOutcome> {
  const db = await getDb();
  if (!db) throw new Error("database not available");
  const userId = Number(data.userId);
  const scope = await resolveInventoryEnterpriseScope(db, userId, data.enterpriseId ?? undefined);
  const [existing] = await db
    .select()
    .from(inventories)
    .where(
      and(
        eq(inventories.userId, userId),
        inventoryEnterpriseCondition(scope),
        eq(inventories.publishRequestId, input.requestId),
      ),
    )
    .limit(1);
  if (existing) {
    if (existing.status === "published") {
      return { id: existing.id, partNumber: existing.partNumber, success: true };
    }
    return {
      id: existing.id,
      partNumber: existing.partNumber,
      success: false,
      reason: existing.publishErrorCode === "DUPLICATE_PART_NUMBER"
        ? "duplicate"
        : existing.publishErrorCode === "PUBLISHED_LIMIT_REACHED"
          ? "limit"
          : "unavailable",
      message: existing.publishErrorMessage ?? "库存已保存到待发布列表，请修改后重新发布",
      errorCode: existing.publishErrorCode ?? "PUBLISH_FAILED",
      errorFields: existing.publishErrorFields ?? [],
      savedAsDraft: true,
    };
  }

  const [insertResult] = await db.transaction(async tx => {
    await lockActiveInventoryOwner(tx, data);
    return tx.insert(inventories).values({
      ...data,
      status: "draft",
      publishedAt: null,
      publishRequestId: input.requestId,
      publishAttemptedByUserId: input.actorUserId,
    });
  });
  const id = Number(insertResult.insertId);
  if (!Number.isInteger(id) || id <= 0) throw new Error("库存草稿保存失败");
  try {
    return await publishDraftInventoryWithGuard(
      id,
      userId,
      scope.enterpriseId,
      undefined,
      input.ownerUserId,
      input.actorUserId,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "发布失败";
    await recordInventoryPublishFailure({
      id,
      userId,
      scope,
      code: "PUBLISH_FAILED",
      message,
      fields: [],
      actorUserId: input.actorUserId,
      ownerUserId: input.ownerUserId,
    }).catch(() => undefined);
    return {
      id,
      partNumber: String(data.partNumber),
      success: false,
      reason: "unavailable",
      message,
      errorCode: "PUBLISH_FAILED",
      errorFields: [],
      savedAsDraft: true,
    };
  }
}

export async function createPublishedInventoryWithGuard(data: InsertInventory) {
  const userId = Number(data.userId);
  const database = await getDb();
  if (!database) throw new Error("database not available");
  const scope = await resolveInventoryEnterpriseScope(
    database,
    userId,
    data.enterpriseId ?? undefined,
  );
  const partNumber = String(data.partNumber);
  if (!hasInventoryLeadTime(data.leadTime)) {
    return {
      success: false,
      reason: "unavailable",
      message: "请先填写货期后再发布",
    } as const;
  }
  if (!canPublishInventoryAvailability(data)) {
    return {
      success: false,
      reason: "unavailable",
      message: data.qtyOnSale <= 0 && Number(data.qtyOrder ?? 0) > 0
        ? "纯订货库存的货期必须为“订货”"
        : "请填写大于0的上架数量或订货数量后再发布",
    } as const;
  }
  return withInventoryPublisherLock(userId, scope.enterpriseId, async () => {
    const quota = await getInventoryQuota(database, {
      enterpriseId: scope.enterpriseId,
      dataOwnerUserId: userId,
    });
    if (isInventoryQuotaExceeded(await countPublishedInventories(userId, scope), quota.publishedRowLimit)) {
      return {
        success: false,
        reason: "limit",
        message: inventoryPublishedLimitMessage(quota.publishedRowLimit),
      } as const;
    }
    const duplicate = await findPublishedDuplicate(userId, scope, partNumber);
    if (duplicate) {
      return {
        success: false,
        reason: "duplicate",
        message: DUPLICATE_INVENTORY_MESSAGE,
      } as const;
    }
    await createInventory(data);
    return { success: true } as const;
  });
}

export async function publishDraftInventoryWithGuard(
  id: number,
  userId: number,
  enterpriseId: number | undefined,
  sharedConnection?: Connection,
  ownerUserId?: number,
  actorUserId?: number,
): Promise<InventoryPublishOutcome> {
  const database = await getDb();
  if (!database) throw new Error("database not available");
  const scope = await resolveInventoryEnterpriseScope(database, userId, enterpriseId);
  const initial = await getInventoryById(id, userId, scope.enterpriseId, ownerUserId);
  if (!initial || (initial.status !== "draft" && initial.status !== "offshelf")) {
    return {
      id,
      partNumber: initial?.partNumber ?? "",
      success: false,
      reason: "unavailable",
      message: "库存条目不存在或已不在草稿/已下架列表",
    };
  }

  return withInventoryPublisherLock(userId, scope.enterpriseId, async () => {
    const current = await getInventoryById(id, userId, scope.enterpriseId, ownerUserId);
    if (!current || (current.status !== "draft" && current.status !== "offshelf")) {
      return {
        id,
        partNumber: current?.partNumber ?? initial.partNumber,
        success: false,
        reason: "unavailable",
        message: "库存条目不存在或已不在草稿/已下架列表",
      };
    }
    if (!hasInventoryLeadTime(current.leadTime)) {
      await recordInventoryPublishFailure({
        id: current.id,
        userId,
        scope,
        code: "MISSING_LEAD_TIME",
        message: "请先填写货期后再发布",
        fields: ["leadTime"],
        actorUserId,
        ownerUserId,
      });
      return {
        id: current.id,
        partNumber: current.partNumber,
        success: false,
        reason: "unavailable",
        message: "请先填写货期后再发布",
        errorCode: "MISSING_LEAD_TIME",
        errorFields: ["leadTime"],
        savedAsDraft: true,
      };
    }
    if (!canPublishInventoryAvailability(current)) {
      const orderLeadTimeInvalid = current.qtyOnSale <= 0 && Number(current.qtyOrder ?? 0) > 0;
      const message = orderLeadTimeInvalid
        ? "纯订货库存的货期必须为“订货”"
        : current.qtyOrder == null
          ? "订货数量未知，请填写明确的订货数量后再发布"
          : "请填写大于0的上架数量或订货数量后再发布";
      const fields = orderLeadTimeInvalid ? ["leadTime"] : ["qtyOnSale", "qtyOrder"];
      await recordInventoryPublishFailure({
        id: current.id,
        userId,
        scope,
        code: orderLeadTimeInvalid ? "INVALID_ORDER_LEAD_TIME" : "INVALID_QUANTITY",
        message,
        fields,
        actorUserId,
        ownerUserId,
      });
      return {
        id,
        partNumber: current.partNumber,
        success: false,
        reason: "unavailable",
        message,
        errorCode: orderLeadTimeInvalid ? "INVALID_ORDER_LEAD_TIME" : "INVALID_QUANTITY",
        errorFields: fields,
        savedAsDraft: true,
      };
    }
    const db = await getDb();
    if (!db) throw new Error("database not available");
    const quota = await getInventoryQuota(db, {
      enterpriseId: scope.enterpriseId,
      dataOwnerUserId: userId,
    });
    const publishedLimitMessage = inventoryPublishedLimitMessage(quota.publishedRowLimit);
    if (isInventoryQuotaExceeded(await countPublishedInventories(userId, scope), quota.publishedRowLimit)) {
      await recordInventoryPublishFailure({
        id: current.id,
        userId,
        scope,
        code: "PUBLISHED_LIMIT_REACHED",
        message: publishedLimitMessage,
        fields: [],
        actorUserId,
        ownerUserId,
      });
      return {
        id: current.id,
        partNumber: current.partNumber,
        success: false,
        reason: "limit",
        message: publishedLimitMessage,
        errorCode: "PUBLISHED_LIMIT_REACHED",
        errorFields: [],
        savedAsDraft: true,
      };
    }
    const duplicate = await findPublishedDuplicate(userId, scope, current.partNumber, current.id);
    if (duplicate) {
      await recordInventoryPublishFailure({
        id: current.id,
        userId,
        scope,
        code: "DUPLICATE_PART_NUMBER",
        message: DUPLICATE_INVENTORY_MESSAGE,
        fields: ["partNumber"],
        actorUserId,
        ownerUserId,
      });
      return {
        id: current.id,
        partNumber: current.partNumber,
        success: false,
        reason: "duplicate",
        message: DUPLICATE_INVENTORY_MESSAGE,
        errorCode: "DUPLICATE_PART_NUMBER",
        errorFields: ["partNumber"],
        duplicateInventoryId: duplicate.id,
        savedAsDraft: true,
      };
    }
    const [result] = await db
      .update(inventories)
      .set({
        status: "published",
        publishedAt: new Date(),
        offshelfBy: null,
        offshelfReason: null,
        publishErrorCode: null,
        publishErrorMessage: null,
        publishErrorFields: null,
        publishFailedAt: null,
        publishAttemptedByUserId: actorUserId ?? null,
        publishAttemptCount: 0,
      })
      .where(
        and(
          eq(inventories.id, current.id),
          eq(inventories.userId, userId),
          inventoryEnterpriseCondition(scope),
          ownerUserId ? eq(inventories.ownerUserId, ownerUserId) : undefined,
          eq(inventories.status, current.status),
        ),
      );
    if (Number(result.affectedRows ?? 0) !== 1) {
      return {
        id: current.id,
        partNumber: current.partNumber,
        success: false,
        reason: "unavailable",
        message: "库存状态已变化，请刷新后重试",
      };
    }
    return { id: current.id, partNumber: current.partNumber, success: true };
  }, sharedConnection);
}

export async function updateInventory(
  id: number,
  userId: number,
  enterpriseId: number | undefined,
  data: Partial<InsertInventory>,
  ownerUserId?: number,
) {
  const db = await getDb();
  if (!db) throw new Error("database not available");
  const scope = await resolveInventoryEnterpriseScope(db, userId, enterpriseId);
  await db
    .update(inventories)
    .set(data)
    .where(
      and(
        eq(inventories.id, id),
        eq(inventories.userId, userId),
        inventoryEnterpriseCondition(scope),
        ownerUserId ? eq(inventories.ownerUserId, ownerUserId) : undefined,
      ),
    );
}

export type InventoryBulkActionOutcome = {
  id: number;
  partNumber: string | null;
  success: boolean;
  reason?: "not_found_or_forbidden" | "not_published" | "operation_failed";
  message?: string;
};

/** 原子修改一条已发布库存的公司目录展示范围；归属、负责人和状态必须同时匹配。 */
export async function setInventoryCompanyCatalogVisibility(
  id: number,
  userId: number,
  enterpriseId: number | undefined,
  visible: boolean,
  actorUserId: number,
  ownerUserId?: number,
) {
  const db = await getDb();
  if (!db) throw new Error("database not available");
  const scope = await resolveInventoryEnterpriseScope(db, userId, enterpriseId);
  const [result] = await db
    .update(inventories)
    .set({
      companyCatalogVisible: visible,
      catalogVisibilityUpdatedByUserId: actorUserId,
      catalogVisibilityUpdatedAt: new Date(),
    })
    .where(and(
      eq(inventories.id, id),
      eq(inventories.userId, userId),
      inventoryEnterpriseCondition(scope),
      ownerUserId ? eq(inventories.ownerUserId, ownerUserId) : undefined,
      eq(inventories.status, "published"),
    ));
  return Number(result.affectedRows ?? 0) === 1;
}

/** 将权限范围内的全部已发布库存统一设为“全部可见”或“仅搜索可见”。 */
export async function setAllInventoryCompanyCatalogVisibility(
  userId: number,
  enterpriseId: number | undefined,
  visible: boolean,
  actorUserId: number,
  ownerUserId?: number,
) {
  const db = await getDb();
  if (!db) throw new Error("database not available");
  const scope = await resolveInventoryEnterpriseScope(db, userId, enterpriseId);
  const [result] = await db
    .update(inventories)
    .set({
      companyCatalogVisible: visible,
      catalogVisibilityUpdatedByUserId: actorUserId,
      catalogVisibilityUpdatedAt: new Date(),
    })
    .where(and(
      eq(inventories.userId, userId),
      inventoryEnterpriseCondition(scope),
      ownerUserId ? eq(inventories.ownerUserId, ownerUserId) : undefined,
      eq(inventories.status, "published"),
    ));
  return Number(result.affectedRows ?? 0);
}

/**
 * 批量修改公司目录展示范围。锁定归属后一次写入，非本人和非发布状态逐条返回失败，
 * 与批量下架/删除保持相同的最多 50 条和部分成功语义。
 */
export async function bulkSetInventoryCompanyCatalogVisibility(
  ids: number[],
  userId: number,
  enterpriseId: number | undefined,
  visible: boolean,
  actorUserId: number,
  ownerUserId?: number,
): Promise<InventoryBulkActionOutcome[]> {
  const uniqueIds = normalizeInventoryBulkIds(ids);
  const db = await getDb();
  if (!db) throw new Error("database not available");
  const scope = await resolveInventoryEnterpriseScope(db, userId, enterpriseId);

  return db.transaction(async tx => {
    const ownedRows = await tx
      .select({ id: inventories.id, partNumber: inventories.partNumber, status: inventories.status })
      .from(inventories)
      .where(and(
        eq(inventories.userId, userId),
        inventoryEnterpriseCondition(scope),
        ownerUserId ? eq(inventories.ownerUserId, ownerUserId) : undefined,
        inArray(inventories.id, uniqueIds),
      ))
      .for("update");
    const ownedById = new Map(ownedRows.map(row => [row.id, row]));
    const publishedIds = ownedRows
      .filter(row => row.status === "published")
      .map(row => row.id);

    if (publishedIds.length > 0) {
      await tx
        .update(inventories)
        .set({
          companyCatalogVisible: visible,
          catalogVisibilityUpdatedByUserId: actorUserId,
          catalogVisibilityUpdatedAt: new Date(),
        })
        .where(and(
          eq(inventories.userId, userId),
          inventoryEnterpriseCondition(scope),
          ownerUserId ? eq(inventories.ownerUserId, ownerUserId) : undefined,
          eq(inventories.status, "published"),
          inArray(inventories.id, publishedIds),
        ));
    }

    return uniqueIds.map(id => {
      const row = ownedById.get(id);
      if (!row) {
        return {
          id,
          partNumber: null,
          success: false,
          reason: "not_found_or_forbidden",
          message: "库存不存在或无权操作",
        };
      }
      if (row.status !== "published") {
        return {
          id,
          partNumber: row.partNumber,
          success: false,
          reason: "not_published",
          message: "库存已不是发布状态，请刷新后重试",
        };
      }
      return { id, partNumber: row.partNumber, success: true };
    });
  });
}

function normalizeInventoryBulkIds(ids: number[]) {
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length === 0 || uniqueIds.length > INVENTORY_BULK_ACTION_LIMIT) {
    throw new Error(`每次只能操作1至${INVENTORY_BULK_ACTION_LIMIT}条库存`);
  }
  return uniqueIds;
}

/** 原子下架一条仍在售的库存；归属、负责人和 published 状态必须同时匹配。 */
export async function offshelfInventory(
  id: number,
  userId: number,
  enterpriseId: number | undefined,
  actorUserId: number,
  ownerUserId?: number,
) {
  const db = await getDb();
  if (!db) throw new Error("database not available");
  const scope = await resolveInventoryEnterpriseScope(db, userId, enterpriseId);
  const [result] = await db
    .update(inventories)
    .set({
      status: "offshelf",
      publishedAt: null,
      updatedByUserId: actorUserId,
      offshelfBy: "user",
      offshelfReason: null,
    })
    .where(and(
      eq(inventories.id, id),
      eq(inventories.userId, userId),
      inventoryEnterpriseCondition(scope),
      ownerUserId ? eq(inventories.ownerUserId, ownerUserId) : undefined,
      eq(inventories.status, "published"),
    ));
  return Number(result.affectedRows ?? 0) === 1;
}

/**
 * 批量下架当前供应商的在售库存。
 *
 * 先锁定当前用户确实拥有的记录，再一次性更新仍为 published 的条目。
 * 非本人、记录已不存在或状态已变化的ID只作为失败项返回，不会误改其他库存。
 */
export async function bulkOffshelfInventories(
  ids: number[],
  userId: number,
  enterpriseId: number | undefined,
  ownerUserId?: number,
): Promise<InventoryBulkActionOutcome[]> {
  const uniqueIds = normalizeInventoryBulkIds(ids);
  const db = await getDb();
  if (!db) throw new Error("database not available");
  const scope = await resolveInventoryEnterpriseScope(db, userId, enterpriseId);

  return db.transaction(async tx => {
    const ownedRows = await tx
      .select({ id: inventories.id, partNumber: inventories.partNumber, status: inventories.status })
      .from(inventories)
      .where(
        and(
          eq(inventories.userId, userId),
          inventoryEnterpriseCondition(scope),
          ownerUserId ? eq(inventories.ownerUserId, ownerUserId) : undefined,
          inArray(inventories.id, uniqueIds),
        ),
      )
      .for("update");
    const ownedById = new Map(ownedRows.map(row => [row.id, row]));
    const publishedIds = ownedRows
      .filter(row => row.status === "published")
      .map(row => row.id);

    if (publishedIds.length > 0) {
      await tx
        .update(inventories)
        .set({
          status: "offshelf",
          publishedAt: null,
          offshelfBy: "user",
          offshelfReason: null,
        })
        .where(
          and(
            eq(inventories.userId, userId),
            inventoryEnterpriseCondition(scope),
            ownerUserId ? eq(inventories.ownerUserId, ownerUserId) : undefined,
            eq(inventories.status, "published"),
            inArray(inventories.id, publishedIds),
          ),
        );
    }

    return uniqueIds.map(id => {
      const row = ownedById.get(id);
      if (!row) {
        return {
          id,
          partNumber: null,
          success: false,
          reason: "not_found_or_forbidden",
          message: "库存不存在或无权操作",
        };
      }
      if (row.status !== "published") {
        return {
          id,
          partNumber: row.partNumber,
          success: false,
          reason: "not_published",
          message: "库存已不是发布状态，请刷新后重试",
        };
      }
      return { id, partNumber: row.partNumber, success: true };
    });
  });
}

/** 将权限范围内的全部已发布库存统一下架，不受当前页50条限制。 */
export async function offshelfAllPublishedInventories(
  userId: number,
  enterpriseId: number | undefined,
  actorUserId: number,
  ownerUserId?: number,
) {
  const db = await getDb();
  if (!db) throw new Error("database not available");
  const scope = await resolveInventoryEnterpriseScope(db, userId, enterpriseId);
  const [result] = await db
    .update(inventories)
    .set({
      status: "offshelf",
      publishedAt: null,
      updatedByUserId: actorUserId,
      offshelfBy: "user",
      offshelfReason: null,
    })
    .where(and(
      eq(inventories.userId, userId),
      inventoryEnterpriseCondition(scope),
      ownerUserId ? eq(inventories.ownerUserId, ownerUserId) : undefined,
      eq(inventories.status, "published"),
    ));
  return Number(result.affectedRows ?? 0);
}

/**
 * 批量永久删除当前供应商的库存。
 *
 * 删除逐条执行，某一条因订单等业务关联失败时不会阻断其他条目；数据库错误
 * 不直接暴露给前端，只返回可据以处理的安全说明。
 */
export async function bulkDeleteInventories(
  ids: number[],
  userId: number,
  enterpriseId: number | undefined,
  ownerUserId?: number,
): Promise<InventoryBulkActionOutcome[]> {
  const uniqueIds = normalizeInventoryBulkIds(ids);
  const db = await getDb();
  if (!db) throw new Error("database not available");
  const scope = await resolveInventoryEnterpriseScope(db, userId, enterpriseId);

  return db.transaction(async tx => {
    const ownedRows = await tx
      .select({ id: inventories.id, partNumber: inventories.partNumber })
      .from(inventories)
      .where(
        and(
          eq(inventories.userId, userId),
          inventoryEnterpriseCondition(scope),
          ownerUserId ? eq(inventories.ownerUserId, ownerUserId) : undefined,
          inArray(inventories.id, uniqueIds),
        ),
      )
      .for("update");
    const ownedById = new Map(ownedRows.map(row => [row.id, row]));
    const outcomes: InventoryBulkActionOutcome[] = [];

    for (const id of uniqueIds) {
      const row = ownedById.get(id);
      if (!row) {
        outcomes.push({
          id,
          partNumber: null,
          success: false,
          reason: "not_found_or_forbidden",
          message: "库存不存在或无权操作",
        });
        continue;
      }

      try {
        const [result] = await tx
          .delete(inventories)
          .where(
            and(
              eq(inventories.id, id),
              eq(inventories.userId, userId),
              inventoryEnterpriseCondition(scope),
              ownerUserId ? eq(inventories.ownerUserId, ownerUserId) : undefined,
            ),
          );
        const affectedRows = Number(result.affectedRows ?? 0);
        if (affectedRows === 1) {
          outcomes.push({ id, partNumber: row.partNumber, success: true });
        } else {
          outcomes.push({
            id,
            partNumber: row.partNumber,
            success: false,
            reason: "operation_failed",
            message: "库存状态已变化，请刷新后重试",
          });
        }
      } catch {
        outcomes.push({
          id,
          partNumber: row.partNumber,
          success: false,
          reason: "operation_failed",
          message: "库存与现有业务记录关联，无法删除；建议改为下架",
        });
      }
    }

    return outcomes;
  });
}

export type RepublishOutcome = {
  success: boolean;
  /** null 表示成功；duplicate 同料号已在售；unavailable 记录不可用 */
  reason: "duplicate" | "unavailable" | null;
  message?: string;
  /** 本次刷新后的时间（供前端提示） */
  refreshedAt: Date | null;
};

/**
 * 编辑并重新发布已在售库存（本次操作计一次刷新）。
 *
 * ## 为什么需要这个函数
 *
 * 原流程要改已发布库存必须先「下架」→ 进入已下架列表 → 编辑 → 再发布。
 * 下架期间该条从搜索结果消失，等于为改一个价格牺牲曝光。
 * 本函数让在售条目原地更新，不经过下架。
 *
 * ## 刷新口径（产品决策）
 *
 * 每次编辑保存均更新 refreshedAt，即**计一次刷新**，不受 24 小时冷却限制
 * （与「一键刷新全部」不同，后者仍保留冷却）。
 * 理由：编辑意味着商户真实维护了报价或库量，这正是新鲜度权重
 * 要鼓励的行为；且单条编辑需逐条手工操作，成本远高于一键刷新全部。
 *
 * refreshedAt 直接影响搜索排名的新鲜度权重
 * （≤3 天权重 1、≤7 天 0.8、≤14 天 0.5、≤30 天 0.2），
 * 同时也是商户列表的排序依据，所以刚编辑过的条目会自然排到前面。
 *
 * ## 必须守住的约束：重复料号校验
 *
 * 发布路径有「同一供应商不得有重复在售料号」的校验
 * （findPublishedDuplicate）。若此处不校验，用户把料号 A 改成
 * 已在售的 B，就能绕过约束造出重复在售条目。
 * 故复用同一校验，并在同一把命名锁下执行，避免并发绕过。
 */
export async function updatePublishedInventory(
  id: number,
  userId: number,
  enterpriseId: number | undefined,
  data: Partial<InsertInventory>,
  partNumber: string,
  ownerUserId?: number,
): Promise<RepublishOutcome> {
  const database = await getDb();
  if (!database) throw new Error("database not available");
  const scope = await resolveInventoryEnterpriseScope(database, userId, enterpriseId);
  const initial = await getInventoryById(id, userId, scope.enterpriseId, ownerUserId);
  if (!initial || initial.status !== "published") {
    return {
      success: false,
      reason: "unavailable",
      message: "库存条目不存在或不在在售状态",
      refreshedAt: null,
    };
  }

  // 锁按商家划分，确保单条发布、在售编辑和后台批量导入共享同一互斥边界。
  return withInventoryPublisherLock(userId, scope.enterpriseId, async () => {
    const current = await getInventoryById(id, userId, scope.enterpriseId, ownerUserId);
    if (!current || current.status !== "published") {
      return {
        success: false,
        reason: "unavailable" as const,
        message: "库存条目不存在或不在在售状态",
        refreshedAt: null,
      };
    }

    // 拿到锁后复查重复，排除自身
    const duplicate = await findPublishedDuplicate(userId, scope, partNumber, id);
    if (duplicate) {
      return {
        success: false,
        reason: "duplicate" as const,
        message: "您已发布相同型号的在售库存，请勿重复发布",
        refreshedAt: null,
      };
    }

    const now = new Date();

    /*
     * 上架数量用「差额调整」而非直接覆盖，这是必需的：
     *
     * qtyOnSale 同时被下单流程扣减（routers/order.ts 中的
     * adjustInventoryQty(inventoryId, -qty)）。若编辑直接写入表单绝对值，
     * 就会抹掉编辑期间发生的订单占用：
     *
     *   商户打开编辑页（表单回填 1000）
     *   → 买家下单 300（qtyOnSale 变为 700）
     *   → 商户只改了价格就保存，写回 1000
     *   → 那 300 颗的占用被凭空抹除，同一批货可被重复卖出
     *
     * 改用差额后：差额 = 表单新值 − 本次请求进入时读到的值（initial）。
     * 商户未改数量时差额为 0，qtyOnSale 完全不动，占用原样保留。
     * 不采用前端传快照值：前端值可被篡改，服务端自读更可信。
     *
     * qtyStock（仓库总库存）不参与订单占用，可直接覆盖。
     */
    const { qtyOnSale: nextQtyOnSale, ...restData } = data;
    const delta =
      typeof nextQtyOnSale === "number" ? nextQtyOnSale - initial.qtyOnSale : 0;

    const db = database;
    const enterpriseSql = scope.includeVerifiedLegacyNull
      ? sql`AND (enterpriseId = ${scope.enterpriseId} OR enterpriseId IS NULL)`
      : sql`AND enterpriseId = ${scope.enterpriseId}`;
    const updated = await db.transaction(async tx => {
      const [detailsResult] = await tx
        .update(inventories)
        .set({ ...restData, refreshedAt: now })
        .where(
          and(
            eq(inventories.id, id),
            eq(inventories.userId, userId),
            inventoryEnterpriseCondition(scope),
            ownerUserId ? eq(inventories.ownerUserId, ownerUserId) : undefined,
            eq(inventories.status, "published"),
          ),
        );
      if (Number(detailsResult.affectedRows ?? 0) !== 1) return false;
      if (delta === 0) return true;

      /*
       * Drizzle 会按 schema 列顺序生成 SET，不能靠对象属性顺序控制 SQL。
       * MySQL 单表 UPDATE 又会让后面的表达式读取前面已经更新的列值。
       * 因此数量与状态必须使用显式 SQL，并把 qtyOnSale 放在最后：
       * 30000 调为 15000 时，所有状态表达式都基于原值只应用一次 -15000。
       */
      const quantityResult = await tx.execute(sql`
        UPDATE inventories
           SET status = IF(GREATEST(0, qtyOnSale + ${delta}) = 0 AND (COALESCE(qtyOrder, 0) <= 0 OR COALESCE(leadTime, '') <> '订货'), 'offshelf', status),
               publishedAt = IF(GREATEST(0, qtyOnSale + ${delta}) = 0 AND (COALESCE(qtyOrder, 0) <= 0 OR COALESCE(leadTime, '') <> '订货'), NULL, publishedAt),
               offshelfBy = IF(GREATEST(0, qtyOnSale + ${delta}) = 0 AND (COALESCE(qtyOrder, 0) <= 0 OR COALESCE(leadTime, '') <> '订货'), 'system', offshelfBy),
               offshelfReason = IF(GREATEST(0, qtyOnSale + ${delta}) = 0 AND (COALESCE(qtyOrder, 0) <= 0 OR COALESCE(leadTime, '') <> '订货'), 'sold_out', offshelfReason),
               qtyOnSale = GREATEST(0, qtyOnSale + ${delta})
         WHERE id = ${id}
           AND userId = ${userId}
           ${enterpriseSql}
           ${ownerUserId ? sql`AND ownerUserId = ${ownerUserId}` : sql``}
           AND status = 'published'
      `);
      const affectedRows = Number(
        (quantityResult as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0,
      );
      if (affectedRows !== 1) {
        throw new Error("库存状态已变化，请刷新后重试");
      }
      return true;
    });
    if (!updated) {
      return {
        success: false,
        reason: "unavailable",
        message: "库存已售罄或状态已变化，请刷新后重试",
        refreshedAt: null,
      };
    }

    return { success: true, reason: null, refreshedAt: now };
  });
}
export async function deleteInventory(
  id: number,
  userId: number,
  enterpriseId: number | undefined,
  ownerUserId?: number,
) {
  const db = await getDb();
  if (!db) throw new Error("database not available");
  const scope = await resolveInventoryEnterpriseScope(db, userId, enterpriseId);
  await db
    .delete(inventories)
    .where(
      and(
        eq(inventories.id, id),
        eq(inventories.userId, userId),
        inventoryEnterpriseCondition(scope),
        ownerUserId ? eq(inventories.ownerUserId, ownerUserId) : undefined,
      ),
    );
}

/** 批量删除当前供应商的待发布草稿；非本人或非草稿记录不会被删除。 */
export async function deleteDraftInventories(
  ids: number[],
  userId: number,
  enterpriseId: number | undefined,
  ownerUserId?: number,
) {
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length === 0) return 0;
  const db = await getDb();
  if (!db) throw new Error("database not available");
  const scope = await resolveInventoryEnterpriseScope(db, userId, enterpriseId);
  const [result] = await db
    .delete(inventories)
    .where(
      and(
        eq(inventories.userId, userId),
        inventoryEnterpriseCondition(scope),
        ownerUserId ? eq(inventories.ownerUserId, ownerUserId) : undefined,
        eq(inventories.status, "draft"),
        inArray(inventories.id, uniqueIds),
      ),
    );
  return Number(result.affectedRows ?? 0);
}

/** 一键清空当前供应商全部待发布草稿。 */
export async function deleteAllDraftInventories(
  userId: number,
  enterpriseId: number | undefined,
  ownerUserId?: number,
) {
  const db = await getDb();
  if (!db) throw new Error("database not available");
  const scope = await resolveInventoryEnterpriseScope(db, userId, enterpriseId);
  const [result] = await db
    .delete(inventories)
    .where(
      and(
        eq(inventories.userId, userId),
        inventoryEnterpriseCondition(scope),
        eq(inventories.status, "draft"),
        ownerUserId ? eq(inventories.ownerUserId, ownerUserId) : undefined,
      ),
    );
  return Number(result.affectedRows ?? 0);
}

// ============ 公开搜索（对照原型 51dianzi_search_v7） ============

export type SearchSort =
  | "default"
  | "priceAsc"
  | "priceDesc"
  | "stockAsc"
  | "stockDesc"
  | "lead";

export interface SearchParams {
  keyword?: string;
  brand?: string;
  pkg?: string;
  category?: string;
  sort?: SearchSort;
  page?: number;
  pageSize?: number;
  /**
   * 「我关注的供应商」筛选：传入当前登录用户 ID 则只返回已关注
   * 供应商的报价；不传或传 undefined 时行为与原来完全一致。
   * 它是「筛选」而非「排序」，所以与 keyword/brand 等条件叠加生效。
   */
  followedByUserId?: number;
}

function searchConditions(
  keyword?: string,
  brand?: string,
  brandVariants?: string[],
  pkg?: string,
  category?: string,
  followedByUserId?: number,
) {
  const conds = [
    eq(inventories.status, "published" as const),
    // 订货目录可被检索但不虚构现货；现货核验和交易仍要求正库存。
    or(gt(inventories.qtyOnSale, 0), and(eq(inventories.qtyOnSale, 0), eq(inventories.leadTime, "订货")))!,
    searchDiscoverableCondition(keyword),
  ];
  if (keyword && keyword.trim()) {
    const normalizedPartKeyword = normalizeExactInventoryKeyword(keyword);
    /*
     * 含数字且不含空格的输入按电子料型号处理（如 STM32F103C8T6）。
     * 这类查询占搜索页绝大多数，使用生成列前缀索引，同时保留订购后缀；
     * 品牌、分类、自然语言等普通关键词继续沿用全字段模糊搜索。
     */
    const looksLikePartNumber =
      /\d/.test(normalizedPartKeyword) && !/\s/.test(normalizedPartKeyword);
    const kw = keyword.normalize("NFKC").trim().toLowerCase();
    const packagingKeys = looksLikePartNumber
      ? packagingSearchLookupKeys(normalizedPartKeyword)
      : [];
    const kwCond = looksLikePartNumber
      ? or(
          like(inventories.partNumberNormalized, `${normalizedPartKeyword}%`),
          ...(packagingKeys
            .filter(key => key !== normalizedPartKeyword)
            .map(key => eq(inventories.partNumberNormalized, key))),
        )
      : or(
          sql`LOWER(${inventories.partNumber}) LIKE ${`%${kw}%`}`,
          sql`LOWER(${inventories.brand}) LIKE ${`%${kw}%`}`,
          sql`LOWER(${inventories.note}) LIKE ${`%${kw}%`}`,
          sql`LOWER(${inventories.category}) LIKE ${`%${kw}%`}`
        );
    if (kwCond) conds.push(kwCond);
  }
  if (brand && brand !== "all") {
    const variants = brandVariants?.filter(Boolean) ?? [];
    conds.push(
      variants.length > 0
        ? inArray(inventories.brand, variants)
        : eq(inventories.brand, brand),
    );
  }
  if (pkg && pkg !== "all") conds.push(eq(inventories.pkg, pkg));
  if (category && category !== "all") conds.push(eq(inventories.category, category));
  /*
   * 关注筛选用 EXISTS 子查询而非 JOIN：
   * JOIN 会在关注表出现重复行时放大结果集（尽管有唯一索引保护，
   * 但不应依赖外部约束保证查询正确性），也会影响 COUNT(*) 总数。
   * supplier_follows 的 (userId, supplierId) 唯一索引使子查询为索引命中。
   */
  if (followedByUserId) {
    conds.push(
      sql`EXISTS (SELECT 1 FROM supplier_follows sf WHERE sf.userId = ${followedByUserId} AND sf.supplierId = ${inventories.userId})`
    );
  }
  return and(...conds);
}

/** 搜索结果行：含智能排名的得分明细与推荐理由 */
export type RankedInventoryRow = {
  id: number;
  partNumber: string;
  brand: string;
  category: string;
  pkg: string | null;
  prodYear: string | null;
  dateCode: string | null;
  qtyOnSale: number;
  qtyOrder: number | null;
  priceEx: string | null;
  taxIncluded: boolean;
  ladderPrices: LadderTier[] | null;
  moq: number | null;
  source: string | null;
  grade: string | null;
  leadTime: string | null;
  note: string | null;
  photos: InventoryPhoto[] | null;
  publishedAt: Date | null;
  refreshedAt: Date | null;
  /** 当前库存快照仍有效时的最近现货核验时间；过期或库存变化时为 null。 */
  spotVerifiedAt: Date | null;
  supplierId: number;
  supplierName: string;
  /** 企业在 ERP 公司信息墙中选定的头像；仅已认证企业的有效照片可返回。 */
  supplierAvatarUrl: string | null;
  /** 企业选择的头像适配方式；现有头像默认按 logo 完整显示。 */
  supplierAvatarDisplayMode: "logo" | "photo";
  supplierAvatarCropZoom: number;
  supplierAvatarCropX: number;
  supplierAvatarCropY: number;
  /** 供应商是否已通过企业认证 */
  supplierCertified: boolean;
  /** 首次获准经营时间（未认证或未回填时为 null） */
  merchantSinceAt: Date | null;
  /** 实名公开评价数量；只用于展示，不参与搜索排名。 */
  publicReviewCount: number;
  completedTradeCount: number;
  merchantTenureDays: number;
  /** 相关度分层：0 精确 / 1 前缀 / 2 包含 / 3 其他字段命中 */
  relevanceTier: number;
  /** 异常低价标记：同型号 3 家以上报价且低于组均价一半 */
  suspiciousPrice: boolean;
  rankingScore: number;
  rankingComponents: {
    price: number;
    freshness: number;
    trades: number;
    tenure: number;
    spotVerification: number;
  };
  recommendationReasons: string[];
};

function normalizeRankedInventoryRows(
  rawRows: Record<string, unknown>[],
): RankedInventoryRow[] {
  return rawRows.map(row => {
    const rankingScore = Number(row.rankingScore ?? 0);
    const priceComponent = Number(row.priceComponent ?? 0);
    const freshnessComponent = Number(row.freshnessComponent ?? 0);
    const publicReviewCount = Number(row.publicReviewCount ?? 0);
    const completedTradeCount = Number(row.completedTradeCount ?? 0);
    const merchantTenureDays = Number(row.merchantTenureDays ?? 0);
    return {
      id: Number(row.id),
      partNumber: row.partNumber as string,
      brand: row.brand as string,
      category: row.category as string,
      pkg: (row.pkg as string | null) ?? null,
      prodYear: (row.prodYear as string | null) ?? null,
      dateCode: (row.dateCode as string | null) ?? null,
      qtyOnSale: Number(row.qtyOnSale),
      qtyOrder: row.qtyOrder == null ? null : Number(row.qtyOrder),
      priceEx: (row.priceEx as string | null) ?? null,
      taxIncluded: Boolean(Number(row.taxIncluded ?? 1)),
      ladderPrices: (row.ladderPrices as LadderTier[] | null) ?? null,
      moq: row.moq == null ? null : Number(row.moq),
      source: (row.source as string | null) ?? null,
      grade: (row.grade as string | null) ?? null,
      leadTime: (row.leadTime as string | null) ?? null,
      note: maskForbiddenWords(row.note as string | null) || null,
      photos: (row.photos as InventoryPhoto[] | null) ?? null,
      publishedAt: (row.publishedAt as Date | null) ?? null,
      refreshedAt: (row.refreshedAt as Date | null) ?? null,
      spotVerifiedAt: (row.spotVerifiedAt as Date | null) ?? null,
      supplierId: Number(row.supplierId),
      supplierName: row.supplierName as string,
      supplierAvatarUrl: typeof row.supplierAvatarUrl === "string" && row.supplierAvatarUrl.trim()
        ? row.supplierAvatarUrl.trim()
        : null,
      supplierAvatarDisplayMode: row.supplierAvatarDisplayMode === "photo" ? "photo" : "logo",
      supplierAvatarCropZoom: Number(row.supplierAvatarCropZoom ?? 100),
      supplierAvatarCropX: Number(row.supplierAvatarCropX ?? 0),
      supplierAvatarCropY: Number(row.supplierAvatarCropY ?? 0),
      supplierCertified: Boolean(row.supplierCertified),
      merchantSinceAt: (row.merchantSinceAt as Date | null) ?? null,
      publicReviewCount,
      completedTradeCount,
      merchantTenureDays,
      relevanceTier: Number(row.relevanceTier ?? 0),
      suspiciousPrice: Boolean(Number(row.suspiciousPrice ?? 0)),
      rankingScore: Math.round(rankingScore * 100) / 100,
      rankingComponents: {
        price: Math.round(priceComponent * 100) / 100,
        freshness: Math.round(freshnessComponent * 100) / 100,
        trades: Math.round(Number(row.tradeComponent ?? 0) * 100) / 100,
        tenure: Math.round(Number(row.tenureComponent ?? 0) * 100) / 100,
        spotVerification:
          Math.round(Number(row.spotVerificationComponent ?? 0) * 100) / 100,
      },
      recommendationReasons: buildRecommendationReasons({
        hasPrice: row.priceEx != null && Number(row.priceEx) > 0,
        priceComponent,
        freshnessComponent,
        completedTradeCount,
        tenureDays: merchantTenureDays,
      }),
    };
  });
}

const EMPTY_SEARCH_COUNT_CACHE_TTL_MS = 60_000;
const emptySearchCountCache = new Map<string, { total: number; expiresAt: number }>();

async function cachedEmptySearchCount(key: string, load: () => Promise<number>) {
  const now = Date.now();
  const cached = emptySearchCountCache.get(key);
  if (cached && cached.expiresAt > now) return cached.total;
  const total = await load();
  emptySearchCountCache.set(key, { total, expiresAt: now + EMPTY_SEARCH_COUNT_CACHE_TTL_MS });
  return total;
}

/**
 * 空关键词属于“发现有价格现货”：默认排序直接读取预计算的数据通价值快照。
 *
 * 排序硬分层：低于数据通参考价 >= 2% > 数据通暂无参考价的明价 > 其余明价。
 * 快照只使用商家直接单价，未税价统一换算为含税可比价；阶梯价不参与空搜索排名。
 * suspiciousPrice 继续作为内部审计标记，但不隐藏、不降级，避免误伤真实优势报价。
 * 每家每轮最多进入 2 条，避免单一供应商连续占满页面。
 */
async function searchPublishedInventoryBrowsePage(params: {
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
  where: SQL;
  countCacheKey: string;
  sort: SearchSort;
  offset: number;
  pageSize: number;
}): Promise<{ items: RankedInventoryRow[]; total: number }> {
  const { db, where, countCacheKey, sort, offset, pageSize } = params;

  if (sort === "default") {
    const pricedWhere = and(where, gt(inventories.priceEx, "0"));
    const total = await cachedEmptySearchCount(`value-snapshot:${countCacheKey}`, async () => {
      const rows = await db
        .select({ cnt: sql<number>`COUNT(*)` })
        .from(recommendationInventoryScores)
        .innerJoin(inventories, eq(recommendationInventoryScores.inventoryId, inventories.id))
        .where(pricedWhere);
      return Number(rows[0]?.cnt ?? 0);
    });
    if (total === 0) return { items: [], total: 0 };

    const result = await db.execute(sql`
      WITH latest_spot_verification AS (
        SELECT verification.*
          FROM inventory_spot_verifications verification
          INNER JOIN (
            SELECT inventoryId, MAX(id) AS latestId
              FROM inventory_spot_verifications
             WHERE expiresAt > NOW()
             GROUP BY inventoryId
          ) latest ON latest.latestId = verification.id
      ), value_base AS (
        SELECT ris.inventoryId AS id,
               inventories.userId AS supplierId,
               ris.priorityTier,
               ris.valueScore,
               ris.advantagePct,
               ris.priceScore,
               ris.freshnessScore,
               ris.suspiciousPrice,
               ris.comparablePrice,
               COALESCE(inventories.refreshedAt, inventories.publishedAt, inventories.createdAt) AS effectiveRefreshedAt,
               CASE
                 WHEN spot.expiresAt > NOW()
                  AND spot.inventoryFingerprint = ${spotAuditFingerprintSql("spot")}
                 THEN spot.verifiedAt ELSE NULL
               END AS spotVerifiedAt
          FROM recommendation_inventory_scores ris
          INNER JOIN inventories ON inventories.id = ris.inventoryId
          LEFT JOIN latest_spot_verification spot ON spot.inventoryId = inventories.id
         WHERE ${pricedWhere}
      ), value_scored AS (
        SELECT value_base.*,
               CASE
                 WHEN spotVerifiedAt IS NULL THEN 0
                 ELSE ${SPOT_VERIFICATION_MAX_BOOST} * GREATEST(
                   0,
                   1 - GREATEST(0, TIMESTAMPDIFF(DAY, spotVerifiedAt, NOW())) / ${SPOT_VERIFICATION_VALID_DAYS}
                 )
               END AS spotVerificationComponent
          FROM value_base
      ), value_candidates AS (
        SELECT value_scored.*,
               ROW_NUMBER() OVER (
                 PARTITION BY priorityTier, supplierId
                 ORDER BY advantagePct DESC, valueScore + spotVerificationComponent DESC,
                          effectiveRefreshedAt DESC, id DESC
               ) AS supplierRow
          FROM value_scored
      ), page_ids AS (
        SELECT value_candidates.*,
               FLOOR((supplierRow - 1) / ${EMPTY_BROWSE_SUPPLIER_BATCH_SIZE}) AS supplierBatch
         FROM value_candidates
         ORDER BY priorityTier ASC, supplierBatch ASC, advantagePct DESC,
                  valueScore + spotVerificationComponent DESC, effectiveRefreshedAt DESC, id DESC
         LIMIT ${pageSize} OFFSET ${offset}
      )
      SELECT inventories.id, inventories.partNumber, inventories.brand, inventories.category,
             inventories.pkg, inventories.prodYear, inventories.dateCode, inventories.qtyOnSale, inventories.qtyOrder,
             inventories.priceEx, inventories.taxIncluded, inventories.ladderPrices, inventories.moq,
             inventories.source, inventories.grade, inventories.leadTime, inventories.note,
             inventories.photos, inventories.publishedAt,
             page_ids.effectiveRefreshedAt AS refreshedAt,
             page_ids.spotVerifiedAt,
             inventories.userId AS supplierId,
             ${materialSearchSupplierNameSql()} AS supplierName,
             CASE WHEN c.reviewStatus = 'approved' THEN COALESCE(ap.thumbnailUrl, ap.url) ELSE NULL END AS supplierAvatarUrl,
             CASE WHEN c.avatarDisplayMode = 'photo' THEN 'photo' ELSE 'logo' END AS supplierAvatarDisplayMode,
             LEAST(200, GREATEST(100, COALESCE(c.avatarCropZoom, 100))) AS supplierAvatarCropZoom,
             LEAST(100, GREATEST(-100, COALESCE(c.avatarCropX, 0))) AS supplierAvatarCropX,
             LEAST(100, GREATEST(-100, COALESCE(c.avatarCropY, 0))) AS supplierAvatarCropY,
             CASE WHEN c.reviewStatus = 'approved' THEN 1 ELSE 0 END AS supplierCertified,
             CASE
               WHEN c.reviewStatus = 'approved' AND c.merchantSinceAt IS NOT NULL AND c.merchantSinceAt <= NOW()
               THEN c.merchantSinceAt ELSE NULL
             END AS merchantSinceAt,
             (
               SELECT COUNT(*)
                 FROM public_company_review_events e
                 INNER JOIN public_company_reviews r
                   ON r.id = e.reviewId AND e.eventType = 'created'
                WHERE e.ratedUserId = inventories.userId AND r.status = 'published'
             ) AS publicReviewCount,
             (
               SELECT COUNT(*)
                 FROM orders o
                WHERE o.sellerId = inventories.userId
                  AND o.doneAt IS NOT NULL
                  AND o.status NOT IN ('cancel', 'refund')
             ) AS completedTradeCount,
             GREATEST(0, TIMESTAMPDIFF(DAY,
               CASE
                 WHEN c.reviewStatus = 'approved' AND c.merchantSinceAt IS NOT NULL AND c.merchantSinceAt <= NOW()
                 THEN c.merchantSinceAt ELSE NULL
               END,
               NOW()
             )) AS merchantTenureDays,
             page_ids.priorityTier - 1 AS relevanceTier,
             page_ids.suspiciousPrice,
             ${PRICE_WEIGHT} * page_ids.priceScore / 100 AS priceComponent,
             ${FRESHNESS_WEIGHT} * page_ids.freshnessScore / 100 AS freshnessComponent,
             0 AS tradeComponent,
             0 AS tenureComponent,
             page_ids.spotVerificationComponent,
             LEAST(100, page_ids.valueScore + page_ids.spotVerificationComponent) AS rankingScore,
             page_ids.comparablePrice AS taxComparablePrice
        FROM page_ids
        INNER JOIN inventories ON inventories.id = page_ids.id
        LEFT JOIN users u ON u.id = inventories.userId
        LEFT JOIN companies c ON c.userId = inventories.userId
        LEFT JOIN company_profile_photos ap
          ON ap.id = c.avatarPhotoId
         AND ap.companyId = c.id
         AND ap.status = 'approved'
         AND ap.deletedAt IS NULL
       ORDER BY page_ids.priorityTier ASC, page_ids.supplierBatch ASC,
                page_ids.advantagePct DESC,
                page_ids.valueScore + page_ids.spotVerificationComponent DESC,
                page_ids.effectiveRefreshedAt DESC, page_ids.id DESC
    `);
    const rawRows = (result as unknown as [Record<string, unknown>[], unknown])[0] ?? [];
    return { items: normalizeRankedInventoryRows(rawRows), total };
  }

  const total = await cachedEmptySearchCount(`inventory-browse:${countCacheKey}`, async () => {
    const rows = await db
      .select({ cnt: sql<number>`COUNT(*)` })
      .from(inventories)
      .where(where);
    return Number(rows[0]?.cnt ?? 0);
  });
  if (total === 0) return { items: [], total: 0 };

  let browseOrder: SQL;
  switch (sort) {
    case "priceAsc":
      browseOrder = sql`
        CASE WHEN ${inventories.priceEx} IS NULL OR ${inventories.priceEx} <= 0 THEN 1 ELSE 0 END ASC,
        CASE WHEN ${inventories.taxIncluded} = 1
          THEN ${inventories.priceEx}
          ELSE ${inventories.priceEx} * ${UNTAXED_TO_TAX_INCLUDED_MULTIPLIER}
        END ASC,
        ${inventories.id} ASC`;
      break;
    case "priceDesc":
      browseOrder = sql`
        CASE WHEN ${inventories.priceEx} IS NULL OR ${inventories.priceEx} <= 0 THEN 1 ELSE 0 END ASC,
        CASE WHEN ${inventories.taxIncluded} = 1
          THEN ${inventories.priceEx}
          ELSE ${inventories.priceEx} * ${UNTAXED_TO_TAX_INCLUDED_MULTIPLIER}
        END DESC,
        ${inventories.id} ASC`;
      break;
    case "stockAsc":
      browseOrder = sql`${inventories.qtyOnSale} ASC, ${inventories.id} ASC`;
      break;
    case "stockDesc":
      browseOrder = sql`${inventories.qtyOnSale} DESC, ${inventories.id} ASC`;
      break;
    case "lead":
      browseOrder = sql`CASE WHEN ${inventories.leadTime} LIKE '%现货%' THEN 0 ELSE 1 END ASC, ${inventories.leadTime} ASC, ${inventories.id} ASC`;
      break;
    default:
      browseOrder = sql`${inventories.refreshedAt} DESC, ${inventories.id} DESC`;
  }

  const result = await db.execute(sql`
    WITH latest_spot_verification AS (
      SELECT verification.*
        FROM inventory_spot_verifications verification
        INNER JOIN (
          SELECT inventoryId, MAX(id) AS latestId
            FROM inventory_spot_verifications
           WHERE expiresAt > NOW()
           GROUP BY inventoryId
        ) latest ON latest.latestId = verification.id
    )
    SELECT inventories.id, inventories.partNumber, inventories.brand, inventories.category,
           inventories.pkg, inventories.prodYear, inventories.dateCode, inventories.qtyOnSale, inventories.qtyOrder,
           inventories.priceEx, inventories.taxIncluded, inventories.ladderPrices, inventories.moq,
           inventories.source, inventories.grade, inventories.leadTime, inventories.note,
           inventories.photos, inventories.publishedAt,
           COALESCE(inventories.refreshedAt, inventories.publishedAt, inventories.createdAt) AS refreshedAt,
           CASE
             WHEN spot.expiresAt > NOW()
              AND spot.inventoryFingerprint = ${spotAuditFingerprintSql("spot")}
             THEN spot.verifiedAt ELSE NULL
           END AS spotVerifiedAt,
           inventories.userId AS supplierId,
           ${materialSearchSupplierNameSql()} AS supplierName,
           CASE WHEN c.reviewStatus = 'approved' THEN COALESCE(ap.thumbnailUrl, ap.url) ELSE NULL END AS supplierAvatarUrl,
           CASE WHEN c.avatarDisplayMode = 'photo' THEN 'photo' ELSE 'logo' END AS supplierAvatarDisplayMode,
           LEAST(200, GREATEST(100, COALESCE(c.avatarCropZoom, 100))) AS supplierAvatarCropZoom,
           LEAST(100, GREATEST(-100, COALESCE(c.avatarCropX, 0))) AS supplierAvatarCropX,
           LEAST(100, GREATEST(-100, COALESCE(c.avatarCropY, 0))) AS supplierAvatarCropY,
           CASE WHEN c.reviewStatus = 'approved' THEN 1 ELSE 0 END AS supplierCertified,
           CASE
             WHEN c.reviewStatus = 'approved' AND c.merchantSinceAt IS NOT NULL AND c.merchantSinceAt <= NOW()
             THEN c.merchantSinceAt ELSE NULL
           END AS merchantSinceAt,
           (
             SELECT COUNT(*)
               FROM public_company_review_events e
               INNER JOIN public_company_reviews r
                 ON r.id = e.reviewId AND e.eventType = 'created'
              WHERE e.ratedUserId = inventories.userId AND r.status = 'published'
           ) AS publicReviewCount,
           (
             SELECT COUNT(*)
               FROM orders o
              WHERE o.sellerId = inventories.userId
                AND o.doneAt IS NOT NULL
                AND o.status NOT IN ('cancel', 'refund')
           ) AS completedTradeCount,
           GREATEST(0, TIMESTAMPDIFF(DAY,
             CASE
               WHEN c.reviewStatus = 'approved' AND c.merchantSinceAt IS NOT NULL AND c.merchantSinceAt <= NOW()
               THEN c.merchantSinceAt ELSE NULL
             END,
             NOW()
           )) AS merchantTenureDays,
           0 AS relevanceTier, 0 AS suspiciousPrice, 0 AS priceComponent,
           0 AS freshnessComponent, 0 AS tradeComponent, 0 AS tenureComponent,
           0 AS spotVerificationComponent,
           0 AS rankingScore
      FROM inventories
      LEFT JOIN users u ON u.id = inventories.userId
      LEFT JOIN companies c ON c.userId = inventories.userId
      LEFT JOIN company_profile_photos ap
        ON ap.id = c.avatarPhotoId
       AND ap.companyId = c.id
       AND ap.status = 'approved'
       AND ap.deletedAt IS NULL
      LEFT JOIN latest_spot_verification spot ON spot.inventoryId = inventories.id
     WHERE ${where}
     ORDER BY ${browseOrder}
     LIMIT ${pageSize} OFFSET ${offset}
  `);
  const rawRows = (result as unknown as [Record<string, unknown>[], unknown])[0] ?? [];
  return { items: normalizeRankedInventoryRows(rawRows), total };
}

/**
 * 搜索已发布库存，支持排序与分页。
 *
 * 空关键词属于全站有价现货发现，走“数据通价格优势＋供应商轮转”的预计算快照路径；
 * 提供关键词时才执行相关度和同型号价格比较，避免跨型号比较绝对价格。
 *
   * 综合排序（sort=default）走智能排名：单条 SQL 内用 CTE 一次算完公开评价数量、成交统计、
   * 同型号价格分组与四项得分，再在应用层做供应商多样性重排。
 * 拆成多次查询会让"同型号最低价"这类窗口函数失去全量视野，因此必须一次查完。
 *
 * 其他排序分支（价格 / 库存 / 交期）不参与排名，但仍复用同一 CTE，
 * 以保证返回字段结构一致，前台无需分支处理。
 */
export async function searchPublishedInventories(
  params: SearchParams
): Promise<{ items: RankedInventoryRow[]; total: number }> {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };
  const {
    keyword,
    brand,
    pkg,
    category,
    sort = "default",
    page = 1,
    pageSize = 20,
    followedByUserId,
  } = params;
  const brandVariants =
    brand && brand !== "all" ? await resolveBrandFacetRawBrands(brand) : undefined;
  const where = searchConditions(
    keyword,
    brand,
    brandVariants,
    pkg,
    category,
    followedByUserId,
  );
  const normalizedKeyword = keyword?.normalize("NFKC").trim().toLowerCase() ?? "";
  const exactKeyword = normalizedKeyword;
  const prefixKeyword = `${normalizedKeyword}%`;
  const packagingSearchKeys = packagingSearchLookupKeys(exactKeyword.toUpperCase());
  const verifiedPackagingEquivalent = verifiedSearchPackagingEquivalent(exactKeyword);
  // 只在搜经核验的完整型号对时共用价格比较基准；普通型号保持原分组 SQL。
  const priceComparisonPartKey = verifiedPackagingEquivalent
    ? sql`CASE WHEN inventories.partNumberNormalized IN (${exactKeyword.toUpperCase()}, ${verifiedPackagingEquivalent})
          THEN ${[exactKeyword.toUpperCase(), verifiedPackagingEquivalent].sort()[0]}
          ELSE inventories.partNumberNormalized END`
    : sql`inventories.partNumberNormalized`;
  const offset = (page - 1) * pageSize;

  if (!normalizedKeyword) {
    return searchPublishedInventoryBrowsePage({
      db,
      where: where!,
      countCacheKey: JSON.stringify({
        brandVariants: brandVariants ? [...brandVariants].sort() : [],
        pkg: pkg ?? "",
        category: category ?? "",
        followedByUserId: followedByUserId ?? 0,
      }),
      sort,
      offset,
      pageSize,
    });
  }

  const countRows = await db
    .select({ cnt: sql<number>`COUNT(*)` })
    .from(inventories)
    .where(where);
  const total = Number(countRows[0]?.cnt ?? 0);
  if (total === 0) return { items: [], total: 0 };

  let orderSql: SQL;
  switch (sort) {
    case "priceAsc":
      // 先统一换算为含税比较价；无价（询价）行沉底。
      orderSql = sql`taxComparablePrice IS NULL ASC, taxComparablePrice ASC, id ASC`;
      break;
    case "priceDesc":
      orderSql = sql`taxComparablePrice IS NULL ASC, taxComparablePrice DESC, id ASC`;
      break;
    case "stockAsc":
      orderSql = sql`qtyOnSale ASC, id ASC`;
      break;
    case "stockDesc":
      orderSql = sql`qtyOnSale DESC, id ASC`;
      break;
    case "lead":
      orderSql = sql`CASE WHEN leadTime LIKE '%现货%' THEN 0 ELSE 1 END ASC, leadTime ASC, id ASC`;
      break;
    default:
      orderSql = sql`relevanceTier ASC, suspiciousPrice ASC, rankingScore DESC, refreshedAt DESC, tieHash ASC, id ASC`;
  }

  // 多样性重排需要看到目标页附近的候选池，因此先多取再切片；
  // 深翻页（offset >= 5000）放弃重排，避免拉取过大结果集。
  const useDiversity = sort === "default" && offset < 5000;
  const queryOffset = useDiversity ? 0 : offset;
  const queryLimit = useDiversity
    ? Math.min(total, Math.max(120, offset + pageSize + 100))
    : pageSize;

  const result = await db.execute(sql`
    WITH latest_spot_verification AS (
      SELECT verification.*
        FROM inventory_spot_verifications verification
        INNER JOIN (
          SELECT inventoryId, MAX(id) AS latestId
            FROM inventory_spot_verifications
           WHERE expiresAt > NOW()
           GROUP BY inventoryId
        ) latest
          ON latest.latestId = verification.id
    ),
    public_review_stats AS (
      SELECT e.ratedUserId, COUNT(*) AS publicReviewCount
        FROM public_company_review_events e
        INNER JOIN public_company_reviews r
          ON r.id = e.reviewId AND e.eventType = 'created'
       WHERE r.status = 'published'
       GROUP BY e.ratedUserId
    ),
    trade_stats AS (
      /*
       * 累计完成交易按持久的完成时间统计，不设时间窗口，也不按当前商品截断。
       * 售后驳回后恢复 done 的订单仍保留 doneAt；已取消或退款成功的订单不贡献成交信誉。
       */
      SELECT sellerId, COUNT(*) AS completedTradeCount
        FROM orders
       WHERE doneAt IS NOT NULL
         AND status NOT IN ('cancel', 'refund')
       GROUP BY sellerId
    ),
    matched AS (
      SELECT inventories.id, inventories.partNumber, inventories.brand, inventories.category,
             inventories.pkg, inventories.prodYear, inventories.dateCode, inventories.qtyOnSale, inventories.qtyOrder, inventories.priceEx,
             inventories.taxIncluded, inventories.ladderPrices, inventories.moq, inventories.source, inventories.grade,
             inventories.leadTime, inventories.note, inventories.photos, inventories.publishedAt,
             COALESCE(inventories.refreshedAt, inventories.publishedAt, inventories.createdAt) AS refreshedAt,
             CASE
               WHEN spot.expiresAt > NOW()
                AND spot.inventoryFingerprint = ${spotAuditFingerprintSql("spot")}
               THEN spot.verifiedAt ELSE NULL
             END AS spotVerifiedAt,
             inventories.userId AS supplierId,
             ${materialSearchSupplierNameSql()} AS supplierName,
             CASE
               WHEN c.reviewStatus = 'approved' THEN COALESCE(ap.thumbnailUrl, ap.url)
               ELSE NULL
             END AS supplierAvatarUrl,
             CASE WHEN c.avatarDisplayMode = 'photo' THEN 'photo' ELSE 'logo' END AS supplierAvatarDisplayMode,
             LEAST(200, GREATEST(100, COALESCE(c.avatarCropZoom, 100))) AS supplierAvatarCropZoom,
             LEAST(100, GREATEST(-100, COALESCE(c.avatarCropX, 0))) AS supplierAvatarCropX,
             LEAST(100, GREATEST(-100, COALESCE(c.avatarCropY, 0))) AS supplierAvatarCropY,
             CASE WHEN c.reviewStatus = 'approved' THEN 1 ELSE 0 END AS supplierCertified,
             CASE
               WHEN c.reviewStatus = 'approved'
                AND c.merchantSinceAt IS NOT NULL
                AND c.merchantSinceAt <= NOW()
               THEN c.merchantSinceAt
               ELSE NULL
             END AS merchantSinceAt,
             COALESCE(prs.publicReviewCount, 0) AS publicReviewCount,
             COALESCE(ts.completedTradeCount, 0) AS completedTradeCount,
             CASE
               WHEN ${normalizedKeyword} = '' THEN 0
               WHEN inventories.partNumberNormalized = ${exactKeyword.toUpperCase()} THEN 0
               /* 已核验包装配对在 packagingSearchKeys 中，同样视为完整型号命中。 */
               WHEN ${packagingSearchKeys.length > 1 ? sql`inventories.partNumberNormalized IN (${sql.join(packagingSearchKeys.map(key => sql`${key}`), sql`, `)})` : sql`0`} THEN 0
               WHEN inventories.partNumberNormalized LIKE ${prefixKeyword.toUpperCase()} THEN 1
               WHEN inventories.partNumberNormalized LIKE ${`%${normalizedKeyword.toUpperCase()}%`} THEN 2
               ELSE 3
             END AS relevanceTier,
             /*
              * 排序内部统一换算为含税比较价：含税价保持原值，未税价按 13% 税率换算。
              * 页面仍展示供应商原始报价与税价标识，不改写库存数据。
              */
             CASE
               WHEN inventories.priceEx IS NULL OR inventories.priceEx <= 0 THEN NULL
               WHEN inventories.taxIncluded = 1 THEN inventories.priceEx
               ELSE inventories.priceEx * ${UNTAXED_TO_TAX_INCLUDED_MULTIPLIER}
             END AS taxComparablePrice,
             /* 同一型号同组；仅已核验的 TJA1042 双包装型号跨写法共用价格基准。 */
             MIN(CASE
               WHEN inventories.priceEx IS NULL OR inventories.priceEx <= 0 THEN NULL
               WHEN inventories.taxIncluded = 1 THEN inventories.priceEx
               ELSE inventories.priceEx * ${UNTAXED_TO_TAX_INCLUDED_MULTIPLIER}
               END) OVER (
               PARTITION BY ${priceComparisonPartKey}
             ) AS bestPrice,
             AVG(CASE
               WHEN inventories.priceEx IS NULL OR inventories.priceEx <= 0 THEN NULL
               WHEN inventories.taxIncluded = 1 THEN inventories.priceEx
               ELSE inventories.priceEx * ${UNTAXED_TO_TAX_INCLUDED_MULTIPLIER}
             END) OVER (
               PARTITION BY ${priceComparisonPartKey}
             ) AS groupAveragePrice,
             COUNT(CASE WHEN inventories.priceEx > 0 THEN 1 END) OVER (
               PARTITION BY ${priceComparisonPartKey}
             ) AS pricedChannelCount
        FROM inventories
        LEFT JOIN users u ON u.id = inventories.userId
        LEFT JOIN companies c ON c.userId = inventories.userId
        LEFT JOIN company_profile_photos ap
          ON ap.id = c.avatarPhotoId
         AND ap.companyId = c.id
         AND ap.status = 'approved'
         AND ap.deletedAt IS NULL
        LEFT JOIN public_review_stats prs ON prs.ratedUserId = inventories.userId
        LEFT JOIN trade_stats ts ON ts.sellerId = inventories.userId
        LEFT JOIN latest_spot_verification spot ON spot.inventoryId = inventories.id
       WHERE ${where}
    ),
    features AS (
      SELECT matched.*,
             GREATEST(0, TIMESTAMPDIFF(DAY, refreshedAt, NOW())) AS refreshAgeDays,
             GREATEST(0, TIMESTAMPDIFF(DAY, merchantSinceAt, NOW())) AS merchantTenureDays,
             CASE
               WHEN taxComparablePrice IS NULL OR bestPrice IS NULL OR bestPrice <= 0 THEN 0
               ELSE ${PRICE_WEIGHT} * POWER(2, -GREATEST(0, taxComparablePrice / bestPrice - 1) / ${PRICE_HALF_LIFE})
             END AS priceComponent,
             ${FRESHNESS_WEIGHT} * CASE
               WHEN TIMESTAMPDIFF(DAY, refreshedAt, NOW()) <= 3 THEN 1
               WHEN TIMESTAMPDIFF(DAY, refreshedAt, NOW()) <= 7 THEN 0.8
               WHEN TIMESTAMPDIFF(DAY, refreshedAt, NOW()) <= 14 THEN 0.5
               WHEN TIMESTAMPDIFF(DAY, refreshedAt, NOW()) <= 30 THEN 0.2
               ELSE 0.05
             END AS freshnessComponent,
             ${TRADE_WEIGHT} * LEAST(1,
               LOG(1 + completedTradeCount) / LOG(1 + ${TRADE_SATURATION_COUNT})
             ) AS tradeComponent,
             ${TENURE_WEIGHT} * CASE
               WHEN merchantSinceAt IS NULL THEN 0.5
               WHEN TIMESTAMPDIFF(DAY, merchantSinceAt, NOW()) <= 30 THEN 0.5
               WHEN TIMESTAMPDIFF(DAY, merchantSinceAt, NOW()) <= 90 THEN 0.65
               WHEN TIMESTAMPDIFF(DAY, merchantSinceAt, NOW()) <= 180 THEN 0.8
               WHEN TIMESTAMPDIFF(DAY, merchantSinceAt, NOW()) <= 365 THEN 0.9
               ELSE 1
             END AS tenureComponent,
             CASE
               WHEN spotVerifiedAt IS NULL THEN 0
               ELSE ${SPOT_VERIFICATION_MAX_BOOST} * GREATEST(
                 0,
                 1 - GREATEST(0, TIMESTAMPDIFF(DAY, spotVerifiedAt, NOW())) / ${SPOT_VERIFICATION_VALID_DAYS}
               )
             END AS spotVerificationComponent,
             CASE
               WHEN pricedChannelCount >= 3 AND taxComparablePrice < groupAveragePrice * 0.5 THEN 1
               ELSE 0
             END AS suspiciousPrice,
             /* 综合分与精确刷新时间均相同时，才按当天日期哈希轮转。 */
             SHA2(CONCAT(CURDATE(), ':', id), 256) AS tieHash
        FROM matched
    ),
    scored AS (
      SELECT features.*,
             LEAST(100,
               priceComponent + freshnessComponent + tradeComponent + tenureComponent
                 + spotVerificationComponent
             ) AS rankingScore
        FROM features
    )
    SELECT id, partNumber, brand, category, pkg, prodYear, dateCode, qtyOnSale, qtyOrder, priceEx,
           taxIncluded, ladderPrices, moq, source, grade, leadTime, note, photos, publishedAt,
           refreshedAt, spotVerifiedAt, supplierId, supplierName, supplierAvatarUrl, supplierAvatarDisplayMode,
           supplierAvatarCropZoom, supplierAvatarCropX, supplierAvatarCropY,
           supplierCertified, merchantSinceAt,
           publicReviewCount, completedTradeCount,
           merchantTenureDays, relevanceTier, suspiciousPrice, priceComponent,
           freshnessComponent, tradeComponent, tenureComponent, spotVerificationComponent,
           rankingScore, tieHash, taxComparablePrice
      FROM scored
     ORDER BY ${orderSql}
     LIMIT ${queryLimit} OFFSET ${queryOffset}
  `);

  const rawRows = (result as unknown as [Record<string, unknown>[], unknown])[0] ?? [];
  const normalizedRows = normalizeRankedInventoryRows(rawRows);

  if (!useDiversity) return { items: normalizedRows, total };

  // 多样性重排只在同一 (相关度层, 异常低价) 分段内进行：
  // 跨层重排会让低相关行提前，违背排序的硬约束。
  const diversified: RankedInventoryRow[] = [];
  for (let start = 0; start < normalizedRows.length; ) {
    const first = normalizedRows[start];
    const groupEnd = normalizedRows.findIndex(
      (row, index) =>
        index > start &&
        (row.relevanceTier !== first.relevanceTier || row.suspiciousPrice !== first.suspiciousPrice)
    );
    const end = groupEnd < 0 ? normalizedRows.length : groupEnd;
    diversified.push(...diversifyTopChannels(normalizedRows.slice(start, end)));
    start = end;
  }
  return { items: diversified.slice(offset, offset + pageSize), total };
}

/** 从当前搜索结果聚合品牌列表：清洗公开名称、合并同义写法并汇总数量。 */
export async function aggregateBrands(keyword?: string) {
  const db = await getDb();
  if (!db) return [];
  const where = searchConditions(keyword);
  const rows = await db
    .select({ brand: inventories.brand, cnt: sql<number>`COUNT(*)` })
    .from(inventories)
    .where(where)
    .groupBy(inventories.brand)
    .orderBy(desc(sql`COUNT(*)`), asc(inventories.brand));
  return groupBrandFacets(
    rows.map(row => ({ brand: row.brand, count: Number(row.cnt) })),
  ).map(({ brand, count }) => ({ brand, count }));
}

/** 把公开规范品牌还原成库存中全部原始写法，保证去重后筛选结果不丢失。 */
export async function resolveBrandFacetRawBrands(brand: string): Promise<string[]> {
  const db = await getDb();
  const normalizedBrand = brand.trim();
  if (!db || !normalizedBrand || normalizedBrand === "all") return [];

  const rows = await db
    .select({ brand: inventories.brand, cnt: sql<number>`COUNT(*)` })
    .from(inventories)
    .where(and(
      eq(inventories.status, "published" as const),
      companyCatalogVisibleCondition(),
    ))
    .groupBy(inventories.brand);
  const target = normalizedBrand.toLocaleUpperCase("en-US");
  const facet = groupBrandFacets(
    rows.map(row => ({ brand: row.brand, count: Number(row.cnt) })),
  ).find(item => item.brand.toLocaleUpperCase("en-US") === target);

  // 兼容旧书签中的原始品牌值：未命中规范名称时仍按原值精确筛选。
  return facet?.rawBrands ?? [normalizedBrand];
}

/** 从当前搜索结果聚合分类列表（含数量），供搜索页分类筛选栏使用 */
export async function aggregateCategories(keyword?: string) {
  const db = await getDb();
  if (!db) return [];
  const where = searchConditions(keyword);
  const rows = await db
    .select({ category: inventories.category, cnt: sql<number>`COUNT(*)` })
    .from(inventories)
    .where(where)
    .groupBy(inventories.category)
    .orderBy(desc(sql`COUNT(*)`), asc(inventories.category));
  return rows.map(r => ({ category: r.category, count: Number(r.cnt) }));
}

/** 公开商品详情：按库存 id 返回已发布库存（联表供应商名称） */
export async function getPublishedInventoryById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select({
      id: inventories.id,
      partNumber: inventories.partNumber,
      brand: inventories.brand,
      category: inventories.category,
      pkg: inventories.pkg,
      dateCode: inventories.dateCode,
      prodYear: inventories.prodYear,
      qtyOnSale: inventories.qtyOnSale,
      qtyOrder: inventories.qtyOrder,
      priceEx: inventories.priceEx,
      priceIncl: inventories.priceIncl,
      taxIncluded: inventories.taxIncluded,
      invoice: inventories.invoice,
      ladderPrices: inventories.ladderPrices,
      moq: inventories.moq,
      spq: inventories.spq,
      source: inventories.source,
      grade: inventories.grade,
      leadTime: inventories.leadTime,
      rohs: inventories.rohs,
      note: inventories.note,
      photos: inventories.photos,
      publishedAt: inventories.publishedAt,
      supplierId: inventories.userId,
      /* 供应商名称口径必须与搜索列表一致（优先企业名），
         否则用户从搜索结果（显示企业名）点进详情页会变成个人用户名。 */
      supplierName: supplierDisplayNameSql,
    })
    .from(inventories)
    .leftJoin(users, eq(inventories.userId, users.id))
    .leftJoin(companies, eq(companies.userId, inventories.userId))
    .where(and(eq(inventories.id, id), eq(inventories.status, "published")))
    .limit(1);
  const detail = rows[0];
  if (!detail) return undefined;
  // 详情页公开展示备注，同样需要 B 层兜底（理由见 searchPublishedInventories 内注释）
  return { ...detail, note: maskForbiddenWords(detail.note) || null };
}

/** 相关商品推荐：同品牌或同分类的其他已发布库存（品牌命中优先，其次分类，最后发布时间倒序） */
export async function getRelatedInventories(params: {
  excludeId: number;
  brand: string;
  category: string;
  limit?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  const { excludeId, brand, category, limit = 6 } = params;
  return db
    .select({
      id: inventories.id,
      partNumber: inventories.partNumber,
      brand: inventories.brand,
      category: inventories.category,
      pkg: inventories.pkg,
      qtyOnSale: inventories.qtyOnSale,
      qtyOrder: inventories.qtyOrder,
      priceEx: inventories.priceEx,
      taxIncluded: inventories.taxIncluded,
      ladderPrices: inventories.ladderPrices,
      moq: inventories.moq,
      grade: inventories.grade,
      leadTime: inventories.leadTime,
      photos: inventories.photos,
      /* 同上：相关商品推荐的供应商名也需优先企业名，与列表/详情保持一致。 */
      supplierName: supplierDisplayNameSql,
    })
    .from(inventories)
    .leftJoin(users, eq(inventories.userId, users.id))
    .leftJoin(companies, eq(companies.userId, inventories.userId))
    .where(
      and(
        eq(inventories.status, "published"),
        companyCatalogVisibleCondition(),
        sql`${inventories.id} != ${excludeId}`,
        or(eq(inventories.brand, brand), eq(inventories.category, category))
      )
    )
    .orderBy(
      sql`CASE WHEN ${inventories.brand} = ${brand} THEN 0 ELSE 1 END`,
      desc(inventories.publishedAt)
    )
    .limit(limit);
}

/** 搜索框联想：按型号聚合已发布库存（型号 + 品牌 + 在售总量），前缀命中优先 */
export async function suggestPartNumbers(keyword: string, limit = 8) {
  const db = await getDb();
  if (!db) return [];
  const kw = keyword.trim();
  if (!kw) return [];
  const prefix = `${kw}%`;
  const contains = `%${kw}%`;
  const rows = await db
    .select({
      partNumber: inventories.partNumber,
      brand: sql<string>`MAX(${inventories.brand})`,
      totalQty: sql<number>`CAST(SUM(${inventories.qtyOnSale}) AS SIGNED)`,
    })
    .from(inventories)
    .where(
      and(
        eq(inventories.status, "published"),
        companyCatalogVisibleCondition(),
        sql`${inventories.partNumber} LIKE ${contains}`
      )
    )
    .groupBy(inventories.partNumber)
    .orderBy(
      sql`CASE WHEN ${inventories.partNumber} LIKE ${prefix} THEN 0 ELSE 1 END`,
      asc(inventories.partNumber)
    )
    .limit(limit);
  return rows.map(r => ({
    partNumber: r.partNumber,
    brand: r.brand ?? "",
    totalQty: Number(r.totalQty) || 0,
  }));
}

/* ══════════ 卖家自提点 ══════════ */

export async function listSellerPickupPoints(sellerId: number, enabledOnly = false) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(sellerPickupPoints)
    .where(
      enabledOnly
        ? and(eq(sellerPickupPoints.sellerId, sellerId), eq(sellerPickupPoints.enabled, true))
        : eq(sellerPickupPoints.sellerId, sellerId),
    )
    .orderBy(asc(sellerPickupPoints.sortOrder), asc(sellerPickupPoints.id));
}

export async function listEnabledPickupPointsForSellers(sellerIds: number[]) {
  const db = await getDb();
  if (!db || sellerIds.length === 0) return [];
  return db
    .select({
      id: sellerPickupPoints.id,
      sellerId: sellerPickupPoints.sellerId,
      name: sellerPickupPoints.name,
      address: sellerPickupPoints.address,
      contactName: sellerPickupPoints.contactName,
      contactPhone: sellerPickupPoints.contactPhone,
      businessHours: sellerPickupPoints.businessHours,
    })
    .from(sellerPickupPoints)
    .innerJoin(
      companies,
      and(eq(companies.userId, sellerPickupPoints.sellerId), eq(companies.reviewStatus, "approved")),
    )
    .where(
      and(
        inArray(sellerPickupPoints.sellerId, sellerIds),
        eq(sellerPickupPoints.enabled, true),
      ),
    )
    .orderBy(
      asc(sellerPickupPoints.sellerId),
      asc(sellerPickupPoints.sortOrder),
      asc(sellerPickupPoints.id),
    );
}

export async function saveSellerPickupPoint(
  sellerId: number,
  input: Omit<InsertSellerPickupPoint, "sellerId" | "createdAt" | "updatedAt"> & { id?: number },
) {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");
  const [company] = await db
    .select({ reviewStatus: companies.reviewStatus })
    .from(companies)
    .where(eq(companies.userId, sellerId))
    .limit(1);
  if (company?.reviewStatus !== "approved") throw new Error("企业审核通过后可设置自提点");
  const values = {
    name: input.name,
    address: input.address,
    contactName: input.contactName,
    contactPhone: input.contactPhone,
    businessHours: input.businessHours || null,
    enabled: input.enabled ?? true,
    sortOrder: input.sortOrder ?? 0,
  };
  if (input.id) {
    const result = await db
      .update(sellerPickupPoints)
      .set(values)
      .where(and(eq(sellerPickupPoints.id, input.id), eq(sellerPickupPoints.sellerId, sellerId)));
    return Number((result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0) > 0;
  }
  const result = await db.insert(sellerPickupPoints).values({ sellerId, ...values });
  return Number((result as unknown as [{ insertId?: number }])[0]?.insertId ?? 0);
}

export async function deleteSellerPickupPoint(sellerId: number, id: number) {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");
  const result = await db
    .delete(sellerPickupPoints)
    .where(and(eq(sellerPickupPoints.id, id), eq(sellerPickupPoints.sellerId, sellerId)));
  return Number((result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0) > 0;
}

/* ══════════ 购物车 ══════════ */

/** 获取用户购物车（关联库存信息） */
export async function getCartByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const cartRows = await db
    .select({
      id: cartItems.id,
      inventoryId: cartItems.inventoryId,
      qty: cartItems.qty,
      checked: cartItems.checked,
      partNumber: inventories.partNumber,
      brand: inventories.brand,
      pkg: inventories.pkg,
      prodYear: inventories.prodYear,
      note: inventories.note,
      leadTime: inventories.leadTime,
      priceEx: inventories.priceEx,
      taxIncluded: inventories.taxIncluded,
      ladderPrices: inventories.ladderPrices,
      moq: inventories.moq,
      qtyOnSale: inventories.qtyOnSale,
      invStatus: inventories.status,
      sellerId: inventories.userId,
      /* 早期此处直接取 users.name，购物车里显示的是卖家个人姓名（如 victor），
         与搜索页/详情页的企业名不一致，采购方无法确认交易对象。 */
      sellerName: supplierDisplayNameSql,
    })
    .from(cartItems)
    .leftJoin(inventories, eq(cartItems.inventoryId, inventories.id))
    .leftJoin(users, eq(inventories.userId, users.id))
    .leftJoin(companies, eq(companies.userId, inventories.userId))
    .where(eq(cartItems.userId, userId))
    .orderBy(desc(cartItems.createdAt));
  // 购物车同样把备注展示给买家，需与搜索/详情保持同一套打码口径
  return cartRows.map(row => ({ ...row, note: maskForbiddenWords(row.note) || null }));
}

const CHECKOUT_SESSION_TTL_MS = 30 * 60 * 1000;

type CheckoutItemSnapshot = {
  cartItemId: number;
  inventoryId: number;
  qty: number;
  inventoryFingerprint: string;
};

export function inventoryCheckoutFingerprint(input: {
  priceEx: string | null;
  taxIncluded: boolean | null;
  ladderPrices: unknown;
  moq: number | null;
  status: string | null;
}) {
  return createHash("sha256")
    .update(JSON.stringify({
      priceEx: input.priceEx,
      taxIncluded: input.taxIncluded !== false,
      ladderPrices: input.ladderPrices,
      moq: Math.max(1, Number(input.moq) || 1),
      status: input.status || "",
    }))
    .digest("hex");
}

function newCheckoutToken() {
  return randomBytes(24).toString("base64url");
}

/**
 * 为购物车页固定本次结算条目。只接受当前用户已勾选的条目，数量与库存 ID
 * 一并快照；后续提交不再重新解释全局 checked 状态。
 */
export async function prepareCheckoutSession(userId: number, cartItemIds: number[]) {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");
  const ids = Array.from(new Set(cartItemIds.map(Number))).filter(Number.isInteger).sort((a, b) => a - b);
  if (ids.length === 0) return null;
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`);
    const selected = await tx
      .select({
        id: cartItems.id,
        inventoryId: cartItems.inventoryId,
        qty: cartItems.qty,
        checked: cartItems.checked,
        priceEx: inventories.priceEx,
        taxIncluded: inventories.taxIncluded,
        ladderPrices: inventories.ladderPrices,
        moq: inventories.moq,
        status: inventories.status,
      })
      .from(cartItems)
      .innerJoin(inventories, eq(cartItems.inventoryId, inventories.id))
      .where(and(eq(cartItems.userId, userId), inArray(cartItems.id, ids)))
      .for("update");
    if (selected.length !== ids.length || selected.some(item => !item.checked)) return null;
    const items: CheckoutItemSnapshot[] = selected
      .map(item => ({
        cartItemId: Number(item.id),
        inventoryId: Number(item.inventoryId),
        qty: Number(item.qty),
        inventoryFingerprint: inventoryCheckoutFingerprint(item),
      }))
      .sort((a, b) => a.cartItemId - b.cartItemId);
    const token = newCheckoutToken();
    const expiresAt = new Date(Date.now() + CHECKOUT_SESSION_TTL_MS);
    await tx.insert(checkoutSessions).values({ token, buyerId: userId, items, expiresAt });
    return { checkoutToken: token, expiresAt, itemCount: items.length };
  });
}

/** 读取结算会话绑定的购物车商品，供结算页展示；任何快照变化都拒绝继续。 */
export async function getCheckoutSessionCart(userId: number, token: string) {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");
  return db.transaction(async tx => {
    const [session] = await tx
      .select()
      .from(checkoutSessions)
      .where(and(eq(checkoutSessions.token, token), eq(checkoutSessions.buyerId, userId)))
      .limit(1)
      .for("update");
    if (!session) return { status: "invalid" as const, items: [] };
    if (session.status !== "prepared") return { status: session.status, items: [] };
    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      await tx
        .update(checkoutSessions)
        .set({ status: "failed", failureMessage: "结算已过期" })
        .where(eq(checkoutSessions.id, session.id));
      return { status: "expired" as const, items: [] };
    }
    const snapshots = Array.isArray(session.items) ? session.items : [];
    const cartRows = await tx
      .select({
        id: cartItems.id,
        inventoryId: cartItems.inventoryId,
        qty: cartItems.qty,
        checked: cartItems.checked,
        partNumber: inventories.partNumber,
        brand: inventories.brand,
        pkg: inventories.pkg,
        prodYear: inventories.prodYear,
        note: inventories.note,
        leadTime: inventories.leadTime,
        priceEx: inventories.priceEx,
        taxIncluded: inventories.taxIncluded,
        ladderPrices: inventories.ladderPrices,
        moq: inventories.moq,
        qtyOnSale: inventories.qtyOnSale,
        invStatus: inventories.status,
        sellerId: inventories.userId,
        sellerName: supplierDisplayNameSql,
      })
      .from(cartItems)
      .leftJoin(inventories, eq(cartItems.inventoryId, inventories.id))
      .leftJoin(users, eq(inventories.userId, users.id))
      .leftJoin(companies, eq(companies.userId, inventories.userId))
      .where(eq(cartItems.userId, userId))
      .orderBy(desc(cartItems.createdAt));
    const cart = cartRows.map(row => ({
      ...row,
      note: maskForbiddenWords(row.note) || null,
    }));
    const rows = snapshots.map(snapshot =>
      cart.find(row => Number(row.id) === Number(snapshot.cartItemId)),
    );
    const changed = rows.some((row, index) =>
      !row ||
      Number(row.inventoryId) !== Number(snapshots[index].inventoryId) ||
      Number(row.qty) !== Number(snapshots[index].qty) ||
      inventoryCheckoutFingerprint({
        priceEx: row.priceEx,
        taxIncluded: row.taxIncluded,
        ladderPrices: row.ladderPrices,
        moq: row.moq,
        status: row.invStatus,
      }) !== snapshots[index].inventoryFingerprint,
    );
    return changed
      ? { status: "changed" as const, items: [] }
      : {
          status: "prepared" as const,
          items: rows.filter((row): row is (typeof cart)[number] => Boolean(row)),
        };
  });
}

/**
 * 加入购物车：已存在则合并数量。
 *
 * 传入 `maxQty` 时做库存上限保护。所有购物车写入先锁定当前用户行，
 * 再在同一事务内读取和更新条目，避开普通加购与立即购买并发交错。
 * 超限时返回 null，由调用方决定提示文案。
 * 不传 `maxQty` 保持原有行为，向后兼容。
 */
export async function addToCart(
  userId: number,
  inventoryId: number,
  qty: number,
  maxQty?: number,
): Promise<number | null> {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");
  const hasLimit = typeof maxQty === "number" && Number.isFinite(maxQty) && maxQty >= 0;
  if (hasLimit && qty > (maxQty as number)) return null;
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`);
    const existingResult = await tx.execute(sql`
      SELECT id, qty FROM cart_items
       WHERE userId = ${userId} AND inventoryId = ${inventoryId}
       LIMIT 1
       FOR UPDATE
    `);
    const existing = (existingResult as unknown as [Array<{ id: number; qty: number }>, unknown])[0][0];
    if (existing) {
      const nextQty = Number(existing.qty) + qty;
      if (hasLimit && nextQty > (maxQty as number)) return null;
      await tx.execute(sql`
        UPDATE cart_items SET qty = ${nextQty}, checked = 1
         WHERE id = ${Number(existing.id)} AND userId = ${userId}
      `);
      return Number(existing.id);
    }
    const result = await tx
      .insert(cartItems)
      .values({ userId, inventoryId, qty, checked: true });
    return Number((result as unknown as [{ insertId: number }])[0].insertId);
  });
}

/** 更新购物车条目（数量/勾选） */
export async function updateCartItem(
  userId: number,
  id: number,
  patch: { qty?: number; checked?: boolean },
) {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`);
    await tx
      .update(cartItems)
      .set(patch)
      .where(and(eq(cartItems.id, id), eq(cartItems.userId, userId)));
  });
}

/** 全选/全不选 */
export async function setCartAllChecked(userId: number, checked: boolean) {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`);
    await tx.update(cartItems).set({ checked }).where(eq(cartItems.userId, userId));
  });
}

/**
 * 将购物车选中范围一次原子替换为客户端当前确认的可结算条目。
 * 先锁用户行，与加购/立即购买共用串行化边界，避免多设备交错覆盖。
 */
export async function setCartCheckedSelection(
  userId: number,
  checked: boolean,
  ids: number[],
) {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`);
    await tx
      .update(cartItems)
      .set({ checked: false })
      .where(eq(cartItems.userId, userId));
    if (checked && ids.length > 0) {
      await tx
        .update(cartItems)
        .set({ checked: true })
        .where(and(eq(cartItems.userId, userId), inArray(cartItems.id, ids)));
    }
  });
}

/** 删除购物车条目（支持批量） */
export async function removeCartItems(userId: number, ids: number[]) {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");
  if (ids.length === 0) return;
  await db
    .delete(cartItems)
    .where(and(eq(cartItems.userId, userId), sql`${cartItems.id} IN ${ids}`));
}

/**
 * 立即购买：把目标商品数量设置为本次购买数量，并且只勾选该商品。
 *
 * 用户行锁作为同一账号购物车的串行化锁；数量写入、取消其他勾选和勾选
 * 目标商品在同一事务提交，避免多页面或多设备并发立即购买发生交错。
 */
export async function buyNowToCart(
  userId: number,
  inventoryId: number,
  qty: number,
  maxQty: number,
): Promise<{ cartItemId: number; checkoutToken: string; expiresAt: Date } | null> {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");
  if (!Number.isFinite(maxQty) || qty > maxQty) return null;
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`);
    const existingResult = await tx.execute(sql`
      SELECT id FROM cart_items
       WHERE userId = ${userId} AND inventoryId = ${inventoryId}
       LIMIT 1
       FOR UPDATE
    `);
    const existing = (existingResult as unknown as [Array<{ id: number }>, unknown])[0][0];
    let cartItemId: number;
    if (existing) {
      cartItemId = Number(existing.id);
      await tx.execute(sql`
        UPDATE cart_items SET qty = ${qty}
         WHERE id = ${cartItemId} AND userId = ${userId}
      `);
    } else {
      const inserted = await tx.insert(cartItems).values({
        userId,
        inventoryId,
        qty,
        checked: false,
      });
      cartItemId = Number((inserted as unknown as [{ insertId: number }])[0].insertId);
    }
    await tx.execute(sql`
      UPDATE cart_items
         SET checked = CASE WHEN id = ${cartItemId} THEN 1 ELSE 0 END
       WHERE userId = ${userId}
    `);
    const checkoutToken = newCheckoutToken();
    const expiresAt = new Date(Date.now() + CHECKOUT_SESSION_TTL_MS);
    const [inventoryVersion] = await tx
      .select({
        priceEx: inventories.priceEx,
        taxIncluded: inventories.taxIncluded,
        ladderPrices: inventories.ladderPrices,
        moq: inventories.moq,
        status: inventories.status,
      })
      .from(inventories)
      .where(eq(inventories.id, inventoryId))
      .limit(1)
      .for("update");
    if (!inventoryVersion) return null;
    await tx.insert(checkoutSessions).values({
      token: checkoutToken,
      buyerId: userId,
      items: [{
        cartItemId,
        inventoryId,
        qty,
        inventoryFingerprint: inventoryCheckoutFingerprint(inventoryVersion),
      }],
      expiresAt,
    });
    return { cartItemId, checkoutToken, expiresAt };
  });
}

/** 购物车商品种类数（导航角标） */
export async function getCartCount(userId: number) {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ cnt: sql<number>`COUNT(*)` })
    .from(cartItems)
    .where(eq(cartItems.userId, userId));
  return Number(row?.cnt ?? 0);
}

/* ══════════ 收货地址 ══════════ */

export async function getAddressesByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(addresses)
    .where(eq(addresses.userId, userId))
    .orderBy(desc(addresses.isDefault), desc(addresses.createdAt));
}

export async function createAddress(data: InsertAddress) {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");
  if (data.isDefault) {
    await db
      .update(addresses)
      .set({ isDefault: false })
      .where(eq(addresses.userId, data.userId));
  }
  const result = await db.insert(addresses).values(data);
  return Number((result as unknown as [{ insertId: number }])[0].insertId);
}

export async function updateAddress(
  userId: number,
  id: number,
  patch: Partial<InsertAddress>,
) {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");
  if (patch.isDefault) {
    await db
      .update(addresses)
      .set({ isDefault: false })
      .where(eq(addresses.userId, userId));
  }
  await db
    .update(addresses)
    .set(patch)
    .where(and(eq(addresses.id, id), eq(addresses.userId, userId)));
}

export async function deleteAddress(userId: number, id: number) {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");
  await db
    .delete(addresses)
    .where(and(eq(addresses.id, id), eq(addresses.userId, userId)));
  // 若删除后无默认地址，将最早一条设为默认
  const rest = await db
    .select()
    .from(addresses)
    .where(eq(addresses.userId, userId));
  if (rest.length > 0 && !rest.some(a => a.isDefault)) {
    await db
      .update(addresses)
      .set({ isDefault: true })
      .where(eq(addresses.id, rest[0].id));
  }
}

/* ══════════ 发票抬头 ══════════ */

export async function getInvoiceTitlesByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(invoiceTitles)
    .where(eq(invoiceTitles.userId, userId))
    .orderBy(desc(invoiceTitles.isDefault), desc(invoiceTitles.updatedAt), desc(invoiceTitles.id));
}

export async function createInvoiceTitle(data: InsertInvoiceTitle) {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");
  return db.transaction(async tx => {
    const existing = await tx
      .select({ id: invoiceTitles.id })
      .from(invoiceTitles)
      .where(eq(invoiceTitles.userId, data.userId))
      .limit(1);
    const isDefault = Boolean(data.isDefault || existing.length === 0);
    if (isDefault) {
      await tx
        .update(invoiceTitles)
        .set({ isDefault: false })
        .where(eq(invoiceTitles.userId, data.userId));
    }
    const result = await tx.insert(invoiceTitles).values({ ...data, isDefault });
    return Number((result as unknown as [{ insertId: number }])[0].insertId);
  });
}

export async function updateInvoiceTitle(
  userId: number,
  id: number,
  patch: Partial<Omit<InsertInvoiceTitle, "userId">>,
) {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");
  return db.transaction(async tx => {
    const owned = await tx
      .select({ id: invoiceTitles.id, isDefault: invoiceTitles.isDefault })
      .from(invoiceTitles)
      .where(and(eq(invoiceTitles.id, id), eq(invoiceTitles.userId, userId)))
      .limit(1);
    if (!owned[0]) return false;
    const safePatch = { ...patch };
    if (owned[0].isDefault && patch.isDefault === false) {
      // 始终保留一个默认抬头；切换默认请使用 setDefault。
      delete safePatch.isDefault;
    }
    if (safePatch.isDefault) {
      await tx
        .update(invoiceTitles)
        .set({ isDefault: false })
        .where(eq(invoiceTitles.userId, userId));
    }
    await tx
      .update(invoiceTitles)
      .set(safePatch)
      .where(and(eq(invoiceTitles.id, id), eq(invoiceTitles.userId, userId)));
    return true;
  });
}

export async function deleteInvoiceTitle(userId: number, id: number) {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");
  return db.transaction(async tx => {
    await tx
      .delete(invoiceTitles)
      .where(and(eq(invoiceTitles.id, id), eq(invoiceTitles.userId, userId)));
    const rest = await tx
      .select({ id: invoiceTitles.id, isDefault: invoiceTitles.isDefault })
      .from(invoiceTitles)
      .where(eq(invoiceTitles.userId, userId))
      .orderBy(asc(invoiceTitles.id));
    if (rest.length > 0 && !rest.some(item => item.isDefault)) {
      await tx
        .update(invoiceTitles)
        .set({ isDefault: true })
        .where(eq(invoiceTitles.id, rest[0].id));
    }
  });
}

/* ══════════ 订单 ══════════ */

/** 创建订单（含订单项与初始轨迹） */
export async function createOrder(
  order: InsertOrder,
  items: Omit<InsertOrderItem, "orderId">[],
) {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");
  const result = await db.insert(orders).values(order);
  const orderId = Number((result as unknown as [{ insertId: number }])[0].insertId);
  if (items.length > 0) {
    await db.insert(orderItems).values(items.map(it => ({ ...it, orderId })));
  }
  await db.insert(orderTracks).values({
    orderId,
    content: "订单已提交，等待买家付款",
  });
  return orderId;
}

/** 订单号是否已存在 */
export async function orderNoExists(orderNo: string) {
  const db = await getDb();
  if (!db) return false;
  const [row] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.orderNo, orderNo));
  return !!row;
}

/** 买家订单列表（含订单项） */
export async function getOrdersByBuyer(buyerId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(orders)
    .where(eq(orders.buyerId, buyerId))
    .orderBy(desc(orders.createdAt));
}

/** 卖家收到的订单列表 */
export async function getOrdersBySeller(sellerId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(orders)
    .where(eq(orders.sellerId, sellerId))
    .orderBy(desc(orders.createdAt));
}

/**
 * 批量取订单买家展示身份。
 *
 * 企业名称优先；个人买家或未提交企业资料的账号回退到姓名、用户名。
 * companies 使用 leftJoin，避免个人买家的订单从结果中消失。
 */
export async function getOrderBuyerIdentities(buyerIds: number[]) {
  const db = await getDb();
  if (!db || buyerIds.length === 0) return [];
  const uniqueBuyerIds = Array.from(new Set(buyerIds));
  return db
    .select({
      buyerId: users.id,
      buyerCompanyName: companies.companyName,
      buyerName: users.name,
      buyerUsername: users.username,
    })
    .from(users)
    .leftJoin(companies, eq(companies.userId, users.id))
    .where(inArray(users.id, uniqueBuyerIds));
}

/** 按订单读取已经固化的合同主体和 PDF 归档记录。 */
export async function getOrderContractRecordByOrderId(orderId: number) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(orderContractRecords)
    .where(eq(orderContractRecords.orderId, orderId))
    .limit(1);
  return row ?? null;
}

/**
 * 幂等固化合同主体。重复请求不得覆盖原始甲乙方信息，避免企业资料变更后改写历史合同。
 */
export async function ensureOrderContractRecord(record: InsertOrderContractRecord) {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");
  await db
    .insert(orderContractRecords)
    .values(record)
    .onDuplicateKeyUpdate({ set: { orderId: record.orderId } });
  const stored = await getOrderContractRecordByOrderId(record.orderId);
  if (!stored) throw new Error("合同主体快照写入失败");
  return stored;
}

/** 仅在尚未归档时写入 PDF 归档信息；已归档合同不可被新模板覆盖。 */
export async function archiveOrderContractPdf(input: {
  orderId: number;
  pdfStorageKey: string;
  pdfSha256: string;
  pdfByteSize: number;
  generatedAt: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");
  await db
    .update(orderContractRecords)
    .set({
      pdfStorageKey: input.pdfStorageKey,
      pdfSha256: input.pdfSha256,
      pdfByteSize: input.pdfByteSize,
      generatedAt: input.generatedAt,
    })
    .where(
      and(
        eq(orderContractRecords.orderId, input.orderId),
        isNull(orderContractRecords.pdfStorageKey),
      ),
    );
  return getOrderContractRecordByOrderId(input.orderId);
}

/** 记录通过权限校验后的合同下载，不把 IP 或 UA 暴露给交易对手。 */
export async function createOrderContractDownload(record: InsertOrderContractDownload) {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");
  await db.insert(orderContractDownloads).values(record);
}

/** 批量取订单项 */
export async function getOrderItemsByOrderIds(orderIds: number[]) {
  const db = await getDb();
  if (!db || orderIds.length === 0) return [];
  return db
    .select({
      item: orderItems,
      inventoryPartNumber: inventories.partNumber,
      inventoryBrand: inventories.brand,
      inventoryPkg: inventories.pkg,
      inventoryParams: inventories.note,
    })
    .from(orderItems)
    .leftJoin(inventories, eq(inventories.id, orderItems.inventoryId))
    .where(sql`${orderItems.orderId} IN ${orderIds}`)
    .then(rows => rows.map(row => ({
      ...row.item,
      partNumber: row.item.partNumber || row.inventoryPartNumber || row.item.partNumber,
      brand: row.item.brand || row.inventoryBrand || row.item.brand,
      pkg: row.item.pkg || row.inventoryPkg,
      params: row.inventoryParams || row.item.params,
    })));
}

/** 单个订单（按 id） */
export async function getOrderById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(orders).where(eq(orders.id, id));
  return row ?? null;
}

function mysqlAffectedRows(result: unknown): number {
  return Number(
    (result as unknown as [{ affectedRows?: number }, unknown])?.[0]?.affectedRows ??
      (result as { rowsAffected?: number })?.rowsAffected ??
      0,
  );
}

/**
 * 卖家发货的原子状态迁移：只有仍为 paid 的本人订单才能写入履约信息和轨迹。
 *
 * 退款申请会以 orders 行锁把状态改为 refund。这里不能先读 paid 再无条件 update，
 * 否则两个请求可交错为“订单退款中但带着新运单”；条件更新与轨迹写入在同一
 * 事务内，未抢到状态时也不会留下伪造的发货轨迹。
 */
export async function shipPaidOrder(input: {
  orderId: number;
  sellerId: number;
  patch: Partial<InsertOrder>;
  track: string;
}): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");
  return db.transaction(async tx => {
    const result = await tx
      .update(orders)
      .set(input.patch)
      .where(
        and(
          eq(orders.id, input.orderId),
          eq(orders.sellerId, input.sellerId),
          eq(orders.status, "paid"),
        ),
      );
    const affected = mysqlAffectedRows(result);
    if (affected !== 1) return false;
    await tx.insert(orderTracks).values({ orderId: input.orderId, content: input.track });
    return true;
  });
}

/** 更新订单 */
export async function updateOrder(id: number, patch: Partial<InsertOrder>) {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");
  await db.update(orders).set(patch).where(eq(orders.id, id));
}

/** 追加物流/状态轨迹 */
export async function addOrderTrack(orderId: number, content: string) {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");
  await db.insert(orderTracks).values({ orderId, content });
}

/** 取订单轨迹（时间倒序） */
export async function getOrderTracks(orderId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(orderTracks)
    .where(eq(orderTracks.orderId, orderId))
    .orderBy(desc(orderTracks.createdAt), desc(orderTracks.id));
}

/** 读取物流轨迹缓存（按快递编码 + 运单号） */
export async function getLogisticsSnapshot(expressCode: string, expressNo: string) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(logisticsSnapshots)
    .where(
      and(
        eq(logisticsSnapshots.expressCode, expressCode),
        eq(logisticsSnapshots.expressNo, expressNo),
      ),
    );
  return row ?? null;
}

/**
 * 写入或更新物流轨迹缓存。
 *
 * 用 upsert 而非先查后写：多个用户同时查看同一运单时，并发插入会撞唯一索引，
 * 交由数据库以 ON DUPLICATE KEY 合并比应用层加锁更可靠。
 */
export async function upsertLogisticsSnapshot(row: InsertLogisticsSnapshot) {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");
  await db
    .insert(logisticsSnapshots)
    .values(row)
    .onDuplicateKeyUpdate({
      set: {
        state: row.state,
        traces: row.traces,
        arrivalTime: row.arrivalTime ?? null,
        currentCity: row.currentCity ?? null,
        queriedAt: row.queriedAt ?? new Date(),
        lastError: row.lastError ?? null,
      },
    });
}

/**
 * 只记录查询失败，不覆盖已有轨迹。
 *
 * 失败时仍应把 queriedAt 往后推，否则会导致前端反复重试而触发快递100 锁单。
 */
export async function markLogisticsQueryFailed(
  expressCode: string,
  expressNo: string,
  message: string,
) {
  const db = await getDb();
  if (!db) return;
  const existing = await getLogisticsSnapshot(expressCode, expressNo);
  const lastError = message.slice(0, 255);
  if (existing) {
    await db
      .update(logisticsSnapshots)
      .set({ lastError, queriedAt: new Date() })
      .where(eq(logisticsSnapshots.id, existing.id));
    return;
  }
  await db.insert(logisticsSnapshots).values({
    expressCode,
    expressNo,
    // 尚未拿到任何轨迹时用空数组占位，避免前端解析报错
    state: "",
    traces: "[]",
    lastError,
    queriedAt: new Date(),
  });
}

/**
 * 按图片哈希读取已有的面单识别结果。
 *
 * 面单 OCR 是实时扣费产品，命中缓存就能避免一次真实消费，
 * 因此这个查询必须在调用网关**之前**执行。
 */
export async function getWaybillOcrRecordByHash(imageHash: string) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(waybillOcrRecords)
    .where(eq(waybillOcrRecords.imageHash, imageHash));
  return row ?? null;
}

/**
 * 记录一次面单识别结果。
 *
 * 用 upsert 而非普通 insert：同一张图被两个用户同时上传时，
 * 两个请求都会未命中缓存而真实调用，回写时会撞唯一索引。
 * 此处以后写入者为准，避免报错影响用户（额度已经扣过，报错只会雪上加霜）。
 */
export async function recordWaybillOcr(row: InsertWaybillOcrRecord) {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");
  await db
    .insert(waybillOcrRecords)
    .values(row)
    .onDuplicateKeyUpdate({
      set: {
        waybill: row.waybill,
        expressCode: row.expressCode ?? null,
        payload: row.payload,
        taskId: row.taskId ?? null,
      },
    });
}

/**
 * 统计指定用户在时间窗内的真实识别次数，用于频率约束。
 *
 * 存在的理由：实时扣费意味着恶意或误操作的批量上传会直接产生费用。
 */
export async function countWaybillOcrSince(userId: number, since: Date) {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db
    .select({ id: waybillOcrRecords.id })
    .from(waybillOcrRecords)
    .where(
      and(
        eq(waybillOcrRecords.userId, userId),
        gte(waybillOcrRecords.createdAt, since),
      ),
    );
  return rows.length;
}

/**
 * 后台订单筛选可用状态。必须与 ORDER_STATUSES 保持同步，
 * 漏掉 refunded 会让已退款订单在后台按状态筛选时完全查不到。
 */
export type InternalOrderStatus =
  | "pending"
  | "paid"
  | "shipped"
  | "done"
  | "refund"
  | "cancel"
  | "refunded";

export type InternalOrderListInput = {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: InternalOrderStatus;
  buyerId?: number;
  sellerId?: number;
  createdFrom?: number;
  createdTo?: number;
  /**
   * 销售可见范围（后台销售工号集合）。
   *
   * ⚠️ 三态语义，必须原样传递，不可用 `?? []` 或 `|| undefined` 折叠：
   *   undefined → 不限制（超级管理员）
   *   []        → 什么都看不到（未分配任何范围的账号）
   *   [...]     → 仅这些销售名下客户的订单
   * 折叠任一语义都会造成越权或全量误屏蔽。与后台商户管理的
   * getMerchants(salesStaffCodes) 保持完全相同的约定。
   */
  salesStaffCodes?: string[];
};

/**
 * 后台订单查询的公共过滤条件。
 *
 * 列表、统计、详情必须共用本函数：三者若各写一份条件，
 * 会出现「统计显示 28 单、列表只列出 12 单」这类自相矛盾的结果，
 * 后台数据便不再可信；销售范围隔离更会因某一处遗漏而整体失效。
 */
function buildAdminOrderConditions(input: {
  keyword?: string;
  status?: InternalOrderStatus;
  buyerId?: number;
  sellerId?: number;
  createdFrom?: number;
  createdTo?: number;
  salesStaffCodes?: string[];
}): SQL[] {
  const conditions: SQL[] = [];
  const keyword = input.keyword?.trim();
  if (keyword) {
    const pattern = `%${keyword}%`;
    const keywordCondition = or(
      like(orders.orderNo, pattern),
      like(users.name, pattern),
      like(users.username, pattern),
      // 买家公司名也纳入搜索：后台以公司为单位跟单，只能搜联系人名很难定位
      like(companies.companyName, pattern),
      like(orders.sellerName, pattern),
      like(orders.receiver, pattern),
      like(orders.receiverPhone, pattern),
    );
    if (keywordCondition) conditions.push(keywordCondition);
  }
  if (input.status) conditions.push(eq(orders.status, input.status));
  if (input.buyerId) conditions.push(eq(orders.buyerId, input.buyerId));
  if (input.sellerId) conditions.push(eq(orders.sellerId, input.sellerId));
  if (input.createdFrom !== undefined) {
    conditions.push(gte(orders.createdAt, new Date(input.createdFrom)));
  }
  if (input.createdTo !== undefined) {
    conditions.push(lte(orders.createdAt, new Date(input.createdTo)));
  }
  /*
   * 销售范围过滤：按买家企业资料上的 salesOwnerCode 判定归属。
   * 空数组不在此处处理——调用方需提前短路返回，
   * 因为 inArray(x, []) 在部分驱动上会生成恒真或语法错误的 SQL，
   * 一旦恒真即等于把全部订单暴露给无范围账号。
   */
  if (input.salesStaffCodes !== undefined && input.salesStaffCodes.length > 0) {
    conditions.push(inArray(companies.salesOwnerCode, input.salesStaffCodes));
  }
  return conditions;
}

/** 后台订单只读列表：商城订单表是唯一事实源，不复制或双写订单。 */
export async function listOrdersForAdmin(input: InternalOrderListInput) {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");

  // 未分配任何销售范围的账号一律看不到数据，提前短路避免生成恒真条件
  if (input.salesStaffCodes !== undefined && input.salesStaffCodes.length === 0) {
    return { rows: [], total: 0 };
  }

  const conditions = buildAdminOrderConditions(input);

  const where = and(...conditions);
  /*
   * companies 必须用 leftJoin：个人买家或尚未提交企业资料的用户没有 companies 行，
   * 用 innerJoin 会让这批订单直接从后台消失（订单存在却查不到，运营无法发货）。
   */
  const [rows, totalRows] = await Promise.all([
    db
      .select({
        ...getTableColumns(orders),
        buyerName: users.name,
        buyerUsername: users.username,
        buyerCompanyName: companies.companyName,
        buyerSalesOwner: companies.salesOwner,
        buyerSalesOwnerCode: companies.salesOwnerCode,
      })
      .from(orders)
      .leftJoin(users, eq(orders.buyerId, users.id))
      .leftJoin(companies, eq(orders.buyerId, companies.userId))
      .where(where)
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize),
    db
      .select({ total: sql<number>`count(*)` })
      .from(orders)
      .leftJoin(users, eq(orders.buyerId, users.id))
      .leftJoin(companies, eq(orders.buyerId, companies.userId))
      .where(where),
  ]);

  return {
    rows: rows.map(row => ({
      id: row.id,
      orderNo: row.orderNo,
      batchId: null,
      batchSeq: null,
      batchNo: null,
      buyerId: row.buyerId,
      buyerName: row.buyerName,
      buyerUsername: row.buyerUsername,
      /** 买家工商名称；个人买家为 null，由后台自行回退展示联系人 */
      buyerCompanyName: row.buyerCompanyName ?? null,
      /** 归属销售姓名与工号，供后台展示「该客户由谁负责」 */
      buyerSalesOwner: row.buyerSalesOwner ?? null,
      buyerSalesOwnerCode: row.buyerSalesOwnerCode ?? null,
      sellerId: row.sellerId,
      sellerName: row.sellerName,
      status: row.status,
      totalAmount: row.totalAmount,
      payMethod: row.payMethod,
      receiver: row.receiver,
      receiverPhone: row.receiverPhone,
      expressCo: row.expressCo,
      expressNo: row.expressNo,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
    total: Number(totalRows[0]?.total ?? 0),
  };
}

/**
 * 后台订单只读详情：显式返回当前模型不具备的批次/物料码兼容空值。
 *
 * salesStaffCodes 语义同列表（undefined 不限 / [] 不可见 / [...] 限定范围）。
 * 越出范围时返回 null 而不是抛错，与后台 getMerchantById 保持一致：
 * 报错会反向确认「该订单存在但你无权」，而返回不存在不泄露任何信息。
 * 详情必须同样校验范围：若只在列表过滤，销售只要猜到或遍历 orderId
 * 就能直接读到他人客户的订单详情（含收货人、手机号、采购明细）。
 */
export async function getOrderDetailForAdmin(
  orderId: number,
  salesStaffCodes?: string[],
) {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");

  // 无任何范围的账号看不到任何订单
  if (salesStaffCodes !== undefined && salesStaffCodes.length === 0) return null;

  const scopeCondition = salesStaffCodes !== undefined
    ? inArray(companies.salesOwnerCode, salesStaffCodes)
    : undefined;

  const [row] = await db
    .select({
      ...getTableColumns(orders),
      buyerName: users.name,
      buyerUsername: users.username,
      buyerCompanyName: companies.companyName,
      buyerSalesOwner: companies.salesOwner,
      buyerSalesOwnerCode: companies.salesOwnerCode,
    })
    .from(orders)
    .leftJoin(users, eq(orders.buyerId, users.id))
    .leftJoin(companies, eq(orders.buyerId, companies.userId))
    .where(scopeCondition ? and(eq(orders.id, orderId), scopeCondition) : eq(orders.id, orderId))
    .limit(1);
  if (!row) return null;

  const [items, tracks] = await Promise.all([
    db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId))
      .orderBy(asc(orderItems.id)),
    db
      .select()
      .from(orderTracks)
      .where(eq(orderTracks.orderId, orderId))
      .orderBy(desc(orderTracks.createdAt), desc(orderTracks.id)),
  ]);

  return {
    order: {
      ...row,
      batchId: null,
      batchSeq: null,
      batchNo: null,
      batchTotalAmount: null,
      batchCreatedAt: null,
    },
    items: items.map(item => ({
      id: item.id,
      materialCode: null,
      partNumber: item.partNumber,
      brand: item.brand,
      pkg: item.pkg,
      qty: item.qty,
      unit: item.unit,
      unitPrice: item.unitPrice,
      subtotal: item.subtotal,
    })),
    tracks: tracks.map(track => ({
      id: track.id,
      content: track.content,
      createdAt: track.createdAt,
    })),
    siblings: [],
  };
}

/** 后台订单统计的返回形状（与管理端 PlatformOrderStats 一一对应）。 */
export type InternalOrderStats = {
  totalOrders: number;
  grossAmount: string;
  buyerCount: number;
  sellerCount: number;
  todayOrders: number;
  sevenDayOrders: number;
  statusCounts: Record<InternalOrderStatus, number>;
  statusAmounts: Record<InternalOrderStatus, string>;
};

/** 与前台 ORDER_STATUSES 及后台 statusMeta 保持一致；漏值会让该状态统计永远为空。 */
const INTERNAL_ORDER_STATUSES: InternalOrderStatus[] = [
  "pending",
  "paid",
  "shipped",
  "done",
  "refund",
  "cancel",
  "refunded",
];

/**
 * 后台订单统计。
 *
 * 过滤条件与列表完全共用 buildAdminOrderConditions，
 * 确保「统计数字」与「列表条数」在任何筛选与任何销售范围下都一致。
 *
 * 【时间口径】今日与近 7 日均用 MySQL 端的 CURDATE()/NOW() 计算。
 * 不在 JS 里算边界：库内 DATETIME 为北京时间字面值，而 Node 进程未设 TZ，
 * 两边口径不一致时「今日」会在距零点 8 小时内整体错位（凌晨单子算到前一天）。
 * 交由数据库计算可彻底避开此类漂移（MySQL 会话时区为 +08:00）。
 *
 * 【金额】grossAmount 含全部状态（含已取消/已退款），与后台
 * 「含全部订单状态」的界面文案一致；若改为仅算有效订单，必须同步改文案，
 * 否则财务会把两种口径的数字当成同一个指标对账。
 */
export async function getOrderStatsForAdmin(
  input: {
    keyword?: string;
    status?: InternalOrderStatus;
    buyerId?: number;
    sellerId?: number;
    createdFrom?: number;
    createdTo?: number;
    salesStaffCodes?: string[];
  } = {},
): Promise<InternalOrderStats> {
  const emptyStats = (): InternalOrderStats => ({
    totalOrders: 0,
    grossAmount: "0.00",
    buyerCount: 0,
    sellerCount: 0,
    todayOrders: 0,
    sevenDayOrders: 0,
    statusCounts: Object.fromEntries(
      INTERNAL_ORDER_STATUSES.map(status => [status, 0]),
    ) as Record<InternalOrderStatus, number>,
    statusAmounts: Object.fromEntries(
      INTERNAL_ORDER_STATUSES.map(status => [status, "0.00"]),
    ) as Record<InternalOrderStatus, string>,
  });

  const db = await getDb();
  if (!db) throw new Error("数据库未连接");

  // 无销售范围的账号看到全零，而不是报错：与列表返回空集保持一致
  if (input.salesStaffCodes !== undefined && input.salesStaffCodes.length === 0) {
    return emptyStats();
  }

  const where = and(...buildAdminOrderConditions(input));

  const [totals, statusRows] = await Promise.all([
    db
      .select({
        totalOrders: sql<number>`count(*)`,
        grossAmount: sql<string>`COALESCE(SUM(${orders.totalAmount}), 0)`,
        buyerCount: sql<number>`COUNT(DISTINCT ${orders.buyerId})`,
        sellerCount: sql<number>`COUNT(DISTINCT ${orders.sellerId})`,
        // 日期边界交由 MySQL 计算，避开 Node 进程与库时区不一致带来的漂移
        todayOrders: sql<number>`SUM(CASE WHEN DATE(${orders.createdAt}) = CURDATE() THEN 1 ELSE 0 END)`,
        sevenDayOrders: sql<number>`SUM(CASE WHEN ${orders.createdAt} >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END)`,
      })
      .from(orders)
      .leftJoin(users, eq(orders.buyerId, users.id))
      .leftJoin(companies, eq(orders.buyerId, companies.userId))
      .where(where),
    db
      .select({
        status: orders.status,
        count: sql<number>`count(*)`,
        amount: sql<string>`COALESCE(SUM(${orders.totalAmount}), 0)`,
      })
      .from(orders)
      .leftJoin(users, eq(orders.buyerId, users.id))
      .leftJoin(companies, eq(orders.buyerId, companies.userId))
      .where(where)
      .groupBy(orders.status),
  ]);

  const stats = emptyStats();
  const total = totals[0];
  if (total) {
    stats.totalOrders = Number(total.totalOrders ?? 0);
    stats.grossAmount = Number(total.grossAmount ?? 0).toFixed(2);
    stats.buyerCount = Number(total.buyerCount ?? 0);
    stats.sellerCount = Number(total.sellerCount ?? 0);
    stats.todayOrders = Number(total.todayOrders ?? 0);
    stats.sevenDayOrders = Number(total.sevenDayOrders ?? 0);
  }

  /*
   * 零订单的状态也返回 0（而非缺键）。
   * 后台按 statusMeta 全集遍历展示，缺键会显示“—”，
   * 使「暂无该状态订单」与「统计取不到」无法区分。
   */
  for (const row of statusRows) {
    const status = row.status as InternalOrderStatus;
    if (!INTERNAL_ORDER_STATUSES.includes(status)) continue;
    stats.statusCounts[status] = Number(row.count ?? 0);
    stats.statusAmounts[status] = Number(row.amount ?? 0).toFixed(2);
  }

  return stats;
}

/** 按 id 批量取库存（下单校验用） */
export async function getInventoriesByIds(ids: number[]) {
  const db = await getDb();
  if (!db || ids.length === 0) return [];
  const invRows = await db
    .select({
      id: inventories.id,
      userId: inventories.userId,
      partNumber: inventories.partNumber,
      brand: inventories.brand,
      pkg: inventories.pkg,
      prodYear: inventories.prodYear,
      note: inventories.note,
      qtyOnSale: inventories.qtyOnSale,
      priceEx: inventories.priceEx,
      taxIncluded: inventories.taxIncluded,
      ladderPrices: inventories.ladderPrices,
      moq: inventories.moq,
      status: inventories.status,
      // 供应商名统一口径：优先企业名，自营主体显示为「51电子网自营」
      sellerName: supplierDisplayNameSql,
    })
    .from(inventories)
    .leftJoin(users, eq(inventories.userId, users.id))
    .leftJoin(companies, eq(inventories.userId, companies.userId))
    .where(sql`${inventories.id} IN ${ids}`);
  // BOM 配单批量匹配也会展示备注，同样接入打码
  return invRows.map(row => ({ ...row, note: maskForbiddenWords(row.note) || null }));
}

/** 库存在售数量增减（下单扣减 delta<0，取消回补 delta>0），下限为 0；售罄进入已下架。 */
export async function adjustInventoryQty(inventoryId: number, delta: number) {
  const db = await getDb();
  if (!db) throw new Error("database not available");
  if (delta < 0) {
    await db.execute(sql`
      UPDATE inventories
         SET publishedAt = IF(status = 'published' AND GREATEST(0, qtyOnSale + ${delta}) = 0, NULL, publishedAt),
             offshelfBy = IF(status = 'published' AND GREATEST(0, qtyOnSale + ${delta}) = 0, 'system', offshelfBy),
             offshelfReason = IF(status = 'published' AND GREATEST(0, qtyOnSale + ${delta}) = 0, 'sold_out', offshelfReason),
             status = IF(status = 'published' AND GREATEST(0, qtyOnSale + ${delta}) = 0, 'offshelf', status),
             qtyOnSale = GREATEST(0, qtyOnSale + ${delta})
       WHERE id = ${inventoryId}
    `);
    return;
  }
  await db
    .update(inventories)
    .set({ qtyOnSale: sql`GREATEST(0, ${inventories.qtyOnSale} + ${delta})` })
    .where(eq(inventories.id, inventoryId));
}


/* ============================================================
 * 内部接口：供后台（admin.51dianzi.com）读取前台注册用户
 *
 * 后台自身的库是 dianzi51_admin，不含前台用户表，因此后台通过
 * /api/trpc/internalUser.* 走内部 HTTP 接口向前台取数。
 * 返回结构必须与后台 server/platformUserApi.ts 中的
 * PlatformUserStats / PlatformUserListRow 类型严格对齐，
 * 任一字段名不符都会让后台「用户管理」页报错。
 * ============================================================ */

export type InternalUserListInput = {
  page: number;
  pageSize: number;
  keyword?: string;
};

/**
 * 前台注册用户统计。
 *
 * 用户类型以主站 users.crmAccess 为唯一事实源；后台商户绑定只描述企业关系，
 * 不能反向决定用户是否拥有 ERP 权限。北京时间自然日使用 Unix 秒计算边界，
 * 不依赖数据库全局或连接会话时区，避免驱动 timezone 选项与 MySQL 会话时区混淆。
 */
export async function getPortalUserStats() {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");

  const [row] = await db
    .select({
      totalUsers: sql<number>`sum(case when ${users.role} = 'user' then 1 else 0 end)`,
      ordinaryUsers: sql<number>`sum(case when ${users.role} = 'user' and ${users.crmAccess} = 0 then 1 else 0 end)`,
      erpUsers: sql<number>`sum(case when ${users.role} = 'user' and ${users.crmAccess} = 1 then 1 else 0 end)`,
      todayRegistered: sql<number>`
        sum(case when ${users.role} = 'user'
                  and unix_timestamp(${users.createdAt}) >= floor((unix_timestamp() + 28800) / 86400) * 86400 - 28800
                  and unix_timestamp(${users.createdAt}) < floor((unix_timestamp() + 28800) / 86400) * 86400 - 28800 + 86400
                 then 1 else 0 end)`,
      todayWebsiteRegistered: sql<number>`
        sum(case when ${users.role} = 'user'
                  and lower(trim(coalesce(${users.loginMethod}, ''))) in ('local', 'password')
                  and unix_timestamp(${users.createdAt}) >= floor((unix_timestamp() + 28800) / 86400) * 86400 - 28800
                  and unix_timestamp(${users.createdAt}) < floor((unix_timestamp() + 28800) / 86400) * 86400 - 28800 + 86400
                 then 1 else 0 end)`,
      todayMiniProgramRegistered: sql<number>`
        sum(case when ${users.role} = 'user'
                  and lower(trim(coalesce(${users.loginMethod}, ''))) in ('wechat_miniprogram', 'wechat_mini_program', 'miniprogram')
                  and unix_timestamp(${users.createdAt}) >= floor((unix_timestamp() + 28800) / 86400) * 86400 - 28800
                  and unix_timestamp(${users.createdAt}) < floor((unix_timestamp() + 28800) / 86400) * 86400 - 28800 + 86400
                 then 1 else 0 end)`,
      sevenDayActive: sql<number>`
        sum(case when ${users.role} = 'user'
                  and ${users.lastSignedIn} is not null
                  and unix_timestamp(${users.lastSignedIn}) >= unix_timestamp() - 604800
                 then 1 else 0 end)`,
    })
    .from(users);

  const totalUsers = Number(row?.totalUsers ?? 0);
  const ordinaryUsers = Number(row?.ordinaryUsers ?? 0);
  const erpUsers = Number(row?.erpUsers ?? 0);
  const todayRegistered = Number(row?.todayRegistered ?? 0);
  const todayWebsiteRegistered = Number(row?.todayWebsiteRegistered ?? 0);
  const todayMiniProgramRegistered = Number(row?.todayMiniProgramRegistered ?? 0);

  return {
    totalUsers,
    ordinaryUsers,
    erpUsers,
    todayRegistered,
    todayWebsiteRegistered,
    todayMiniProgramRegistered,
    todayOtherRegistered: Math.max(todayRegistered - todayWebsiteRegistered - todayMiniProgramRegistered, 0),
    sevenDayActive: Number(row?.sevenDayActive ?? 0),
  };
}

/** 仅供后台超级管理员核对企业绑定差异的ERP账号ID集合。 */
export async function getPortalErpUserIds() {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "user"), eq(users.crmAccess, true)));
  return rows.map(item => String(item.id));
}

/** 前台注册用户分页列表，支持按用户名/姓名/手机/邮箱/企业名称搜索 */
export async function listPortalUsers(input: InternalUserListInput) {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");

  const conditions: SQL[] = [eq(users.role, "user")];
  const keyword = input.keyword?.trim();
  if (keyword) {
    const pattern = `%${keyword}%`;
    const keywordCondition = or(
      like(users.username, pattern),
      like(users.name, pattern),
      like(users.phone, pattern),
      like(users.email, pattern),
      like(companies.companyName, pattern),
    );
    if (keywordCondition) conditions.push(keywordCondition);
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // 企业信息在 companies 表而非 users 表，必须 LEFT JOIN：
  // 个人用户没有企业记录，用 INNER JOIN 会把他们整行漏掉。
  const [rows, totalRows] = await Promise.all([
    db
      .select({
        id: users.id,
        username: users.username,
        name: users.name,
        phone: users.phone,
        email: users.email,
        loginMethod: users.loginMethod,
        companyName: companies.companyName,
        creditCode: companies.creditCode,
        createdAt: users.createdAt,
        lastSignedIn: users.lastSignedIn,
        loginDisabled: users.loginDisabled,
        loginDisabledAt: users.loginDisabledAt,
        loginDisabledReason: users.loginDisabledReason,
        forumMutedUntil: users.forumMutedUntil,
        forumMuteReason: users.forumMuteReason,
        crmAccess: users.crmAccess,
      })
      .from(users)
      .leftJoin(companies, eq(companies.userId, users.id))
      .where(where)
      .orderBy(desc(users.createdAt), desc(users.id))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize),
    db
      .select({ total: sql<number>`count(*)` })
      .from(users)
      .leftJoin(companies, eq(companies.userId, users.id))
      .where(where),
  ]);

  return {
    rows: rows.map(row => ({
      id: row.id,
      username: row.username ?? null,
      name: row.name ?? null,
      phone: row.phone ?? null,
      email: row.email ?? null,
      loginMethod: row.loginMethod ?? null,
      companyName: row.companyName ?? null,
      creditCode: row.creditCode ?? null,
      createdAt: row.createdAt,
      lastSignedIn: row.lastSignedIn,
      loginDisabled: Boolean(row.loginDisabled),
      loginDisabledAt: row.loginDisabledAt,
      loginDisabledReason: row.loginDisabledReason ?? null,
      forumMutedUntil: row.forumMutedUntil,
      forumMuteReason: row.forumMuteReason ?? null,
      userType: row.crmAccess ? "erp" as const : "ordinary" as const,
    })),
    total: Number(totalRows[0]?.total ?? 0),
  };
}

export type InternalModerationOperator = {
  id: string;
  name: string;
  role: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

type ModerationTransaction = any;

async function requireModerationTarget(
  tx: ModerationTransaction,
  userId: number,
) {
  const [target] = await tx
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .for("update");
  if (!target) throw new Error("用户不存在");
  if (target.role !== "user") throw new Error("仅可管理前台注册用户");
  return target;
}

async function requirePortalUserTarget(db: any, userId: number) {
  const [target] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!target) throw new Error("用户不存在");
  if (target.role !== "user") throw new Error("仅可管理前台注册用户");
}

async function insertModerationAudit(
  tx: ModerationTransaction,
  input: {
    targetUserId: number;
    action: string;
    reason: string;
    operator: InternalModerationOperator;
    metadata?: Record<string, unknown>;
  },
) {
  await tx.insert(userModerationAudits).values({
    targetUserId: input.targetUserId,
    action: input.action,
    reason: input.reason,
    operatorId: input.operator.id,
    operatorName: input.operator.name,
    operatorRole: input.operator.role,
    ipAddress: input.operator.ipAddress || null,
    userAgent: input.operator.userAgent || null,
    metadata: input.metadata || null,
  });
}

/** 后台启停登录；禁用时保护主站管理员与任意企业所有者，恢复操作仍允许。 */
export async function setPortalUserLoginDisabled(input: {
  userId: number;
  disabled: boolean;
  reason: string;
  operator: InternalModerationOperator;
}) {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");
  return db.transaction(async tx => {
    const target = await requireModerationTarget(tx, input.userId);
    if (input.disabled && target.role === "admin") throw new Error("禁止禁用前台管理员账号");
    if (input.disabled) {
      const [ownedEnterprise] = await tx
        .select({ id: enterprises.id })
        .from(enterprises)
        .where(eq(enterprises.superAdminUserId, input.userId))
        .limit(1)
        .for("update");
      const [superAdminMembership] = await tx
        .select({ id: enterpriseMembers.id })
        .from(enterpriseMembers)
        .where(and(
          eq(enterpriseMembers.userId, input.userId),
          eq(enterpriseMembers.role, "super_admin"),
        ))
        .limit(1)
        .for("update");
      if (ownedEnterprise || superAdminMembership) {
        throw new Error("禁止禁用企业所有者账号");
      }
    }
    const now = new Date();
    await tx.update(users).set({
      loginDisabled: input.disabled,
      loginDisabledAt: input.disabled ? now : null,
      loginDisabledReason: input.disabled ? input.reason : null,
    }).where(eq(users.id, input.userId));
    await insertModerationAudit(tx, {
      targetUserId: input.userId,
      action: input.disabled ? "login_disabled" : "login_restored",
      reason: input.reason,
      operator: input.operator,
      metadata: { disabled: input.disabled },
    });
    return { userId: input.userId, loginDisabled: input.disabled, loginDisabledAt: input.disabled ? now : null };
  });
}

/** 后台设置固定时长论坛禁言；durationHours=null 表示解除。 */
export async function setPortalUserForumMute(input: {
  userId: number;
  durationHours: 3 | 6 | 24 | 72 | 168 | null;
  reason: string;
  operator: InternalModerationOperator;
}) {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");
  return db.transaction(async tx => {
    await requireModerationTarget(tx, input.userId);
    const mutedUntil = input.durationHours === null
      ? null
      : new Date(Date.now() + input.durationHours * 60 * 60 * 1000);
    await tx.update(users).set({
      forumMutedUntil: mutedUntil,
      forumMuteReason: mutedUntil ? input.reason : null,
    }).where(eq(users.id, input.userId));
    await insertModerationAudit(tx, {
      targetUserId: input.userId,
      action: mutedUntil ? "forum_muted" : "forum_unmuted",
      reason: input.reason,
      operator: input.operator,
      metadata: { durationHours: input.durationHours, mutedUntil },
    });
    return { userId: input.userId, forumMutedUntil: mutedUntil, forumMuteReason: mutedUntil ? input.reason : null };
  });
}

/** 内部管控历史只返回业务所需字段，主动排除 IP、UA 与 metadata。 */
export async function getPortalModerationHistory(userId: number, limit: number) {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");
  await requirePortalUserTarget(db, userId);
  return db
    .select({
      id: userModerationAudits.id,
      action: userModerationAudits.action,
      reason: userModerationAudits.reason,
      operatorId: userModerationAudits.operatorId,
      operatorName: userModerationAudits.operatorName,
      operatorRole: userModerationAudits.operatorRole,
      createdAt: userModerationAudits.createdAt,
    })
    .from(userModerationAudits)
    .where(eq(userModerationAudits.targetUserId, userId))
    .orderBy(desc(userModerationAudits.id))
    .limit(limit);
}

export async function getPortalForumMessages(userId: number, limit: number) {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");
  await requirePortalUserTarget(db, userId);
  return db
    .select({
      id: forumMessages.id,
      messageType: forumMessages.messageType,
      content: sql<string>`COALESCE(${forumMessages.content}, '')`,
      attachmentId: forumMessages.attachmentId,
      isHidden: forumMessages.isHidden,
      hiddenAt: forumMessages.hiddenAt,
      hiddenReason: forumMessages.hiddenReason,
      deletedAt: forumMessages.deletedAt,
      createdAt: forumMessages.createdAt,
    })
    .from(forumMessages)
    .where(eq(forumMessages.userId, userId))
    .orderBy(desc(forumMessages.id))
    .limit(limit);
}

export async function hidePortalForumMessage(input: {
  messageId: number;
  reason: string;
  operator: InternalModerationOperator;
}) {
  const db = await getDb();
  if (!db) throw new Error("数据库未连接");
  return db.transaction(async tx => {
    const [message] = await tx
      .select({ id: forumMessages.id, userId: forumMessages.userId, isHidden: forumMessages.isHidden })
      .from(forumMessages)
      .where(eq(forumMessages.id, input.messageId))
      .limit(1)
      .for("update");
    if (!message) throw new Error("论坛消息不存在");
    await requireModerationTarget(tx, message.userId);
    const hiddenAt = message.isHidden ? null : new Date();
    if (!message.isHidden) {
      await tx.update(forumMessages).set({
        isHidden: true,
        hiddenAt,
        hiddenByOperatorId: input.operator.id,
        hiddenByOperatorName: input.operator.name,
        hiddenReason: input.reason,
      }).where(eq(forumMessages.id, input.messageId));
      await tx.update(forumSupplierQuotes).set({ isActive: false }).where(
        eq(forumSupplierQuotes.messageId, input.messageId),
      );
      await tx.insert(forumMessageChanges).values({
        messageId: input.messageId,
        changeType: "hidden",
      });
    }
    await insertModerationAudit(tx, {
      targetUserId: message.userId,
      action: "forum_message_hidden",
      reason: input.reason,
      operator: input.operator,
      metadata: { messageId: input.messageId, alreadyHidden: Boolean(message.isHidden) },
    });
    return { messageId: input.messageId, hidden: true as const, hiddenAt };
  });
}

// ============ 关注的供应商 ============

/**
 * 关注供应商（幂等）。
 *
 * 用 onDuplicateKeyUpdate 而非「先查后插」：
 * 前端连点或并发请求下「先查后插」会因竞态双双通过检查，
 * 依赖唯一索引 + upsert 才能真正保证幂等，且无需捕获重复键错误。
 */
export async function followSupplier(userId: number, supplierId: number) {
  const db = await getDb();
  if (!db) throw new Error("database not available");
  await db
    .insert(supplierFollows)
    .values({ userId, supplierId })
    .onDuplicateKeyUpdate({ set: { supplierId } });
}

/** 取消关注（物理删除；关注关系是纯偏好数据，无审计价值） */
export async function unfollowSupplier(userId: number, supplierId: number) {
  const db = await getDb();
  if (!db) throw new Error("database not available");
  await db
    .delete(supplierFollows)
    .where(and(eq(supplierFollows.userId, userId), eq(supplierFollows.supplierId, supplierId)));
}

/**
 * 批量查询关注状态。
 *
 * 搜索结果一页最多 50 行，逐行查询会造成 N+1；这里一次取回该用户
 * 在给定供应商集合内的全部关注关系，前端按 supplierId 命中即可。
 */
export async function getFollowedSupplierIds(
  userId: number,
  supplierIds?: number[]
): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  if (supplierIds && supplierIds.length === 0) return [];
  const rows = await db
    .select({ supplierId: supplierFollows.supplierId })
    .from(supplierFollows)
    .where(
      supplierIds && supplierIds.length > 0
        ? and(
            eq(supplierFollows.userId, userId),
            inArray(supplierFollows.supplierId, supplierIds)
          )
        : eq(supplierFollows.userId, userId)
    );
  return rows.map(r => Number(r.supplierId));
}

/**
 * 「我的关注」列表：已关注供应商及其在售概况。
 *
 * 供应商名称取同一口径（优先企业名），并附带在售条数，
 * 便于用户判断该供应商当前是否值得进入查看。
 */
export async function listFollowedSuppliers(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      supplierId: supplierFollows.supplierId,
      followedAt: supplierFollows.createdAt,
      supplierName: supplierDisplayNameSql,
      certified: sql<number>`CASE WHEN ${companies.reviewStatus} = 'approved' THEN 1 ELSE 0 END`,
      onSaleCount: sql<number>`(SELECT COUNT(*) FROM inventories iv WHERE iv.userId = ${supplierFollows.supplierId} AND iv.status = 'published' AND iv.companyCatalogVisible = 1)`,
    })
    .from(supplierFollows)
    .leftJoin(users, eq(users.id, supplierFollows.supplierId))
    .leftJoin(companies, eq(companies.userId, supplierFollows.supplierId))
    .where(eq(supplierFollows.userId, userId))
    .orderBy(desc(supplierFollows.createdAt));
  return rows.map(r => ({
    supplierId: Number(r.supplierId),
    supplierName: r.supplierName,
    certified: Number(r.certified) === 1,
    onSaleCount: Number(r.onSaleCount ?? 0),
    followedAt: r.followedAt,
  }));
}

// ============ 微信小程序账号绑定 ============

/** 按 openid 查绑定关系（含关联的平台账号） */
export async function getWechatBindingByOpenid(openid: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(wechatAccountBindings)
    .where(eq(wechatAccountBindings.openid, openid))
    .limit(1);
  return rows.length > 0 ? rows[0] : undefined;
}

/** 按平台账号查绑定关系：用于「该账号是否已绑微信」判断 */
export async function getWechatBindingByUserId(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(wechatAccountBindings)
    .where(eq(wechatAccountBindings.userId, userId))
    .limit(1);
  return rows.length > 0 ? rows[0] : undefined;
}

/**
 * 建立绑定关系。
 *
 * 调用方必须自行捕获重复键错误（errno 1062）：
 * openid 与 userId 均有唯一约束，并发首次登录时两个请求都会认为「未绑定」，
 * 数据库约束是最终仲裁，落败方应改走「关联既有账号」路径而非报错给用户。
 */
export async function createWechatBinding(input: InsertWechatAccountBinding) {
  const db = await getDb();
  if (!db) throw new Error("database not available");
  await db.insert(wechatAccountBindings).values(input);
  return getWechatBindingByOpenid(input.openid);
}

/** 记录本次微信登录时间；失败不阻断登录流程 */
export async function touchWechatBindingLogin(openid: string) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(wechatAccountBindings)
    .set({ lastLoginAt: new Date() })
    .where(eq(wechatAccountBindings.openid, openid));
}

/**
 * 补录 unionId。
 *
 * 首次绑定时微信不一定返回 unionId（需小程序已绑定开放平台），
 * 后续登录若拿到则补上 —— 日后接入公众号/App 时靠它识别同一用户，
 * 而历史数据一旦缺失便无法补录。
 */
export async function fillWechatBindingUnionId(openid: string, unionId: string) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(wechatAccountBindings)
    .set({ unionId })
    .where(
      and(eq(wechatAccountBindings.openid, openid), isNull(wechatAccountBindings.unionId)),
    );
}
