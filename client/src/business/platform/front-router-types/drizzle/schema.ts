import {
  bigint,
  boolean,
  char,
  check,
  customType,
  date,
  decimal,
  index,
  int,
  json,
  longtext,
  mysqlEnum,
  MySqlTimestamp,
  MySqlTimestampBuilder,
  mysqlTable,
  primaryKey,
  text,
  uniqueIndex,
  varchar,
  type MySqlTable,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { ERP_PERMISSION_KEYS, type ErpPermissionKey } from "../../shared/erpPermissions";
// Internal customer demands are separate from public marketplace demands.
export * from "./customerDemandTables";
export * from "./crmSalesOrderTables";
export * from "./customerDemandQuoteTables";
export * from "./customerDemandRevisionTables";
export * from "./purchaseOrderTables";

/**
 * 按**北京时间**口径读写的时间列，替代 drizzle 自带的 timestamp / datetime。
 *
 * ## 为什么必须自定义
 *
 * drizzle-orm 0.44.6 的 timestamp 与 datetime 列**硬编码按 UTC 处理**：
 *
 * ```js
 * // timestamp.js
 * mapFromDriverValue(value) { return new Date(value + "+0000"); }
 * mapToDriverValue(value) { return value.toISOString().slice(0, -1)...; }
 * // datetime.js —— 同样的 UTC 硬编码
 * mapFromDriverValue(value) { return new Date(value.replace(" ", "T") + "Z"); }
 * ```
 *
 * 而本项目 MySQL 会话时区为 `+08:00`，库内 DATETIME 存的是**北京时间字面值**。
 * 两者口径不一致，造成过两类线上故障：
 *
 * 1. **读取多 8 小时**：库内 `14:26:34`（北京）被当成 UTC，
 *    读出的时间戳变 `14:26:34Z`，后台按北京时间格式化后显示 `22:26:34`。
 * 2. **写入少 8 小时**：应用 `new Date()` 经 `toISOString()` 转 UTC 落库，
 *    产生「付款时间早于下单时间」这类脏数据
 *    （实测 6 张已付款订单稳定差 -479 分钟）。
 *
 * 注意：给连接串加 `?timezone=+08:00` 或 `createPool({ timezone })` **都无效**，
 * 因为上述映射在 ORM 层硬编码，根本不经过 mysql2 的时区设置。已实测确认。
 *
 * ## 本实现的口径
 *
 * - 读：把库内字面值按 `+08:00` 解析 → 得到正确时间戳
 * - 写：把时间戳格式化为北京时间字面值 → 与库内既有数据口径一致
 *
 * 读写对称，往返无损（已在生产库用临时表实测验证）。
 */
const beijingTime = customType<{ data: Date; driverData: string }>({
  dataType: () => "timestamp",
  fromDriver(value) {
    /*
     * mysql2 在某些配置下会直接返回 Date 对象（而非字符串），
     * 此时必须原样放行，否则会被再解析一次造成二次偏移。
     * driverData 声明为 string，故此处需要放宽类型后判断。
     */
    const raw = value as unknown;
    if (raw instanceof Date) return raw;
    return new Date(String(raw).replace(" ", "T") + "+08:00");
  },
  toDriver(value) {
    if (!(value instanceof Date)) return value;
    /*
     * 用 sv-SE 区域是因为它的日期格式恰为 `YYYY-MM-DD HH:mm:ss`，
     * 与 MySQL DATETIME 字面值格式一致，无需手工拼装而避免补零错误。
     */
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .format(value)
      .replace("T", " ");
  },
});

/**
 * 等价于原 `timestamp(name)`，仅把时区口径换成北京时间。
 *
 * 保留名字为 `timestamp` 是为了让下方 99 处字段定义**无需逐一改写**，
 * 降低漏改与误改风险。
 */
const timestamp = beijingTime;

/** 仅恢复已有服务器 ON UPDATE 属性；其他北京时间时间列不变。 */
class BeijingOnUpdateTimestampBuilder<TName extends string> extends MySqlTimestampBuilder<{
  name: TName;
  dataType: "date";
  columnType: "MySqlTimestamp";
  data: Date;
  driverParam: string | number;
  enumValues: undefined;
}> {
  constructor(name: TName) {
    super(name, undefined);
  }

  build(table: MySqlTable) {
    const column = new MySqlTimestamp(table, this.config);
    column.mapFromDriverValue = (value: string): Date => {
      const raw = value as unknown;
      if (raw instanceof Date) return raw;
      return new Date(String(raw).replace(" ", "T") + "+08:00");
    };
    column.mapToDriverValue = (value: Date): string => {
      const raw = value as unknown;
      if (!(raw instanceof Date)) return raw as string;
      return new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(value).replace("T", " ");
    };
    return column;
  }
}

const timestampWithServerOnUpdate = <TName extends string>(name: TName) =>
  new BeijingOnUpdateTimestampBuilder(name).onUpdateNow();

/**
 * 不允许数据库自动改写的北京时间 DATETIME 字段。
 * 企业邀请过期时间属于业务绝对截止时间，不能使用可能带隐式
 * `ON UPDATE CURRENT_TIMESTAMP` 的首个 TIMESTAMP 列。
 */
const immutableBeijingDateTime = customType<{ data: Date; driverData: string }>({
  dataType: () => "datetime",
  fromDriver(value) {
    const raw = value as unknown;
    if (raw instanceof Date) return raw;
    return new Date(String(raw).replace(" ", "T") + "+08:00");
  },
  toDriver(value) {
    if (!(value instanceof Date)) return value;
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .format(value)
      .replace("T", " ");
  },
});

/**
 * 等价于原 `datetime(name)`。drizzle 的 datetime 有完全相同的 UTC 硬编码问题，
 * 若只换 timestamp 而漏掉它，会留下同类缺陷（本项目有 4 处使用）。
 */
const datetime = beijingTime;

/**
 * 等价于原 `.defaultNow()`：由**数据库** `DEFAULT CURRENT_TIMESTAMP` 生成值。
 *
 * customType 不支持链式 `.defaultNow()`（会报
 * `defaultNow is not a function`），故改用等价的 SQL 默认值。
 *
 * 这类字段的**写入一直是正确的**（数据库按会话时区 +08:00 生成北京时间），
 * 本次换类型只修正它们的**读取**。
 */
const DEFAULT_NOW = sql`CURRENT_TIMESTAMP`;

/**
 * Core user table backing auth flow.
 * 本项目使用自定义用户名+密码认证（openId 保留用于兼容框架层，值为 "local:" + username）。
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  /** 兼容框架层的标识：自定义账号为 "local:<username>" */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  /** 登录用户名（唯一） */
  username: varchar("username", { length: 64 }).unique(),
  /** 密码 hash（scrypt: salt:hash 格式） */
  passwordHash: varchar("passwordHash", { length: 255 }),
  /** 会话版本：密码变更时递增，使其他设备上的旧会话立即失效。 */
  sessionVersion: int("sessionVersion").default(0).notNull(),
  /** 最近一次设置或修改密码的时间。 */
  passwordChangedAt: timestamp("passwordChangedAt"),
  /** 手机号：数据库唯一约束是并发注册的最终仲裁；NULL 兼容历史系统账号。 */
  phone: varchar("phone", { length: 20 }).unique(),
  /** 用户主动填写、允许在聊一聊联系人资料页公开的微信号。 */
  wechatId: varchar("wechatId", { length: 20 }),
  /** 用户主动填写、允许在51论坛成员资料页公开的QQ号。 */
  qqId: varchar("qqId", { length: 20 }),
  name: text("name"),
  email: varchar("email", { length: 320 }).unique(),
  /**
   * 用户提交但尚未完成验证码校验的新邮箱。始终不作为登录找回渠道，
   * 只有 verifyEmail 成功后才原子提升为 email。
   */
  pendingEmail: varchar("pendingEmail", { length: 320 }),
  /** 当前邮箱完成验证码校验的时间；邮箱变更时必须清空并重新验证。 */
  emailVerifiedAt: timestamp("emailVerifiedAt"),
  /** 职位 */
  jobTitle: varchar("jobTitle", { length: 64 }),
  /** 头像图片 URL（OSS）；为空时前端降级为首字母色块 */
  avatarUrl: text("avatarUrl"),
  /**
   * 当日已更换头像次数，配合 avatarChangeDate 做每日限额。
   * 频繁换头像会干扰交易对手对商家的识别，故加限。
   */
  avatarChangeCount: int("avatarChangeCount").default(0).notNull(),
  /** 计数对应的日期（北京时间 YYYY-MM-DD），跨天自动重置 */
  avatarChangeDate: varchar("avatarChangeDate", { length: 10 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  /** 后台账号管控。禁用后既有会话与所有新登录渠道均立即失效。 */
  loginDisabled: boolean("loginDisabled").default(false).notNull(),
  loginDisabledAt: timestamp("loginDisabledAt"),
  loginDisabledReason: varchar("loginDisabledReason", { length: 500 }),
  /** 论坛禁言只影响发言能力，用户仍可阅读论坛。 */
  forumMutedUntil: timestamp("forumMutedUntil"),
  forumMuteReason: varchar("forumMuteReason", { length: 500 }),
  /** 是否开通 CRM 使用权限（供应商身份）：提交企业信息后自动开通 */
  crmAccess: boolean("crmAccess").default(false).notNull(),
  /** 新用户 51小电欢迎消息写入时间；存量用户在迁移时回填，避免补发。 */
  welcomeMessageSentAt: timestamp("welcomeMessageSentAt"),
  createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
  lastSignedIn: timestamp("lastSignedIn").default(DEFAULT_NOW).notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Multi-entry QQ contacts.  The legacy users.qqId column remains untouched so
 * old clients and broad users projections keep working during rollout.
 */
export const userQqProfiles = mysqlTable("user_qq_profiles", {
  userId: int("userId").primaryKey(),
  contacts: text("contacts").notNull(),
  defaultQq: varchar("defaultQq", { length: 20 }),
  isPublic: boolean("isPublic").default(true).notNull(),
  version: int("version", { unsigned: true }).default(1).notNull(),
});

export type UserQqProfile = typeof userQqProfiles.$inferSelect;
export type InsertUserQqProfile = typeof userQqProfiles.$inferInsert;

/** 51论坛消息。删除与后台隐藏均采用软删除字段，保留完整管控追溯链。 */
export const forumMessages = mysqlTable(
  "forum_messages",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    /** Verified identity frozen at posting time; never inferred for historical rows. */
    authorEnterpriseId: int("authorEnterpriseId"),
    authorCompanyId: int("authorCompanyId"),
    authorCompanyNameSnapshot: varchar("authorCompanyNameSnapshot", { length: 255 }),
    clientMessageId: varchar("clientMessageId", { length: 64 }).notNull(),
    messageType: mysqlEnum("messageType", ["text", "sticker", "image", "file"]).notNull(),
    content: text("content"),
    attachmentId: int("attachmentId"),
    /** 被当前消息引用的原消息；不设外键以兼容既有软删除与历史数据。 */
    replyToMessageId: int("replyToMessageId"),
    isHidden: boolean("isHidden").default(false).notNull(),
    hiddenAt: timestamp("hiddenAt"),
    hiddenByOperatorId: varchar("hiddenByOperatorId", { length: 128 }),
    hiddenByOperatorName: varchar("hiddenByOperatorName", { length: 128 }),
    hiddenReason: varchar("hiddenReason", { length: 500 }),
    deletedAt: timestamp("deletedAt"),
    deletedByUserId: int("deletedByUserId"),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    userClientMessageUnique: uniqueIndex("forum_messages_user_client_unique").on(
      table.userId,
      table.clientMessageId,
    ),
    visibleTimelineIdx: index("forum_messages_visible_timeline_idx").on(
      table.isHidden,
      table.deletedAt,
      table.id,
    ),
    userTimelineIdx: index("forum_messages_user_timeline_idx").on(table.userId, table.id),
    authorEnterpriseIdx: index("forum_messages_author_enterprise_idx").on(table.authorEnterpriseId, table.id),
    attachmentIdx: index("forum_messages_attachment_idx").on(table.attachmentId),
    replyToMessageIdx: index("forum_messages_reply_to_message_idx").on(table.replyToMessageId),
  }),
);
export type ForumMessage = typeof forumMessages.$inferSelect;
export type InsertForumMessage = typeof forumMessages.$inferInsert;

/**
 * 论坛文本报价提取任务。每条论坛消息只保留一个幂等任务；不同时间发送的消息
 * 拥有不同 messageId，因此即使企业和型号相同，也会产生独立的历史报价。
 */
export const forumQuoteJobs = mysqlTable(
  "forum_quote_jobs",
  {
    messageId: int("messageId").primaryKey(),
    enterpriseId: int("enterpriseId").notNull(),
    status: mysqlEnum("status", ["queued", "running", "completed", "ignored", "failed"])
      .default("queued")
      .notNull(),
    attempts: int("attempts").default(0).notNull(),
    leaseOwner: varchar("leaseOwner", { length: 128 }),
    leaseExpiresAt: timestamp("leaseExpiresAt"),
    nextAttemptAt: timestamp("nextAttemptAt"),
    errorMessage: varchar("errorMessage", { length: 500 }),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    startedAt: timestamp("startedAt"),
    processedAt: timestamp("processedAt"),
    updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    statusLeaseIdx: index("forum_quote_jobs_status_lease_idx").on(
      table.status,
      table.nextAttemptAt,
      table.leaseExpiresAt,
      table.messageId,
    ),
  }),
);
export type ForumQuoteJob = typeof forumQuoteJobs.$inferSelect;
export type InsertForumQuoteJob = typeof forumQuoteJobs.$inferInsert;

/**
 * 从论坛公开文本提取的供应商报价。记录永久保留，不设到期时间；仅在原消息
 * 被撤回或后台隐藏时停用。税价为三态，未说明时保持 unspecified，绝不猜测。
 */
export const forumSupplierQuotes = mysqlTable(
  "forum_supplier_quotes",
  {
    id: int("id").autoincrement().primaryKey(),
    messageId: int("messageId").notNull(),
    quoteIndex: int("quoteIndex").notNull(),
    senderUserId: int("senderUserId").notNull(),
    enterpriseId: int("enterpriseId").notNull(),
    partNumber: varchar("partNumber", { length: 128 }).notNull(),
    partNumberNormalized: varchar("partNumberNormalized", { length: 128 }).notNull(),
    dateCode: varchar("dateCode", { length: 32 }),
    quantity: int("quantity"),
    price: decimal("price", { precision: 12, scale: 4 }).notNull(),
    taxStatus: mysqlEnum("taxStatus", ["included", "excluded", "unspecified"])
      .default("unspecified")
      .notNull(),
    leadTime: varchar("leadTime", { length: 32 }),
    originalLine: text("originalLine").notNull(),
    extractionMethod: mysqlEnum("extractionMethod", ["rules", "model"]).notNull(),
    isActive: boolean("isActive").default(true).notNull(),
    quotedAt: timestamp("quotedAt").default(DEFAULT_NOW).notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    messageQuoteUnique: uniqueIndex("forum_supplier_quotes_message_quote_unique").on(
      table.messageId,
      table.quoteIndex,
    ),
    partActiveTimeIdx: index("forum_supplier_quotes_part_active_time_idx").on(
      table.partNumberNormalized,
      table.isActive,
      table.quotedAt,
    ),
    enterpriseTimeIdx: index("forum_supplier_quotes_enterprise_time_idx").on(
      table.enterpriseId,
      table.quotedAt,
    ),
  }),
);
export type ForumSupplierQuote = typeof forumSupplierQuotes.$inferSelect;
export type InsertForumSupplierQuote = typeof forumSupplierQuotes.$inferInsert;

/** 当前用户对单条论坛消息的本地隐藏，不影响其他用户及原消息、附件。 */
export const forumMessageUserHidden = mysqlTable(
  "forum_message_user_hidden",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    messageId: int("messageId").notNull(),
    restoreToken: varchar("restoreToken", { length: 64 }),
    undoExpiresAtMs: bigint("undoExpiresAtMs", { mode: "number", unsigned: true }),
    hiddenAt: timestamp("hiddenAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    userMessageUnique: uniqueIndex("forum_message_user_hidden_user_message_unique").on(
      table.userId,
      table.messageId,
    ),
    messageUserIdx: index("forum_message_user_hidden_message_user_idx").on(table.messageId, table.userId),
  }),
);
export type ForumMessageUserHidden = typeof forumMessageUserHidden.$inferSelect;
export type InsertForumMessageUserHidden = typeof forumMessageUserHidden.$inferInsert;

/** 当前用户个人隐藏/恢复事件，供同账号的其他标签页和设备同步。 */
export const forumMessageUserVisibilityChanges = mysqlTable(
  "forum_message_user_visibility_changes",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    messageId: int("messageId").notNull(),
    changeType: mysqlEnum("changeType", ["hidden", "restored"]).notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    userTimelineIdx: index("forum_message_user_visibility_changes_user_timeline_idx").on(
      table.userId,
      table.id,
    ),
  }),
);
export type ForumMessageUserVisibilityChange = typeof forumMessageUserVisibilityChanges.$inferSelect;
export type InsertForumMessageUserVisibilityChange = typeof forumMessageUserVisibilityChanges.$inferInsert;

/** 论坛消息可见性变更游标，供前台轻量轮询可靠同步隐藏与撤回。 */
export const forumMessageChanges = mysqlTable(
  "forum_message_changes",
  {
    id: int("id").autoincrement().primaryKey(),
    messageId: int("messageId").notNull(),
    changeType: mysqlEnum("changeType", ["hidden", "withdrawn"]).notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    messageTimelineIdx: index("forum_message_changes_message_timeline_idx").on(table.messageId, table.id),
  }),
);
export type ForumMessageChange = typeof forumMessageChanges.$inferSelect;

/** 论坛附件只保存私有对象键；访问时由论坛路由鉴权后生成短时 URL。 */
export const forumAttachments = mysqlTable(
  "forum_attachments",
  {
    id: int("id").autoincrement().primaryKey(),
    uploaderUserId: int("uploaderUserId").notNull(),
    kind: mysqlEnum("kind", ["image", "file"]).notNull(),
    storageKey: varchar("storageKey", { length: 512 }).notNull(),
    originalName: varchar("originalName", { length: 255 }).notNull(),
    mimeType: varchar("mimeType", { length: 128 }).notNull(),
    byteSize: int("byteSize").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    claimedMessageId: int("claimedMessageId"),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    storageKeyUnique: uniqueIndex("forum_attachments_storage_key_unique").on(table.storageKey),
    uploaderIdx: index("forum_attachments_uploader_idx").on(table.uploaderUserId, table.id),
    claimedMessageIdx: index("forum_attachments_claimed_message_idx").on(table.claimedMessageId),
  }),
);
export type ForumAttachment = typeof forumAttachments.$inferSelect;
export type InsertForumAttachment = typeof forumAttachments.$inferInsert;

/** 消息中的结构化 @ 提及，正文仅用于展示，本表才是可靠的用户关联。 */
export const forumMessageMentions = mysqlTable(
  "forum_message_mentions",
  {
    id: int("id").autoincrement().primaryKey(),
    messageId: int("messageId").notNull(),
    mentionedUserId: int("mentionedUserId").notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    messageUserUnique: uniqueIndex("forum_message_mentions_message_user_unique").on(
      table.messageId,
      table.mentionedUserId,
    ),
    mentionedTimelineIdx: index("forum_message_mentions_user_timeline_idx").on(
      table.mentionedUserId,
      table.messageId,
    ),
  }),
);
export type ForumMessageMention = typeof forumMessageMentions.$inferSelect;
export type InsertForumMessageMention = typeof forumMessageMentions.$inferInsert;

/** 用户对指定版本论坛公约的确认记录；版本升级后须重新确认。 */
export const forumRulesAcceptances = mysqlTable(
  "forum_rules_acceptances",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    ruleVersion: varchar("ruleVersion", { length: 16 }).notNull(),
    acceptedAt: timestamp("acceptedAt").default(DEFAULT_NOW).notNull(),
    ipAddress: varchar("ipAddress", { length: 64 }),
    userAgent: varchar("userAgent", { length: 512 }),
  },
  table => ({
    userVersionUnique: uniqueIndex("forum_rules_acceptances_user_version_unique").on(
      table.userId,
      table.ruleVersion,
    ),
  }),
);
export type ForumRulesAcceptance = typeof forumRulesAcceptances.$inferSelect;
export type InsertForumRulesAcceptance = typeof forumRulesAcceptances.$inferInsert;

/** 论坛内独立的用户偏好；群昵称只影响论坛消息展示，不回写 users.name。 */
export const forumUserSettings = mysqlTable(
  "forum_user_settings",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    groupNickname: varchar("groupNickname", { length: 32 }),
    notificationMode: mysqlEnum("notificationMode", ["all", "mentions", "muted"]).default("all").notNull(),
    /** 兼容旧库/旧版本保留；论坛业务只读取 notificationMode。 */
    notificationsMuted: boolean("notificationsMuted").default(false).notNull(),
    lastReadMessageId: int("lastReadMessageId").default(0).notNull(),
    /** 仅在用户实际打开论坛并读到底部时推进，用于消息已读人数统计。 */
    lastViewedMessageId: int("lastViewedMessageId").default(0).notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    userUnique: uniqueIndex("forum_user_settings_user_unique").on(table.userId),
    viewedMessageIdx: index("forum_user_settings_viewed_message_idx").on(table.lastViewedMessageId, table.userId),
  }),
);
export type ForumUserSetting = typeof forumUserSettings.$inferSelect;
export type InsertForumUserSetting = typeof forumUserSettings.$inferInsert;

/** 单行版本状态；仅在实际阅读游标前进时递增，供论坛轻量轮询。 */
export const forumReadReceiptState = mysqlTable("forum_read_receipt_state", {
  id: int("id").primaryKey(),
  revision: bigint("revision", { mode: "number", unsigned: true }).default(0).notNull(),
  updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
});

/** 论坛成员关注关系。应用层与数据库约束共同禁止关注自己。 */
export const forumFollowedUsers = mysqlTable(
  "forum_followed_users",
  {
    id: int("id").autoincrement().primaryKey(),
    followerUserId: int("followerUserId").notNull(),
    followedUserId: int("followedUserId").notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    followerFollowedUnique: uniqueIndex("forum_followed_users_follower_followed_unique").on(
      table.followerUserId,
      table.followedUserId,
    ),
    followedIdx: index("forum_followed_users_followed_idx").on(table.followedUserId, table.followerUserId),
    notSelf: check("forum_followed_users_not_self", sql`${table.followerUserId} <> ${table.followedUserId}`),
  }),
);
export type ForumFollowedUser = typeof forumFollowedUsers.$inferSelect;
export type InsertForumFollowedUser = typeof forumFollowedUsers.$inferInsert;

/** 后台账号/论坛管控审计。内部查询不会返回 IP、UA 或 metadata。 */
export const userModerationAudits = mysqlTable(
  "user_moderation_audits",
  {
    id: int("id").autoincrement().primaryKey(),
    targetUserId: int("targetUserId").notNull(),
    action: varchar("action", { length: 64 }).notNull(),
    reason: varchar("reason", { length: 500 }).notNull(),
    operatorId: varchar("operatorId", { length: 128 }).notNull(),
    operatorName: varchar("operatorName", { length: 128 }).notNull(),
    operatorRole: varchar("operatorRole", { length: 64 }).notNull(),
    ipAddress: varchar("ipAddress", { length: 64 }),
    userAgent: varchar("userAgent", { length: 512 }),
    metadata: json("metadata"),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    targetTimelineIdx: index("user_moderation_audits_target_timeline_idx").on(
      table.targetUserId,
      table.id,
    ),
    operatorTimelineIdx: index("user_moderation_audits_operator_timeline_idx").on(
      table.operatorId,
      table.id,
    ),
  }),
);
export type UserModerationAudit = typeof userModerationAudits.$inferSelect;
export type InsertUserModerationAudit = typeof userModerationAudits.$inferInsert;

/**
 * 主账号用户名变更历史。
 * 旧用户名永久保留，避免历史交易中的身份名称被其他账号重新注册后冒用。
 */
export const userUsernameHistory = mysqlTable(
  "user_username_history",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    oldUsername: varchar("oldUsername", { length: 64 }).notNull(),
    newUsername: varchar("newUsername", { length: 64 }).notNull(),
    changedAt: timestamp("changedAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    oldUsernameUnique: uniqueIndex("user_username_history_old_username_unique").on(
      table.oldUsername,
    ),
    userChangedIdx: index("user_username_history_user_changed_idx").on(
      table.userId,
      table.changedAt,
    ),
  }),
);

export type UserUsernameHistory = typeof userUsernameHistory.$inferSelect;
export type InsertUserUsernameHistory = typeof userUsernameHistory.$inferInsert;

/**
 * 用户协议签署记录表：注册时在线阅读 + 手写签名的电子签署存证。
 * 依据《电子签名法》第13/14条要求，绑定签名图像、时间、版本、账户与设备信息。
 */
export const agreementSignatures = mysqlTable("agreement_signatures", {
  id: int("id").autoincrement().primaryKey(),
  /** 签署用户 id（users.id） */
  userId: int("userId").notNull(),
  /** 签署用户 openId 冗余（local:username） */
  openId: varchar("openId", { length: 64 }).notNull(),
  /** 协议名称 */
  agreementName: varchar("agreementName", { length: 128 })
    .default("51电子网用户注册服务协议")
    .notNull(),
  /** 协议版本号 */
  agreementVersion: varchar("agreementVersion", { length: 16 }).notNull(),
  /** 协议文档 SHA-256 摘要（防篡改存证） */
  agreementHash: varchar("agreementHash", { length: 64 }),
  /** 历史公开签名 URL；仅兼容存量，新增记录不写入。 */
  signatureImageUrl: text("signatureImageUrl"),
  /** 私有签名对象 key；新增记录只保存此稳定标识。 */
  signatureObjectKey: varchar("signatureObjectKey", { length: 512 }),
  /** 签署人类型：self 本人 / agent 单位授权代理人 */
  signerType: mysqlEnum("signerType", ["self", "agent"]).default("self").notNull(),
  /** 签署人手写姓名（用户填写的签名对应姓名，可选） */
  signerName: varchar("signerName", { length: 64 }),
  /** 开始阅读时间 */
  readStartAt: timestamp("readStartAt"),
  /** 阅读完成（滚动到底）时间 */
  readEndAt: timestamp("readEndAt"),
  /** 签署时间 */
  signedAt: timestamp("signedAt").default(DEFAULT_NOW).notNull(),
  /** 签署 IP */
  ip: varchar("ip", { length: 64 }),
  /** 签署设备 UA */
  userAgent: varchar("userAgent", { length: 512 }),
  createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
}, table => [index("idx_agreement_user").on(table.userId)]);

export type AgreementSignature = typeof agreementSignatures.$inferSelect;
export type InsertAgreementSignature = typeof agreementSignatures.$inferInsert;

/**
 * 企业服务协议接受记录：企业开通/资料更新提交前的版本化点击同意存证。
 */
export const enterpriseServiceAgreementAcceptances = mysqlTable(
  "enterprise_service_agreement_acceptances",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    companyNameSnapshot: varchar("companyNameSnapshot", { length: 128 }).notNull(),
    creditCodeSnapshot: varchar("creditCodeSnapshot", { length: 32 }),
    registrationIdentifierSnapshot: varchar("registrationIdentifierSnapshot", { length: 64 }),
    agreementName: varchar("agreementName", { length: 128 }).notNull(),
    agreementVersion: varchar("agreementVersion", { length: 16 }).notNull(),
    agreementHash: varchar("agreementHash", { length: 64 }).notNull(),
    acceptedAt: timestamp("acceptedAt").default(DEFAULT_NOW).notNull(),
    ip: varchar("ip", { length: 64 }),
    userAgent: varchar("userAgent", { length: 512 }),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    userVersionHashUnique: uniqueIndex("enterprise_agreement_user_version_hash_unique").on(
      table.userId,
      table.agreementVersion,
      table.agreementHash,
    ),
    userAcceptedIdx: index("enterprise_agreement_user_accepted_idx").on(
      table.userId,
      table.acceptedAt,
    ),
  }),
);

export type EnterpriseServiceAgreementAcceptance =
  typeof enterpriseServiceAgreementAcceptances.$inferSelect;
export type InsertEnterpriseServiceAgreementAcceptance =
  typeof enterpriseServiceAgreementAcceptances.$inferInsert;

/**
 * 企业信息表：每个用户一条企业资料。
 * 认证等级 certLevel 预留：pending 待审核 / certified 已认证 / premium 高级认证
 */
