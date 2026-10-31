import { and, desc, eq, like, or, sql } from "drizzle-orm";
import {
  companies,
  conversations,
  inventories,
  publicInventoryCompanyBindings,
  users,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { companyCatalogVisibleCondition } from "./inventoryVisibility";

/**
 * This is an intentionally opaque, server-issued capability.  A caller can only
 * obtain it from resolveChatContactConversationCompanyContext; profile and
 * inventory reads reject structural copies even if their fields look valid.
 */
const verifiedChatContactContextBrand = Symbol("verifiedChatContactContext");

export type VerifiedChatContactConversationCompanyContext = Readonly<{
  viewerUserId: number;
  contactUserId: number;
  conversationId: number;
  companyId: number | null;
  readonly [verifiedChatContactContextBrand]: true;
}>;

type ChatContactInput = Readonly<{
  viewerUserId: number;
  contactUserId: number;
  conversationId: number;
}>;

type ChatContactProfileInput = ChatContactInput & Readonly<{
  contextCompanyId: VerifiedChatContactConversationCompanyContext;
}>;

type ChatContactInventoryInput = ChatContactProfileInput & Readonly<{
  page: number;
  pageSize: number;
  keyword?: string;
}>;

type ChatContactDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

type ConversationContextRow = {
  user1Id: unknown;
  user2Id: unknown;
  user1EnterpriseId: unknown;
  user2EnterpriseId: unknown;
  user1CompanyId: unknown;
  user2CompanyId: unknown;
  identityContextKey: unknown;
};

type CompanyIdRow = { companyId: unknown };

const issuedChatContactContexts = new WeakSet<object>();

function rowsOf<Row>(result: unknown): Row[] {
  if (Array.isArray(result) && Array.isArray(result[0])) {
    return result[0] as Row[];
  }
  return Array.isArray(result) ? result as Row[] : [];
}

function positivePublicCompanyId(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function chatCompanySafeAlias(alias: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
    throw new Error("unsafe public inventory SQL alias");
  }
  return alias;
}

/**
 * Legacy rows have no immutable identity tuple.  The only accepted company is
 * therefore the company proved by that conversation's inquiry bindings, or the
 * single pre-conversation company permitted by the historical fallback.
 */
function conversationPublicCompanyJoinSql(
  conversationAlias = "c",
  peerUserAlias = "u",
  companyAlias = "comp",
) {
  const conversation = chatCompanySafeAlias(conversationAlias);
  const peer = chatCompanySafeAlias(peerUserAlias);
  const company = chatCompanySafeAlias(companyAlias);
  return sql.raw(`LEFT JOIN companies ${company} ON ${company}.id = CASE
    WHEN EXISTS (SELECT 1 FROM inventory_inquiries ctx_evidence
      WHERE ctx_evidence.conversationId = ${conversation}.id
        AND (ctx_evidence.sellerUserId = ${peer}.id OR ctx_evidence.assigneeUserId = ${peer}.id))
    THEN (SELECT CASE
      WHEN COUNT(*) > 0
        AND COUNT(ctx_b.companyId) = COUNT(*)
        AND COUNT(DISTINCT ctx_b.companyId) = 1
        AND SUM(CASE WHEN ctx_bound_company.id IS NOT NULL AND (
          (ctx_i.enterpriseId IS NULL
            AND ctx_bound_company.userId = ctx_i.sellerUserId)
          OR (ctx_i.enterpriseId IS NOT NULL
            AND ctx_enterprise.crmDataOwnerUserId = ctx_i.sellerUserId
            AND ctx_bound_company.userId = ctx_enterprise.crmDataOwnerUserId
            AND (ctx_bound_company.enterpriseId = ctx_i.enterpriseId OR ctx_bound_company.enterpriseId IS NULL))
        ) THEN 1 ELSE 0 END) = COUNT(*)
      THEN MIN(ctx_b.companyId) ELSE NULL END
      FROM inventory_inquiries ctx_i
      LEFT JOIN public_inventory_company_bindings ctx_b ON ctx_b.inventoryId = ctx_i.inventoryId
      LEFT JOIN companies ctx_bound_company ON ctx_bound_company.id = ctx_b.companyId
      LEFT JOIN enterprises ctx_enterprise ON ctx_enterprise.id = ctx_i.enterpriseId
      WHERE ctx_i.conversationId = ${conversation}.id
        AND (ctx_i.sellerUserId = ${peer}.id OR ctx_i.assigneeUserId = ${peer}.id))
    ELSE (SELECT CASE
      WHEN COUNT(*) = 1
        AND MIN(ctx_c.createdAt) IS NOT NULL
        AND ${conversation}.createdAt IS NOT NULL
        AND MIN(ctx_c.createdAt) <= ${conversation}.createdAt
      THEN MIN(ctx_c.id) ELSE NULL END
      FROM companies ctx_c
      WHERE ctx_c.userId = ${peer}.id)
    END`);
}

function issueVerifiedContext(
  input: ChatContactInput,
  companyId: number | null,
): VerifiedChatContactConversationCompanyContext {
  const context = Object.freeze({
    viewerUserId: input.viewerUserId,
    contactUserId: input.contactUserId,
    conversationId: input.conversationId,
    companyId,
    [verifiedChatContactContextBrand]: true as const,
  });
  issuedChatContactContexts.add(context);
  return context;
}

function isIssuedVerifiedContext(
  value: unknown,
): value is VerifiedChatContactConversationCompanyContext {
  if (typeof value !== "object" || value === null || !Object.isFrozen(value)) {
    return false;
  }
  return (value as { readonly [verifiedChatContactContextBrand]: unknown })[
    verifiedChatContactContextBrand
  ] === true && issuedChatContactContexts.has(value);
}

async function canViewChatContact(input: ChatContactInput): Promise<boolean> {
  const viewerUserId = positivePublicCompanyId(input.viewerUserId);
  const contactUserId = positivePublicCompanyId(input.contactUserId);
  const conversationId = positivePublicCompanyId(input.conversationId);
  if (!viewerUserId || !contactUserId || !conversationId || viewerUserId === contactUserId) {
    return false;
  }
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const user1Id = Math.min(viewerUserId, contactUserId);
  const user2Id = Math.max(viewerUserId, contactUserId);
  const [conversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(
      eq(conversations.id, conversationId),
      eq(conversations.user1Id, user1Id),
      eq(conversations.user2Id, user2Id),
    ))
    .limit(1);
  return Boolean(conversation);
}

/**
 * Reconstructs the peer company strictly from the conversation's frozen tuple.
 * It returns null (rather than choosing a current company) for malformed,
 * ambiguous, revoked, or unsupported contexts.
 */
async function resolveChatContactConversationCompanyIdFromDb(
  db: ChatContactDb,
  input: ChatContactInput,
): Promise<number | null> {
  const viewerUserId = positivePublicCompanyId(input.viewerUserId);
  const contactUserId = positivePublicCompanyId(input.contactUserId);
  const conversationId = positivePublicCompanyId(input.conversationId);
  if (!viewerUserId || !contactUserId || !conversationId || viewerUserId === contactUserId) {
    return null;
  }

  const conversationRows = rowsOf<ConversationContextRow>(await db.execute(sql`
    SELECT chat_context.user1Id AS user1Id,
           chat_context.user2Id AS user2Id,
           chat_context.user1EnterpriseId AS user1EnterpriseId,
           chat_context.user2EnterpriseId AS user2EnterpriseId,
           chat_context.user1CompanyId AS user1CompanyId,
           chat_context.user2CompanyId AS user2CompanyId,
           chat_context.identityContextKey AS identityContextKey
      FROM conversations chat_context
     WHERE chat_context.id = ${conversationId}
       AND ((chat_context.user1Id = ${viewerUserId} AND chat_context.user2Id = ${contactUserId})
         OR (chat_context.user1Id = ${contactUserId} AND chat_context.user2Id = ${viewerUserId}))
     LIMIT 2
  `));
  if (conversationRows.length !== 1) return null;

  const conversation = conversationRows[0];
  const user1Id = positivePublicCompanyId(conversation.user1Id);
  const user2Id = positivePublicCompanyId(conversation.user2Id);
  if (
    !user1Id
    || !user2Id
    || user1Id === user2Id
    || !(
      (user1Id === viewerUserId && user2Id === contactUserId)
      || (user1Id === contactUserId && user2Id === viewerUserId)
    )
  ) {
    return null;
  }

  if (conversation.identityContextKey === "legacy" || conversation.identityContextKey == null) {
    const legacyRows = rowsOf<CompanyIdRow>(await db.execute(sql`
      SELECT frozen_company.id AS companyId
        FROM conversations chat_context
        INNER JOIN users chat_peer
          ON chat_peer.id = CASE
            WHEN chat_context.user1Id = ${viewerUserId} THEN chat_context.user2Id
            ELSE chat_context.user1Id
          END
        ${conversationPublicCompanyJoinSql("chat_context", "chat_peer", "frozen_company")}
       WHERE chat_context.id = ${conversationId}
         AND ((chat_context.user1Id = ${viewerUserId} AND chat_context.user2Id = ${contactUserId})
           OR (chat_context.user1Id = ${contactUserId} AND chat_context.user2Id = ${viewerUserId}))
       LIMIT 1
    `));
    return positivePublicCompanyId(legacyRows[0]?.companyId);
  }

  const user1EnterpriseId = conversation.user1EnterpriseId === null
    ? 0
    : positivePublicCompanyId(conversation.user1EnterpriseId);
  const user2EnterpriseId = conversation.user2EnterpriseId === null
    ? 0
    : positivePublicCompanyId(conversation.user2EnterpriseId);
  const user1CompanyId = conversation.user1CompanyId === null
    ? 0
    : positivePublicCompanyId(conversation.user1CompanyId);
  const user2CompanyId = conversation.user2CompanyId === null
    ? 0
    : positivePublicCompanyId(conversation.user2CompanyId);
  if (
    user1EnterpriseId === null
    || user2EnterpriseId === null
    || user1CompanyId === null
    || user2CompanyId === null
    || typeof conversation.identityContextKey !== "string"
  ) {
    return null;
  }

  const user1Token = `u${user1Id}:e${user1EnterpriseId}:c${user1CompanyId}`;
  const user2Token = `u${user2Id}:e${user2EnterpriseId}:c${user2CompanyId}`;
  const expectedIdentityContextKey = user1Id < user2Id
    ? `v1:${user1Token}|${user2Token}`
    : `v1:${user2Token}|${user1Token}`;
  if (conversation.identityContextKey !== expectedIdentityContextKey) return null;

  const peerEnterpriseId = user1Id === contactUserId ? user1EnterpriseId : user2EnterpriseId;
  const peerCompanyId = user1Id === contactUserId ? user1CompanyId : user2CompanyId;
  if (!peerEnterpriseId || !peerCompanyId) return null;

  const verifiedRows = rowsOf<CompanyIdRow>(await db.execute(sql`
    SELECT frozen_company.id AS companyId
      FROM users chat_peer
      INNER JOIN enterprise_members chat_peer_member
        ON chat_peer_member.userId = chat_peer.id
       AND chat_peer_member.enterpriseId = ${peerEnterpriseId}
       AND chat_peer_member.status = 'active'
      INNER JOIN enterprises chat_peer_enterprise
        ON chat_peer_enterprise.id = chat_peer_member.enterpriseId
      INNER JOIN companies frozen_company
        ON frozen_company.id = ${peerCompanyId}
       AND frozen_company.userId = chat_peer_enterprise.crmDataOwnerUserId
       AND frozen_company.enterpriseId = chat_peer_enterprise.id
     WHERE chat_peer.id = ${contactUserId}
       AND COALESCE(chat_peer.loginDisabled, 0) = 0
     LIMIT 2
  `));
  return verifiedRows.length === 1
    ? positivePublicCompanyId(verifiedRows[0]?.companyId)
    : null;
}

async function resolveChatContactConversationCompanyId(
  input: ChatContactInput,
): Promise<number | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return resolveChatContactConversationCompanyIdFromDb(db, input);
}