export const companies = mysqlTable("companies", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  /** 兼容链接统一企业；历史记录迁移后可暂为 NULL */
  enterpriseId: int("enterpriseId"),
  /** 企业名称 */
  companyName: varchar("companyName", { length: 128 }),
  /** 统一社会信用代码 */
  creditCode: varchar("creditCode", { length: 32 }),
  /** 注册辖区；旧内地资料保持CN与原creditCode。 */
  registrationRegion: varchar("registrationRegion", { length: 2 }).default("CN").notNull(),
  registrationIdentifier: varchar("registrationIdentifier", { length: 64 }),
  registrationSubmissionId: varchar("registrationSubmissionId", { length: 36 }),
  registrationPayloadHash: varchar("registrationPayloadHash", { length: 64 }),
  /** 香港人工审核资料，仅owner／审核后台可见，不进入公共投影。 */
  registrationData: json("registrationData").$type<import("../../shared/hongKongRegistration").HkRegistrationData>(),
  /** 企业类型，如：有限责任公司（制造业 · 智能硬件） */
  companyType: varchar("companyType", { length: 128 }),
  /** 法定代表人 */
  legalPerson: varchar("legalPerson", { length: 64 }),
  /** 企业角色，如：供应商（卖家）/ 采购方（买家） */
  companyRole: varchar("companyRole", { length: 64 }),
  /** 历史合并银行信息，仅用于兼容存量数据，新提交不再写入 */
  bankInfo: varchar("bankInfo", { length: 255 }),
  /** 银行账户名称 */
  bankAccountName: varchar("bankAccountName", { length: 128 }),
  /** 银行账户号码 */
  bankAccountNumber: varchar("bankAccountNumber", { length: 64 }),
  /** 开户行 */
  bankName: varchar("bankName", { length: 128 }),
  /** 微信支付二级商户号及进件状态；active 前不得用于真实交易 */
  wechatSubMerchantId: varchar("wechatSubMerchantId", { length: 64 }),
  wechatSubMerchantStatus: mysqlEnum("wechatSubMerchantStatus", ["not_applied", "reviewing", "active", "rejected", "disabled"])
    .default("not_applied")
    .notNull(),
  /** 支付宝二级商户号及进件状态；active 前不得用于真实交易 */
  alipaySubMerchantId: varchar("alipaySubMerchantId", { length: 64 }),
  alipaySubMerchantStatus: mysqlEnum("alipaySubMerchantStatus", ["not_applied", "reviewing", "active", "rejected", "disabled"])
    .default("not_applied")
    .notNull(),
  /** 注册地址 */
  regAddress: varchar("regAddress", { length: 255 }),
  /** 营业执照“成立日期”；DATE 无时区，禁止用平台注册时间或换证日期代替。 */
  establishedAt: date("establishedAt", { mode: "string" }),
  /** 销售负责人（客户对接的平台销售姓名，前台表单填写，与后台商户管理打通） */
  salesOwner: varchar("salesOwner", { length: 64 }),
  /**
   * 销售负责人工号（来自后台启用人员列表）。
   * 姓名可重复也可变更，工号才是与后台建立归属关系的唯一依据。
   */
  salesOwnerCode: varchar("salesOwnerCode", { length: 64 }),
  /** 历史公开营业执照 URL；仅兼容存量，新增资料不写入。 */
  licenseUrl: text("licenseUrl"),
  /** 私有营业执照对象 key；新增资料只保存此稳定标识。 */
  licenseObjectKey: varchar("licenseObjectKey", { length: 512 }),
  /** 营业执照文件名 */
  licenseFileName: varchar("licenseFileName", { length: 255 }),
  /** 历史公开银行资料 URL；仅兼容存量，新增资料不写入。 */
  bankLicenseUrl: text("bankLicenseUrl"),
  /** 私有银行资料对象 key；新增资料只保存此稳定标识。 */
  bankLicenseObjectKey: varchar("bankLicenseObjectKey", { length: 512 }),
  /** 银行资料文件名 */
  bankLicenseFileName: varchar("bankLicenseFileName", { length: 255 }),
  /** 认证等级（预留）：待审核 / 已认证 / 高级认证 */
  certLevel: mysqlEnum("certLevel", ["pending", "certified", "premium"])
    .default("pending")
    .notNull(),
  /** 人工审核状态：待审核 / 已通过 / 已驳回（提交或修改企业资料后回到 pending） */
  reviewStatus: mysqlEnum("reviewStatus", ["pending", "approved", "rejected"])
    .default("pending")
    .notNull(),
  /** 驳回原因（reviewStatus=rejected 时展示给用户） */
  rejectReason: text("rejectReason"),
  /** 待审核草稿（JSON）：已通过认证的企业修改资料时，新内容存于此，审核通过后才替换生效字段 */
  pendingDraft: text("pendingDraft"),
  /** 最近一次提交时间 */
  submittedAt: timestamp("submittedAt"),
  /** 最近一次审核时间 */
  reviewedAt: timestamp("reviewedAt"),
  /** 首次获准在平台经营的时间；资料复审不得重置。搜索排名的商户资历因子依赖此字段。 */
  merchantSinceAt: timestamp("merchantSinceAt"),
  /** 公司头像引用本企业信息墙中的有效照片；搜索页启用前仅供 ERP 维护。 */
  avatarPhotoId: int("avatarPhotoId"),
  /** 搜索页头像适配方式：logo 完整留白展示，photo 居中裁切铺满。 */
  avatarDisplayMode: mysqlEnum("avatarDisplayMode", ["logo", "photo"])
    .default("logo")
    .notNull(),
  /** 裁切铺满模式的缩放百分比（100–200）。 */
  avatarCropZoom: int("avatarCropZoom").default(100).notNull(),
  /** 裁切铺满模式的水平焦点（-100–100）。 */
  avatarCropX: int("avatarCropX").default(0).notNull(),
  /** 裁切铺满模式的垂直焦点（-100–100）。 */
  avatarCropY: int("avatarCropY").default(0).notNull(),
  /** 最近设置公司头像的用户 ID，便于追溯企业侧操作。 */
  avatarUpdatedBy: int("avatarUpdatedBy"),
  avatarUpdatedAt: timestamp("avatarUpdatedAt"),
  /** 首页供应商卡片的独立展示主图；与搜索展示图互不影响。 */
  homeCoverPhotoId: int("homeCoverPhotoId"),
  /** 首页供应商卡片适配方式：logo 完整留白展示，photo 裁切铺满。 */
  homeCoverDisplayMode: mysqlEnum("homeCoverDisplayMode", ["logo", "photo"])
    .default("photo")
    .notNull(),
  /** 公司展示主图缩放百分比（100–200），与搜索展示图独立。 */
  homeCoverCropZoom: int("homeCoverCropZoom").default(100).notNull(),
  /** 公司展示主图水平焦点（-100–100）。 */
  homeCoverCropX: int("homeCoverCropX").default(0).notNull(),
  /** 公司展示主图垂直焦点（-100–100）。 */
  homeCoverCropY: int("homeCoverCropY").default(0).notNull(),
  /** 最近设置首页展示主图的用户 ID，便于追溯企业侧操作。 */
  homeCoverUpdatedBy: int("homeCoverUpdatedBy"),
  homeCoverUpdatedAt: timestamp("homeCoverUpdatedAt"),
  /** 平台后台控制的首页优质商家状态；不以照片数量或前端请求决定。 */
  homepageFeatured: boolean("homepageFeatured").default(false).notNull(),
  /** 最近一次平台后台变更优质商家状态的时间。 */
  homepageFeaturedUpdatedAt: timestamp("homepageFeaturedUpdatedAt"),
  /** 最近一次平台后台变更优质商家状态的后台操作人标识。 */
  homepageFeaturedUpdatedBy: varchar("homepageFeaturedUpdatedBy", { length: 128 }),
  /** 平台后台控制的首页入驻商家展示；未勾选不进入首页入驻照片轮播。 */
  homepageShowcased: boolean("homepageShowcased").default(false).notNull(),
  homepageShowcasedUpdatedAt: timestamp("homepageShowcasedUpdatedAt"),
  homepageShowcasedUpdatedBy: varchar("homepageShowcasedUpdatedBy", { length: 128 }),
  createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
}, table => ({
  enterpriseIdx: index("companies_enterprise_idx").on(table.enterpriseId),
  creditCodeIdx: index("companies_credit_code_idx").on(table.creditCode),
  avatarPhotoIdx: index("companies_avatar_photo_idx").on(table.avatarPhotoId),
  homeCoverPhotoIdx: index("companies_home_cover_photo_idx").on(table.homeCoverPhotoId),
  homepageFeaturedIdx: index("companies_homepage_featured_idx").on(
    table.homepageFeatured,
    table.merchantSinceAt,
    table.createdAt,
    table.id,
  ),
  homepageShowcasedIdx: index("companies_homepage_showcased_idx").on(
    table.homepageShowcased,
    table.merchantSinceAt,
    table.createdAt,
    table.id,
  ),
}));

export type Company = typeof companies.$inferSelect;
export type InsertCompany = typeof companies.$inferInsert;

/** 卖家自提点：由已审核企业维护，结算时按卖家选择并固化到订单。 */
export const sellerPickupPoints = mysqlTable(
  "seller_pickup_points",
  {
    id: int("id").autoincrement().primaryKey(),
    sellerId: int("sellerId").notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    address: varchar("address", { length: 400 }).notNull(),
    contactName: varchar("contactName", { length: 64 }).notNull(),
    contactPhone: varchar("contactPhone", { length: 20 }).notNull(),
    businessHours: varchar("businessHours", { length: 128 }),
    enabled: boolean("enabled").default(true).notNull(),
    sortOrder: int("sortOrder").default(0).notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    sellerEnabledIdx: index("seller_pickup_points_seller_enabled_idx").on(
      table.sellerId,
      table.enabled,
      table.sortOrder,
    ),
  }),
);

export type SellerPickupPoint = typeof sellerPickupPoints.$inferSelect;
export type InsertSellerPickupPoint = typeof sellerPickupPoints.$inferInsert;

/**
 * ERP 新注册企业赠咖啡券活动。
 *
 * startsAt 是新用户资格的唯一时间边界：只有 users.createdAt >= startsAt 才可领券。
 * 部署与导券阶段保持 draft，线上验证完成后由管理员显式激活。
 */
export const coffeeVoucherCampaigns = mysqlTable(
  "coffee_voucher_campaigns",
  {
    id: int("id").autoincrement().primaryKey(),
    code: varchar("code", { length: 64 }).notNull(),
    title: varchar("title", { length: 128 }).notNull(),
    status: mysqlEnum("status", ["draft", "active", "paused", "exhausted", "ended"])
      .default("draft")
      .notNull(),
    startsAt: timestamp("startsAt"),
    endsAt: timestamp("endsAt"),
    createdByUserId: int("createdByUserId"),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    codeUnique: uniqueIndex("coffee_voucher_campaigns_code_unique").on(table.code),
    statusStartIdx: index("coffee_voucher_campaigns_status_start_idx").on(
      table.status,
      table.startsAt,
    ),
  }),
);
export type CoffeeVoucherCampaign = typeof coffeeVoucherCampaigns.$inferSelect;
export type InsertCoffeeVoucherCampaign = typeof coffeeVoucherCampaigns.$inferInsert;

/**
 * 活动券库存。图片保存在 ECS 私有共享目录，本表只存随机资产键、哈希与相对路径。
 * 禁止把二维码目标网址或公开图片 URL 写入数据库。
 */
export const coffeeVouchers = mysqlTable(
  "coffee_vouchers",
  {
    id: int("id").autoincrement().primaryKey(),
    campaignId: int("campaignId").notNull(),
    assetKey: varchar("assetKey", { length: 64 }).notNull(),
    sourceHash: varchar("sourceHash", { length: 64 }).notNull(),
    privatePath: varchar("privatePath", { length: 512 }).notNull(),
    mimeType: varchar("mimeType", { length: 64 }).default("image/webp").notNull(),
    status: mysqlEnum("status", ["available", "assigned", "void"])
      .default("available")
      .notNull(),
    assignedAt: timestamp("assignedAt"),
    voidedAt: timestamp("voidedAt"),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    campaignAssetUnique: uniqueIndex("coffee_vouchers_campaign_asset_unique").on(
      table.campaignId,
      table.assetKey,
    ),
    campaignHashUnique: uniqueIndex("coffee_vouchers_campaign_hash_unique").on(
      table.campaignId,
      table.sourceHash,
    ),
    campaignStatusIdx: index("coffee_vouchers_campaign_status_idx").on(
      table.campaignId,
      table.status,
      table.id,
    ),
  }),
);
export type CoffeeVoucher = typeof coffeeVouchers.$inferSelect;
export type InsertCoffeeVoucher = typeof coffeeVouchers.$inferInsert;

/**
 * 咖啡券企业分配记录。
 *
 * enterpriseKey 使用规范化统一社会信用代码，保证同一企业跨账号最多领取一张；
 * user 唯一约束再阻止同一账号在企业资料变更后重复领取。
 */
export const coffeeVoucherAssignments = mysqlTable(
  "coffee_voucher_assignments",
  {
    id: int("id").autoincrement().primaryKey(),
    campaignId: int("campaignId").notNull(),
    voucherId: int("voucherId").notNull(),
    userId: int("userId").notNull(),
    companyId: int("companyId").notNull(),
    enterpriseKey: varchar("enterpriseKey", { length: 128 }).notNull(),
    notificationStatus: mysqlEnum("notificationStatus", ["pending", "sent", "failed"])
      .default("pending")
      .notNull(),
    messageId: int("messageId"),
    erpActivatedAt: timestamp("erpActivatedAt").notNull(),
    assignedAt: timestamp("assignedAt").default(DEFAULT_NOW).notNull(),
    notifiedAt: timestamp("notifiedAt"),
    lastError: varchar("lastError", { length: 255 }),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    campaignVoucherUnique: uniqueIndex("coffee_voucher_assignments_campaign_voucher_unique").on(
      table.campaignId,
      table.voucherId,
    ),
    campaignEnterpriseUnique: uniqueIndex("coffee_voucher_assignments_campaign_enterprise_unique").on(
      table.campaignId,
      table.enterpriseKey,
    ),
    campaignUserUnique: uniqueIndex("coffee_voucher_assignments_campaign_user_unique").on(
      table.campaignId,
      table.userId,
    ),
    userAssignedIdx: index("coffee_voucher_assignments_user_assigned_idx").on(
      table.userId,
      table.assignedAt,
    ),
    campaignNotifyIdx: index("coffee_voucher_assignments_campaign_notify_idx").on(
      table.campaignId,
      table.notificationStatus,
      table.assignedAt,
    ),
  }),
);
export type CoffeeVoucherAssignment = typeof coffeeVoucherAssignments.$inferSelect;
export type InsertCoffeeVoucherAssignment = typeof coffeeVoucherAssignments.$inferInsert;

/**
 * 企业公司信息墙照片。
 *
 * 公开企业主页只读取 approved 且 deletedAt 为空的记录；图片对象 key 必须位于
 * company-wall/{companyId}/ 前缀，禁止企业引用外部或其他企业的图片。
 */
export const companyProfilePhotos = mysqlTable("company_profile_photos", {
  id: int("id").autoincrement().primaryKey(),
  companyId: int("companyId").notNull(),
  uploaderUserId: int("uploaderUserId").notNull(),
  objectKey: varchar("objectKey", { length: 512 }).notNull(),
  url: text("url").notNull(),
  /** 列表卡片使用的 WebP 缩略图；旧记录为空时回退原图。 */
  thumbnailObjectKey: varchar("thumbnailObjectKey", { length: 512 }),
  thumbnailUrl: text("thumbnailUrl"),
  name: varchar("name", { length: 255 }),
  mimeType: varchar("mimeType", { length: 64 }).notNull(),
  category: mysqlEnum("category", ["storefront", "office", "warehouse", "production", "team", "other"])
    .default("other")
    .notNull(),
  caption: varchar("caption", { length: 120 }),
  status: mysqlEnum("status", ["pending", "approved", "rejected"])
    .default("approved")
    .notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  reviewedBy: int("reviewedBy"),
  reviewedAt: timestamp("reviewedAt"),
  deletedAt: timestamp("deletedAt"),
  createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
}, table => [
  uniqueIndex("company_profile_photos_object_key_unique").on(table.objectKey),
  index("company_profile_photos_public_idx").on(table.companyId, table.status, table.deletedAt, table.sortOrder),
]);

export type CompanyProfilePhoto = typeof companyProfilePhotos.$inferSelect;
export type InsertCompanyProfilePhoto = typeof companyProfilePhotos.$inferInsert;

/**
 * 独立后台变更首页优质商家状态的不可变审计。
 * requestId 全局唯一，服务层以完整 payload 哈希拒绝同请求键的异内容重放。
 */
export const companyHomepageFeatureAudits = mysqlTable(
  "company_homepage_feature_audits",
  {
    id: int("id").autoincrement().primaryKey(),
    companyId: int("companyId").notNull(),
    ownerUserId: int("ownerUserId").notNull(),
    action: varchar("action", { length: 64 }).notNull(),
    beforeValue: json("beforeValue").$type<Record<string, unknown>>(),
    afterValue: json("afterValue").$type<Record<string, unknown>>().notNull(),
    reason: varchar("reason", { length: 500 }).notNull(),
    requestId: varchar("requestId", { length: 64 }).notNull(),
    payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
    operatorId: varchar("operatorId", { length: 128 }).notNull(),
    operatorName: varchar("operatorName", { length: 128 }).notNull(),
    operatorRole: varchar("operatorRole", { length: 64 }).notNull(),
    ipAddress: varchar("ipAddress", { length: 64 }),
    userAgent: varchar("userAgent", { length: 512 }),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    requestIdUnique: uniqueIndex("company_homepage_feature_audits_request_unique").on(table.requestId),
    companyCreatedIdx: index("company_homepage_feature_audits_company_created_idx").on(
      table.companyId,
      table.createdAt,
    ),
    ownerCreatedIdx: index("company_homepage_feature_audits_owner_created_idx").on(
      table.ownerUserId,
      table.createdAt,
    ),
  }),
);
export type CompanyHomepageFeatureAudit = typeof companyHomepageFeatureAudits.$inferSelect;
export type InsertCompanyHomepageFeatureAudit = typeof companyHomepageFeatureAudits.$inferInsert;

/** 阶梯价档位：数量下限 + 含税单价 */
/** maxQty 可选，保留API原始排他上界；超安全整数的上界保持字符串。 */
export type LadderTier = { minQty: number; price: number; maxQty?: number | string };

/** 库存照片：数据库只保存对象存储引用和展示所需元数据 */
export type InventoryPhoto = {
  key: string;
  url: string;
  name: string;
  mimeType: string;
  size: number;
};

/**
 * 库存表：供应商发布的电子元器件库存。
 * 状态：draft 草稿（待发布）/ published 已发布 / offshelf 已下架
 */
export const inventories = mysqlTable("inventories", {
  id: int("id").autoincrement().primaryKey(),
  /**
   * 兼容期企业交易主账号。订单、收款、公司主页和企业信誉仍使用此字段，
   * 员工责任必须读取 enterpriseId / ownerUserId，不能再从 userId 推断。
   */
  userId: int("userId").notNull(),
  /** 库存所属统一企业；存量无企业资料时允许为空并继续走 userId 兼容逻辑。 */
  enterpriseId: int("enterpriseId"),
  /** 当前库存负责人，也是新询价的默认接单人。 */
  ownerUserId: int("ownerUserId"),
  /** 实际创建或上传库存的独立员工账号；创建后不应改写。 */
  createdByUserId: int("createdByUserId"),
  /** 最近维护库存的独立员工账号。 */
  updatedByUserId: int("updatedByUserId"),
  /** 最近一次负责人分配时间。 */
  ownerAssignedAt: timestamp("ownerAssignedAt"),
  /** 乐观锁版本；每次负责人变化递增，避免并发转交覆盖。 */
  ownershipVersion: int("ownershipVersion").default(1).notNull(),
  /** 型号 */
  partNumber: varchar("partNumber", { length: 128 }).notNull(),
  /** NFKC 在写入前完成；数据库统一大写并去首尾空格，用于精确/前缀型号索引搜索。 */
  partNumberNormalized: varchar("partNumberNormalized", { length: 128 }).generatedAlwaysAs(
    sql`UPPER(TRIM(partNumber))`,
    { mode: "stored" },
  ),
  /** 品牌 */
  brand: varchar("brand", { length: 64 }).notNull(),
  /** 分类 */
  category: varchar("category", { length: 32 }).notNull(),
  /** 封装 */
  pkg: varchar("pkg", { length: 32 }),
  /** 批号 / Date Code */
  dateCode: varchar("dateCode", { length: 32 }),
  /** 生产年份 */
  prodYear: varchar("prodYear", { length: 16 }),
  /** 上架数量 */
  qtyOnSale: int("qtyOnSale").notNull(),
  /** 实际库存数量 */
  qtyStock: int("qtyStock").notNull(),
  /** 可订货数量；NULL 表示历史数据未知，0 表示确认无订货供应。 */
  qtyOrder: int("qtyOrder"),
  /**
   * 商家录入的单价（4位小数）。
   *
   * 此值保存商家录入的展示价格；含税或未税口径由 taxIncluded 标记。
   * 列名保留 priceEx 仅为兼容存量代码与数据。
   */
  priceEx: decimal("priceEx", { precision: 12, scale: 4 }),
  /**
   * 历史价格镜像列，与 priceEx 同值。
   *
   * 保留此列仅为兼容存量读取代码；价格是否含税必须以 taxIncluded 为准。
   */
  priceIncl: decimal("priceIncl", { precision: 12, scale: 4 }),
  /** 价格是否含税；历史数据默认 true，false 表示未税价且仅可询价 */
  taxIncluded: boolean("taxIncluded").default(true).notNull(),
  /** 可开 13% 增值税专用发票 */
  invoice: boolean("invoice").default(true).notNull(),
  /** 阶梯价（JSON 多档）：[{minQty, price}] */
  ladderPrices: json("ladderPrices").$type<LadderTier[]>(),
  /** 最小起订量 MOQ */
  moq: int("moq"),
  /** 整包数量 SPQ */
  spq: int("spq"),
  /** 货源性质 */
  source: varchar("source", { length: 32 }),
  /** 品质等级 */
  grade: varchar("grade", { length: 32 }),
  /** 交货期；历史数据允许 NULL，新建、编辑和发布接口均强制非空。 */
  leadTime: varchar("leadTime", { length: 32 }),
  /** 仓库地址 / 库存所在地 */
  warehouseAddress: varchar("warehouseAddress", { length: 255 }),
  /** RoHS 合规 */
  rohs: boolean("rohs").default(true).notNull(),
  /** 备注说明 */
  note: text("note"),
  /** 库存实拍照片（S3 对象引用，最多 5 张） */
  photos: json("photos").$type<InventoryPhoto[]>(),
  /** 状态：草稿 / 已发布 / 已下架 */
  status: mysqlEnum("status", ["draft", "published", "offshelf"])
    .default("draft")
    .notNull(),
  /** 是否允许在公司主页、推荐、联想等可批量浏览入口展示；false 时仅完整型号精确搜索可见。 */
  companyCatalogVisible: boolean("companyCatalogVisible").default(true).notNull(),
  /** 最近一次修改公司目录展示范围的独立员工账号。 */
  catalogVisibilityUpdatedByUserId: int("catalogVisibilityUpdatedByUserId"),
  /** 最近一次修改公司目录展示范围的时间。 */
  catalogVisibilityUpdatedAt: timestamp("catalogVisibilityUpdatedAt"),
  /** 下架来源：user 用户自助 / admin 平台后台 / system 系统售罄 */
  offshelfBy: mysqlEnum("offshelfBy", ["user", "admin", "system"]),
  /** 下架原因：admin 为后台填写；system 售罄固定为 sold_out */
  offshelfReason: varchar("offshelfReason", { length: 255 }),
  /** 发布时间 */
  publishedAt: timestamp("publishedAt"),
  /** 最近一次发布失败的稳定错误代码；仅 draft 状态有意义。 */
  publishErrorCode: varchar("publishErrorCode", { length: 64 }),
  /** 最近一次发布失败的用户可读说明。 */
  publishErrorMessage: varchar("publishErrorMessage", { length: 255 }),
  /** 需修改的表单字段，例如 ["partNumber"]。 */
  publishErrorFields: json("publishErrorFields").$type<string[]>(),
  /** 最近一次发布失败时间。 */
  publishFailedAt: timestamp("publishFailedAt"),
  /** 最近一次尝试发布的独立员工账号。 */
  publishAttemptedByUserId: int("publishAttemptedByUserId"),
  /** 连续发布尝试次数，成功后归零。 */
  publishAttemptCount: int("publishAttemptCount").default(0).notNull(),
  /** 单条直接发布的幂等请求标识，避免网络重试生成重复草稿。 */
  publishRequestId: varchar("publishRequestId", { length: 64 }),
  /** 最近一次一键刷新时间（商户手动刷新，24 小时限一次）；搜索排名的新鲜度因子依赖此字段。 */
  refreshedAt: timestamp("refreshedAt"),
  createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
}, table => ({
  enterpriseOwnerStatusIdx: index("inventories_enterprise_owner_status_idx").on(
    table.enterpriseId,
    table.ownerUserId,
    table.status,
  ),
  ownerStatusUpdatedIdx: index("inventories_owner_status_updated_idx").on(
    table.ownerUserId,
    table.status,
    table.updatedAt,
  ),
  spotCandidateIdx: index("inventories_spot_candidate_idx").on(
    table.userId, table.enterpriseId, table.status, table.partNumberNormalized, table.id,
  ),
  spotCandidateOwnerIdx: index("inventories_spot_candidate_owner_idx").on(
    table.userId, table.enterpriseId, table.ownerUserId, table.status, table.partNumberNormalized, table.id,
  ),
  userStatusIdIdx: index("inventories_user_status_id_idx").on(
    table.userId,
    table.status,
    table.id,
  ),
  userStatusUpdatedIdIdx: index("inventories_user_status_updated_id_idx").on(
    table.userId,
    table.status,
    table.updatedAt,
    table.id,
  ),
  userUpdatedIdIdx: index("inventories_user_updated_id_idx").on(
    table.userId,
    table.updatedAt,
    table.id,
  ),
  publishErrorIdx: index("inventories_publish_error_idx").on(
    table.userId,
    table.status,
    table.publishErrorCode,
  ),
  publishRequestUnique: uniqueIndex("inventories_publish_request_unique").on(
    table.userId,
    table.publishRequestId,
  ),
  companyCatalogIdx: index("inventories_company_catalog_idx").on(
    table.userId,
    table.status,
    table.companyCatalogVisible,
    table.refreshedAt,
    table.id,
  ),
  publicBrowseIdx: index("inventories_public_browse_idx").on(
    table.status,
    table.companyCatalogVisible,
    table.refreshedAt,
    table.id,
    table.qtyOnSale,
  ),
  publicPublishedIdx: index("inventories_public_published_idx").on(
    table.status,
    table.companyCatalogVisible,
    table.publishedAt,
    table.id,
    table.qtyOnSale,
  ),
  publicPartSearchIdx: index("inventories_public_part_search_idx").on(
    table.status,
    table.partNumberNormalized,
    table.companyCatalogVisible,
    table.qtyOnSale,
    table.id,
  ),
}));

export type Inventory = typeof inventories.$inferSelect;
export type InsertInventory = typeof inventories.$inferInsert;

/** 已有库存到公开公司冻结绑定；聊天联系人仅消费该归属，不推断或回填。 */
export const publicInventoryCompanyBindings = mysqlTable("public_inventory_company_bindings", {
  inventoryId: int("inventoryId").primaryKey(),
  companyId: int("companyId"),
  bindingSource: mysqlEnum("bindingSource", ["legacy_frozen", "enterprise", "personal_frozen"]).notNull(),
  createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
}, table => ({
  companyIdx: index("public_inventory_company_bindings_company_idx").on(table.companyId),
  sourceIdx: index("public_inventory_company_bindings_source_idx").on(table.bindingSource, table.inventoryId),
}));

/**
 * 当前库存的现货照片核验结果。
 *
 * 每次成功核验都追加历史记录；照片仅供平台审计，不随公开搜索接口下发。
 * 公开标签必须同时满足：未过期、库存仍在售、inventoryFingerprint 与当前库存一致。
 */
export const inventorySpotVerifications = mysqlTable("inventory_spot_verifications", {
  id: int("id").autoincrement().primaryKey(),
  inventoryId: int("inventoryId").notNull(),
  enterpriseId: int("enterpriseId").notNull(),
  dataOwnerUserId: int("dataOwnerUserId").notNull(),
  verifiedByUserId: int("verifiedByUserId").notNull(),
  recognizedPartNumber: varchar("recognizedPartNumber", { length: 128 }).notNull(),
  inventoryPartNumber: varchar("inventoryPartNumber", { length: 128 }).notNull(),
  matchRule: mysqlEnum("matchRule", ["exact", "single_character", "packaging"]).notNull(),
  matchScore: decimal("matchScore", { precision: 5, scale: 4 }).notNull(),
  photoKey: varchar("photoKey", { length: 512 }).notNull(),
  photoSha256: varchar("photoSha256", { length: 64 }).notNull(),
  requestId: varchar("requestId", { length: 64 }).notNull(),
  inventoryFingerprint: varchar("inventoryFingerprint", { length: 64 }).notNull(),
  modelName: varchar("modelName", { length: 64 }).notNull(),
  verifiedAt: immutableBeijingDateTime("verifiedAt").notNull(),
  expiresAt: immutableBeijingDateTime("expiresAt").notNull(),
  createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
}, table => ({
  photoShaUnique: uniqueIndex("inventory_spot_verifications_photo_sha_unique").on(table.photoSha256),
  requestUnique: uniqueIndex("inventory_spot_verifications_request_unique").on(
    table.enterpriseId,
    table.verifiedByUserId,
    table.requestId,
  ),
  inventoryLatestIdx: index("inventory_spot_verifications_inventory_latest_idx").on(
    table.inventoryId,
    table.id,
  ),
  ownerExpiryIdx: index("inventory_spot_verifications_owner_expiry_idx").on(
    table.dataOwnerUserId,
    table.expiresAt,
    table.inventoryId,
  ),
  enterpriseExpiryIdx: index("inventory_spot_verifications_enterprise_expiry_idx").on(
    table.enterpriseId,
    table.expiresAt,
    table.inventoryId,
  ),
  expiryInventoryIdx: index("inventory_spot_verifications_expiry_inventory_idx").on(
    table.expiresAt,
    table.inventoryId,
    table.id,
  ),
}));

export type InventorySpotVerification = typeof inventorySpotVerifications.$inferSelect;
export type InsertInventorySpotVerification = typeof inventorySpotVerifications.$inferInsert;

/**
 * 现货核验人工复核。机器无法确认印刷/激光时入队；已绿标记录也可被后台取消。
 * 绿标仍以 inventory_spot_verifications 最新未过期记录为准。
 */
export const inventorySpotVerificationReviews = mysqlTable("inventory_spot_verification_reviews", {
  id: int("id").autoincrement().primaryKey(),
  enterpriseId: int("enterpriseId").notNull(),
  dataOwnerUserId: int("dataOwnerUserId").notNull(),
  submittedByUserId: int("submittedByUserId").notNull(),
  inventoryId: int("inventoryId"),
  recognizedPartNumber: varchar("recognizedPartNumber", { length: 128 }).notNull(),
  inventoryPartNumber: varchar("inventoryPartNumber", { length: 128 }),
  markingSource: mysqlEnum("markingSource", ["printed", "laser", "handwritten", "screen", "unknown"]).notNull(),
  photoKey: varchar("photoKey", { length: 512 }).notNull(),
  photoSha256: varchar("photoSha256", { length: 64 }).notNull(),
  requestId: varchar("requestId", { length: 64 }).notNull(),
  status: mysqlEnum("status", ["pending", "approved", "rejected", "cancelled"]).notNull().default("pending"),
  sourceVerificationId: int("sourceVerificationId"),
  resultVerificationId: int("resultVerificationId"),
  reviewedByAdminId: int("reviewedByAdminId"),
  reviewedByAdminName: varchar("reviewedByAdminName", { length: 128 }),
  reviewedAt: immutableBeijingDateTime("reviewedAt"),
  rejectMessage: varchar("rejectMessage", { length: 255 }),
  createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
}, table => ({
  photoShaUnique: uniqueIndex("inventory_spot_verification_reviews_photo_sha_unique").on(table.photoSha256),
  requestUnique: uniqueIndex("inventory_spot_verification_reviews_request_unique").on(
    table.enterpriseId,
    table.submittedByUserId,
    table.requestId,
  ),
  enterpriseStatusIdx: index("inventory_spot_verification_reviews_enterprise_status_idx").on(
    table.enterpriseId,
    table.status,
    table.id,
  ),
  inventoryStatusIdx: index("inventory_spot_verification_reviews_inventory_status_idx").on(
    table.inventoryId,
    table.status,
    table.id,
  ),
}));

export type InventorySpotVerificationReview = typeof inventorySpotVerificationReviews.$inferSelect;
export type InsertInventorySpotVerificationReview = typeof inventorySpotVerificationReviews.$inferInsert;


/**
 * 库存异步导入任务。
 *
 * activeEnterpriseId 仅在非终态保留 enterpriseId，并通过唯一索引保证
 * 一个企业同一时间最多存在一个导入任务。进入终态后清空，允许下一任务创建。
 */
export const inventoryImportJobs = mysqlTable("inventory_import_jobs", {
  id: varchar("id", { length: 36 }).primaryKey(),
  enterpriseId: int("enterpriseId").notNull(),
  activeEnterpriseId: int("activeEnterpriseId"),
  dataOwnerUserId: int("dataOwnerUserId").notNull(),
  createdByUserId: int("createdByUserId").notNull(),
  ownerUserId: int("ownerUserId").notNull(),
  clientRequestId: varchar("clientRequestId", { length: 64 }).notNull(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  fileHash: varchar("fileHash", { length: 64 }),
  manifestHash: varchar("manifestHash", { length: 64 }).notNull(),
  saveAs: mysqlEnum("saveAs", ["draft", "published"]).default("published").notNull(),
  status: mysqlEnum("status", [
    "staging",
    "queued",
    "running",
    "paused",
    "completed",
    "failed",
    "cancelled",
  ]).default("staging").notNull(),
  totalRows: int("totalRows").notNull(),
  stagedRows: int("stagedRows").default(0).notNull(),
  processedRows: int("processedRows").default(0).notNull(),
  successRows: int("successRows").default(0).notNull(),
  errorRows: int("errorRows").default(0).notNull(),
  /** 暂存时逐行拒绝数；已计入 errorRows，绝不由 worker 写入正式库存。 */
  skippedRows: int("skippedRows").default(0).notNull(),
  duplicateRows: int("duplicateRows").default(0).notNull(),
  /** 按型号覆盖更新已发布库存的行数；不占用 success 以外的名额。 */
  updatedRows: int("updatedRows").default(0).notNull(),
  leaseOwner: varchar("leaseOwner", { length: 96 }),
  leaseExpiresAt: timestamp("leaseExpiresAt"),
  heartbeatAt: timestamp("heartbeatAt"),
  attemptCount: int("attemptCount").default(0).notNull(),
  errorMessage: varchar("errorMessage", { length: 255 }),
  startedAt: timestamp("startedAt"),
  finishedAt: timestamp("finishedAt"),
  createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
}, table => ({
  activeEnterpriseUnique: uniqueIndex("inventory_import_jobs_active_enterprise_unique").on(
    table.activeEnterpriseId,
  ),
  enterpriseRequestUnique: uniqueIndex("inventory_import_jobs_enterprise_request_unique").on(
    table.enterpriseId,
    table.clientRequestId,
  ),
  enterpriseCreatedIdx: index("inventory_import_jobs_enterprise_created_idx").on(
    table.enterpriseId,
    table.createdAt,
  ),
  statusCreatedIdx: index("inventory_import_jobs_status_created_idx").on(
    table.status,
    table.createdAt,
  ),
  leaseIdx: index("inventory_import_jobs_lease_idx").on(table.status, table.leaseExpiresAt),
}));

export type InventoryImportJob = typeof inventoryImportJobs.$inferSelect;
export type InsertInventoryImportJob = typeof inventoryImportJobs.$inferInsert;

/** 每次暂存上传的幂等凭据；同一批号只能对应同一份内容。 */
export const inventoryImportBatches = mysqlTable("inventory_import_batches", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  jobId: varchar("jobId", { length: 36 }).notNull(),
  batchIndex: int("batchIndex").notNull(),
  startRow: int("startRow").notNull(),
  rowCount: int("rowCount").notNull(),
  payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
  createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
}, table => ({
  jobBatchUnique: uniqueIndex("inventory_import_batches_job_batch_unique").on(
    table.jobId,
    table.batchIndex,
  ),
  jobStartRowUnique: uniqueIndex("inventory_import_batches_job_start_unique").on(
    table.jobId,
    table.startRow,
  ),
}));

export type InventoryImportBatch = typeof inventoryImportBatches.$inferSelect;

/**
 * 导入暂存区：HTTP请求只写入该表，正式库存由独立worker分批合并。
 * jobId + rowNumber 是行级幂等键，客户端或网络重试不会产生第二份数据。
 */
export const inventoryImportStaging = mysqlTable("inventory_import_staging", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  jobId: varchar("jobId", { length: 36 }).notNull(),
  enterpriseId: int("enterpriseId").notNull(),
  rowNumber: int("rowNumber").notNull(),
  partNumber: varchar("partNumber", { length: 128 }).notNull(),
  partNumberNormalized: varchar("partNumberNormalized", { length: 128 }).notNull(),
  brand: varchar("brand", { length: 64 }).notNull(),
  category: varchar("category", { length: 32 }).notNull(),
  pkg: varchar("pkg", { length: 32 }),
  dateCode: varchar("dateCode", { length: 32 }).notNull(),
  qtyOnSale: int("qtyOnSale").notNull(),
  qtyStock: int("qtyStock").notNull(),
  priceEx: decimal("priceEx", { precision: 12, scale: 4 }),
  priceIncl: decimal("priceIncl", { precision: 12, scale: 4 }),
  taxIncluded: boolean("taxIncluded").default(true).notNull(),
  moq: int("moq"),
  spq: int("spq"),
  leadTime: varchar("leadTime", { length: 32 }).notNull(),
  warehouseAddress: varchar("warehouseAddress", { length: 255 }),
  rohs: boolean("rohs").default(true).notNull(),
  note: text("note"),
  status: mysqlEnum("status", ["pending", "success", "error"]).default("pending").notNull(),
  errorCode: varchar("errorCode", { length: 64 }),
  errorMessage: varchar("errorMessage", { length: 255 }),
  processedAt: timestamp("processedAt"),
  createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
}, table => ({
  jobRowUnique: uniqueIndex("inventory_import_staging_job_row_unique").on(
    table.jobId,
    table.rowNumber,
  ),
  jobStatusRowIdx: index("inventory_import_staging_job_status_row_idx").on(
    table.jobId,
    table.status,
    table.rowNumber,
  ),
  enterprisePartIdx: index("inventory_import_staging_enterprise_part_idx").on(
    table.enterpriseId,
    table.partNumberNormalized,
  ),
}));

export type InventoryImportStagingRow = typeof inventoryImportStaging.$inferSelect;
export type InsertInventoryImportStagingRow = typeof inventoryImportStaging.$inferInsert;

/**
 * Immutable V3/new-stage preview snapshot. Existing staged rows have no row
 * here and intentionally retain legacy worker behavior after the rollout.
 */
export const inventoryImportRowVersions = mysqlTable("inventory_import_row_versions", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  jobId: varchar("jobId", { length: 36 }).notNull(),
  rowNumber: int("rowNumber").notNull(),
  guardKind: mysqlEnum("guardKind", ["existing", "new"]).notNull(),
  inventoryId: int("inventoryId"),
  expectedFingerprint: char("expectedFingerprint", { length: 64 }),
  /** inventories.ownershipVersion at stage time; snapshot remains authoritative for content. */
  expectedRevision: int("expectedRevision"),
  expectedUpdatedAt: varchar("expectedUpdatedAt", { length: 64 }),
  /** Canonical complete iuUpgradeV1-compatible field snapshot. */
  snapshotJson: longtext("snapshotJson").notNull(),
  createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
}, table => ({
  jobRowUnique: uniqueIndex("inventory_import_row_versions_job_row_unique").on(table.jobId, table.rowNumber),
  inventoryIdx: index("inventory_import_row_versions_inventory_idx").on(table.inventoryId),
  jobIdx: index("inventory_import_row_versions_job_idx").on(table.jobId),
}));

export type InventoryImportRowVersion = typeof inventoryImportRowVersions.$inferSelect;

/** 独立私有错误行；源值不截断，保持行号与任务/企业归属，供用户修复后单独重传。 */
export const inventoryImportRejected = mysqlTable("inventory_import_rejected", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  jobId: varchar("jobId", { length: 36 }).notNull(),
  enterpriseId: int("enterpriseId").notNull(),
  rowNumber: int("rowNumber").notNull(),
  rawRow: text("rawRow").notNull(),
  errorMessage: varchar("errorMessage", { length: 255 }).notNull(),
  createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
}, table => ({
  jobRowUnique: uniqueIndex("inventory_import_rejected_job_row_unique").on(table.jobId, table.rowNumber),
  enterpriseJobRowIdx: index("inventory_import_rejected_enterprise_job_row_idx").on(table.enterpriseId, table.jobId, table.rowNumber),
}));

/** 正式库存与导入任务的不可变关系，用于行级幂等和精确回滚。 */
export const inventoryImportResults = mysqlTable("inventory_import_results", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  jobId: varchar("jobId", { length: 36 }).notNull(),
  rowNumber: int("rowNumber").notNull(),
  inventoryId: int("inventoryId").notNull(),
  createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
}, table => ({
  jobRowUnique: uniqueIndex("inventory_import_results_job_row_unique").on(
    table.jobId,
    table.rowNumber,
  ),
  inventoryUnique: uniqueIndex("inventory_import_results_inventory_unique").on(table.inventoryId),
  jobCreatedIdx: index("inventory_import_results_job_created_idx").on(table.jobId, table.createdAt),
}));

export type InventoryImportResult = typeof inventoryImportResults.$inferSelect;

/**
 * 既有草稿的一键发布任务。任务只保存创建时的ID上界和时间快照，
 * worker按主键游标分批处理，避免把数十万条ID一次性装入Web进程内存。
 */
export const inventoryPublishJobs = mysqlTable("inventory_publish_jobs", {
  id: varchar("id", { length: 36 }).primaryKey(),
  enterpriseId: int("enterpriseId").notNull(),
  activeEnterpriseId: int("activeEnterpriseId"),
  dataOwnerUserId: int("dataOwnerUserId").notNull(),
  createdByUserId: int("createdByUserId").notNull(),
  scopeOwnerUserId: int("scopeOwnerUserId"),
  clientRequestId: varchar("clientRequestId", { length: 64 }).notNull(),
  status: mysqlEnum("status", [
    "queued",
    "running",
    "paused",
    "completed",
    "failed",
    "cancelled",
  ]).default("queued").notNull(),
  totalRows: int("totalRows").notNull(),
  processedRows: int("processedRows").default(0).notNull(),
  successRows: int("successRows").default(0).notNull(),
  errorRows: int("errorRows").default(0).notNull(),
  duplicateRows: int("duplicateRows").default(0).notNull(),
  skippedRows: int("skippedRows").default(0).notNull(),
  lastInventoryId: int("lastInventoryId").default(0).notNull(),
  maxInventoryId: int("maxInventoryId").notNull(),
  leaseOwner: varchar("leaseOwner", { length: 96 }),
  leaseExpiresAt: timestamp("leaseExpiresAt"),
  heartbeatAt: timestamp("heartbeatAt"),
  attemptCount: int("attemptCount").default(0).notNull(),
  errorMessage: varchar("errorMessage", { length: 255 }),
  startedAt: timestamp("startedAt"),
  finishedAt: timestamp("finishedAt"),
  createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
}, table => ({
  activeEnterpriseUnique: uniqueIndex("inventory_publish_jobs_active_enterprise_unique").on(
    table.activeEnterpriseId,
  ),
  enterpriseRequestUnique: uniqueIndex("inventory_publish_jobs_enterprise_request_unique").on(
    table.enterpriseId,
    table.clientRequestId,
  ),
  enterpriseCreatedIdx: index("inventory_publish_jobs_enterprise_created_idx").on(
    table.enterpriseId,
    table.createdAt,
  ),
  statusCreatedIdx: index("inventory_publish_jobs_status_created_idx").on(
    table.status,
    table.createdAt,
  ),
  leaseIdx: index("inventory_publish_jobs_lease_idx").on(table.status, table.leaseExpiresAt),
}));

export type InventoryPublishJob = typeof inventoryPublishJobs.$inferSelect;
export type InsertInventoryPublishJob = typeof inventoryPublishJobs.$inferInsert;

/** 逐条发布失败明细；成功项不复制，正式库存行本身即为成功凭据。 */
export const inventoryPublishJobErrors = mysqlTable("inventory_publish_job_errors", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  jobId: varchar("jobId", { length: 36 }).notNull(),
  inventoryId: int("inventoryId").notNull(),
  partNumber: varchar("partNumber", { length: 128 }).notNull(),
  errorCode: varchar("errorCode", { length: 64 }).notNull(),
  errorMessage: varchar("errorMessage", { length: 255 }).notNull(),
  createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
}, table => ({
  jobInventoryUnique: uniqueIndex("inventory_publish_job_errors_job_inventory_unique").on(
    table.jobId,
    table.inventoryId,
  ),
  jobCreatedIdx: index("inventory_publish_job_errors_job_created_idx").on(
    table.jobId,
    table.createdAt,
  ),
}));

export type InventoryPublishJobError = typeof inventoryPublishJobErrors.$inferSelect;
/** 库存负责人变更的不可变审计日志。 */
export const inventoryAssignmentLogs = mysqlTable(
  "inventory_assignment_logs",
  {
    id: int("id").autoincrement().primaryKey(),
    inventoryId: int("inventoryId").notNull(),
    enterpriseId: int("enterpriseId").notNull(),
    previousOwnerUserId: int("previousOwnerUserId"),
    nextOwnerUserId: int("nextOwnerUserId").notNull(),
    actorUserId: int("actorUserId"),
    reason: varchar("reason", { length: 255 }).notNull(),
    batchId: varchar("batchId", { length: 64 }),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    inventoryCreatedIdx: index("inventory_assignment_logs_inventory_created_idx").on(
      table.inventoryId,
      table.createdAt,
    ),
    enterpriseCreatedIdx: index("inventory_assignment_logs_enterprise_created_idx").on(
      table.enterpriseId,
      table.createdAt,
    ),
    batchIdx: index("inventory_assignment_logs_batch_idx").on(table.batchId),
  }),
);

export type InventoryAssignmentLog = typeof inventoryAssignmentLogs.$inferSelect;
export type InsertInventoryAssignmentLog = typeof inventoryAssignmentLogs.$inferInsert;

/**
 * 购物车表：用户加购的库存商品（userId + inventoryId 唯一，重复加购合并数量）。
 */
export const cartItems = mysqlTable("cart_items", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  inventoryId: int("inventoryId").notNull(),
  /** 购买数量 */
  qty: int("qty").notNull(),
  /** 是否勾选参与结算 */
  checked: boolean("checked").default(true).notNull(),
  createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
});

export type CartItem = typeof cartItems.$inferSelect;
export type InsertCartItem = typeof cartItems.$inferInsert;

/**
 * 结算会话：把“本次结算哪些购物车条目”固定下来，避免结算页展示后继续依赖
 * 容易被其他页面或设备改变的全局 checked 状态。token 同时作为提交幂等键。
 */
export const checkoutSessions = mysqlTable(
  "checkout_sessions",
  {
    id: int("id").autoincrement().primaryKey(),
    token: varchar("token", { length: 64 }).notNull(),
    buyerId: int("buyerId").notNull(),
    items: json("items")
      .$type<Array<{
        cartItemId: number;
        inventoryId: number;
        qty: number;
        inventoryFingerprint: string;
      }>>()
      .notNull(),
    status: mysqlEnum("status", ["prepared", "processing", "completed", "failed"])
      .default("prepared")
      .notNull(),
    /** 首次提交时固化；同一 token 不允许更换支付方式、地址、配送或备注。 */
    requestHash: varchar("requestHash", { length: 64 }),
    payMethod: mysqlEnum("payMethod", ["corp", "alipay", "wechat"]),
    /** 成功响应快照：客户端网络重试时返回原订单，不重复扣库存。 */
    response: json("response").$type<Record<string, unknown>>(),
    failureMessage: varchar("failureMessage", { length: 255 }),
    expiresAt: beijingTime("expiresAt").notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    tokenUnique: uniqueIndex("checkout_sessions_token_unique").on(table.token),
    buyerStatusIdx: index("checkout_sessions_buyer_status_idx").on(
      table.buyerId,
      table.status,
      table.expiresAt,
    ),
  }),
);

export type CheckoutSession = typeof checkoutSessions.$inferSelect;
export type InsertCheckoutSession = typeof checkoutSessions.$inferInsert;

/**
 * 收货地址表：用户的收货地址（支持默认地址）。
 */
export const addresses = mysqlTable("addresses", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  /** 收货人 */
  receiver: varchar("receiver", { length: 64 }).notNull(),
  /** 手机号 */
  phone: varchar("phone", { length: 20 }).notNull(),
  /** 所在地区（省市区） */
  region: varchar("region", { length: 128 }).notNull(),
  /** 县级行政区划代码（GB/T 2260，历史地址可为空） */
  regionCode: varchar("regionCode", { length: 12 }),
  /** 详细地址 */
  detail: varchar("detail", { length: 255 }).notNull(),
  /** 用户自定义地址标签；历史地址为空 */
  label: varchar("label", { length: 20 }),
  /** 是否默认地址 */
  isDefault: boolean("isDefault").default(false).notNull(),
  createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
});

export type Address = typeof addresses.$inferSelect;
export type InsertAddress = typeof addresses.$inferInsert;

/** 发票抬头类型：增值税专用发票 / 增值税普通发票 / 个人发票。 */
export const INVOICE_TITLE_TYPES = ["special", "normal", "personal"] as const;
export type InvoiceTitleType = (typeof INVOICE_TITLE_TYPES)[number];

/** 网站与小程序共用的发票抬头资料。 */
export const invoiceTitles = mysqlTable(
  "invoice_titles",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    type: varchar("type", { length: 16 }).$type<InvoiceTitleType>().notNull(),
    title: varchar("title", { length: 128 }).notNull(),
    taxNumber: varchar("taxNumber", { length: 32 }),
    registeredAddress: varchar("registeredAddress", { length: 255 }),
    registeredPhone: varchar("registeredPhone", { length: 32 }),
    bankName: varchar("bankName", { length: 128 }),
    bankAccount: varchar("bankAccount", { length: 64 }),
    email: varchar("email", { length: 320 }),
    isDefault: boolean("isDefault").default(false).notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    userIdx: index("invoice_titles_user_id_idx").on(table.userId),
    userDefaultIdx: index("invoice_titles_user_default_idx").on(table.userId, table.isDefault),
  }),
);

export type InvoiceTitle = typeof invoiceTitles.$inferSelect;
export type InsertInvoiceTitle = typeof invoiceTitles.$inferInsert;

/** 订单状态：待付款 / 待发货 / 已发货 / 已完成 / 退款售后中 / 已取消 / 已退款 */
export const ORDER_STATUSES = [
  "pending",
  "paid",
  "shipped",
  "done",
  "refund",
  "cancel",
  /**
   * 退款完成的终态。
   *
   * 必须与 refund（退款申请中）区分：两者共用一个状态会导致订单停在
   * refund 后没有出口，既无法判断是等审核还是已退完，财务也无法按状态对账。
   * 生产曾因此产生长期卡单（DZ20260814-36981 等）。
   *
   * 新增值追加在枚举末尾，MySQL 可用 INSTANT 方式在线变更，无需重建表。
   */
  "refunded",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * 订单表：按卖家拆单（一个供应商一张订单）。
 * 金额均为下单时快照，字符串小数（decimal）。
 */
export const orders = mysqlTable("orders", {
  id: int("id").autoincrement().primaryKey(),
  /** 订单号：DZ + YYYYMMDD + "-" + 5位随机 */
  orderNo: varchar("orderNo", { length: 32 }).notNull().unique(),
  /** 买家用户 ID */
  buyerId: int("buyerId").notNull(),
  /** 卖家用户 ID（库存归属供应商） */
  sellerId: int("sellerId").notNull(),
  /** 卖家名称快照（企业名或用户名） */
  sellerName: varchar("sellerName", { length: 128 }).notNull(),
  /** 下单时负责该库存的企业员工；卖家交易主体仍由 sellerId 表示。 */
  handlerUserId: int("handlerUserId"),
  /** 经办人姓名快照，员工离职或改名不改变历史订单。 */
  handlerNameSnapshot: varchar("handlerNameSnapshot", { length: 128 }),
  status: mysqlEnum("status", ORDER_STATUSES).default("pending").notNull(),
  /**
   * 商品金额的**未税部分**，由含税货款作价内税拆分得出（含税额 / 1.13）。
   *
   * 全站价格口径为含税价，此字段与 taxAmount 仅用于订单详情、
   * 出库单的税额栏与开具增值税专票，恒有 amountEx + taxAmount = 含税货款。
   */
  amountEx: decimal("amountEx", { precision: 14, scale: 2 }).notNull(),
  /** 增值税（13%，价内税）= 含税货款 - amountEx */
  taxAmount: decimal("taxAmount", { precision: 14, scale: 2 }).notNull(),
  /** 运费（按**含税**货款判定：满 ¥500 免运费，未满 ¥15） */
  shippingFee: decimal("shippingFee", { precision: 14, scale: 2 }).notNull(),
  /** 应付总额 = 含税货款 + 运费（= amountEx + taxAmount + shippingFee） */
  totalAmount: decimal("totalAmount", { precision: 14, scale: 2 }).notNull(),
  /** 付款方式：corp 对公转账 / alipay 支付宝 / wechat 微信支付 */
  payMethod: mysqlEnum("payMethod", ["corp", "alipay", "wechat"])
    .default("corp")
    .notNull(),
  /** 配送方式：express 快递配送 / pickup 上门自提；历史订单默认快递 */
  deliveryMethod: mysqlEnum("deliveryMethod", ["express", "pickup"])
    .default("express")
    .notNull(),
  /** 历史订单使用全局配送；新订单按卖家子订单固化配送方案。 */
  deliveryPlanMode: mysqlEnum("deliveryPlanMode", ["legacy_global", "seller_split"])
    .default("legacy_global")
    .notNull(),
  /** 订单备注 */
  note: varchar("note", { length: 255 }),
  /** 快递订单保存收货信息；自提订单保存提货人信息与自提点地址。 */
  receiver: varchar("receiver", { length: 64 }).notNull(),
  receiverPhone: varchar("receiverPhone", { length: 20 }).notNull(),
  receiverAddress: varchar("receiverAddress", { length: 400 }).notNull(),
  /** 下单时固化的自提点信息；快递订单保持 NULL。 */
  pickupPointId: int("pickupPointId"),
  pickupPointName: varchar("pickupPointName", { length: 128 }),
  pickupAddress: varchar("pickupAddress", { length: 400 }),
  pickupContact: varchar("pickupContact", { length: 64 }),
  pickupPhone: varchar("pickupPhone", { length: 20 }),
  pickupBusinessHours: varchar("pickupBusinessHours", { length: 128 }),
  /** 卖家完成备货、买家完成提货的可审计时间。 */
  pickupReadyAt: timestamp("pickupReadyAt"),
  pickedUpAt: timestamp("pickedUpAt"),
  /** 快递公司（发货后填写） */
  expressCo: varchar("expressCo", { length: 64 }),
  /** 快递单号 */
  expressNo: varchar("expressNo", { length: 64 }),
  /** 取消/退款说明 */
  statusNote: varchar("statusNote", { length: 255 }),
  /**
   * 买家声明「我已转账」的时间（仅对公转账使用）。
   *
   * 对公转账的待付款订单受超时自动关单约束，但一旦买家声明已转账，
   * 款项可能已在路上（订单号已作为转账附言交给买家），
   * 此时**绝对不能再自动关单**：否则钱按该订单号打来而订单已不存在，
   * 只能人工查账退款，买家会认为平台收钱不发货。
   *
   * 为何用字段而不新增订单状态：新增状态会波及所有按状态分支的代码
   * （前台订单中心、后台订单管理、出库管理、统计口径），
   * 后台刚因状态映射缺 refunded 一个值而整页白屏。子状态用字段表达风险小得多。
   */
  transferDeclaredAt: timestamp("transferDeclaredAt"),
  /** 买家选填的转账凭证（转账日期、付款账户后 4 位等），供收款卖家核销比对 */
  transferNote: varchar("transferNote", { length: 255 }),
  /** 新订单由卖家直收；platform_legacy 仅用于保留历史订单付款责任 */
  corpPayeeMode: mysqlEnum("corpPayeeMode", ["platform_legacy", "seller_direct"])
    .default("platform_legacy")
    .notNull(),
  /** 下单时固化的收款企业与银行账户快照 */
  payeeCompanyId: int("payeeCompanyId"),
  payeeAccountName: varchar("payeeAccountName", { length: 128 }),
  payeeAccountNumber: varchar("payeeAccountNumber", { length: 64 }),
  payeeBankName: varchar("payeeBankName", { length: 128 }),
  payeeReviewedAt: timestamp("payeeReviewedAt"),
  /** 付款时间 */
  paidAt: timestamp("paidAt"),
  /** 发货时间 */
  shippedAt: timestamp("shippedAt"),
  /** 完成时间 */
  doneAt: timestamp("doneAt"),
  createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
});

export type Order = typeof orders.$inferSelect;
export type InsertOrder = typeof orders.$inferInsert;

/**
 * 订单合同快照与归档记录。
 *
 * 一张卖家子订单只对应一份合同。甲乙方身份和收款信息在下单时固化，
 * 首次生成 PDF 后再写入私有对象存储 key 与 SHA-256，后续下载不重新套用新模板。
 */
export const orderContractRecords = mysqlTable(
  "order_contract_records",
  {
    id: int("id").autoincrement().primaryKey(),
    orderId: int("orderId").notNull(),
    contractNo: varchar("contractNo", { length: 64 }).notNull(),
    templateVersion: varchar("templateVersion", { length: 32 }).notNull(),
    buyerName: varchar("buyerName", { length: 128 }).notNull(),
    buyerCreditCode: varchar("buyerCreditCode", { length: 32 }),
    buyerAddress: varchar("buyerAddress", { length: 255 }),
    buyerLegalPerson: varchar("buyerLegalPerson", { length: 64 }),
    sellerName: varchar("sellerName", { length: 128 }).notNull(),
    sellerCreditCode: varchar("sellerCreditCode", { length: 32 }),
    sellerAddress: varchar("sellerAddress", { length: 255 }),
    sellerLegalPerson: varchar("sellerLegalPerson", { length: 64 }),
    payeeAccountName: varchar("payeeAccountName", { length: 128 }),
    payeeAccountNumber: varchar("payeeAccountNumber", { length: 64 }),
    payeeBankName: varchar("payeeBankName", { length: 128 }),
    pdfStorageKey: varchar("pdfStorageKey", { length: 512 }),
    pdfSha256: varchar("pdfSha256", { length: 64 }),
    pdfByteSize: int("pdfByteSize"),
    generatedAt: timestamp("generatedAt"),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    orderUnique: uniqueIndex("order_contract_records_order_id_unique").on(table.orderId),
    contractNoUnique: uniqueIndex("order_contract_records_contract_no_unique").on(table.contractNo),
  }),
);

export type OrderContractRecord = typeof orderContractRecords.$inferSelect;
export type InsertOrderContractRecord = typeof orderContractRecords.$inferInsert;

/** 合同下载审计：记录买卖双方何时通过哪个账号取得了哪份不可变合同。 */
export const orderContractDownloads = mysqlTable(
  "order_contract_downloads",
  {
    id: int("id").autoincrement().primaryKey(),
    orderId: int("orderId").notNull(),
    contractRecordId: int("contractRecordId").notNull(),
    userId: int("userId").notNull(),
    actorRole: mysqlEnum("actorRole", ["buyer", "seller"]).notNull(),
    ip: varchar("ip", { length: 64 }),
    userAgent: varchar("userAgent", { length: 512 }),
    downloadedAt: timestamp("downloadedAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    orderTimeIdx: index("order_contract_downloads_order_time_idx").on(
      table.orderId,
      table.downloadedAt,
    ),
    userTimeIdx: index("order_contract_downloads_user_time_idx").on(
      table.userId,
      table.downloadedAt,
    ),
  }),
);

export type OrderContractDownload = typeof orderContractDownloads.$inferSelect;
export type InsertOrderContractDownload = typeof orderContractDownloads.$inferInsert;

/**
 * 物流轨迹缓存表。
 *
 * 快递100 官方要求同一运单查询间隔不低于半小时（否则会锁单），且计费上
 * 同一自然月内同一运单多次查询只收一次费用。因此必须把查询结果落库，
 * 由本表同时承担「最小查询间隔」与「终态永久缓存」两项职责。
 *
 * 以 (expressCode, expressNo) 而非 orderId 作为唯一键：同一运单可能对应多个
 * 订单（合并发货），按运单缓存可让它们共享同一次查询结果。
 */