/**
 * Issues an opaque, frozen context capability for one exact conversation tuple.
 * A null companyId is deliberate fail-closed state, not permission to pick a
 * company from the contact's current user record.
 */
export async function resolveChatContactConversationCompanyContext(
  input: ChatContactInput,
): Promise<VerifiedChatContactConversationCompanyContext> {
  const companyId = await resolveChatContactConversationCompanyId(input);
  return issueVerifiedContext(input, companyId);
}

async function resolveChatContactCompanyId(
  db: ChatContactDb,
  input: ChatContactProfileInput,
): Promise<number | null> {
  const context = input.contextCompanyId;
  if (!isIssuedVerifiedContext(context)) return null;

  const requestedCompanyId = positivePublicCompanyId(context.companyId);
  if (
    context.viewerUserId === context.contactUserId
    || context.viewerUserId !== input.viewerUserId
    || context.contactUserId !== input.contactUserId
    || context.conversationId !== input.conversationId
    || context.companyId !== (requestedCompanyId ?? null)
  ) {
    return null;
  }

  const verifiedCompanyId = await resolveChatContactConversationCompanyIdFromDb(db, context);
  return verifiedCompanyId !== null && verifiedCompanyId === requestedCompanyId
    ? verifiedCompanyId
    : null;
}

function firstInventoryPhotoUrl(value: unknown): string | null {
  let photos: unknown = value;
  if (typeof photos === "string") {
    try {
      photos = JSON.parse(photos);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(photos) || photos.length < 1) return null;
  const first = photos[0] as { url?: unknown } | null;
  return first && typeof first.url === "string" && first.url.trim()
    ? first.url.trim()
    : null;
}

/**
 * 聊一聊联系人资料：仅会话双方可读，且企业与库存只取会话中证明的公司映射。
 * 不返回认证、证照、银行、销售归属或其他敏感企业字段。
 */
export async function getChatContactProfile(input: ChatContactProfileInput) {
  if (!(await canViewChatContact(input))) return null;
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const companyId = await resolveChatContactCompanyId(db, input);
  const [profile] = await db
    .select({
      userId: users.id,
      name: users.name,
      username: users.username,
      avatarUrl: users.avatarUrl,
      jobTitle: users.jobTitle,
      phone: users.phone,
      wechatId: users.wechatId,
    })
    .from(users)
    .where(eq(users.id, input.contactUserId))
    .limit(1);
  if (!profile) return null;

  const [company] = companyId
    ? await db
      .select({
        id: companies.id,
        companyName: companies.companyName,
        companyType: companies.companyType,
        companyRole: companies.companyRole,
      })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1)
    : [];
  const [{ count }] = company
    ? await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(inventories)
      .innerJoin(
        publicInventoryCompanyBindings,
        eq(publicInventoryCompanyBindings.inventoryId, inventories.id),
      )
      .where(and(
        eq(publicInventoryCompanyBindings.companyId, Number(company.id)),
        eq(inventories.status, "published"),
        companyCatalogVisibleCondition(),
      ))
    : [{ count: 0 }];

  return {
    contact: {
      userId: profile.userId,
      name: profile.name?.trim() || profile.username?.trim() || "联系人",
      avatarUrl: profile.avatarUrl || null,
      jobTitle: profile.jobTitle?.trim() || null,
      phone: profile.phone?.trim() || null,
      wechatId: profile.wechatId?.trim() || null,
    },
    // companyId is additive and remains optional for existing clients.
    company: company?.companyName?.trim()
      ? {
        companyId: Number(company.id),
        name: company.companyName.trim(),
        type: company.companyType?.trim() || null,
        role: company.companyRole?.trim() || null,
      }
      : null,
    inventoryCount: Number(count ?? 0),
  };
}