export const logisticsSnapshots = mysqlTable(
  "logistics_snapshots",
  {
    id: int("id").autoincrement().primaryKey(),
    /** 快递100 编码，全小写 */
    expressCode: varchar("expressCode", { length: 32 }).notNull(),
    /** 运单号 */
    expressNo: varchar("expressNo", { length: 64 }).notNull(),
    /** 基础物流状态：0 在途 / 1 揽收 / 3 签收 等 */
    state: varchar("state", { length: 8 }).notNull(),
    /** 轨迹 JSON，时间倒序，直接透传给前端渲染 */
    traces: text("traces").notNull(),
    /** 预计到达时间，仅部分快递公司支持 */
    arrivalTime: varchar("arrivalTime", { length: 32 }),
    /** 当前所在城市 */
    currentCity: varchar("currentCity", { length: 64 }),
    /** 最近一次成功查询时间，用于判断是否已过最小间隔 */
    queriedAt: timestamp("queriedAt").default(DEFAULT_NOW).notNull(),
    /** 最近一次查询失败信息，便于排查但不影响缓存展示 */
    lastError: varchar("lastError", { length: 255 }),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    waybillUnique: uniqueIndex("logistics_snapshots_waybill_unique").on(
      table.expressCode,
      table.expressNo,
    ),
    queriedAtIdx: index("logistics_snapshots_queried_at_idx").on(table.queriedAt),
  }),
);
export type LogisticsSnapshot = typeof logisticsSnapshots.$inferSelect;
export type InsertLogisticsSnapshot = typeof logisticsSnapshots.$inferInsert;

/**
 * 面单 OCR 识别记录表。
 *
 * 存在的理由不是为了展示，而是为了**避免重复扣费**：
 * 快递100 面单 OCR 是实时扣费产品，同一张图反复识别会重复消耗额度。
 * 以图片内容的 SHA-256 为唯一键，命中时直接返回已有结果。
 *
 * 同时也保留了对账轨迹：taskId 是快递100 的任务编号，
 * 当计费数量与预期不符时可据此比对。
 */
export const waybillOcrRecords = mysqlTable(
  "waybill_ocr_records",
  {
    id: int("id").autoincrement().primaryKey(),
    /** 图片内容 SHA-256，用于同图去重 */
    imageHash: varchar("imageHash", { length: 64 }).notNull(),
    /** 识别出的运单号 */
    waybill: varchar("waybill", { length: 64 }).notNull(),
    /**
     * 推断的快递公司编码。
     * OCR 接口不返回快递公司，这里存的是本地规则推断的结果，
     * 可能为空（无法推断时）。
     */
    expressCode: varchar("expressCode", { length: 32 }),
    /** 完整识别结果 JSON，包含收寄件人、条码等 */
    payload: text("payload").notNull(),
    /** 快递100 任务 ID，对账用 */
    taskId: varchar("taskId", { length: 64 }),
    /** 发起识别的用户 ID，用于责任追溯与频率约束 */
    userId: int("userId"),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    imageHashUnique: uniqueIndex("waybill_ocr_records_image_hash_unique").on(
      table.imageHash,
    ),
    createdAtIdx: index("waybill_ocr_records_created_at_idx").on(table.createdAt),
    userIdIdx: index("waybill_ocr_records_user_id_idx").on(table.userId),
  }),
);
export type WaybillOcrRecord = typeof waybillOcrRecords.$inferSelect;
export type InsertWaybillOcrRecord = typeof waybillOcrRecords.$inferInsert;

/**
 * 订单商品项表：下单时的商品快照。
 */
export const orderItems = mysqlTable("order_items", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId").notNull(),
  inventoryId: int("inventoryId").notNull(),
  /** 型号快照 */
  partNumber: varchar("partNumber", { length: 128 }).notNull(),
  brand: varchar("brand", { length: 64 }).notNull(),
  pkg: varchar("pkg", { length: 32 }),
  prodYear: varchar("prodYear", { length: 16 }),
  /** 参数/备注快照 */
  params: varchar("params", { length: 255 }),
  /** 计量单位（默认"颗"） */
  unit: varchar("unit", { length: 8 }).default("颗").notNull(),
  qty: int("qty").notNull(),
  /** 成交**含税**单价（按阶梯价）。全站价格口径统一为含税价 */
  unitPrice: decimal("unitPrice", { precision: 12, scale: 4 }).notNull(),
  /** 小计（**含税**）= 含税单价 × 数量 */
  subtotal: decimal("subtotal", { precision: 14, scale: 2 }).notNull(),
  createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
});

export type OrderItem = typeof orderItems.$inferSelect;
export type InsertOrderItem = typeof orderItems.$inferInsert;

/**
 * 物流/状态轨迹表：订单的物流轨迹与状态变更记录。
 */
export const orderTracks = mysqlTable("order_tracks", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId").notNull(),
  /** 轨迹内容 */
  content: varchar("content", { length: 255 }).notNull(),
  createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
});

export type OrderTrack = typeof orderTracks.$inferSelect;
export type InsertOrderTrack = typeof orderTracks.$inferInsert;

/** 支付批次状态：一次结算可关联多张按供应商拆分的订单。 */
export const PAYMENT_BATCH_STATUSES = [
  "creating",
  "waiting",
  "paid",
  "closing",
  "closed",
  "failed",
  "manual_review",
] as const;
export type PaymentBatchStatus = (typeof PAYMENT_BATCH_STATUSES)[number];

/**
 * 支付批次：保存支付宝预创建二维码、金额与状态；应用私钥和证书绝不入库。
 * 一个 paymentNo 对应支付宝唯一 out_trade_no，并可关联多张拆分订单。
 */
export const paymentBatches = mysqlTable(
  "payment_batches",
  {
    id: int("id").autoincrement().primaryKey(),
    paymentNo: varchar("paymentNo", { length: 64 }).notNull(),
    buyerId: int("buyerId").notNull(),
    provider: mysqlEnum("provider", ["alipay", "wechat"]).default("alipay").notNull(),
    /**
     * 微信交易类型在建单时固化：Native 与 JSAPI 的 AppID、通知及查单结果
     * 必须按各自类型校验，绝不因当前两个 AppID 恰好相同而互相放行。
     * 保持可空仅为兼容已上线的历史批次；新建微信批次必须写入。
     */
    wechatTradeType: mysqlEnum("wechatTradeType", ["NATIVE", "JSAPI"]),
    /** 当前仍为平台商户；二级商户开通后按卖家生成独立支付批次 */
    routingMode: mysqlEnum("routingMode", ["platform_legacy", "sub_merchant"])
      .default("platform_legacy")
      .notNull(),
    sellerId: int("sellerId"),
    subMerchantId: varchar("subMerchantId", { length: 64 }),
    status: mysqlEnum("status", PAYMENT_BATCH_STATUSES).default("creating").notNull(),
    amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).default("CNY").notNull(),
    /** 支付宝返回的二维码码串，由前端本地渲染；最长 1024 字符。 */
    qrCode: text("qrCode"),
    /** 支付宝交易号；支付成功后写入。 */
    providerTradeNo: varchar("providerTradeNo", { length: 64 }),
    providerStatus: varchar("providerStatus", { length: 32 }),
    /** 最近一次通知 ID，仅用于审计；业务幂等以批次状态和交易号共同保证。 */
    notifyId: varchar("notifyId", { length: 128 }),
    /** 绝对到期时刻；使用 DATETIME 避免 MySQL 首个 TIMESTAMP 的隐式 ON UPDATE。 */
    expiresAt: datetime("expiresAt").notNull(),
    lastQueryAt: timestamp("lastQueryAt"),
    paidAt: timestamp("paidAt"),
    closedAt: timestamp("closedAt"),
    failureCode: varchar("failureCode", { length: 64 }),
    failureMessage: varchar("failureMessage", { length: 255 }),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    paymentNoUnique: uniqueIndex("payment_batches_payment_no_unique").on(table.paymentNo),
    providerTradeNoUnique: uniqueIndex("payment_batches_provider_trade_no_unique").on(
      table.providerTradeNo,
    ),
    buyerStatusIdx: index("payment_batches_buyer_status_idx").on(table.buyerId, table.status),
    expiresAtIdx: index("payment_batches_expires_at_idx").on(table.expiresAt),
  }),
);

export type PaymentBatch = typeof paymentBatches.$inferSelect;
export type InsertPaymentBatch = typeof paymentBatches.$inferInsert;

/** 支付批次与拆分订单的关联；一张订单最多属于一个支付批次。 */
export const paymentBatchOrders = mysqlTable(
  "payment_batch_orders",
  {
    id: int("id").autoincrement().primaryKey(),
    paymentBatchId: int("paymentBatchId").notNull(),
    orderId: int("orderId").notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    orderUnique: uniqueIndex("payment_batch_orders_order_unique").on(table.orderId),
    batchOrderUnique: uniqueIndex("payment_batch_orders_batch_order_unique").on(
      table.paymentBatchId,
      table.orderId,
    ),
    batchIdx: index("payment_batch_orders_batch_idx").on(table.paymentBatchId),
  }),
);

export type PaymentBatchOrder = typeof paymentBatchOrders.$inferSelect;
export type InsertPaymentBatchOrder = typeof paymentBatchOrders.$inferInsert;

// ─── 退款 / 售后模块 ───

/**
 * 退款单状态机。
 *
 * orders.status 只有笼统的 refund（"退款/售后"），无法表达退款进行到哪一步，
 * 因此细粒度状态放在退款单上；订单列表仍显示原有标签，买卖双方看到的状态不变。
 *
 * 流转路径：
 *   requested ──（未发货且满 24h 自动 / 卖家点"通过售后"）──→ approved
 *   requested ──（已发货，卖家同意退货）──────────────────→ awaiting_return
 *   requested ──（卖家驳回）──────────────────────────────→ rejected
 *   awaiting_return ──（退货运单签收）─────────────────────→ approved
 *   approved ──（微信/支付宝，网关受理）──────────────────→ processing
 *   approved ──（对公转账，无自动退款能力）────────────────→ pending_offline
 *   processing ──（渠道确认成功）─────────────────────────→ succeeded
 *   processing ──（渠道失败，重试耗尽）───────────────────→ failed
 *   pending_offline ──（财务线下打款后人工标记）───────────→ succeeded
 *   failed ──（人工介入）───────────────────────────────→ manual_review
 */
export const REFUND_STATUSES = [
  "requested",
  "awaiting_return",
  "approved",
  "processing",
  "succeeded",
  "failed",
  "rejected",
  "pending_offline",
  "manual_review",
] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

/** 退款单终态：不再自动流转，Worker 应跳过。 */
export const REFUND_FINAL_STATUSES: readonly RefundStatus[] = [
  "succeeded",
  "rejected",
  "manual_review",
];

/**
 * 退款单：一张订单同时最多一笔进行中的退款。
 *
 * 金额一律由服务端计算后落库，绝不接受前端传入，否则买家可篡改退款金额。
 * goodsAmount / shippingFee 分开记录，便于财务对账核对运费策略是否正确执行。
 *
 * 关于 orderItemId / refundQty：
 * 当前业务以整单退款为主（生产 28 张订单中 27 张仅含 1 个商品项），
 * 因此这两个字段允许为空，为空即表示整单退款。预留字段是为了将来 BOM 配单
 * 多料号订单出现"只退其中一项"的需求时，无需变更已承载真实资金的表结构，
 * 只需补充前端交互与入参即可。
 */
export const orderRefunds = mysqlTable(
  "order_refunds",
  {
    id: int("id").autoincrement().primaryKey(),
    /**
     * 退款单号，同时作为微信 out_refund_no。
     * 这是防重复退款的最后一道保险：同一 out_refund_no 重复提交，
     * 渠道侧不会二次退款，只会返回原退款单结果。
     */
    refundNo: varchar("refundNo", { length: 64 }).notNull(),
    orderId: int("orderId").notNull(),
    /** 冗余买卖双方 id，便于按人查询退款记录而无需回表 orders。 */
    buyerId: int("buyerId").notNull(),
    sellerId: int("sellerId").notNull(),
    status: mysqlEnum("status", REFUND_STATUSES).default("requested").notNull(),
    /** 申请时订单所处状态，用于驳回时把订单还原回去。 */
    orderStatusBefore: mysqlEnum("orderStatusBefore", ORDER_STATUSES).notNull(),
    /** 申请时订单是否已发货，决定运费是否退还，落库避免事后重新判断出现偏差。 */
    shippedWhenRequested: boolean("shippedWhenRequested").default(false).notNull(),
    /** 买家填写的售后原因 */
    reason: varchar("reason", { length: 200 }).notNull(),
    /** 实退总额 = goodsAmount + shippingFee */
    refundAmount: decimal("refundAmount", { precision: 14, scale: 2 }).notNull(),
    /** 退还的货款（含税部分按比例摊入） */
    goodsAmount: decimal("goodsAmount", { precision: 14, scale: 2 }).notNull(),
    /** 退还的运费：未发货为订单运费，已发货为 0（运费已由承运商收取） */
    shippingFee: decimal("shippingFee", { precision: 14, scale: 2 }).default("0.00").notNull(),
    /** 预留：部分退款时指向具体商品项；为空表示整单退款 */
    orderItemId: int("orderItemId"),
    /** 预留：部分退款时的退货数量；为空表示整单退款 */
    refundQty: int("refundQty"),
    /** 付款方式快照：corp 走线下打款，wechat/alipay 走渠道退款 */
    payMethod: mysqlEnum("payMethod", ["corp", "alipay", "wechat"]).notNull(),
    /** 关联支付批次；对公转账为空 */
    paymentBatchId: int("paymentBatchId"),
    /** 渠道返回的退款单号，用于对账与查询 */
    providerRefundId: varchar("providerRefundId", { length: 64 }),
    providerStatus: varchar("providerStatus", { length: 32 }),
    /** 买家寄回商品的退货运单（已发货场景），卖家发货运单在 orders.expressNo */
    returnExpressCo: varchar("returnExpressCo", { length: 64 }),
    returnExpressNo: varchar("returnExpressNo", { length: 64 }),
    /** 退货物流最近一次状态，3 表示已签收 */
    returnLogisticsState: varchar("returnLogisticsState", { length: 8 }),
    /** 卖家确认退货已验收入库的时间；已发货退款只有该字段存在时才回补库存 */
    returnReceivedAt: timestamp("returnReceivedAt"),
    /**
     * 未发货订单自动通过退款的时刻（申请时间 + 24h）。
     * 使用 DATETIME 而非 TIMESTAMP，避免 MySQL 首个 TIMESTAMP 列的隐式 ON UPDATE。
     */
    autoApproveAt: datetime("autoApproveAt"),
    /** 批准人：卖家点"通过售后"记其 userId；系统自动通过为空 */
    approvedBy: int("approvedBy"),
    approvedAt: timestamp("approvedAt"),
    /** 卖家驳回理由 */
    rejectReason: varchar("rejectReason", { length: 200 }),
    /** 渠道调用重试次数，超过上限转 manual_review 等人工处理 */
    attemptCount: int("attemptCount").default(0).notNull(),
    lastAttemptAt: timestamp("lastAttemptAt"),
    lastError: varchar("lastError", { length: 255 }),
    /**
     * 库存是否已回补。退款可能因渠道异常重试多次，
     * 没有这个标记会导致每次重试都回补一遍，造成在售库存虚增。
     */
    stockRestored: boolean("stockRestored").default(false).notNull(),
    /** 线下打款经办人（对公转账场景），记录管理端操作者 */
    offlineOperator: varchar("offlineOperator", { length: 64 }),
    /**
     * 线下汇款凭据（银行流水号/回单号）。
     *
     * 对公转账退款没有渠道退款单号，若只记经办人，日后买家称未收到款、
     * 或财务对账时无法追溯到具体银行流水，这笔钱在账务上就是说不清的糊涂账。
     * 故确认打款时强制录入。
     */
    offlineVoucherNo: varchar("offlineVoucherNo", { length: 64 }),
    /** 线下打款确认时间（人工登记时刻） */
    offlinePaidAt: timestamp("offlinePaidAt"),
    succeededAt: timestamp("succeededAt"),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    refundNoUnique: uniqueIndex("order_refunds_refund_no_unique").on(table.refundNo),
    /**
     * 一张订单只允许一笔退款单。若允许多笔，买家可以并发申请多次，
     * 每笔都通过渠道退款校验，累加后退出超过实付金额的钱。
     */
    orderUnique: uniqueIndex("order_refunds_order_unique").on(table.orderId),
    /** Worker 扫描 requested + autoApproveAt 到期、approved 待执行都走这个索引 */
    statusAutoApproveIdx: index("order_refunds_status_auto_approve_idx").on(
      table.status,
      table.autoApproveAt,
    ),
    buyerIdx: index("order_refunds_buyer_idx").on(table.buyerId, table.status),
    sellerIdx: index("order_refunds_seller_idx").on(table.sellerId, table.status),
    paymentBatchIdx: index("order_refunds_payment_batch_idx").on(table.paymentBatchId),
  }),
);

export type OrderRefund = typeof orderRefunds.$inferSelect;
export type InsertOrderRefund = typeof orderRefunds.$inferInsert;

// ─── Chat / IM 模块 ───

/**
 * 会话表：买卖双方一对一会话。user1Id < user2Id 保证唯一性。
 */
export const conversations = mysqlTable(
  "conversations",
  {
    id: int("id").autoincrement().primaryKey(),
    user1Id: int("user1Id").notNull(),
    user2Id: int("user2Id").notNull(),
    /** 冻结的参与方经营身份；NULL 只表示个人/未知的历史身份。 */
    user1EnterpriseId: int("user1EnterpriseId"),
    user2EnterpriseId: int("user2EnterpriseId"),
    user1CompanyId: int("user1CompanyId"),
    user2CompanyId: int("user2CompanyId"),
    user1CompanyNameSnapshot: varchar("user1CompanyNameSnapshot", { length: 255 }),
    user2CompanyNameSnapshot: varchar("user2CompanyNameSnapshot", { length: 255 }),
    /** 非空的身份元组键；legacy 保留给发布前个人/系统历史。 */
    identityContextKey: varchar("identityContextKey", { length: 160 }).default("legacy").notNull(),
    /** 当前会话轮次；结束后首次新消息自动进入下一轮 */
    currentRound: int("currentRound").default(1).notNull(),
    /** 当前轮次开始时间；用于展示与审计 */
    roundStartedAt: timestamp("roundStartedAt").default(DEFAULT_NOW).notNull(),
    /** 当前轮次首条消息 ID；NULL 表示存量首轮从现有消息起计算 */
    roundStartMessageId: int("roundStartMessageId"),
    /** 当前轮次结束时间；有新消息时自动清空并开始下一轮 */
    endedAt: timestamp("endedAt"),
    /** 主动结束当前轮次的用户 */
    endedByUserId: int("endedByUserId"),
    lastMessageAt: timestamp("lastMessageAt").default(DEFAULT_NOW).notNull(),
    lastMessagePreview: varchar("lastMessagePreview", { length: 200 }),
    /** 客服会话对应的后台消息模块会话编号（message_threads.threadNo） */
    adminThreadNo: varchar("adminThreadNo", { length: 32 }),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    userPairIdentityUnique: uniqueIndex("conversations_user_pair_identity_unique").on(
      table.user1Id,
      table.user2Id,
      table.identityContextKey,
    ),
    user1IdentityIdx: index("conversations_user1_identity_idx").on(
      table.user1Id,
      table.user1EnterpriseId,
      table.user1CompanyId,
    ),
    user2IdentityIdx: index("conversations_user2_identity_idx").on(
      table.user2Id,
      table.user2EnterpriseId,
      table.user2CompanyId,
    ),
  }),
);

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = typeof conversations.$inferInsert;

/**
 * 历史个人会话到双方确认后的冻结身份会话的状态记录。
 * 本模型以 v23 正式库 information_schema 的字段、主键和索引为准；
 * 它不执行对历史消息、会话或身份的回填。
 */
export const chatConversationIdentityTransitions = mysqlTable(
  "chat_conversation_identity_transitions",
  {
    id: int("id").autoincrement().primaryKey(),
    legacyConversationId: int("legacyConversationId").notNull(),
    initiatorUserId: int("initiatorUserId").notNull(),
    initiatorIdentityKey: varchar("initiatorIdentityKey", { length: 191 }).notNull(),
    initiatorEnterpriseId: int("initiatorEnterpriseId"),
    initiatorCompanyId: int("initiatorCompanyId"),
    initiatorCompanyName: varchar("initiatorCompanyName", { length: 255 }),
    recipientUserId: int("recipientUserId").notNull(),
    recipientConfirmedIdentityKey: varchar("recipientConfirmedIdentityKey", { length: 191 }),
    recipientConfirmedEnterpriseId: int("recipientConfirmedEnterpriseId"),
    recipientConfirmedCompanyId: int("recipientConfirmedCompanyId"),
    recipientConfirmedCompanyName: varchar("recipientConfirmedCompanyName", { length: 255 }),
    pendingConversationId: int("pendingConversationId").notNull(),
    finalConversationId: int("finalConversationId"),
    status: mysqlEnum("status", ["pending", "locked"]).default("pending").notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestampWithServerOnUpdate("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    legacyInitiatorIdentityUnique: uniqueIndex("chat_identity_transition_legacy_initiator_identity_uq").on(
      table.legacyConversationId,
      table.initiatorUserId,
      table.initiatorIdentityKey,
    ),
    pendingConversationUnique: uniqueIndex("chat_identity_transition_pending_conversation_uq").on(
      table.pendingConversationId,
    ),
    finalConversationIdx: index("chat_identity_transition_final_conversation_idx").on(
      table.finalConversationId,
    ),
  }),
);

export type ChatConversationIdentityTransition = typeof chatConversationIdentityTransitions.$inferSelect;
export type InsertChatConversationIdentityTransition = typeof chatConversationIdentityTransitions.$inferInsert;

/**
 * 会话屏蔽关系。屏蔽后双方均不能继续发送新消息；解除屏蔽只能由发起方操作。
 */
export const chatUserBlocks = mysqlTable(
  "chat_user_blocks",
  {
    id: int("id").autoincrement().primaryKey(),
    blockerUserId: int("blockerUserId").notNull(),
    blockedUserId: int("blockedUserId").notNull(),
    conversationId: int("conversationId").notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    blockerBlockedUnique: uniqueIndex("chat_user_blocks_blocker_blocked_unique").on(
      table.blockerUserId,
      table.blockedUserId,
    ),
    conversationIdx: index("chat_user_blocks_conversation_idx").on(table.conversationId),
    blockedUserIdx: index("chat_user_blocks_blocked_user_idx").on(table.blockedUserId),
  }),
);

export type ChatUserBlock = typeof chatUserBlocks.$inferSelect;
export type InsertChatUserBlock = typeof chatUserBlocks.$inferInsert;

/** 联系人资料页举报记录：保留会话、双方与举报原因，供后台审计处理。 */
export const chatUserReports = mysqlTable(
  "chat_user_reports",
  {
    id: int("id").autoincrement().primaryKey(),
    reporterUserId: int("reporterUserId").notNull(),
    reportedUserId: int("reportedUserId").notNull(),
    conversationId: int("conversationId").notNull(),
    reason: varchar("reason", { length: 32 }).notNull(),
    detail: varchar("detail", { length: 300 }),
    /** 对应管理后台消息中心的线程编号；跨库关联必须使用稳定编号。 */
    adminThreadNo: varchar("adminThreadNo", { length: 32 }),
    status: mysqlEnum("status", ["pending", "reviewed", "closed"])
      .default("pending")
      .notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    reporterConversationIdx: index("chat_user_reports_reporter_conversation_idx").on(
      table.reporterUserId,
      table.conversationId,
      table.createdAt,
    ),
    statusCreatedIdx: index("chat_user_reports_status_created_idx").on(
      table.status,
      table.createdAt,
    ),
    adminThreadUnique: uniqueIndex("chat_user_reports_admin_thread_unique").on(
      table.adminThreadNo,
    ),
  }),
);

export type ChatUserReport = typeof chatUserReports.$inferSelect;
export type InsertChatUserReport = typeof chatUserReports.$inferInsert;

/**
 * 会话轮次归档表：每次主动结束会话时写入一条，记录该轮的消息量与参与人数。
 *
 * 评价资格依据此表判定，避免用户靠单方面刷消息获得评价权。
 */
export const conversationRounds = mysqlTable(
  "conversation_rounds",
  {
    id: int("id").autoincrement().primaryKey(),
    conversationId: int("conversationId").notNull(),
    roundNo: int("roundNo").notNull(),
    startedAt: datetime("startedAt", { mode: "date" }).notNull(),
    /** 该轮首条消息 ID；NULL 表示存量首轮从现有消息起计算 */
    startMessageId: int("startMessageId"),
    endedAt: datetime("endedAt", { mode: "date" }).notNull(),
    endedByUserId: int("endedByUserId").notNull(),
    /** 该轮双方（不含客服）消息总数，用于评价资格判定 */
    participantMessageCount: int("participantMessageCount").default(0).notNull(),
    /** 该轮不同发送者数量，需 >= 2 才算双方真实交流 */
    distinctSenderCount: int("distinctSenderCount").default(0).notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    conversationRoundUnique: uniqueIndex("conversation_rounds_conversation_round_unique").on(
      table.conversationId,
      table.roundNo,
    ),
    conversationEndedIdx: index("conversation_rounds_conversation_ended_idx").on(
      table.conversationId,
      table.endedAt,
    ),
  }),
);

export type ConversationRound = typeof conversationRounds.$inferSelect;
export type InsertConversationRound = typeof conversationRounds.$inferInsert;

/**
 * 会话评价表：双方按轮次互评 1—5 星，用于商户信誉与搜索排名。
 *
 * counted 为 false 表示该评价因短期重复（同一对用户 7 天内）不计入权重，
 * 但仍保留记录以便审计与展示。
 */
export const conversationRatings = mysqlTable(
  "conversation_ratings",
  {
    id: int("id").autoincrement().primaryKey(),
    conversationId: int("conversationId").notNull(),
    roundNo: int("roundNo").notNull(),
    raterUserId: int("raterUserId").notNull(),
    ratedUserId: int("ratedUserId").notNull(),
    stars: int("stars").notNull(),
    /** 是否计入商户信誉与搜索排名；7 天内重复评价同一商户不计入 */
    counted: boolean("counted").default(true).notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    roundRaterUnique: uniqueIndex("conversation_ratings_round_rater_unique").on(
      table.conversationId,
      table.roundNo,
      table.raterUserId,
    ),
    countedRatedCreatedIdx: index("conversation_ratings_counted_rated_created_idx").on(
      table.counted,
      table.ratedUserId,
      table.createdAt,
    ),
    raterRatedCreatedIdx: index("conversation_ratings_rater_rated_created_idx").on(
      table.raterUserId,
      table.ratedUserId,
      table.createdAt,
    ),
  }),
);

export type ConversationRating = typeof conversationRatings.$inferSelect;
export type InsertConversationRating = typeof conversationRatings.$inferInsert;

/**
 * B2B 实名公开评价。
 *
 * 同一评价企业可因多次交易对同一企业发布多条独立主评论；每条主评论均可由
 * 被评价企业公开回复一次，回复后评价企业可追加一次。评价不打星、不生成综合评分，也不参与搜索排名。
 */
export const publicCompanyReviews = mysqlTable(
  "public_company_reviews",
  {
    id: int("id").autoincrement().primaryKey(),
    /** 从聊天页发布时记录会话；从企业主页直接发布时为空，不创建无消息会话。 */
    conversationId: int("conversationId"),
    /** 同一发布账号的一次提交幂等键；网络超时重试不得生成重复评论与通知。 */
    clientRequestId: varchar("clientRequestId", { length: 64 }),
    /** 目标、会话、正文及规范化图片的摘要；同一请求键不得替换内容或附件。 */
    requestPayloadHash: varchar("requestPayloadHash", { length: 64 }),
    raterUserId: int("raterUserId").notNull(),
    ratedUserId: int("ratedUserId").notNull(),
    /** 发布时的企业全称快照，保证历史评价实名可追溯。 */
    raterCompanyName: varchar("raterCompanyName", { length: 128 }).notNull(),
    content: text("content").notNull(),
    replyContent: text("replyContent"),
    repliedByUserId: int("repliedByUserId"),
    repliedAt: datetime("repliedAt", { mode: "date" }),
    followUpContent: text("followUpContent"),
    followedUpAt: datetime("followedUpAt", { mode: "date" }),
    /** 保留历史修订号；多次主评论各自独立，删除后不覆盖旧记录。 */
    revision: int("revision").default(1).notNull(),
    status: mysqlEnum("status", ["published", "user_deleted", "platform_hidden"]).default("published").notNull(),
    /** 历史兼容字段；不再用于限制企业之间只能存在一条有效评论。 */
    activeSlot: int("activeSlot").generatedAlwaysAs(
      sql`CASE WHEN status IN ('published','platform_hidden') THEN 1 ELSE NULL END`,
      { mode: "stored" },
    ),
    deletedByUserId: int("deletedByUserId"),
    deletedAt: datetime("deletedAt", { mode: "date" }),
    hiddenReason: varchar("hiddenReason", { length: 255 }),
    hiddenByAdminId: int("hiddenByAdminId"),
    hiddenByAdminName: varchar("hiddenByAdminName", { length: 128 }),
    hiddenAt: datetime("hiddenAt", { mode: "date" }),
    restoredByAdminId: int("restoredByAdminId"),
    restoredByAdminName: varchar("restoredByAdminName", { length: 128 }),
    restoredAt: datetime("restoredAt", { mode: "date" }),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    raterRequestUnique: uniqueIndex("public_company_reviews_rater_request_unique").on(
      table.raterUserId,
      table.clientRequestId,
    ),
    /** 同名非唯一兼容索引可阻止旧版迁移在回滚时重新施加“仅一条评论”约束。 */
    legacyCurrentCompatIdx: index("public_company_reviews_rater_rated_current_unique").on(
      table.raterUserId,
      table.ratedUserId,
      table.activeSlot,
    ),
    raterRatedCreatedIdx: index("public_company_reviews_rater_rated_created_idx").on(
      table.raterUserId,
      table.ratedUserId,
      table.createdAt,
    ),
    ratedStatusCreatedIdx: index("public_company_reviews_rated_status_created_idx").on(
      table.ratedUserId,
      table.status,
      table.createdAt,
    ),
    conversationIdx: index("public_company_reviews_conversation_idx").on(
      table.conversationId,
      table.id,
    ),
  }),
);

export type PublicCompanyReview = typeof publicCompanyReviews.$inferSelect;
export type InsertPublicCompanyReview = typeof publicCompanyReviews.$inferInsert;

/**
 * 公司主页每日点赞。
 *
 * likeDate 固定按北京时间自然日写入；唯一索引从数据库层保证同一账号
 * 对同一公司每天最多产生一条点赞，累计点赞不参与搜索或推荐排名。
 */
export const companyDailyLikes = mysqlTable(
  "company_daily_likes",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    supplierId: int("supplierId").notNull(),
    likeDate: date("likeDate", { mode: "string" }).notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    userSupplierDateUnique: uniqueIndex("company_daily_likes_user_supplier_date_unique").on(
      table.userId,
      table.supplierId,
      table.likeDate,
    ),
    supplierCreatedIdx: index("company_daily_likes_supplier_created_idx").on(
      table.supplierId,
      table.createdAt,
    ),
  }),
);

export type CompanyDailyLike = typeof companyDailyLikes.$inferSelect;
export type InsertCompanyDailyLike = typeof companyDailyLikes.$inferInsert;

/** 公开评价图片；图片仅归属于主评价，最多三张。 */
export const publicCompanyReviewImages = mysqlTable(
  "public_company_review_images",
  {
    id: int("id").autoincrement().primaryKey(),
    reviewId: int("reviewId").notNull(),
    uploaderUserId: int("uploaderUserId").notNull(),
    storageKey: varchar("storageKey", { length: 512 }).notNull(),
    url: varchar("url", { length: 1024 }).notNull(),
    mimeType: varchar("mimeType", { length: 64 }).default("image/webp").notNull(),
    byteSize: int("byteSize").notNull(),
    sortOrder: int("sortOrder").default(0).notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    storageKeyUnique: uniqueIndex("public_company_review_images_storage_key_unique").on(table.storageKey),
    reviewSortIdx: index("public_company_review_images_review_sort_idx").on(
      table.reviewId,
      table.sortOrder,
      table.id,
    ),
  }),
);

export type PublicCompanyReviewImage = typeof publicCompanyReviewImages.$inferSelect;
export type InsertPublicCompanyReviewImage = typeof publicCompanyReviewImages.$inferInsert;

/** 企业评论活动事件。只有新主评价和追加评论会通知被评价企业。 */
export const publicCompanyReviewEvents = mysqlTable(
  "public_company_review_events",
  {
    id: int("id").autoincrement().primaryKey(),
    reviewId: int("reviewId").notNull(),
    /** 活动发生时冻结的评论方企业稳定账号。 */
    raterUserId: int("raterUserId").notNull(),
    /** 活动发生时冻结的被评方企业稳定账号。 */
    ratedUserId: int("ratedUserId").notNull(),
    eventType: mysqlEnum("eventType", ["created", "follow_up"]).notNull(),
    /** 历史回填事件为 false，只有上线后真实新活动才进入未读提醒。 */
    notifyEligible: boolean("notifyEligible").default(true).notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    reviewEventUnique: uniqueIndex("public_company_review_events_review_type_unique").on(
      table.reviewId,
      table.eventType,
    ),
    ratedEventIdx: index("public_company_review_events_rated_id_idx").on(
      table.ratedUserId,
      table.id,
    ),
  }),
);

export type PublicCompanyReviewEvent = typeof publicCompanyReviewEvents.$inferSelect;
export type InsertPublicCompanyReviewEvent = typeof publicCompanyReviewEvents.$inferInsert;

/** 企业评论逐用户、逐事件已读记录；只标记实际存在于事务快照中的事件。 */
export const publicCompanyReviewEventReads = mysqlTable(
  "public_company_review_event_reads",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    eventId: int("eventId").notNull(),
    readAt: timestamp("readAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    userEventUnique: uniqueIndex("public_company_review_event_reads_user_event_unique").on(
      table.userId,
      table.eventId,
    ),
    eventIdx: index("public_company_review_event_reads_event_idx").on(table.eventId),
  }),
);

export type PublicCompanyReviewEventRead = typeof publicCompanyReviewEventReads.$inferSelect;
export type InsertPublicCompanyReviewEventRead = typeof publicCompanyReviewEventReads.$inferInsert;

/**
 * 会话用户设置：每个用户对每个会话的个性化设置（置顶、分组、未读数、软删除）。
 */
export const conversationUserSettings = mysqlTable("conversation_user_settings", {
  id: int("id").autoincrement().primaryKey(),
  conversationId: int("conversationId").notNull(),
  userId: int("userId").notNull(),
  pinned: boolean("pinned").default(false).notNull(),
  /** 当前用户为该会话设置的联系人备注名，仅本人可见 */
  remarkName: varchar("remarkName", { length: 64 }),
  groupName: varchar("groupName", { length: 64 }),
  unreadCount: int("unreadCount").default(0).notNull(),
  deleted: boolean("deleted").default(false).notNull(),
  lastReadAt: timestamp("lastReadAt").default(DEFAULT_NOW).notNull(),
  /** 当前用户在该会话中已读到的最大消息 ID，用于对端显示逐消息已读/未读。 */
  lastReadMessageId: int("lastReadMessageId"),
  /** 当前用户已删除到的最大消息 ID；只影响本人历史，不删除对方消息。 */
  clearedBeforeMessageId: int("clearedBeforeMessageId"),
  createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).notNull(),
}, table => ({
  conversationUserUnique: uniqueIndex("conversation_user_settings_conversation_user_unique").on(
    table.conversationId,
    table.userId,
  ),
  userDeletedIdx: index("conversation_user_settings_user_deleted_idx").on(
    table.userId,
    table.deleted,
  ),
}));

export type ConversationUserSetting = typeof conversationUserSettings.$inferSelect;
export type InsertConversationUserSetting = typeof conversationUserSettings.$inferInsert;

/** 官方客服按企业 scope 的个人阅读、清空和隐藏状态。 */
export const accountSupportViewSettings = mysqlTable(
  "account_support_view_settings",
  {
    userId: int("userId").notNull(),
    scopeEnterpriseId: int("scopeEnterpriseId").notNull(),
    lastReadMessageId: int("lastReadMessageId").default(0).notNull(),
    deletedBeforeMessageId: int("deletedBeforeMessageId").default(0).notNull(),
    /** 仅在同一 scope 收到更新消息前隐藏。 */
    deleted: boolean("deleted").default(false).notNull(),
    lastReadAt: timestamp("lastReadAt").default(DEFAULT_NOW).notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestampWithServerOnUpdate("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    accountScopePrimary: primaryKey({
      name: "account_support_view_settings_pk",
      columns: [table.userId, table.scopeEnterpriseId],
    }),
    accountVisibilityIdx: index("account_support_view_settings_user_deleted_idx").on(
      table.userId,
      table.deleted,
      table.scopeEnterpriseId,
    ),
  }),
);

export type AccountSupportViewSetting = typeof accountSupportViewSettings.$inferSelect;
export type InsertAccountSupportViewSetting = typeof accountSupportViewSettings.$inferInsert;

export const CHAT_ATTACHMENT_KINDS = ["image", "file"] as const;
export type ChatAttachmentKind = (typeof CHAT_ATTACHMENT_KINDS)[number];

/**
 * 聊天附件元数据。实际文件只存在对象存储，消息 content 仅引用本表 id。
 * 下载前必须再次校验当前用户是否属于 conversationId 对应会话。
 */
export const chatAttachments = mysqlTable(
  "chat_attachments",
  {
    id: int("id").autoincrement().primaryKey(),
    conversationId: int("conversationId").notNull(),
    uploaderUserId: int("uploaderUserId").notNull(),
    kind: varchar("kind", { length: 16 }).$type<ChatAttachmentKind>().notNull(),
    storageKey: varchar("storageKey", { length: 512 }).notNull(),
    originalName: varchar("originalName", { length: 255 }).notNull(),
    mimeType: varchar("mimeType", { length: 128 }).notNull(),
    byteSize: int("byteSize").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    /** 官方客服附件只绑定一个服务端解析后的 A/B 或 general (0) scope。 */
    supportEnterpriseId: int("supportEnterpriseId"),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    storageKeyUnique: uniqueIndex("chat_attachments_storage_key_unique").on(table.storageKey),
    conversationIdx: index("chat_attachments_conversation_id_idx").on(table.conversationId, table.id),
    uploaderIdx: index("chat_attachments_uploader_user_id_idx").on(table.uploaderUserId, table.id),
    supportScopeIdx: index("chat_attachments_support_scope_idx").on(
      table.conversationId,
      table.supportEnterpriseId,
      table.id,
    ),
  }),
);

export type ChatAttachment = typeof chatAttachments.$inferSelect;
export type InsertChatAttachment = typeof chatAttachments.$inferInsert;

/**
 * 消息表：文本消息或报价单卡片消息。
 */
export const messages = mysqlTable(
  "messages",
  {
    id: int("id").autoincrement().primaryKey(),
    conversationId: int("conversationId").notNull(),
    senderId: int("senderId").notNull(),
    /** 发送时冻结的经营身份；系统/历史消息保持 NULL。 */
    senderEnterpriseId: int("senderEnterpriseId"),
    senderCompanyId: int("senderCompanyId"),
    senderCompanyNameSnapshot: varchar("senderCompanyNameSnapshot", { length: 255 }),
    /** 平台/后台投递目标；不得复用 senderCompanyNameSnapshot。 */
    recipientEnterpriseId: int("recipientEnterpriseId"),
    recipientCompanyId: int("recipientCompanyId"),
    recipientCompanyNameSnapshot: varchar("recipientCompanyNameSnapshot", { length: 255 }),
    /** 客服消息实际所属企业范围；现网为可空 INT，不推导或回填历史范围。 */
    supportScopeEnterpriseId: int("supportScopeEnterpriseId"),
    /** 新发送幂等键按冻结经营身份分域；历史记录显式保留 legacy。 */
    senderIdentityContextKey: varchar("senderIdentityContextKey", { length: 160 })
      .default("legacy")
      .notNull(),
    /** 浏览器生成的消息幂等键；存量与系统消息可为空。 */
    clientMessageId: varchar("clientMessageId", { length: 64 }),
    /**
     * text | quote | inquiry | greeting | transfer_notice | company_like
     *
     * 长度 16 已接近上限：transfer_notice 占 15 字符。
     * 新增类型名若超过 16，MySQL 非严格模式下会静默截断，
     * 前端就匹配不到卡片分支，直接把 JSON 原文展给用户。
     */
    msgType: varchar("msgType", { length: 16 }).notNull().default("text"),
    /** 文本内容或 JSON 报价单 */
    content: text("content").notNull(),
    /** 被引用的原消息；删除仅影响个人视图，撤回后引用摘要自动打码。 */
    replyToMessageId: int("replyToMessageId"),
    /** 撤回只打状态、不清除原文，保留业务审计能力。 */
    recalledAt: timestamp("recalledAt"),
    recalledByUserId: int("recalledByUserId"),
    /** 后台消息模块的消息 id（客服回复同步去重用） */
    adminMsgId: int("adminMsgId"),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    /** 同一冻结发送主体的 clientMessageId 唯一，拦住跨企业回放。 */
    senderClientMessageUnique: uniqueIndex("messages_sender_client_message_unique").on(
      table.senderId,
      table.senderIdentityContextKey,
      table.clientMessageId,
    ),
    conversationMessageIdx: index("messages_conversation_id_idx").on(
      table.conversationId,
      table.id,
    ),
    senderEnterpriseIdx: index("messages_sender_enterprise_idx").on(
      table.senderEnterpriseId,
      table.senderCompanyId,
      table.id,
    ),
    replyToMessageIdx: index("messages_reply_to_message_idx").on(table.replyToMessageId),
    /** 同一会话内后台消息 id 唯一，保证客服回复同步幂等。 */
    conversationAdminMessageUnique: uniqueIndex("messages_conversation_admin_message_unique").on(
      table.conversationId,
      table.adminMsgId,
    ),
  }),
);

export type Message = typeof messages.$inferSelect;
export type InsertMessage = typeof messages.$inferInsert;

export const accountSupportSourceThreads = mysqlTable(
  "account_support_source_threads",
  {
    sourceThreadNo: varchar("sourceThreadNo", { length: 32 }).primaryKey(),
    portalUserId: int("portalUserId").notNull(),
    canonicalConversationId: int("canonicalConversationId").notNull(),
    sourceThreadId: int("sourceThreadId"),
    sourceMerchantId: int("sourceMerchantId"),
    recipientEnterpriseId: int("recipientEnterpriseId"),
    recipientCompanyId: int("recipientCompanyId"),
    recipientCompanyNameSnapshot: varchar("recipientCompanyNameSnapshot", { length: 255 }),
    verification: mysqlEnum("verification", [
      "inquiry_card",
      "merchant_registration",
      "unknown",
      "outbound_frozen_sender",
    ]).notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    lastSeenAt: timestampWithServerOnUpdate("lastSeenAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    portalConversationIdx: index("account_support_source_threads_portal_conversation_idx").on(
      table.portalUserId,
      table.canonicalConversationId,
    ),
    recipientIdx: index("account_support_source_threads_recipient_idx").on(
      table.recipientEnterpriseId,
      table.recipientCompanyId,
    ),
    scopeSeenIdx: index("account_support_source_scope_seen_idx").on(
      table.portalUserId,
      table.recipientEnterpriseId,
      table.lastSeenAt,
    ),
  }),
);

export type AccountSupportSourceThread = typeof accountSupportSourceThreads.$inferSelect;
export type InsertAccountSupportSourceThread = typeof accountSupportSourceThreads.$inferInsert;

export const accountSupportOutboundThreads = mysqlTable(
  "account_support_outbound_threads",
  {
    portalUserId: int("portalUserId").notNull(),
    scopeEnterpriseId: int("scopeEnterpriseId").notNull(),
    threadNo: varchar("threadNo", { length: 32 }).notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestampWithServerOnUpdate("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    outboundThreadPrimary: primaryKey({
      name: "account_support_outbound_threads_pk",
      columns: [table.portalUserId, table.scopeEnterpriseId],
    }),
    threadIdx: index("account_support_outbound_thread_idx").on(table.threadNo),
  }),
);

export type AccountSupportOutboundThread = typeof accountSupportOutboundThreads.$inferSelect;
export type InsertAccountSupportOutboundThread = typeof accountSupportOutboundThreads.$inferInsert;

export const accountSupportDeliveryCursors = mysqlTable("account_support_delivery_cursors", {
  portalUserId: int("portalUserId").primaryKey(),
  lastAdminMessageId: int("lastAdminMessageId").default(0).notNull(),
  sweepAfterUserId: int("sweepAfterUserId").default(0).notNull(),
  sweepMaxUserId: int("sweepMaxUserId").default(0).notNull(),
  createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  updatedAt: timestampWithServerOnUpdate("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
});

export type AccountSupportDeliveryCursor = typeof accountSupportDeliveryCursors.$inferSelect;
export type InsertAccountSupportDeliveryCursor = typeof accountSupportDeliveryCursors.$inferInsert;

/**
 * 逐用户隐藏消息：删除操作只影响操作者本人，不改变对方视图或业务审计原文。
 */
export const chatMessageUserHidden = mysqlTable(
  "chat_message_user_hidden",
  {
    id: int("id").autoincrement().primaryKey(),
    messageId: int("messageId").notNull(),
    userId: int("userId").notNull(),
    hiddenAt: timestamp("hiddenAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    userMessageUnique: uniqueIndex("chat_message_user_hidden_user_message_unique").on(
      table.userId,
      table.messageId,
    ),
    messageUserIdx: index("chat_message_user_hidden_message_user_idx").on(
      table.messageId,
      table.userId,
    ),
  }),
);

export type ChatMessageUserHidden = typeof chatMessageUserHidden.$inferSelect;
export type InsertChatMessageUserHidden = typeof chatMessageUserHidden.$inferInsert;

export const INVENTORY_INQUIRY_STATUSES = ["open", "replied", "closed", "transferred"] as const;
export type InventoryInquiryStatus = (typeof INVENTORY_INQUIRY_STATUSES)[number];

/**
 * 库存询价业务单。聊天消息负责交流展示，本表负责企业归属、经办人、
 * 首响、转交与后续管理统计。
 */
export const inventoryInquiries = mysqlTable(
  "inventory_inquiries",
  {
    id: int("id").autoincrement().primaryKey(),
    inventoryId: int("inventoryId"),
    /** Distinct source identity. NULL inventoryId for factory sources prevents accidental ordinary joins. */
    sourceKind: varchar("sourceKind", { length: 32 }).default("inventory").notNull(),
    sourcePublicId: varchar("sourcePublicId", { length: 64 }),
    sourceRecordId: int("sourceRecordId"),
    responsibilityVersion: int("responsibilityVersion", { unsigned: true }),
    responsibilitySnapshot: varchar("responsibilitySnapshot", { length: 64 }),
    receptionAdminUserId: int("receptionAdminUserId"),
    receptionBindingVersion: int("receptionBindingVersion", { unsigned: true }),
    receptionKind: varchar("receptionKind", { length: 32 }),
    receptionBrand: varchar("receptionBrand", { length: 32 }),
    factorySourceSnapshot: json("factorySourceSnapshot").$type<{ sourceFactoryName: string; sourceLabel: string; brand: string; assigneeName: string }>(),
    enterpriseId: int("enterpriseId"),
    sellerUserId: int("sellerUserId").notNull(),
    buyerUserId: int("buyerUserId").notNull(),
    /** 买方经营身份在创建询价时冻结；历史行保持 NULL，不能按后来的企业选择猜测。 */
    buyerEnterpriseId: int("buyerEnterpriseId"),
    buyerCompanyId: int("buyerCompanyId"),
    buyerCompanyNameSnapshot: varchar("buyerCompanyNameSnapshot", { length: 255 }),
    /** 非空请求 scope；legacy 仅用于未迁移的历史记录。 */
    buyerIdentityContextKey: varchar("buyerIdentityContextKey", { length: 160 })
      .default("legacy")
      .notNull(),
    assigneeUserId: int("assigneeUserId").notNull(),
    conversationId: int("conversationId").notNull(),
    messageId: int("messageId").notNull(),
    /** 询价发生时的型号快照；库存之后改名也不得改变历史询价归类。 */
    partNumber: varchar("partNumber", { length: 128 }),
    /** NFKC + 去首尾空格 + 大写后的精确型号键，不做模糊合并。 */
    partNumberNormalized: varchar("partNumberNormalized", { length: 128 }),
    requestedQty: int("requestedQty").notNull(),
    source: mysqlEnum("source", ["search", "detail", "recommend", "quote", "data_hub", "company"]),
    clientMessageId: varchar("clientMessageId", { length: 64 }).notNull(),
    status: mysqlEnum("status", INVENTORY_INQUIRY_STATUSES).default("open").notNull(),
    firstResponseAt: timestamp("firstResponseAt"),
    lastActivityAt: timestamp("lastActivityAt").default(DEFAULT_NOW).notNull(),
    transferredFromUserId: int("transferredFromUserId"),
    closedAt: timestamp("closedAt"),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    buyerClientUnique: uniqueIndex("inventory_inquiries_buyer_client_unique").on(
      table.buyerIdentityContextKey,
      table.clientMessageId,
    ),
    assigneeStatusActivityIdx: index("inventory_inquiries_assignee_status_activity_idx").on(
      table.assigneeUserId,
      table.status,
      table.lastActivityAt,
    ),
    enterpriseStatusActivityIdx: index("inventory_inquiries_enterprise_status_activity_idx").on(
      table.enterpriseId,
      table.status,
      table.lastActivityAt,
    ),
    inventoryCreatedIdx: index("inventory_inquiries_inventory_created_idx").on(
      table.inventoryId,
      table.createdAt,
    ),
    buyerPartCreatedIdx: index("inventory_inquiries_buyer_part_created_idx").on(
      table.buyerUserId,
      table.partNumberNormalized,
      table.createdAt,
    ),
    buyerIdentityCreatedIdx: index("inventory_inquiries_buyer_identity_created_idx").on(
      table.buyerEnterpriseId,
      table.buyerCompanyId,
      table.createdAt,
    ),
    conversationStatusIdx: index("inventory_inquiries_conversation_status_idx").on(
      table.conversationId,
      table.status,
    ),
  }),
);

export type InventoryInquiry = typeof inventoryInquiries.$inferSelect;
export type InsertInventoryInquiry = typeof inventoryInquiries.$inferInsert;

/** 库存询价负责人变更的不可变审计日志；保留交接前后会话和消息引用。 */
export const inventoryInquiryAssignmentLogs = mysqlTable(
  "inventory_inquiry_assignment_logs",
  {
    id: int("id").autoincrement().primaryKey(),
    inquiryId: int("inquiryId").notNull(),
    enterpriseId: int("enterpriseId").notNull(),
    previousAssigneeUserId: int("previousAssigneeUserId").notNull(),
    nextAssigneeUserId: int("nextAssigneeUserId").notNull(),
    actorUserId: int("actorUserId").notNull(),
    previousConversationId: int("previousConversationId").notNull(),
    nextConversationId: int("nextConversationId").notNull(),
    previousMessageId: int("previousMessageId").notNull(),
    nextMessageId: int("nextMessageId").notNull(),
    reason: varchar("reason", { length: 255 }).notNull(),
    requestId: varchar("requestId", { length: 64 }).notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    inquiryRequestUnique: uniqueIndex("inventory_inquiry_assignment_inquiry_request_unique").on(
      table.inquiryId,
      table.requestId,
    ),
    enterpriseCreatedIdx: index("inventory_inquiry_assignment_enterprise_created_idx").on(
      table.enterpriseId,
      table.createdAt,
    ),
    requestIdx: index("inventory_inquiry_assignment_request_idx").on(table.requestId),
  }),
);

export type InventoryInquiryAssignmentLog = typeof inventoryInquiryAssignmentLogs.$inferSelect;
export type InsertInventoryInquiryAssignmentLog = typeof inventoryInquiryAssignmentLogs.$inferInsert;

/** 客服同步事件类型：前台推送与拉取后台回复。 */
export const CHAT_SYNC_EVENT_TYPES = [
  "push_service_message",
  "pull_service_replies",
] as const;
export type ChatSyncEventType = (typeof CHAT_SYNC_EVENT_TYPES)[number];

/** 同步任务状态：待投递 / 投递中 / 已完成 / 重试耗尽。 */
export const CHAT_SYNC_STATUSES = [
  "pending",
  "processing",
  "succeeded",
  "dead",
] as const;
export type ChatSyncStatus = (typeof CHAT_SYNC_STATUSES)[number];

/**
 * 客服消息同步发件箱（transactional outbox）。
 *
 * 前台与管理端的客服消息同步不在请求路径内完成，而是先落库成为任务，
 * 再由 chatSyncWorker 异步投递。这样管理端临时不可用时不会阻塞用户发消息，
 * 也不会因一次网络波动而丢消息。
 */
export const chatSyncOutbox = mysqlTable(
  "chat_sync_outbox",
  {
    id: int("id").autoincrement().primaryKey(),
    /** 幂等键，同一事件重复投递只会入库一次。 */
    eventKey: varchar("eventKey", { length: 96 }).notNull(),
    eventType: mysqlEnum("eventType", CHAT_SYNC_EVENT_TYPES).notNull(),
    conversationId: int("conversationId").notNull(),
    /** push 事件的待同步消息 id；pull 事件为空。 */
    messageId: int("messageId"),
    status: mysqlEnum("status", CHAT_SYNC_STATUSES).default("pending").notNull(),
    attempts: int("attempts").default(0).notNull(),
    /** 下次可投递时间，配合指数退避。 */
    availableAt: timestamp("availableAt").default(DEFAULT_NOW).notNull(),
    lockedAt: timestamp("lockedAt"),
    /** 租约持有者，格式 hostname:pid。 */
    lockedBy: varchar("lockedBy", { length: 64 }),
    lastError: varchar("lastError", { length: 1000 }),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    eventKeyUnique: uniqueIndex("chat_sync_outbox_event_key_unique").on(table.eventKey),
    dispatchIdx: index("chat_sync_outbox_dispatch_idx").on(
      table.status,
      table.availableAt,
      table.id,
    ),
    conversationEventIdx: index("chat_sync_outbox_conversation_event_idx").on(
      table.conversationId,
      table.eventType,
    ),
  }),
);

export type ChatSyncOutboxRow = typeof chatSyncOutbox.$inferSelect;
export type InsertChatSyncOutbox = typeof chatSyncOutbox.$inferInsert;

/**
 * 会话分组表：用户自定义的供应商分组。
 */
/**
 * 需求表：采购方发布的元器件采购需求（CRM 发布 → 导航栏需求中心展示）。
 * 状态：open 询价中 / closed 已关闭
 */
export const demands = mysqlTable("demands", {
  id: int("id").autoincrement().primaryKey(),
  /** 企业 CRM 数据所有者用户 ID；保留 userId 字段名兼容既有查询 */
  userId: int("userId").notNull(),
  /** 发布时企业主体快照；历史个人需求均为 NULL，公开查询据此确定性隐藏 */
  publisherCompanyId: int("publisherCompanyId"),
  publisherCompanyName: varchar("publisherCompanyName", { length: 128 }),
  publisherCreditCode: varchar("publisherCreditCode", { length: 32 }),
  /** 发布时注册辖区快照；旧内地需求保持 NULL 并按 CN 兼容读取。 */
  publisherRegistrationRegion: varchar("publisherRegistrationRegion", { length: 2 }),
  /** 香港发布时冻结 HK: 加 8 位 BRN；内地需求保持 NULL。 */
  publisherRegistrationIdentifier: varchar("publisherRegistrationIdentifier", { length: 64 }),
  /** 需求型号 */
  partNumber: varchar("partNumber", { length: 128 }).notNull(),
  /** 品牌 */
  brand: varchar("brand", { length: 64 }),
  /** 封装 */
  pkg: varchar("pkg", { length: 64 }),
  /** 品类：MCU/处理器、存储、被动件、功率器件、模组、模拟IC */
  category: varchar("category", { length: 32 }).notNull(),
  /** 需求数量 */
  qty: int("qty").notNull(),
  /** 数量单位：片/颗/只 */
  qtyUnit: varchar("qtyUnit", { length: 8 }).default("片").notNull(),
  /** 目标单价（元，null = 面议） */
  targetPrice: decimal("targetPrice", { precision: 12, scale: 4 }),
  /** 交期：3天内 / 1周内 / 2周内 */
  leadTime: varchar("leadTime", { length: 32 }).notNull(),
  /** 备注说明 */
  note: text("note"),
  /** 状态：open 询价中 / closed 已关闭 */
  status: mysqlEnum("status", ["open", "closed"]).default("open").notNull(),
  createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
});

export type Demand = typeof demands.$inferSelect;
export type InsertDemand = typeof demands.$inferInsert;

/**
 * 需求报价表：供应商对需求的报价（“我要报价”）。
 */
export const demandQuotes = mysqlTable("demand_quotes", {
  id: int("id").autoincrement().primaryKey(),
  /** 对应需求 */
  demandId: int("demandId").notNull(),
  /** 报价供应商用户 */
  supplierId: int("supplierId").notNull(),
  /** 报价单价（元） */
  price: decimal("price", { precision: 12, scale: 4 }).notNull(),
  /** 可供数量 */
  qtyAvailable: int("qtyAvailable").notNull(),
  /** 交期说明，如：现货当天发 / 3天内 */
  leadTime: varchar("leadTime", { length: 32 }),
  /** 报价备注 */
  note: text("note"),
  createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
});

export type DemandQuote = typeof demandQuotes.$inferSelect;
export type InsertDemandQuote = typeof demandQuotes.$inferInsert;
export const conversationGroups = mysqlTable("conversation_groups", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  /** 新分组容器只属于一个选定身份；历史记录保持 legacy。 */
  ownerIdentityContextKey: varchar("ownerIdentityContextKey", { length: 160 })
    .default("legacy")
    .notNull(),
  groupName: varchar("groupName", { length: 64 }).notNull(),
  /** manual 为用户新建；inquiry 为同型号达到两家供应商后自动创建。 */
  groupType: mysqlEnum("groupType", ["manual", "inquiry"]).default("manual").notNull(),
  /** 删除进入回收站；解散则会物理删除分组关系但保留会话和消息。 */
  status: mysqlEnum("status", ["active", "trashed"]).default("active").notNull(),
  autoAssign: boolean("autoAssign").default(false).notNull(),
  trashedAt: datetime("trashedAt", { mode: "date" }),
  createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
}, table => ({
  userStatusCreatedIdx: index("conversation_groups_user_status_created_idx").on(
    table.userId,
    table.status,
    table.createdAt,
  ),
  userIdentityStatusCreatedIdx: index("conversation_groups_user_identity_status_created_idx").on(
    table.userId,
    table.ownerIdentityContextKey,
    table.status,
    table.createdAt,
  ),
}));

export type ConversationGroup = typeof conversationGroups.$inferSelect;
export type InsertConversationGroup = typeof conversationGroups.$inferInsert;

/**
 * 企业接待分组的显式归属映射。历史 conversation_groups 仅包含个人 userId，
 * 因而绝不可由其推断或回填本表；只有企业接待端新建的分组才写入映射。
 */
export const businessChatGroups = mysqlTable(
  "business_chat_groups",
  {
    groupId: int("groupId").primaryKey(),
    enterpriseId: int("enterpriseId").notNull(),
    staffUserId: int("staffUserId").notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    groupEnterpriseStaffUnique: uniqueIndex("business_chat_groups_group_enterprise_staff_unique").on(
      table.groupId,
      table.enterpriseId,
      table.staffUserId,
    ),
    enterpriseStaffGroupIdx: index("business_chat_groups_enterprise_staff_idx").on(
      table.enterpriseId,
      table.staffUserId,
      table.groupId,
    ),
  }),
);
export type BusinessChatGroup = typeof businessChatGroups.$inferSelect;
export type InsertBusinessChatGroup = typeof businessChatGroups.$inferInsert;

/** 一个询价分组可绑定多个精确型号；分组合并后保留全部自动归类入口。 */
export const conversationGroupPartRules = mysqlTable(
  "conversation_group_part_rules",
  {
    id: int("id").autoincrement().primaryKey(),
    groupId: int("groupId").notNull(),
    userId: int("userId").notNull(),
    partNumber: varchar("partNumber", { length: 128 }).notNull(),
    partNumberNormalized: varchar("partNumberNormalized", { length: 128 }).notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    /** 每个用户的一个精确型号只能自动归入一个分组。 */
    userPartUnique: uniqueIndex("conversation_group_part_rules_user_part_unique").on(
      table.userId,
      table.partNumberNormalized,
    ),
    groupIdx: index("conversation_group_part_rules_group_idx").on(table.groupId, table.id),
  }),
);