/** 聊一聊联系人资料页：只读取会话证明公司已发布且公司目录可见的绑定库存。 */
export async function getChatContactInventory(input: ChatContactInventoryInput) {
  if (!(await canViewChatContact(input))) return null;
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const page = Math.max(1, Math.floor(input.page));
  const pageSize = Math.min(30, Math.max(1, Math.floor(input.pageSize)));
  const keyword = input.keyword?.trim().slice(0, 64) || "";
  const companyId = await resolveChatContactCompanyId(db, input);
  if (!companyId) {
    return {
      companyId: null,
      page,
      pageSize,
      total: 0,
      totalPages: 1,
      keyword,
      items: [],
      // Additive field: old clients can ignore it.
      inventoryContextStatus: "unavailable" as const,
      message: "暂无可展示物料",
    };
  }

  const conditions = [
    eq(publicInventoryCompanyBindings.companyId, companyId),
    eq(inventories.status, "published"),
    companyCatalogVisibleCondition(),
  ];
  if (keyword) {
    const pattern = `%${keyword}%`;
    conditions.push(or(
      like(inventories.partNumber, pattern),
      like(inventories.brand, pattern),
      like(inventories.category, pattern),
      like(inventories.pkg, pattern),
    )!);
  }
  const where = and(...conditions)!;
  const [{ total }] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(inventories)
    .innerJoin(
      publicInventoryCompanyBindings,
      eq(publicInventoryCompanyBindings.inventoryId, inventories.id),
    )
    .where(where);
  const items = await db
    .select({
      id: inventories.id,
      partNumber: inventories.partNumber,
      brand: inventories.brand,
      category: inventories.category,
      package: inventories.pkg,
      dateCode: inventories.dateCode,
      productionYear: inventories.prodYear,
      quantity: inventories.qtyOnSale,
      price: inventories.priceIncl,
      taxIncluded: inventories.taxIncluded,
      moq: inventories.moq,
      leadTime: inventories.leadTime,
      invoice: inventories.invoice,
      photos: inventories.photos,
      publishedAt: inventories.publishedAt,
      refreshedAt: inventories.refreshedAt,
    })
    .from(inventories)
    .innerJoin(
      publicInventoryCompanyBindings,
      eq(publicInventoryCompanyBindings.inventoryId, inventories.id),
    )
    .where(where)
    .orderBy(desc(inventories.refreshedAt), desc(inventories.publishedAt), desc(inventories.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const totalCount = Number(total ?? 0);
  return {
    companyId,
    page,
    pageSize,
    total: totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
    keyword,
    items: items.map(item => ({
      id: item.id,
      partNumber: item.partNumber,
      brand: item.brand,
      category: item.category,
      package: item.package,
      dateCode: item.dateCode,
      productionYear: item.productionYear,
      quantity: Number(item.quantity),
      price: item.price === null ? null : Number(item.price),
      taxIncluded: item.taxIncluded,
      moq: item.moq,
      leadTime: item.leadTime,
      invoice: item.invoice,
      imageUrl: firstInventoryPhotoUrl(item.photos),
      publishedAt: item.publishedAt,
      refreshedAt: item.refreshedAt,
    })),
  };
}