export type ConversationGroupPartRule = typeof conversationGroupPartRules.$inferSelect;
export type InsertConversationGroupPartRule = typeof conversationGroupPartRules.$inferInsert;

/**
 * 分组与一对一会话的多对多关系。同一供应商会话可同时属于多个型号分组，
 * 但供应商之间仍彼此不可见，不会变成真正群聊。
 */
export const conversationGroupMembers = mysqlTable(
  "conversation_group_members",
  {
    id: int("id").autoincrement().primaryKey(),
    groupId: int("groupId").notNull(),
    userId: int("userId").notNull(),
    conversationId: int("conversationId").notNull(),
    source: mysqlEnum("source", ["manual", "inquiry_auto", "legacy"]).default("manual").notNull(),
    firstInquiryMessageId: int("firstInquiryMessageId"),
    lastInquiryMessageId: int("lastInquiryMessageId"),
    inquiryCount: int("inquiryCount").default(0).notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    groupConversationUnique: uniqueIndex("conversation_group_members_group_conversation_unique").on(
      table.groupId,
      table.conversationId,
    ),
    userConversationIdx: index("conversation_group_members_user_conversation_idx").on(
      table.userId,
      table.conversationId,
    ),
    groupIdx: index("conversation_group_members_group_idx").on(table.groupId, table.id),
  }),
);

export type ConversationGroupMember = typeof conversationGroupMembers.$inferSelect;
export type InsertConversationGroupMember = typeof conversationGroupMembers.$inferInsert;

/** CRM 入库单。数据按企业稳定owner归属。 */
export const inboundOrders = mysqlTable(
  "inbound_orders",
  {
    id: int("id").autoincrement().primaryKey(),
    slipNo: varchar("slipNo", { length: 32 }).notNull(),
    userId: int("userId").notNull(),
    partNumber: varchar("partNumber", { length: 128 }).notNull(),
    brand: varchar("brand", { length: 64 }),
    qty: int("qty").notNull(),
    /** 用户原始录入价；由 unitCostBasis 标记其含税/未税口径。 */
    unitCost: decimal("unitCost", { precision: 18, scale: 6 }),
    unitCostBasis: varchar("unitCostBasis", { length: 32 }),
    /** 用户确认的增值税率（百分比），历史记录为空，不做猜测。 */
    taxRate: decimal("taxRate", { precision: 5, scale: 2 }),
    /** 服务端按税率归一化后的双价格，后续无需重复推算。 */
    unitCostTaxIncluded: decimal("unitCostTaxIncluded", { precision: 18, scale: 6 }),
    unitCostTaxExcluded: decimal("unitCostTaxExcluded", { precision: 18, scale: 6 }),
    prodYear: varchar("prodYear", { length: 16 }),
    supplierName: varchar("supplierName", { length: 128 }),
    supplierContact: varchar("supplierContact", { length: 64 }),
    supplierPhone: varchar("supplierPhone", { length: 32 }),
    packageType: varchar("packageType", { length: 64 }),
    lotNumber: varchar("lotNumber", { length: 64 }),
    supplierOrderNo: varchar("supplierOrderNo", { length: 64 }),
    status: mysqlEnum("status", ["in_transit", "received", "cancelled"]).default("received").notNull(),
    inboundDate: date("inboundDate").notNull(),
    actualInboundDate: date("actualInboundDate"),
    actualQty: int("actualQty"),
    operator: varchar("operator", { length: 64 }),
    location: varchar("location", { length: 64 }),
    note: text("note"),
    receivedAt: beijingTime("receivedAt"),
    receivedByUserId: int("receivedByUserId"),
    cancelledAt: beijingTime("cancelledAt"),
    cancelledByUserId: int("cancelledByUserId"),
    cancelReason: varchar("cancelReason", { length: 255 }),
    writeVersion: int("writeVersion").default(1).notNull(),
    receiveRequestId: varchar("receiveRequestId", { length: 64 }),
    receivePayloadHash: varchar("receivePayloadHash", { length: 64 }),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
    /** 历史ERP物料编码兼容字段；已有生产数据必须原样保留。 */
    materialCode: varchar("materialCode", { length: 12 }),
    /** 企业私有入库实拍照片对象引用，不保存临时签名URL。 */
    photos: json("photos"),
    /** 非空表示该单已明确登记付款口径；历史单据保持为空，避免误判为未付款。 */
    paymentTrackedAt: beijingTime("paymentTrackedAt"),
    paymentTrackedByUserId: int("paymentTrackedByUserId"),
    /** Excel 批量入库的仓库地址；与仓位 location 分开保存。 */
    warehouseAddress: varchar("warehouseAddress", { length: 255 }),
    /** Excel 批量入库的采购地区；不复用仓库地址或仓位。 */
    procurementRegion: varchar("procurementRegion", { length: 128 }),
    /** 批量导入时采购价原单元格为空、经明确确认按 0 元录入的审计标记。 */
    priceMissing: boolean("priceMissing").default(false).notNull(),
    /** 批量请求账本 ID；历史和单笔录入保持为空。 */
    bulkBatchId: int("bulkBatchId"),
    /** Excel 中的原始行号，供批量导入审计和错误回溯。 */
    bulkSourceRow: int("bulkSourceRow"),
  },
  table => ({
    slipNoUnique: uniqueIndex("inbound_orders_slip_no_unique").on(table.slipNo),
    userCreatedAtIdx: index("inbound_orders_user_created_at_idx").on(table.userId, table.createdAt),
    userDateIdx: index("inbound_orders_user_date_idx").on(table.userId, table.inboundDate),
    userStatusCreatedIdx: index("inbound_orders_user_status_created_idx").on(table.userId, table.status, table.createdAt),
    bulkBatchSourceIdx: index("inbound_orders_bulk_batch_source_idx").on(table.bulkBatchId, table.bulkSourceRow),
  })
);

export type InboundOrder = typeof inboundOrders.$inferSelect;
export type InsertInboundOrder = typeof inboundOrders.$inferInsert;

/** 采购付款流水。金额只追加不覆盖；错误记录通过作废字段保留完整审计。 */
export const inboundPaymentEntries = mysqlTable(
  "inbound_payment_entries",
  {
    id: int("id").autoincrement().primaryKey(),
    inboundOrderId: int("inboundOrderId").notNull(),
    ownerUserId: int("ownerUserId").notNull(),
    actorUserId: int("actorUserId").notNull(),
    requestId: varchar("requestId", { length: 64 }).notNull(),
    payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
    amount: decimal("amount", { precision: 18, scale: 2 }).notNull(),
    paymentDate: date("paymentDate").notNull(),
    note: varchar("note", { length: 255 }),
    voidedAt: beijingTime("voidedAt"),
    voidedByUserId: int("voidedByUserId"),
    voidReason: varchar("voidReason", { length: 255 }),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    ownerRequestUnique: uniqueIndex("inbound_payment_entries_owner_request_unique").on(table.ownerUserId, table.requestId),
    orderDateIdIdx: index("inbound_payment_entries_order_date_id_idx").on(table.ownerUserId, table.inboundOrderId, table.paymentDate, table.id),
    ownerDateIdIdx: index("inbound_payment_entries_owner_date_id_idx").on(table.ownerUserId, table.paymentDate, table.id),
  }),
);

export type InboundPaymentEntry = typeof inboundPaymentEntries.$inferSelect;
export type InsertInboundPaymentEntry = typeof inboundPaymentEntries.$inferInsert;

/** 业务单号原子流水。入库单使用 scope=RK，按北京时间自然日全局递增。 */
export const businessSlipSequences = mysqlTable(
  "business_slip_sequences",
  {
    id: int("id").autoincrement().primaryKey(),
    scope: varchar("scope", { length: 16 }).notNull(),
    businessDate: date("businessDate").notNull(),
    currentValue: int("currentValue").default(0).notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    scopeDateUnique: uniqueIndex("business_slip_sequences_scope_date_unique").on(table.scope, table.businessDate),
  }),
);

/** 入库单生命周期审计。库存相关记录不物理删除。 */
export const inboundOrderEvents = mysqlTable(
  "inbound_order_events",
  {
    id: int("id").autoincrement().primaryKey(),
    inboundOrderId: int("inboundOrderId").notNull(),
    ownerUserId: int("ownerUserId").notNull(),
    actorUserId: int("actorUserId").notNull(),
    eventType: varchar("eventType", { length: 32 }).notNull(),
    reason: varchar("reason", { length: 255 }),
    snapshot: json("snapshot"),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    orderCreatedIdx: index("inbound_order_events_order_created_idx").on(table.inboundOrderId, table.createdAt),
    ownerCreatedIdx: index("inbound_order_events_owner_created_idx").on(table.ownerUserId, table.createdAt),
  }),
);

/** 入库创建请求幂等键，防止网络重试把同一业务单重复入账。 */
export const inboundRequestKeys = mysqlTable(
  "inbound_request_keys",
  {
    id: int("id").autoincrement().primaryKey(),
    ownerUserId: int("ownerUserId").notNull(),
    requestId: varchar("requestId", { length: 64 }).notNull(),
    payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
    inboundOrderId: int("inboundOrderId"),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    ownerRequestUnique: uniqueIndex("inbound_request_keys_owner_request_unique").on(table.ownerUserId, table.requestId),
  }),
);

/**
 * Excel 批量入库请求账本。唯一键在同一数据 owner 内序列化同一请求号，
 * result 保存首次提交的完整行号/单号映射，网络重试与并发双击只读取该结果。
 */
export const inboundBulkRequests = mysqlTable(
  "inbound_bulk_requests",
  {
    id: int("id").autoincrement().primaryKey(),
    ownerUserId: int("ownerUserId").notNull(),
    requestId: varchar("requestId", { length: 64 }).notNull(),
    payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
    actorUserId: int("actorUserId").notNull(),
    result: json("result"),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    ownerRequestUnique: uniqueIndex("inbound_bulk_requests_owner_request_unique").on(table.ownerUserId, table.requestId),
  }),
);

export type InboundBulkRequest = typeof inboundBulkRequests.$inferSelect;
export type InsertInboundBulkRequest = typeof inboundBulkRequests.$inferInsert;

/** 出库创建请求幂等键，防止网络重试生成两张出库单并重复扣库存。 */
export const outboundRequestKeys = mysqlTable(
  "outbound_request_keys",
  {
    id: int("id").autoincrement().primaryKey(),
    ownerUserId: int("ownerUserId").notNull(),
    requestId: varchar("requestId", { length: 64 }).notNull(),
    payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
    outboundOrderId: int("outboundOrderId"),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    ownerRequestUnique: uniqueIndex("outbound_request_keys_owner_request_unique").on(table.ownerUserId, table.requestId),
  }),
);

/** 每次实际入库对台账的不可变影响；作废时精确恢复入库前快照。 */
export const inboundLedgerEffects = mysqlTable(
  "inbound_ledger_effects",
  {
    id: int("id").autoincrement().primaryKey(),
    inboundOrderId: int("inboundOrderId").notNull(),
    ownerUserId: int("ownerUserId").notNull(),
    partNumber: varchar("partNumber", { length: 128 }).notNull(),
    qty: int("qty").notNull(),
    unitCost: decimal("unitCost", { precision: 18, scale: 6 }),
    unitCostBasis: varchar("unitCostBasis", { length: 32 }),
    beforeTotalQtyIn: int("beforeTotalQtyIn").notNull(),
    beforeCurrentQty: int("beforeCurrentQty").notNull(),
    beforeAvgCost: decimal("beforeAvgCost", { precision: 18, scale: 6 }),
    beforeCostBasis: varchar("beforeCostBasis", { length: 32 }),
    beforeMovementVersion: bigint("beforeMovementVersion", { mode: "number", unsigned: true }).notNull(),
    afterTotalQtyIn: int("afterTotalQtyIn").notNull(),
    afterCurrentQty: int("afterCurrentQty").notNull(),
    afterAvgCost: decimal("afterAvgCost", { precision: 18, scale: 6 }),
    afterCostBasis: varchar("afterCostBasis", { length: 32 }),
    afterMovementVersion: bigint("afterMovementVersion", { mode: "number", unsigned: true }).notNull(),
    reversedAt: beijingTime("reversedAt"),
    reversedByUserId: int("reversedByUserId"),
    reverseReason: varchar("reverseReason", { length: 255 }),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    orderUnique: uniqueIndex("inbound_ledger_effects_order_unique").on(table.inboundOrderId),
    ownerPartIdIdx: index("inbound_ledger_effects_owner_part_id_idx").on(table.ownerUserId, table.partNumber, table.id),
  }),
);

/** CRM 出库单。unitCost 保存出库时的加权平均成本，供利润看板计算。 */
export const outboundOrders = mysqlTable(
  "outbound_orders",
  {
    id: int("id").autoincrement().primaryKey(),
    slipNo: varchar("slipNo", { length: 32 }).notNull(),
    userId: int("userId").notNull(),
    partNumber: varchar("partNumber", { length: 128 }).notNull(),
    brand: varchar("brand", { length: 64 }),
    qty: int("qty").notNull(),
    unitPrice: decimal("unitPrice", { precision: 15, scale: 4 }),
    unitPriceBasis: varchar("unitPriceBasis", { length: 32 }),
    unitCost: decimal("unitCost", { precision: 18, scale: 6 }),
    unitCostBasis: varchar("unitCostBasis", { length: 32 }),
    prodYear: varchar("prodYear", { length: 16 }),
    salesName: varchar("salesName", { length: 64 }),
    customerName: varchar("customerName", { length: 128 }),
    customerContact: varchar("customerContact", { length: 64 }),
    customerPhone: varchar("customerPhone", { length: 32 }),
    outboundDate: date("outboundDate").notNull(),
    note: text("note"),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
    /** 历史ERP物料编码兼容字段；已有生产数据必须原样保留。 */
    materialCode: varchar("materialCode", { length: 12 }),
  },
  table => ({
    slipNoUnique: uniqueIndex("outbound_orders_slip_no_unique").on(table.slipNo),
    userCreatedAtIdx: index("outbound_orders_user_created_at_idx").on(table.userId, table.createdAt),
    userDateIdx: index("outbound_orders_user_date_idx").on(table.userId, table.outboundDate),
  })
);

export type OutboundOrder = typeof outboundOrders.$inferSelect;
export type InsertOutboundOrder = typeof outboundOrders.$inferInsert;

/** CRM 型号级库存台账，每个主账号的每个型号仅保留一条汇总记录。 */
export const stockLedger = mysqlTable(
  "stock_ledger",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    partNumber: varchar("partNumber", { length: 128 }).notNull(),
    brand: varchar("brand", { length: 64 }),
    totalQtyIn: int("totalQtyIn").default(0).notNull(),
    totalQtyOut: int("totalQtyOut").default(0).notNull(),
    currentQty: int("currentQty").default(0).notNull(),
    avgCost: decimal("avgCost", { precision: 18, scale: 6 }),
    costBasis: varchar("costBasis", { length: 32 }),
    movementVersion: bigint("movementVersion", { mode: "number", unsigned: true }).default(0).notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
    /** 历史ERP物料编码兼容字段；已有生产数据必须原样保留。 */
    materialCode: varchar("materialCode", { length: 12 }),
  },
  table => ({
    userPartUnique: uniqueIndex("stock_ledger_user_part_unique").on(table.userId, table.partNumber),
    userCurrentQtyIdx: index("stock_ledger_user_current_qty_idx").on(table.userId, table.currentQty),
    materialCodeIdx: index("stock_ledger_material_code_idx").on(table.materialCode),
  })
);

export type StockLedger = typeof stockLedger.$inferSelect;
export type InsertStockLedger = typeof stockLedger.$inferInsert;

/** 型号行情日快照：每天按型号聚合站内在售库存与成交数据。 */
export const marketSnapshots = mysqlTable(
  "market_snapshots",
  {
    id: int("id").autoincrement().primaryKey(),
    partNumber: varchar("partNumber", { length: 128 }).notNull(),
    brand: varchar("brand", { length: 64 }).notNull(),
    category: varchar("category", { length: 32 }).notNull(),
    pkg: varchar("pkg", { length: 32 }),
    snapshotDate: date("snapshotDate").notNull(),
    avgPrice: decimal("avgPrice", { precision: 15, scale: 4 }).notNull(),
    minPrice: decimal("minPrice", { precision: 15, scale: 4 }).notNull(),
    maxPrice: decimal("maxPrice", { precision: 15, scale: 4 }).notNull(),
    inventoryQty: int("inventoryQty").default(0).notNull(),
    avgLeadDays: int("avgLeadDays").default(0).notNull(),
    supplierCount: int("supplierCount").default(0).notNull(),
    dealCount: int("dealCount").default(0).notNull(),
    dealQty: int("dealQty").default(0).notNull(),
    generatedAt: timestamp("generatedAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    partDateUnique: uniqueIndex("market_snapshots_part_date_unique").on(table.partNumber, table.snapshotDate),
    snapshotDateIdx: index("market_snapshots_date_idx").on(table.snapshotDate),
    brandCategoryIdx: index("market_snapshots_brand_category_idx").on(table.brand, table.category),
  })
);

export type MarketSnapshot = typeof marketSnapshots.$inferSelect;
export type InsertMarketSnapshot = typeof marketSnapshots.$inferInsert;

export type MarketReportRankingRow = {
  rank: number;
  partNumber: string;
  brand: string;
  previousPrice?: number;
  currentPrice?: number;
  previousPriceRange?: string;
  currentPriceRange?: string;
  changePercent?: number;
};

export type MarketReportParagraphMark = "quote" | "key";
export type MarketReportParagraph =
  | string
  | {
      text: string;
      mark?: MarketReportParagraphMark;
    };

export type MarketReportSection = {
  heading: string;
  paragraphs: MarketReportParagraph[];
  rankingRows?: MarketReportRankingRow[];
  factRows?: Array<{
    label: string;
    value: string;
  }>;
};

export type MarketReportSource = {
  name: string;
  url: string;
};

/** 数据通行情研究文章；正文与来源均为结构化内容，便于列表与阅读弹窗复用。 */
export const marketReports = mysqlTable(
  "market_reports",
  {
    id: int("id").autoincrement().primaryKey(),
    slug: varchar("slug", { length: 128 }).notNull(),
    category: varchar("category", { length: 32 }).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    summary: text("summary").notNull(),
    coverTone: varchar("coverTone", { length: 32 }).default("blue").notNull(),
    coverImageUrl: varchar("coverImageUrl", { length: 1024 }),
    sections: json("sections").$type<MarketReportSection[]>().notNull(),
    sources: json("sources").$type<MarketReportSource[]>().notNull(),
    publishedAt: timestamp("publishedAt").notNull(),
    sortOrder: int("sortOrder").default(0).notNull(),
    status: mysqlEnum("status", ["draft", "published"]).default("draft").notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    slugUnique: uniqueIndex("market_reports_slug_unique").on(table.slug),
    statusPublishIdx: index("market_reports_status_publish_idx").on(table.status, table.publishedAt),
  })
);

export type MarketReport = typeof marketReports.$inferSelect;
export type InsertMarketReport = typeof marketReports.$inferInsert;

export type AppearanceComparisonItem = {
  label: string;
  reference: string;
  risk: string;
};

/** 数据通外观档案；仅用于收货初筛和包装追溯，不直接给出真伪鉴定结论。 */
export const appearanceArchives = mysqlTable(
  "appearance_archives",
  {
    id: int("id").autoincrement().primaryKey(),
    partNumber: varchar("partNumber", { length: 128 }).notNull(),
    brand: varchar("brand", { length: 96 }).notNull(),
    category: varchar("category", { length: 64 }).notNull(),
    pkg: varchar("pkg", { length: 32 }).notNull(),
    markingSummary: text("markingSummary").notNull(),
    packagingSummary: text("packagingSummary").notNull(),
    printSummary: text("printSummary").notNull(),
    featureTags: json("featureTags").$type<string[]>().notNull(),
    comparisonItems: json("comparisonItems").$type<AppearanceComparisonItem[]>().notNull(),
    officialLookupUrl: text("officialLookupUrl"),
    disclaimer: text("disclaimer").notNull(),
    sortOrder: int("sortOrder").default(0).notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    partNumberUnique: uniqueIndex("appearance_archives_part_number_unique").on(table.partNumber),
    brandCategoryIdx: index("appearance_archives_brand_category_idx").on(table.brand, table.category),
  })
);

export type AppearanceArchive = typeof appearanceArchives.$inferSelect;
export type InsertAppearanceArchive = typeof appearanceArchives.$inferInsert;

/** 登录用户的站内搜索行为，用于生成可解释的个性化推荐。 */
export const searchEvents = mysqlTable(
  "search_events",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    searchType: mysqlEnum("searchType", ["part", "company"])
      .default("part")
      .notNull(),
    keyword: varchar("keyword", { length: 128 }).notNull(),
    matchedPartNumber: varchar("matchedPartNumber", { length: 128 }),
    matchedBrand: varchar("matchedBrand", { length: 64 }),
    matchedCategory: varchar("matchedCategory", { length: 32 }),
    matchedSupplierId: int("matchedSupplierId"),
    searchedAt: timestamp("searchedAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    userDateIdx: index("search_events_user_date_idx").on(table.userId, table.searchedAt),
    keywordIdx: index("search_events_keyword_idx").on(table.keyword),
    userTypeDateIdx: index("search_events_user_type_date_idx").on(
      table.userId,
      table.searchType,
      table.searchedAt
    ),
    typeSupplierDateIdx: index("search_events_type_supplier_date_idx").on(
      table.searchType,
      table.matchedSupplierId,
      table.searchedAt
    ),
  })
);

export type SearchEvent = typeof searchEvents.$inferSelect;
export type InsertSearchEvent = typeof searchEvents.$inferInsert;

/**
 * 搜索热度原始事件：保存去重后的有效型号展示，供每日汇总、来源核对与防重使用。
 * 事件与半小时去重标识仅保存服务端 HMAC，不保存浏览器原值。
 */
export const searchHeatEvents = mysqlTable(
  "search_heat_events",
  {
    id: int("id").autoincrement().primaryKey(),
    eventIdHash: varchar("eventIdHash", { length: 64 }).notNull(),
    dedupeKey: varchar("dedupeKey", { length: 64 }).notNull(),
    partNumberNormalized: varchar("partNumberNormalized", { length: 128 }).notNull(),
    source: mysqlEnum("source", [
      "data_hub",
      "search_page",
      "search_suggest",
      "product_detail",
      "related_model",
      "recommendation",
      "demand_center",
      "company_inventory",
      "forum_material",
    ]).notNull(),
    channel: mysqlEnum("channel", ["web", "weapp"]).default("web").notNull(),
    occurredAt: timestamp("occurredAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    eventIdx: index("search_heat_events_event_idx").on(table.eventIdHash),
    dedupeUnique: uniqueIndex("search_heat_events_dedupe_unique").on(table.dedupeKey),
    partDateIdx: index("search_heat_events_part_date_idx").on(
      table.partNumberNormalized,
      table.occurredAt,
    ),
  }),
);

/**
 * 每日搜索热度快照。真实展示计数与模拟基础量分列保存，后期可通过环境开关
 * 完全移除基础量而不污染真实搜索历史。
 */
export const searchHeatDaily = mysqlTable(
  "search_heat_daily",
  {
    id: int("id").autoincrement().primaryKey(),
    partNumberNormalized: varchar("partNumberNormalized", { length: 128 }).notNull(),
    heatDate: varchar("heatDate", { length: 10 }).notNull(),
    actualCount: int("actualCount").default(0).notNull(),
    syntheticCount: int("syntheticCount").default(0).notNull(),
    finalizedAt: timestamp("finalizedAt"),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    partDateUnique: uniqueIndex("search_heat_daily_part_date_unique").on(
      table.partNumberNormalized,
      table.heatDate,
    ),
    dateIdx: index("search_heat_daily_date_idx").on(table.heatDate),
  }),
);

/** 每日渠道与展示场景明细：用于运营核验，前台走势图仍只读取每日总表。 */
export const searchHeatDailySources = mysqlTable(
  "search_heat_daily_sources",
  {
    id: int("id").autoincrement().primaryKey(),
    partNumberNormalized: varchar("partNumberNormalized", { length: 128 }).notNull(),
    heatDate: varchar("heatDate", { length: 10 }).notNull(),
    channel: mysqlEnum("channel", ["web", "weapp"]).notNull(),
    source: mysqlEnum("source", [
      "data_hub",
      "search_page",
      "search_suggest",
      "product_detail",
      "related_model",
      "recommendation",
      "demand_center",
      "company_inventory",
      "forum_material",
    ]).notNull(),
    actualCount: int("actualCount").default(0).notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    partDateChannelSourceUnique: uniqueIndex("search_heat_daily_sources_unique").on(
      table.partNumberNormalized,
      table.heatDate,
      table.channel,
      table.source,
    ),
    dateIdx: index("search_heat_daily_sources_date_idx").on(table.heatDate),
  }),
);

export type SearchHeatEvent = typeof searchHeatEvents.$inferSelect;
export type SearchHeatDaily = typeof searchHeatDaily.$inferSelect;
export type SearchHeatDailySource = typeof searchHeatDailySources.$inferSelect;

/**
 * 用户主动搜索事件：不同事件逐次累计，同一 eventId 的网络重试只记一次。
 * 主体与网络仅保存 HMAC，用于审计与防刷，不保存原始访客标识或 IP。
 */
export const popularSearchEvents = mysqlTable(
  "popular_search_events",
  {
    id: int("id").autoincrement().primaryKey(),
    eventIdHash: varchar("eventIdHash", { length: 64 }).notNull(),
    actorHash: varchar("actorHash", { length: 64 }).notNull(),
    networkHash: varchar("networkHash", { length: 64 }).notNull(),
    partNumberNormalized: varchar("partNumberNormalized", { length: 128 }).notNull(),
    source: mysqlEnum("source", ["home", "search_page", "data_hub", "demand_center"]).notNull(),
    channel: mysqlEnum("channel", ["web", "weapp"]).default("web").notNull(),
    /** NULL marks legacy events; new scores are persisted with their daily totals. */
    weightedScoreMilli: int("weightedScoreMilli"),
    occurredAt: timestamp("occurredAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    eventUnique: uniqueIndex("popular_search_events_event_unique").on(table.eventIdHash),
    partDateIdx: index("popular_search_events_part_date_idx").on(
      table.partNumberNormalized,
      table.occurredAt,
    ),
    actorDateIdx: index("popular_search_events_actor_date_idx").on(table.actorHash, table.occurredAt),
    networkPartDateActorIdx: index("popular_search_events_network_part_date_actor_idx").on(
      table.networkHash,
      table.partNumberNormalized,
      table.occurredAt,
      table.actorHash,
    ),
    occurredIdx: index("popular_search_events_occurred_idx").on(table.occurredAt),
  }),
);

/**
 * 同一匿名主体每天搜索同一型号的次数汇总。
 * 仅保存服务端 HMAC，用于递减计分和同网络异常集中访问降权，保留期与原始事件一致。
 */
export const popularSearchActorDaily = mysqlTable(
  "popular_search_actor_daily",
  {
    id: int("id").autoincrement().primaryKey(),
    partNumberNormalized: varchar("partNumberNormalized", { length: 128 }).notNull(),
    searchDate: varchar("searchDate", { length: 10 }).notNull(),
    actorHash: varchar("actorHash", { length: 64 }).notNull(),
    searchCount: int("searchCount").default(0).notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    partDateActorUnique: uniqueIndex("popular_search_actor_daily_part_date_actor_unique").on(
      table.partNumberNormalized,
      table.searchDate,
      table.actorHash,
    ),
    dateIdx: index("popular_search_actor_daily_date_idx").on(table.searchDate),
  }),
);

/** 同一网络、型号和匿名主体每天只保留一条去重关系。 */
export const popularSearchNetworkActorDaily = mysqlTable(
  "popular_search_network_actor_daily",
  {
    id: int("id").autoincrement().primaryKey(),
    partNumberNormalized: varchar("partNumberNormalized", { length: 128 }).notNull(),
    searchDate: varchar("searchDate", { length: 10 }).notNull(),
    networkHash: varchar("networkHash", { length: 64 }).notNull(),
    actorHash: varchar("actorHash", { length: 64 }).notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    partDateNetworkActorUnique: uniqueIndex("popular_search_network_actor_daily_unique").on(
      table.partNumberNormalized,
      table.searchDate,
      table.networkHash,
      table.actorHash,
    ),
    dateIdx: index("popular_search_network_actor_daily_date_idx").on(table.searchDate),
  }),
);

/** 同一网络每天搜索同一型号的去重主体数；由事务内原子递增保证阈值正确。 */
export const popularSearchNetworkDaily = mysqlTable(
  "popular_search_network_daily",
  {
    id: int("id").autoincrement().primaryKey(),
    partNumberNormalized: varchar("partNumberNormalized", { length: 128 }).notNull(),
    searchDate: varchar("searchDate", { length: 10 }).notNull(),
    networkHash: varchar("networkHash", { length: 64 }).notNull(),
    distinctActorCount: int("distinctActorCount").default(0).notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    partDateNetworkUnique: uniqueIndex("popular_search_network_daily_unique").on(
      table.partNumberNormalized,
      table.searchDate,
      table.networkHash,
    ),
    dateIdx: index("popular_search_network_daily_date_idx").on(table.searchDate),
  }),
);

/** 每日主动搜索汇总；原始次数与防刷加权分分列保存。 */
export const popularSearchDaily = mysqlTable(
  "popular_search_daily",
  {
    id: int("id").autoincrement().primaryKey(),
    partNumberNormalized: varchar("partNumberNormalized", { length: 128 }).notNull(),
    searchDate: varchar("searchDate", { length: 10 }).notNull(),
    searchCount: int("searchCount").default(0).notNull(),
    weightedSearchCount: int("weightedSearchCount").default(0).notNull(),
    weightedScoreMilli: bigint("weightedScoreMilli", { mode: "number", unsigned: true }).default(0).notNull(),
    scoringVersion: int("scoringVersion").default(0).notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    partDateUnique: uniqueIndex("popular_search_daily_part_date_unique").on(
      table.partNumberNormalized,
      table.searchDate,
    ),
    dateIdx: index("popular_search_daily_date_idx").on(table.searchDate),
  }),
);

export type PopularSearchEvent = typeof popularSearchEvents.$inferSelect;
export type PopularSearchActorDaily = typeof popularSearchActorDaily.$inferSelect;
export type PopularSearchNetworkActorDaily = typeof popularSearchNetworkActorDaily.$inferSelect;
export type PopularSearchNetworkDaily = typeof popularSearchNetworkDaily.$inferSelect;
export type PopularSearchDaily = typeof popularSearchDaily.$inferSelect;

/**
 * 51电子网基于已核验原厂/授权渠道资料制作的物料外观图。
 * 后台物料字典保持只读；本表作为主站覆盖层，仅 approved 记录可公开展示。
 */
export const materialGeneratedImages = mysqlTable(
  "material_generated_images",
  {
    id: int("id").autoincrement().primaryKey(),
    /** 完整订货型号，NFKC 后转大写。 */
    partNumberNormalized: varchar("partNumberNormalized", { length: 128 }).notNull(),
    /** 后台只读字典 materials.id，用于审计，不建立跨库外键。 */
    dictionaryMaterialId: int("dictionaryMaterialId"),
    brand: varchar("brand", { length: 128 }).notNull(),
    package: varchar("package", { length: 128 }).notNull(),
    category: varchar("category", { length: 128 }).notNull(),
    status: mysqlEnum("status", ["draft", "approved", "disabled", "failed"])
      .default("draft")
      .notNull(),
    /** JSON：核验来源 URL、证据摘要与风险说明。 */
    sourceEvidence: text("sourceEvidence").notNull(),
    /** 私有无水印源图；不返回给前端。 */
    privateOriginalKey: varchar("privateOriginalKey", { length: 512 }),
    /** 已烧录51电子网水印的私有对象；仅经审核门禁代理读取。 */
    watermarkedPrivateKey: varchar("watermarkedPrivateKey", { length: 512 }),
    /** 依据原厂数据手册程序化绘制并烧录水印的私有引脚图。 */
    pinoutPrivateKey: varchar("pinoutPrivateKey", { length: 512 }),
    originalSha256: varchar("originalSha256", { length: 64 }),
    watermarkedSha256: varchar("watermarkedSha256", { length: 64 }),
    pinoutSha256: varchar("pinoutSha256", { length: 64 }),
    /** 引脚数或BGA球数，用于页面标注与审核。 */
    pinoutPinCount: int("pinoutPinCount"),
    modelName: varchar("modelName", { length: 64 }),
    promptHash: varchar("promptHash", { length: 64 }),
    generatedAt: timestamp("generatedAt"),
    approvedAt: timestamp("approvedAt"),
    disabledAt: timestamp("disabledAt"),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    partUnique: uniqueIndex("material_generated_images_part_unique").on(table.partNumberNormalized),
    statusUpdatedIdx: index("material_generated_images_status_updated_idx").on(
      table.status,
      table.updatedAt,
    ),
    dictionaryMaterialIdx: index("material_generated_images_dictionary_material_idx").on(
      table.dictionaryMaterialId,
    ),
  }),
);

export type MaterialGeneratedImage = typeof materialGeneratedImages.$inferSelect;
export type InsertMaterialGeneratedImage = typeof materialGeneratedImages.$inferInsert;

/** 每日个性化推荐快照，同一用户每天每条库存最多一条。 */
export const dailyRecommendations = mysqlTable(
  "daily_recommendations",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    inventoryId: int("inventoryId").notNull(),
    recommendationDate: date("recommendationDate", { mode: "string" }).notNull(),
    score: decimal("score", { precision: 8, scale: 3 }).notNull(),
    reason: varchar("reason", { length: 255 }).notNull(),
    generatedAt: timestamp("generatedAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    userInventoryDateUnique: uniqueIndex("daily_recommendations_user_inventory_date_unique").on(
      table.userId,
      table.inventoryId,
      table.recommendationDate
    ),
    userDateScoreIdx: index("daily_recommendations_user_date_score_idx").on(
      table.userId,
      table.recommendationDate,
      table.score
    ),
  })
);

export type DailyRecommendation = typeof dailyRecommendations.$inferSelect;
export type InsertDailyRecommendation = typeof dailyRecommendations.$inferInsert;

/**
 * 全局库存价值快照：数据通价格匹配和商业价值分只在后台计算一次，
 * 用户打开今日推荐时直接读取该表，避免逐条跨库查价和扫描全量库存。
 */
export const recommendationInventoryScores = mysqlTable(
  "recommendation_inventory_scores",
  {
    inventoryId: int("inventoryId").primaryKey(),
    partNumberNormalized: varchar("partNumberNormalized", { length: 128 }).notNull(),
    priceBatchId: int("priceBatchId"),
    referencePrice: decimal("referencePrice", { precision: 16, scale: 6 }),
    comparablePrice: decimal("comparablePrice", { precision: 16, scale: 6 }).notNull(),
    advantagePct: decimal("advantagePct", { precision: 9, scale: 4 }).default("0").notNull(),
    priorityTier: int("priorityTier").notNull(),
    priceScore: decimal("priceScore", { precision: 8, scale: 4 }).default("0").notNull(),
    leadScore: decimal("leadScore", { precision: 8, scale: 4 }).default("0").notNull(),
    quantityScore: decimal("quantityScore", { precision: 8, scale: 4 }).default("0").notNull(),
    freshnessScore: decimal("freshnessScore", { precision: 8, scale: 4 }).default("0").notNull(),
    sellerScore: decimal("sellerScore", { precision: 8, scale: 4 }).default("0").notNull(),
    valueScore: decimal("valueScore", { precision: 10, scale: 4 }).notNull(),
    referenceMatchedBy: varchar("referenceMatchedBy", { length: 32 }),
    suspiciousPrice: boolean("suspiciousPrice").default(false).notNull(),
    inventoryUpdatedAt: timestamp("inventoryUpdatedAt").notNull(),
    computedAt: timestamp("computedAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    valueRankIdx: index("recommendation_scores_value_rank_idx").on(
      table.priorityTier,
      table.valueScore,
      table.inventoryId,
    ),
    partRankIdx: index("recommendation_scores_part_rank_idx").on(
      table.partNumberNormalized,
      table.priorityTier,
      table.valueScore,
    ),
    batchIdx: index("recommendation_scores_batch_idx").on(table.priceBatchId),
  }),
);

export const recommendationScoreState = mysqlTable("recommendation_score_state", {
  id: int("id").primaryKey(),
  priceBatchId: int("priceBatchId"),
  lastInventoryUpdatedAt: timestamp("lastInventoryUpdatedAt"),
  status: mysqlEnum("status", ["idle", "running", "failed"]).default("idle").notNull(),
  leaseUntil: timestamp("leaseUntil"),
  lastStartedAt: timestamp("lastStartedAt"),
  lastCompletedAt: timestamp("lastCompletedAt"),
  lastErrorCode: varchar("lastErrorCode", { length: 64 }),
});

/** 用户关注的推荐库存，跨推荐日期长期保留。 */
export const recommendationFavorites = mysqlTable(
  "recommendation_favorites",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    inventoryId: int("inventoryId").notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    userInventoryUnique: uniqueIndex("recommendation_favorites_user_inventory_unique").on(
      table.userId,
      table.inventoryId
    ),
    userCreatedIdx: index("recommendation_favorites_user_created_idx").on(table.userId, table.createdAt),
  })
);

export type RecommendationFavorite = typeof recommendationFavorites.$inferSelect;
export type InsertRecommendationFavorite = typeof recommendationFavorites.$inferInsert;

/** 项目级周期任务配置；发布后保存 Heartbeat 返回的 task_uid。 */
export const scheduledJobs = mysqlTable(
  "scheduled_jobs",
  {
    id: int("id").autoincrement().primaryKey(),
    jobKey: varchar("jobKey", { length: 64 }).notNull().unique(),
    cronExpression: varchar("cronExpression", { length: 64 }).notNull(),
    scheduleCronTaskUid: varchar("scheduleCronTaskUid", { length: 65 }),
    lastRunAt: timestamp("lastRunAt"),
    lastStatus: varchar("lastStatus", { length: 32 }),
    updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    taskUidIdx: index("scheduled_jobs_task_uid_idx").on(table.scheduleCronTaskUid),
  })
);

export type ScheduledJob = typeof scheduledJobs.$inferSelect;
export type InsertScheduledJob = typeof scheduledJobs.$inferInsert;

/**
 * 找回密码验证码表：支持邮箱 / 手机两种渠道。
 * 验证码 6 位数字，10 分钟有效，使用后立即失效；同一目标 60 秒内只允许发送一次。
 */
export const passwordResetCodes = mysqlTable(
  "password_reset_codes",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    /** 用途：找回/修改密码或验证新邮箱。 */
    purpose: varchar("purpose", { length: 32 }).default("resetPassword").notNull(),
    /** 发送渠道：email / phone */
    channel: mysqlEnum("channel", ["email", "phone"]).notNull(),
    /** 目标邮箱或手机号（发送时的实际值） */
    target: varchar("target", { length: 320 }).notNull(),
    /** 验证码哈希（scrypt，与密码同套工具，不明文存储） */
    codeHash: varchar("codeHash", { length: 255 }).notNull(),
    /** 过期时间 */
    expiresAt: timestamp("expiresAt").notNull(),
    /** 已使用时间（NULL = 未使用） */
    usedAt: timestamp("usedAt"),
    /** 校验失败次数（超过 5 次作废） */
    attempts: int("attempts").default(0).notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    userPurposeChannelUnique: uniqueIndex("password_reset_codes_user_purpose_channel_unique").on(
      table.userId,
      table.purpose,
      table.channel,
    ),
    targetCreatedAtIndex: index("password_reset_codes_target_created_idx").on(
      table.target,
      table.createdAt,
    ),
  }),
);
export type PasswordResetCode = typeof passwordResetCodes.$inferSelect;
export type InsertPasswordResetCode = typeof passwordResetCodes.$inferInsert;

/** 账号敏感操作审计，不保存密码、验证码或完整客户端地址。 */
export const accountSecurityEvents = mysqlTable(
  "account_security_events",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    eventType: varchar("eventType", { length: 64 }).notNull(),
    channel: varchar("channel", { length: 16 }),
    clientType: varchar("clientType", { length: 16 }).notNull(),
    ipHash: varchar("ipHash", { length: 64 }),
    userAgent: varchar("userAgent", { length: 512 }),
    success: boolean("success").default(true).notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    userCreatedAtIndex: index("account_security_events_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
  }),
);
export type AccountSecurityEvent = typeof accountSecurityEvents.$inferSelect;
export type InsertAccountSecurityEvent = typeof accountSecurityEvents.$inferInsert;

/**
 * 通用短信验证码表（登录 / 注册 / 找回用户名 / 手机重置密码）。
 * 多进程（PM2 cluster）共享存储；同一 scene+phone 只保留最新一条记录。
 * 验证码 6 位数字，10 分钟有效，使用后立即失效；60 秒内只允许发送一次；失败 5 次作废。
 */
export const smsVerificationCodes = mysqlTable(
  "sms_verification_codes",
  {
    id: int("id").autoincrement().primaryKey(),
    /** 业务场景：login / register / recoverUsername / resetPassword */
    scene: varchar("scene", { length: 32 }).notNull(),
    /** 手机号 */
    phone: varchar("phone", { length: 20 }).notNull(),
    /** 验证码哈希（HMAC-SHA256，不明文存储） */
    codeHash: varchar("codeHash", { length: 255 }).notNull(),
    /** 过期时间 */
    expiresAt: timestamp("expiresAt").notNull(),
    /** 已使用时间（NULL = 未使用） */
    usedAt: timestamp("usedAt"),
    /** 校验失败次数（超过 5 次作废） */
    attempts: int("attempts").default(0).notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    scenePhoneUnique: uniqueIndex("sms_verification_codes_scene_phone_unique").on(
      table.scene,
      table.phone,
    ),
  }),
);
export type SmsVerificationCode = typeof smsVerificationCodes.$inferSelect;
export type InsertSmsVerificationCode = typeof smsVerificationCodes.$inferInsert;

/**
 * 统一企业实体：统一社会信用代码在此表唯一。
 * superAdminUserId 是当前企业超级管理员；crmDataOwnerUserId 是旧 CRM 业务表稳定的数据归属键，
 * 超级管理员转让时不改变，确保既有入库、出库、库存与子账号数据不丢失。
 */
export const enterprises = mysqlTable(
  "enterprises",
  {
    id: int("id").autoincrement().primaryKey(),
    /** 已去空格并转大写的统一社会信用代码 */
    creditCode: varchar("creditCode", { length: 32 }),
    registrationRegion: varchar("registrationRegion", { length: 2 }).default("CN").notNull(),
    registrationIdentifier: varchar("registrationIdentifier", { length: 64 }),
    /** 企业规范名称；首次认领时由企业资料写入 */
    companyName: varchar("companyName", { length: 128 }).notNull(),
    /** 当前唯一超级管理员（独立前台 users.id） */
    superAdminUserId: int("superAdminUserId").notNull(),
    /** 兼容旧 CRM 表 userId 的稳定数据归属键；转让超级管理员时保持不变 */
    crmDataOwnerUserId: int("crmDataOwnerUserId").notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    creditCodeUnique: uniqueIndex("enterprises_credit_code_unique").on(table.creditCode),
    registrationIdentifierUnique: uniqueIndex("enterprises_registration_identifier_unique").on(table.registrationIdentifier),
    superAdminIdx: index("enterprises_super_admin_idx").on(table.superAdminUserId),
    dataOwnerIdx: index("enterprises_crm_data_owner_idx").on(table.crmDataOwnerUserId),
  })
);

export type Enterprise = typeof enterprises.$inferSelect;
export type InsertEnterprise = typeof enterprises.$inferInsert;

/**
 * 平台审核后才写入的企业库存额度例外。
 *
 * enterpriseId 是主键，dataOwnerUserId 与 enterprises.crmDataOwnerUserId 双重绑定；
 * 业务读取时还会拒绝同一 data owner 对应多个企业的例外，避免历史归属歧义扩大额度。
 */
export const enterpriseInventoryQuotas = mysqlTable(
  "enterprise_inventory_quotas",
  {
    enterpriseId: int("enterpriseId").primaryKey(),
    dataOwnerUserId: int("dataOwnerUserId").notNull(),
    publishedRowLimit: int("publishedRowLimit").notNull(),
    dailyImportRowLimit: int("dailyImportRowLimit").notNull(),
    enabled: boolean("enabled").default(false).notNull(),
    updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    dataOwnerUnique: uniqueIndex("enterprise_inventory_quotas_data_owner_unique").on(table.dataOwnerUserId),
  }),
);

export type EnterpriseInventoryQuota = typeof enterpriseInventoryQuotas.$inferSelect;
export type InsertEnterpriseInventoryQuota = typeof enterpriseInventoryQuotas.$inferInsert;

/**
 * 企业成员：同一 users 账号可归属多家企业，但同一企业内只能有一条成员记录。
 * ERP仅使用独立账号企业成员；可操作范围由 enterprise_member_permissions 控制。
 */
export const enterpriseMembers = mysqlTable(
  "enterprise_members",
  {
    id: int("id").autoincrement().primaryKey(),
    enterpriseId: int("enterpriseId").notNull(),
    userId: int("userId").notNull(),
    role: mysqlEnum("role", ["super_admin", "admin", "member"]).default("member").notNull(),
    status: mysqlEnum("status", ["active", "suspended"]).default("active").notNull(),
    /** own 仅本人业务；enterprise 全企业业务。字段名为兼容性保留。 */
    inventoryDataScope: mysqlEnum("inventoryDataScope", ["own", "enterprise"])
      .default("own")
      .notNull(),
    invitedByUserId: int("invitedByUserId"),
    /** 权限集合版本；每次授权、撤权或成员状态变化递增。 */
    permissionVersion: int("permissionVersion").default(1).notNull(),
    joinedAt: timestamp("joinedAt").default(DEFAULT_NOW).notNull(),
    suspendedAt: timestamp("suspendedAt"),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    enterpriseUserUnique: uniqueIndex("enterprise_members_enterprise_user_unique").on(
      table.enterpriseId,
      table.userId
    ),
    userEnterpriseIdx: index("enterprise_members_user_enterprise_idx").on(table.userId, table.enterpriseId),
    enterpriseRoleStatusIdx: index("enterprise_members_role_status_idx").on(
      table.enterpriseId,
      table.role,
      table.status
    ),
  })
);

export type EnterpriseMember = typeof enterpriseMembers.$inferSelect;
export type InsertEnterpriseMember = typeof enterpriseMembers.$inferInsert;

/** 企业成员的六项ERP模块权限。企业所有者在服务端始终视为拥有全部权限。 */
export const enterpriseMemberPermissions = mysqlTable(
  "enterprise_member_permissions",
  {
    id: int("id").autoincrement().primaryKey(),
    enterpriseMemberId: int("enterpriseMemberId").notNull(),
    permissionKey: mysqlEnum("permissionKey", ERP_PERMISSION_KEYS).notNull(),
    grantedByUserId: int("grantedByUserId").notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    memberPermissionUnique: uniqueIndex("enterprise_member_permissions_member_key_unique").on(
      table.enterpriseMemberId,
      table.permissionKey,
    ),
    permissionMemberIdx: index("enterprise_member_permissions_key_member_idx").on(
      table.permissionKey,
      table.enterpriseMemberId,
    ),
  }),
);

export type EnterpriseMemberPermission = typeof enterpriseMemberPermissions.$inferSelect;
export type InsertEnterpriseMemberPermission = typeof enterpriseMemberPermissions.$inferInsert;

/**
 * Standalone internal customer records. `enterpriseId` is the tenant boundary and
 * `assignedUserId` is the actual independent sales user, never the legacy CRM owner.
 * The stable handoff columns are id, enterpriseId, assignedUserId, version, updatedAt,
 * and updatedByUserId. All rows are retained; archive is represented by archivedAt.
 */
export const crmCustomers = mysqlTable(
  "crm_customers",
  {
    id: int("id").autoincrement().primaryKey(),
    enterpriseId: int("enterpriseId").notNull(),
    assignedUserId: int("assignedUserId").notNull(),
    createdByUserId: int("createdByUserId").notNull(),
    updatedByUserId: int("updatedByUserId").notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    nameNormalized: varchar("nameNormalized", { length: 128 }).notNull(),
    industryCode: varchar("industryCode", { length: 64 }).default(sql`NULL`),
    province: varchar("province", { length: 64 }),
    city: varchar("city", { length: 64 }),
    district: varchar("district", { length: 64 }),
    address: varchar("address", { length: 500 }),
    scale: mysqlEnum("scale", ["unknown", "1-20", "21-50", "51-100", "101-500", "500+"])
      .default("unknown")
      .notNull(),
    grade: mysqlEnum("grade", ["A", "B", "C", "D"]).default("C").notNull(),
    stage: mysqlEnum("stage", ["new", "following", "quoted", "won", "paused", "invalid"])
      .default("new")
      .notNull(),
    source: varchar("source", { length: 128 }),
    nextFollowUpAt: immutableBeijingDateTime("nextFollowUpAt"),
    lastFollowUpAt: immutableBeijingDateTime("lastFollowUpAt"),
    archivedAt: immutableBeijingDateTime("archivedAt"),
    archivedByUserId: int("archivedByUserId"),
    archiveReason: varchar("archiveReason", { length: 500 }),
    version: int("version").default(1).notNull(),
    createdAt: immutableBeijingDateTime("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: immutableBeijingDateTime("updatedAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    enterpriseAssigneeUpdatedIdx: index("crm_customers_enterprise_assignee_updated_idx").on(
      table.enterpriseId,
      table.assignedUserId,
      table.updatedAt,
      table.id,
    ),
    enterpriseArchivedUpdatedIdx: index("crm_customers_enterprise_archived_updated_idx").on(
      table.enterpriseId,
      table.archivedAt,
      table.updatedAt,
      table.id,
    ),
    enterpriseNameIdx: index("crm_customers_enterprise_name_idx").on(table.enterpriseId, table.nameNormalized),
    enterpriseDueIdx: index("crm_customers_enterprise_due_idx").on(table.enterpriseId, table.nextFollowUpAt),
  }),
);
export type CrmCustomer = typeof crmCustomers.$inferSelect;
export type InsertCrmCustomer = typeof crmCustomers.$inferInsert;

/** Phase 1 has one required logical primary contact; the table permits later extension without changing customers. */
export const crmCustomerContacts = mysqlTable(
  "crm_customer_contacts",
  {
    id: int("id").autoincrement().primaryKey(),
    customerId: int("customerId").notNull(),
    contactName: varchar("contactName", { length: 64 }),
    phone: varchar("phone", { length: 64 }),
    phoneNormalized: varchar("phoneNormalized", { length: 64 }).default("").notNull(),
    email: varchar("email", { length: 254 }),
    emailNormalized: varchar("emailNormalized", { length: 254 }).default("").notNull(),
    isPrimary: boolean("isPrimary").default(true).notNull(),
    createdAt: immutableBeijingDateTime("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: immutableBeijingDateTime("updatedAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    customerPrimaryUnique: uniqueIndex("crm_customer_contacts_customer_primary_unique").on(
      table.customerId,
      table.isPrimary,
    ),
    phoneIdx: index("crm_customer_contacts_phone_idx").on(table.phoneNormalized, table.customerId),
    emailIdx: index("crm_customer_contacts_email_idx").on(table.emailNormalized, table.customerId),
  }),
);
export type CrmCustomerContact = typeof crmCustomerContacts.$inferSelect;
export type InsertCrmCustomerContact = typeof crmCustomerContacts.$inferInsert;

/** Follow-ups are append-only. Corrections reference the original record and never mutate it. */
export const crmCustomerFollowups = mysqlTable(
  "crm_customer_followups",
  {
    id: int("id").autoincrement().primaryKey(),
    enterpriseId: int("enterpriseId").notNull(),
    customerId: int("customerId").notNull(),
    authorUserId: int("authorUserId").notNull(),
    method: mysqlEnum("method", ["phone", "wechat", "email", "visit", "other"]).default("phone").notNull(),
    content: varchar("content", { length: 4000 }).notNull(),
    occurredAt: immutableBeijingDateTime("occurredAt").notNull(),
    correctionOfId: int("correctionOfId"),
    requestId: varchar("requestId", { length: 80 }).notNull(),
    payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
    createdAt: immutableBeijingDateTime("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    requestUnique: uniqueIndex("crm_customer_followups_request_unique").on(
      table.enterpriseId,
      table.authorUserId,
      table.requestId,
    ),
    customerOccurredIdx: index("crm_customer_followups_customer_occurred_idx").on(
      table.enterpriseId,
      table.customerId,
      table.occurredAt,
      table.id,
    ),
    correctionIdx: index("crm_customer_followups_correction_idx").on(
      table.enterpriseId,
      table.customerId,
      table.correctionOfId,
    ),
  }),
);
export type CrmCustomerFollowup = typeof crmCustomerFollowups.$inferSelect;
export type InsertCrmCustomerFollowup = typeof crmCustomerFollowups.$inferInsert;

/**
 * Customer audit fields are deliberately usable by the member-handoff helper:
 * customerId, enterpriseId, actorUserId, nullable actorName, action, note,
 * nullable requestId, createdAt. actorName is nullable because display is joined from users.
 */
export const crmCustomerAudits = mysqlTable(
  "crm_customer_audits",
  {
    id: int("id").autoincrement().primaryKey(),
    customerId: int("customerId").notNull(),
    enterpriseId: int("enterpriseId").notNull(),
    actorUserId: int("actorUserId").notNull(),
    actorName: varchar("actorName", { length: 128 }),
    action: varchar("action", { length: 64 }).notNull(),
    note: varchar("note", { length: 500 }).default("").notNull(),
    requestId: varchar("requestId", { length: 80 }),
    createdAt: immutableBeijingDateTime("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    customerCreatedIdx: index("crm_customer_audits_customer_created_idx").on(
      table.enterpriseId,
      table.customerId,
      table.createdAt,
      table.id,
    ),
    requestIdx: index("crm_customer_audits_request_idx").on(table.enterpriseId, table.requestId),
  }),
);
export type CrmCustomerAudit = typeof crmCustomerAudits.$inferSelect;
export type InsertCrmCustomerAudit = typeof crmCustomerAudits.$inferInsert;

/** Per actor/enterprise request registry for create and follow-up idempotency. */
export const crmCustomerRequests = mysqlTable(
  "crm_customer_requests",
  {
    id: int("id").autoincrement().primaryKey(),
    enterpriseId: int("enterpriseId").notNull(),
    actorUserId: int("actorUserId").notNull(),
    requestId: varchar("requestId", { length: 80 }).notNull(),
    action: varchar("action", { length: 32 }).notNull(),
    payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
    customerId: int("customerId").notNull(),
    recordId: int("recordId"),
    createdAt: immutableBeijingDateTime("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    actorRequestUnique: uniqueIndex("crm_customer_requests_actor_request_unique").on(
      table.enterpriseId,
      table.actorUserId,
      table.requestId,
    ),
  }),
);
export type CrmCustomerRequest = typeof crmCustomerRequests.$inferSelect;
export type InsertCrmCustomerRequest = typeof crmCustomerRequests.$inferInsert;

export const ERP_INVITATION_STATUSES = [
  "pending",
  "accepted",
  "rejected",
  "revoked",
  "expired",
] as const;
export type ErpInvitationStatus = (typeof ERP_INVITATION_STATUSES)[number];

/** 手机号解析到独立账号后的企业邀请；聊天卡片只引用此表，不作为状态权威源。 */
export const enterpriseMemberInvitations = mysqlTable(
  "enterprise_member_invitations",
  {
    id: int("id").autoincrement().primaryKey(),
    enterpriseId: int("enterpriseId").notNull(),
    targetUserId: int("targetUserId").notNull(),
    targetPhoneSnapshot: varchar("targetPhoneSnapshot", { length: 20 }).notNull(),
    invitedByUserId: int("invitedByUserId").notNull(),
    permissionKeys: json("permissionKeys").$type<ErpPermissionKey[]>().notNull(),
    /** 接受邀请后写入成员的库存数据范围。 */
    inventoryDataScope: mysqlEnum("inventoryDataScope", ["own", "enterprise"])
      .default("own")
      .notNull(),
    status: mysqlEnum("status", ERP_INVITATION_STATUSES).default("pending").notNull(),
    tokenHash: varchar("tokenHash", { length: 64 }).notNull(),
    requestId: varchar("requestId", { length: 64 }).notNull(),
    conversationId: int("conversationId"),
    messageId: int("messageId"),
    expiresAt: immutableBeijingDateTime("expiresAt").notNull(),
    acceptedAt: timestamp("acceptedAt"),
    rejectedAt: timestamp("rejectedAt"),
    revokedAt: timestamp("revokedAt"),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    tokenHashUnique: uniqueIndex("enterprise_member_invitations_token_hash_unique").on(table.tokenHash),
    requestIdUnique: uniqueIndex("enterprise_member_invitations_request_id_unique").on(table.requestId),
    enterpriseTargetStatusIdx: index("enterprise_member_invitations_enterprise_target_status_idx").on(
      table.enterpriseId,
      table.targetUserId,
      table.status,
    ),
    targetStatusExpiryIdx: index("enterprise_member_invitations_target_status_expiry_idx").on(
      table.targetUserId,
      table.status,
      table.expiresAt,
    ),
  }),
);

export type EnterpriseMemberInvitation = typeof enterpriseMemberInvitations.$inferSelect;
export type InsertEnterpriseMemberInvitation = typeof enterpriseMemberInvitations.$inferInsert;

export const ENTERPRISE_PERMISSION_AUDIT_ACTIONS = [
  "invite_created",
  "invite_resent",
  "invite_revoked",
  "invite_accepted",
  "invite_rejected",
  "permissions_updated",
  "member_suspended",
  "member_activated",
  "member_removed",
  "member_left",
] as const;

/** 企业成员邀请和权限变更的不可变审计日志。 */
export const enterprisePermissionAuditLogs = mysqlTable(
  "enterprise_permission_audit_logs",
  {
    id: int("id").autoincrement().primaryKey(),
    enterpriseId: int("enterpriseId").notNull(),
    actorUserId: int("actorUserId"),
    targetUserId: int("targetUserId").notNull(),
    invitationId: int("invitationId"),
    action: mysqlEnum("action", ENTERPRISE_PERMISSION_AUDIT_ACTIONS).notNull(),
    beforePermissions: json("beforePermissions").$type<ErpPermissionKey[]>(),
    afterPermissions: json("afterPermissions").$type<ErpPermissionKey[]>(),
    requestId: varchar("requestId", { length: 64 }).notNull(),
    result: varchar("result", { length: 24 }).default("success").notNull(),
    note: varchar("note", { length: 500 }),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    requestIdUnique: uniqueIndex("enterprise_permission_audit_request_unique").on(table.requestId),
    enterpriseCreatedIdx: index("enterprise_permission_audit_enterprise_created_idx").on(
      table.enterpriseId,
      table.createdAt,
    ),
    targetCreatedIdx: index("enterprise_permission_audit_target_created_idx").on(
      table.targetUserId,
      table.createdAt,
    ),
  }),
);

export type EnterprisePermissionAuditLog = typeof enterprisePermissionAuditLogs.$inferSelect;
export type InsertEnterprisePermissionAuditLog = typeof enterprisePermissionAuditLogs.$inferInsert;

/**
 * 独立后台对企业普通成员的不可变审计。
 * operatorId 属于外部后台命名空间，绝不能写入 enterprise_permission_audit_logs.actorUserId。
 */
export const enterpriseAdminMemberAudits = mysqlTable(
  "enterprise_admin_member_audits",
  {
    id: int("id").autoincrement().primaryKey(),
    enterpriseId: int("enterpriseId").notNull(),
    targetUserId: int("targetUserId").notNull(),
    action: varchar("action", { length: 64 }).notNull(),
    beforeValue: json("beforeValue").$type<Record<string, unknown>>(),
    afterValue: json("afterValue").$type<Record<string, unknown>>().notNull(),
    reason: varchar("reason", { length: 500 }).notNull(),
    requestId: varchar("requestId", { length: 64 }).notNull(),
    /** 对完整规范化请求做 SHA-256，用于拒绝同 requestId 异 payload。 */
    payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
    operatorId: varchar("operatorId", { length: 128 }).notNull(),
    operatorName: varchar("operatorName", { length: 128 }).notNull(),
    operatorRole: varchar("operatorRole", { length: 64 }).notNull(),
    ipAddress: varchar("ipAddress", { length: 64 }),
    userAgent: varchar("userAgent", { length: 512 }),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    requestIdUnique: uniqueIndex("enterprise_admin_member_audits_request_unique").on(table.requestId),
    enterpriseCreatedIdx: index("enterprise_admin_member_audits_enterprise_created_idx").on(
      table.enterpriseId,
      table.createdAt,
    ),
    targetCreatedIdx: index("enterprise_admin_member_audits_target_created_idx").on(
      table.targetUserId,
      table.createdAt,
    ),
  }),
);

export type EnterpriseAdminMemberAudit = typeof enterpriseAdminMemberAudits.$inferSelect;
export type InsertEnterpriseAdminMemberAudit = typeof enterpriseAdminMemberAudits.$inferInsert;

export const ENTERPRISE_MEMBER_HANDOFF_MODES = ["handoff_only", "handoff_remove"] as const;
export type EnterpriseMemberHandoffMode = (typeof ENTERPRISE_MEMBER_HANDOFF_MODES)[number];

/** 成功完成的成员业务交接账本；同一 requestId 只允许一份不可变结果。 */
export const enterpriseMemberHandoffOperations = mysqlTable(
  "enterprise_member_handoff_operations",
  {
    id: int("id").autoincrement().primaryKey(),
    enterpriseId: int("enterpriseId").notNull(),
    actorUserId: int("actorUserId").notNull(),
    targetUserId: int("targetUserId").notNull(),
    nextOwnerUserId: int("nextOwnerUserId"),
    mode: mysqlEnum("mode", ENTERPRISE_MEMBER_HANDOFF_MODES).notNull(),
    status: mysqlEnum("status", ["processing", "completed"]).default("processing").notNull(),
    inventoryCount: int("inventoryCount").default(0).notNull(),
    inquiryCount: int("inquiryCount").default(0).notNull(),
    requestId: varchar("requestId", { length: 64 }).notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    requestIdUnique: uniqueIndex("enterprise_member_handoff_request_unique").on(table.requestId),
    enterpriseCreatedIdx: index("enterprise_member_handoff_enterprise_created_idx").on(
      table.enterpriseId,
      table.createdAt,
    ),
    targetCreatedIdx: index("enterprise_member_handoff_target_created_idx").on(
      table.targetUserId,
      table.createdAt,
    ),
  }),
);

export type EnterpriseMemberHandoffOperation = typeof enterpriseMemberHandoffOperations.$inferSelect;
export type InsertEnterpriseMemberHandoffOperation = typeof enterpriseMemberHandoffOperations.$inferInsert;

/** 成功完成的企业超级管理员转让审计；记录只新增、不更新、不删除。 */
export const crmOwnerTransferLogs = mysqlTable(
  "crm_owner_transfer_logs",
  {
    id: int("id").autoincrement().primaryKey(),
    enterpriseId: int("enterpriseId").notNull(),
    previousSuperAdminUserId: int("previousSuperAdminUserId").notNull(),
    nextSuperAdminUserId: int("nextSuperAdminUserId").notNull(),
    initiatedByUserId: int("initiatedByUserId").notNull(),
    reason: text("reason").notNull(),
    /** 调用方幂等键；同一请求只允许成功一次 */
    requestId: varchar("requestId", { length: 64 }).notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    requestIdUnique: uniqueIndex("crm_owner_transfer_logs_request_unique").on(table.requestId),
    enterpriseCreatedIdx: index("crm_owner_transfer_logs_enterprise_created_idx").on(
      table.enterpriseId,
      table.createdAt
    ),
    actorIdx: index("crm_owner_transfer_logs_actor_idx").on(table.initiatedByUserId),
  })
);

export type CrmOwnerTransferLog = typeof crmOwnerTransferLogs.$inferSelect;
export type InsertCrmOwnerTransferLog = typeof crmOwnerTransferLogs.$inferInsert;

/**
 * 未回复消息短信提醒记录表。
 *
 * 用途有两个，缺一不可：
 * 1. 幂等：同一会话同一轮未读只提醒一次。若不落库，Worker 每轮轮询都会
 *    重复发送，30 分钟阈值下一小时内可发出十几条，用户必然拦截短信，
 *    连退款通知也会一并收不到。
 * 2. 频控：按 userId + 自然日统计，实现「每人每日最多 N 条」上限。
 *    阿里云对通知类短信有每日 50 条账号级限制，触顶后当天所有通知
 *    （含退款到账通知）全部发不出去，因此必须在业务侧先行限流。
 *
 * 「同一轮未读」的界定：以提醒时该会话的最新消息 id 为界（lastMessageId）。
 * 对方回复后会话产生更大的消息 id，与已记录的 lastMessageId 不同，
 * 于是允许再次提醒；期间对方持续发消息则不会重复提醒。
 */
export const chatReplyReminders = mysqlTable(
  "chat_reply_reminders",
  {
    id: int("id").autoincrement().primaryKey(),
    /** 被提醒人（未回复的一方） */
    userId: int("userId").notNull(),
    conversationId: int("conversationId").notNull(),
    /** 提醒时该会话的最新消息 id，用作「同一轮未读」的幂等键 */
    lastMessageId: int("lastMessageId").notNull(),
    /** 提醒时的未读条数，用于短信文案与事后分析 */
    unreadCount: int("unreadCount").notNull(),
    /** sms | site | skipped：实际生效的通知渠道 */
    channel: varchar("channel", { length: 16 }).notNull().default("site"),
    /** 短信是否真实发出 */
    smsSent: boolean("smsSent").default(false).notNull(),
    /** 未发短信的原因：NO_TEMPLATE / NO_PHONE / DAILY_LIMIT / QUIET_HOURS / 错误码 */
    smsSkipReason: varchar("smsSkipReason", { length: 64 }),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    /**
     * 同一用户在同一会话的同一消息位点只允许一条提醒记录。
     * 这是防重复发送的最后防线：即使 PM2 多进程或 Worker 重启导致
     * 并发扫描到同一会话，唯一索引也会让第二次插入失败。
     */
    userConversationMessageUnique: uniqueIndex("chat_reply_reminders_user_conv_msg_unique").on(
      table.userId,
      table.conversationId,
      table.lastMessageId
    ),
    /** 按人+时间统计当日发送量（频控查询走此索引） */
    userCreatedIdx: index("chat_reply_reminders_user_created_idx").on(table.userId, table.createdAt),
  })
);
export type ChatReplyReminder = typeof chatReplyReminders.$inferSelect;
export type InsertChatReplyReminder = typeof chatReplyReminders.$inferInsert;

/**
 * 用户关注的供应商。
 *
 * 设计说明：
 * - 关注对象用 supplierId（= inventories.userId / users.id），而不是企业 ID：
 *   库存挂在用户账号下发布，企业资料可能缺失或后补；用账号 ID 才能保证任何
 *   在售供应商都可被关注，且与搜索结果返回的 supplierId 直接对齐。
 * - 唯一索引防止同一用户重复关注同一供应商（前端连点或并发请求都会被拦住）。
 * - (userId, createdAt) 索引供「我的关注」列表按关注时间倒序查询。
 * - 取关采用物理删除：关注关系是纯偏好数据，无审计价值，也不参与交易结算。
 */
export const supplierFollows = mysqlTable(
  "supplier_follows",
  {
    id: int("id").autoincrement().primaryKey(),
    /** 关注人（买家） */
    userId: int("userId").notNull(),
    /** 被关注的供应商账号 ID（对应 inventories.userId） */
    supplierId: int("supplierId").notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    userSupplierUnique: uniqueIndex("supplier_follows_user_supplier_unique").on(
      table.userId,
      table.supplierId
    ),
    userCreatedIdx: index("supplier_follows_user_created_idx").on(table.userId, table.createdAt),
  })
);
export type SupplierFollow = typeof supplierFollows.$inferSelect;
export type InsertSupplierFollow = typeof supplierFollows.$inferInsert;

/**
 * 微信小程序账号绑定：openid ↔ 平台账号。
 *
 * ## 为什么必须独立建表，不能复用 users.openId
 *
 * `users.openId` 存的是框架层标识（`local:<username>` 或 `sub:<username>`），
 * 且带唯一约束；鉴权链路存在 `startsWith("sub:")` 这类前缀判断。
 * 把微信 openid 混进该字段会造成难以定位的鉴权异常。
 *
 * ## 为什么以 users.id 关联而非直接存手机号
 *
 * 手机号是「首次关联时的锚点」，不是「绑定关系的载体」。
 * 用户换绑手机号后，绑定关系应当跟着账号走而不是跟着手机号走。
 *
 * ## unionId 预留
 *
 * 同一微信开放平台下，同一用户在不同应用的 openid 不同、unionId 相同。
 * 当前只有小程序一个入口，unionId 暂无用途；但日后接入公众号或 App 时，
 * 没有 unionId 就无法识别是同一个人，而历史数据已无法补录。
 * 因此现在就落库保存。
 */
export const wechatAccountBindings = mysqlTable(
  "wechat_account_bindings",
  {
    id: int("id").autoincrement().primaryKey(),
    /** 平台账号 ID（users.id） */
    userId: int("userId").notNull(),
    /** 微信 openid：同一用户在同一小程序内恒定 */
    openid: varchar("openid", { length: 64 }).notNull(),
    /** 开放平台 unionId：跨应用识别同一用户，当前预留 */
    unionId: varchar("unionId", { length: 64 }),
    /** 绑定时使用的手机号，仅作审计留痕，不参与关联判断 */
    boundPhone: varchar("boundPhone", { length: 20 }),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt")
      .default(DEFAULT_NOW)
      .$onUpdate(() => new Date())
      .notNull(),
    lastLoginAt: timestamp("lastLoginAt"),
  },
  table => ({
    /*
     * openid 唯一：数据库约束是并发登录的最终仲裁。
     * 同一 openid 并发首次登录时，应用层判断会双双认为「未绑定」而各自建号，
     * 唯一约束确保只有一条能落库，另一条报重复键后改走关联既有账号。
     */
    openidUnique: uniqueIndex("wechat_account_bindings_openid_unique").on(table.openid),
    /*
     * userId 唯一：一个平台账号只允许绑定一个微信。
     * 若允许多绑，「这个账号是谁的微信」将无法回答，
     * 换绑时也无从判断该解绑哪一条。
     */
    userUnique: uniqueIndex("wechat_account_bindings_user_unique").on(table.userId),
  })
);
export type WechatAccountBinding = typeof wechatAccountBindings.$inferSelect;
export type InsertWechatAccountBinding = typeof wechatAccountBindings.$inferInsert;

/**
 * 微信服务号账号绑定：服务号 openid ↔ 平台账号。
 *
 * 服务号与小程序的 openid 彼此不同，不能写入小程序绑定表。两端通过同一
 * unionId 自动归并；拿不到 unionId 时使用一次性绑定码显式关联。
 */
export const wechatServiceAccountBindings = mysqlTable(
  "wechat_service_account_bindings",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    openid: varchar("openid", { length: 64 }).notNull(),
    unionId: varchar("unionId", { length: 64 }),
    subscribed: boolean("subscribed").default(true).notNull(),
    reminderEnabled: boolean("reminderEnabled").default(true).notNull(),
    source: varchar("source", { length: 24 }).default("bind_code").notNull(),
    lastSubscribedAt: timestamp("lastSubscribedAt"),
    unsubscribedAt: timestamp("unsubscribedAt"),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt")
      .default(DEFAULT_NOW)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    openidUnique: uniqueIndex("wechat_service_bindings_openid_unique").on(table.openid),
    userUnique: uniqueIndex("wechat_service_bindings_user_unique").on(table.userId),
    unionIdx: index("wechat_service_bindings_union_idx").on(table.unionId),
    reminderIdx: index("wechat_service_bindings_reminder_idx").on(
      table.subscribed,
      table.reminderEnabled,
      table.userId,
    ),
  }),
);
export type WechatServiceAccountBinding = typeof wechatServiceAccountBindings.$inferSelect;
export type InsertWechatServiceAccountBinding = typeof wechatServiceAccountBindings.$inferInsert;

/**
 * 小程序生成的一次性服务号绑定码。
 *
 * 数据库只保存 HMAC 摘要，不保存用户看到的六位明文；十分钟过期且使用后
 * 立即作废，避免服务号消息被转发或数据库泄露后长期劫持账号。
 */
export const wechatServiceBindCodes = mysqlTable(
  "wechat_service_bind_codes",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    codeHash: varchar("codeHash", { length: 64 }).notNull(),
    status: varchar("status", { length: 16 }).default("pending").notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    usedAt: timestamp("usedAt"),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    codeHashUnique: uniqueIndex("wechat_service_bind_codes_hash_unique").on(table.codeHash),
    userStatusIdx: index("wechat_service_bind_codes_user_status_idx").on(
      table.userId,
      table.status,
      table.expiresAt,
    ),
  }),
);
export type WechatServiceBindCode = typeof wechatServiceBindCodes.$inferSelect;
export type InsertWechatServiceBindCode = typeof wechatServiceBindCodes.$inferInsert;

/**
 * 服务号一次性订阅授权与可用通知额度。
 *
 * 每次用户主动确认只生成一条 available 额度；发送前以 FOR UPDATE 原子领取，
 * 成功后改为 consumed，失败则按错误类型释放或撤销，避免无授权推送和重复消费。
 */
export const wechatServiceSubscriptionGrants = mysqlTable(
  "wechat_service_subscription_grants",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    openid: varchar("openid", { length: 64 }),
    templateId: varchar("templateId", { length: 128 }).notNull(),
    scene: int("scene").notNull(),
    stateHash: varchar("stateHash", { length: 64 }).notNull(),
    status: varchar("status", { length: 20 }).default("pending").notNull(),
    source: varchar("source", { length: 20 }).default("authorize_url").notNull(),
    deliveryKey: varchar("deliveryKey", { length: 64 }),
    authorizedAt: timestamp("authorizedAt"),
    consumedAt: timestamp("consumedAt"),
    expiresAt: timestamp("expiresAt").notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt")
      .default(DEFAULT_NOW)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    stateHashUnique: uniqueIndex("wechat_service_subscription_state_unique").on(table.stateHash),
    userTemplateSceneUnique: uniqueIndex("wechat_service_subscription_user_tpl_scene_unique").on(
      table.userId,
      table.templateId,
      table.scene,
    ),
    userTemplateStatusIdx: index("wechat_service_subscription_user_tpl_status_idx").on(
      table.userId,
      table.templateId,
      table.status,
      table.authorizedAt,
    ),
    openidTemplateStatusIdx: index("wechat_service_subscription_openid_tpl_status_idx").on(
      table.openid,
      table.templateId,
      table.status,
    ),
  }),
);
export type WechatServiceSubscriptionGrant =
  typeof wechatServiceSubscriptionGrants.$inferSelect;
export type InsertWechatServiceSubscriptionGrant =
  typeof wechatServiceSubscriptionGrants.$inferInsert;

/**
 * 微信小程序一次性订阅授权与可用通知额度。
 *
 * 小程序端 `requestSubscribeMessage` 的返回值只用于即时反馈，不能直接增加额度；
 * 只有微信服务器推送并通过独立回调Token验签的 `subscribe_msg_popup_event`
 * 才能把最近一条 pending 记录原子更新为 available。
 */
export const wechatMiniProgramSubscriptionGrants = mysqlTable(
  "wechat_miniprogram_subscription_grants",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    openid: varchar("openid", { length: 64 }).notNull(),
    templateId: varchar("templateId", { length: 128 }).notNull(),
    requestHash: varchar("requestHash", { length: 64 }).notNull(),
    status: varchar("status", { length: 20 }).default("pending").notNull(),
    source: varchar("source", { length: 20 }).default("native_popup").notNull(),
    deliveryKey: varchar("deliveryKey", { length: 64 }),
    authorizedAt: timestamp("authorizedAt"),
    consumedAt: timestamp("consumedAt"),
    expiresAt: timestamp("expiresAt").notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    requestHashUnique: uniqueIndex("wechat_mini_subscription_request_unique").on(
      table.requestHash,
    ),
    userTemplateStatusIdx: index("wechat_mini_subscription_user_tpl_status_idx").on(
      table.userId,
      table.templateId,
      table.status,
      table.authorizedAt,
    ),
    openidTemplateStatusIdx: index("wechat_mini_subscription_openid_tpl_status_idx").on(
      table.openid,
      table.templateId,
      table.status,
      table.createdAt,
    ),
  }),
);
export type WechatMiniProgramSubscriptionGrant =
  typeof wechatMiniProgramSubscriptionGrants.$inferSelect;
export type InsertWechatMiniProgramSubscriptionGrant =
  typeof wechatMiniProgramSubscriptionGrants.$inferInsert;

/**
 * 服务号未读消息投递记录。
 *
 * 独立于短信表保存，避免“服务号已发出”与“短信是否发出”共用同一布尔字段；
 * 唯一索引确保同一用户、会话和最新消息位点只产生一次服务号提醒。
 */
export const wechatServiceNotificationDeliveries = mysqlTable(
  "wechat_service_notification_deliveries",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    conversationId: int("conversationId").notNull(),
    lastMessageId: int("lastMessageId").notNull(),
    unreadCount: int("unreadCount").notNull(),
    /** 实际占用该业务消息位点的微信通道；旧记录默认来自服务号。 */
    channel: varchar("channel", { length: 24 }).default("service_account").notNull(),
    status: varchar("status", { length: 24 }).default("claimed").notNull(),
    skipReason: varchar("skipReason", { length: 64 }),
    attemptCount: int("attemptCount").default(0).notNull(),
    clientMsgId: varchar("clientMsgId", { length: 64 }),
    wechatMessageId: varchar("wechatMessageId", { length: 64 }),
    lastAttemptAt: timestamp("lastAttemptAt"),
    sentAt: timestamp("sentAt"),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt")
      .default(DEFAULT_NOW)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    userConversationMessageUnique: uniqueIndex(
      "wechat_service_notification_user_conv_msg_unique",
    ).on(table.userId, table.conversationId, table.lastMessageId),
    userCreatedIdx: index("wechat_service_notification_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    statusCreatedIdx: index("wechat_service_notification_status_created_idx").on(
      table.status,
      table.createdAt,
    ),
  }),
);
export type WechatServiceNotificationDelivery =
  typeof wechatServiceNotificationDeliveries.$inferSelect;
export type InsertWechatServiceNotificationDelivery =
  typeof wechatServiceNotificationDeliveries.$inferInsert;

/**
 * 网站与小程序访问事件。
 *
 * visitorHash / sessionHash 由服务端使用密钥哈希客户端随机标识后保存；
 * 不保存完整 IP，也不采集聊天内容、搜索词或页面查询参数。
 */
export const sitePageViews = mysqlTable(
  "site_page_views",
  {
    id: int("id").autoincrement().primaryKey(),
    eventId: varchar("eventId", { length: 64 }).notNull(),
    visitorHash: varchar("visitorHash", { length: 64 }).notNull(),
    sessionHash: varchar("sessionHash", { length: 64 }).notNull(),
    userId: int("userId"),
    clientType: varchar("clientType", { length: 16 }).default("web").notNull(),
    path: varchar("path", { length: 255 }).notNull(),
    source: varchar("source", { length: 32 }).default("direct").notNull(),
    referrerHost: varchar("referrerHost", { length: 255 }),
    deviceType: varchar("deviceType", { length: 16 }).default("desktop").notNull(),
    occurredAt: timestamp("occurredAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    eventUnique: uniqueIndex("site_page_views_event_unique").on(table.eventId),
    occurredIdx: index("site_page_views_occurred_idx").on(table.occurredAt),
    visitorOccurredIdx: index("site_page_views_visitor_occurred_idx").on(
      table.visitorHash,
      table.occurredAt,
    ),
    userOccurredIdx: index("site_page_views_user_occurred_idx").on(
      table.userId,
      table.occurredAt,
    ),
    clientOccurredIdx: index("site_page_views_client_occurred_idx").on(
      table.clientType,
      table.occurredAt,
    ),
    pathOccurredIdx: index("site_page_views_path_occurred_idx").on(
      table.path,
      table.occurredAt,
    ),
  }),
);
export type SitePageView = typeof sitePageViews.$inferSelect;
export type InsertSitePageView = typeof sitePageViews.$inferInsert;

/** 后台业务员维护的公司代理证；objectKey严禁下发前台。 */
export const companyAgencyCertifications = mysqlTable("company_agency_certifications", {
  id: int("id").autoincrement().primaryKey(),
  companyId: int("companyId").notNull(), ownerUserId: int("ownerUserId").notNull(),
  brands: json("brands").$type<string[]>().notNull(),
  objectKey: varchar("objectKey", {length:512}).notNull(), fileName: varchar("fileName",{length:160}).notNull(),
  mimeType: varchar("mimeType",{length:64}).notNull(), fileSha256: varchar("fileSha256",{length:64}).notNull(),
  status: mysqlEnum("status",["active","cancelled","pending","rejected"]).default("active").notNull(),
  source: mysqlEnum("source",["legacy","frontend","manual"]).default("legacy").notNull(),
  authorizationIssuer: varchar("authorizationIssuer",{length:200}),
  validFrom: date("validFrom",{mode:"string"}), validUntil: date("validUntil",{mode:"string"}),
  supplementalNote: text("supplementalNote"), reviewReason: text("reviewReason"),
  supersedesCertificationId: int("supersedesCertificationId"),
  submittedAt: timestamp("submittedAt"), submittedBy: int("submittedBy"),
  reviewedAt: timestamp("reviewedAt"), reviewedBy: int("reviewedBy"),
  revision: int("revision").default(1).notNull(), createdBy: int("createdBy").notNull(), updatedBy: int("updatedBy").notNull(),
  createdAt: timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(), updatedAt: timestamp("updatedAt").default(sql`CURRENT_TIMESTAMP`).$onUpdate(() => new Date()).notNull(),
},table=>[index("agency_company_status_idx").on(table.companyId,table.status),index("agency_owner_status_idx").on(table.ownerUserId,table.status),index("agency_company_version_idx").on(table.companyId,table.id)]);
export const companyAgencyCertificationAudits = mysqlTable("company_agency_certification_audits", {
  id: int("id").autoincrement().primaryKey(), companyId:int("companyId").notNull(), ownerUserId:int("ownerUserId").notNull(), resultId:int("resultId").notNull(),
  action:varchar("action",{length:32}).notNull(), beforeValue:json("beforeValue"),afterValue:json("afterValue"),
  actorSource: mysqlEnum("actorSource",["manager","frontend"]).default("manager").notNull(),
  ipAddress:varchar("ipAddress",{length:64}),userAgent:varchar("userAgent",{length:512}),
  operatorId:int("operatorId").notNull(),operatorName:varchar("operatorName",{length:128}).notNull(),operatorRole:varchar("operatorRole",{length:64}).notNull(),
  requestId:varchar("requestId",{length:64}).notNull(),payloadHash:varchar("payloadHash",{length:64}).notNull(),createdAt:timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
},table=>[uniqueIndex("agency_request_once").on(table.companyId,table.actorSource,table.operatorId,table.requestId)]);
export const companyAgencyDocumentViews = mysqlTable("company_agency_document_views", {
  actorSource: mysqlEnum("actorSource",["manager","frontend"]).default("manager").notNull(),
  ipAddress:varchar("ipAddress",{length:64}),userAgent:varchar("userAgent",{length:512}),
  id:int("id").autoincrement().primaryKey(),companyId:int("companyId").notNull(),certificationId:int("certificationId").notNull(),operatorId:int("operatorId").notNull(),operatorName:varchar("operatorName",{length:128}).notNull(),createdAt:timestamp("createdAt").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const inventoryImportRepairs = mysqlTable("inventory_import_repairs", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  sourceJobId: varchar("sourceJobId", { length: 36 }).notNull(),
  sourceRowNumber: int("sourceRowNumber").notNull(),
  enterpriseId: int("enterpriseId").notNull(),
  sourceCreatedByUserId: int("sourceCreatedByUserId").notNull(),
  sourceDataOwnerUserId: int("sourceDataOwnerUserId").notNull(),
  correctedJson: json("correctedJson").$type<Record<string, unknown> | null>(),
  revision: int("revision").default(0).notNull(),
  status: mysqlEnum("status", ["pending", "ready", "queued", "success", "error", "existing"])
    .default("pending").notNull(),
  repairJobId: varchar("repairJobId", { length: 36 }),
  repairRequestId: varchar("repairRequestId", { length: 64 }),
  errorMessage: varchar("errorMessage", { length: 255 }),
  inventoryId: int("inventoryId"),
  createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).$onUpdate(() => new Date()).notNull(),
}, table => ({
  sourceUnique: uniqueIndex("inventory_import_repairs_source_unique").on(table.sourceJobId, table.sourceRowNumber),
  enterpriseStatusIdx: index("inventory_import_repairs_enterprise_status_idx").on(table.enterpriseId, table.status, table.updatedAt),
  repairJobIdx: index("inventory_import_repairs_repair_job_idx").on(table.repairJobId),
}));

export const inventoryImportRepairAudits = mysqlTable("inventory_import_repair_audits", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  sourceJobId: varchar("sourceJobId", { length: 36 }).notNull(),
  sourceRowNumber: int("sourceRowNumber").notNull(),
  enterpriseId: int("enterpriseId").notNull(),
  actorUserId: int("actorUserId").notNull(),
  action: varchar("action", { length: 16 }).notNull(), // save | submit
  revision: int("revision").notNull(),
  requestId: varchar("requestId", { length: 64 }).notNull(),
  correctedJson: json("correctedJson").$type<Record<string, unknown> | null>(),
  repairJobId: varchar("repairJobId", { length: 36 }),
  outcome: varchar("outcome", { length: 16 }).notNull(),
  errorMessage: varchar("errorMessage", { length: 255 }),
  createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
}, table => ({
  requestUnique: uniqueIndex("inventory_import_repair_audit_request_unique").on(
    table.sourceJobId, table.sourceRowNumber, table.action, table.requestId,
  ),
  sourceRevisionIdx: index("inventory_import_repair_audit_source_revision_idx").on(
    table.sourceJobId, table.sourceRowNumber, table.revision, table.id,
  ),
  repairJobIdx: index("inventory_import_repair_audit_repair_job_idx").on(table.repairJobId),
}));

/** Internal CLI-only supplier forum publishing. No public enrollment or future-supplier grant. */
export const supplierForumRecommendationPolicies = mysqlTable("supplier_forum_recommendation_policies", {
  id: int("id").primaryKey(), // singleton = 1; DB CHECK also enforces it
  enabled: boolean("enabled").default(false).notNull(),
  revision: int("revision", { unsigned: true }).default(1).notNull(),
  grants: json("grants").$type<import("../server/services/supplierForumRecommendationModel").SupplierForumGrant[]>().notNull(),
  lastPublishedEnterpriseId: int("lastPublishedEnterpriseId"),
  stoppedAt: immutableBeijingDateTime("stoppedAt"),
  updatedAt: immutableBeijingDateTime("updatedAt").default(DEFAULT_NOW).notNull(),
}, table => ({ singleton: check("supplier_forum_policy_singleton", sql`${table.id} = 1`) }));
export const supplierForumRecommendationRuns = mysqlTable("supplier_forum_recommendation_runs", {
  id: int("id").autoincrement().primaryKey(),
  policyId: int("policyId").notNull(),
  policyRevision: int("policyRevision", { unsigned: true }).notNull(),
  publishDate: date("publishDate", { mode: "string" }).notNull(),
  slotNo: int("slotNo").notNull(),
  plannedAt: immutableBeijingDateTime("plannedAt").notNull(),
  status: mysqlEnum("status", ["planned", "claimed", "published", "skipped", "failed"]).notNull(),
  enterpriseId: int("enterpriseId"),
  authorUserId: int("authorUserId"),
  content: text("content"),
  contentHash: char("contentHash", { length: 64 }),
  sourceVersions: json("sourceVersions").$type<import("../server/services/supplierForumRecommendationModel").SupplierForumSourceVersion[]>().notNull(),
  authorizationSnapshot: json("authorizationSnapshot").$type<import("../server/services/supplierForumRecommendationModel").SupplierForumGrant | null>(),
  ruleVersion: varchar("ruleVersion", { length: 32 }),
  clientMessageId: varchar("clientMessageId", { length: 64 }).notNull(),
  messageId: int("messageId"),
  leaseToken: char("leaseToken", { length: 36 }),
  leaseUntil: immutableBeijingDateTime("leaseUntil"),
  attempts: int("attempts", { unsigned: true }).default(0).notNull(),
  errorCode: varchar("errorCode", { length: 64 }),
  createdAt: immutableBeijingDateTime("createdAt").default(DEFAULT_NOW).notNull(),
  updatedAt: immutableBeijingDateTime("updatedAt").default(DEFAULT_NOW).notNull(),
}, table => ({
  // One global persisted 12-slot plan, NOT twelve posts per supplier.
  globalDaySlotUnique: uniqueIndex("supplier_forum_global_day_slot_unique").on(table.publishDate, table.slotNo),
  clientKeyUnique: uniqueIndex("supplier_forum_client_key_unique").on(table.clientMessageId),
  publishedHistoryIdx: index("supplier_forum_published_history_idx").on(table.status, table.publishDate),
  singleton: check("supplier_forum_run_policy_singleton", sql`${table.policyId} = 1`),
  slotRange: check("supplier_forum_slot_range", sql`${table.slotNo} BETWEEN 1 AND 12`),
  slotDay: check("supplier_forum_slot_day", sql`DATE(${table.plannedAt}) = ${table.publishDate}`),
  slotWindow: check("supplier_forum_slot_window", sql`TIME(${table.plannedAt}) >= '09:00:00' AND TIME(${table.plannedAt}) < '18:00:00' AND SECOND(${table.plannedAt}) = 0`),
  slotBucket: check("supplier_forum_slot_bucket", sql`(HOUR(${table.plannedAt}) * 60 + MINUTE(${table.plannedAt})) BETWEEN (540 + (${table.slotNo} - 1) * 45) AND (570 + (${table.slotNo} - 1) * 45)`),
  attemptCap: check("supplier_forum_attempt_cap", sql`${table.attempts} <= 2`),
}));
