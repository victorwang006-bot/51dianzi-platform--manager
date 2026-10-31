import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import {
  companies,
  companyHomepageFeatureAudits,
  companyProfilePhotos,
  inventories,
  users,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { normalizeEnterpriseCreditCode } from "./enterpriseAccess";
import { invalidateHomeSuppliersPublicCache } from "../homeSuppliersPublicRoute";

export type InternalCompanyHomepageOperator = {
  id: string | number;
  name: string;
  role: string;
  ipAddress: string | null;
  userAgent: string | null;
};

type CompanyLookupInput = {
  creditCode: string;
  expectedOwnerUserId: number;
};

type HomepageFeatureMutationInput = CompanyLookupInput & {
  featured: boolean;
  reason: string;
  requestId: string;
  /** This object is supplied by the independently authenticated admin backend, never the browser. */
  operator: InternalCompanyHomepageOperator;
};

type CompanyFeatureRow = {
  companyId: number;
  ownerUserId: number;
  companyName: string | null;
  creditCode: string | null;
  homepageFeatured: boolean | number;
  homepageFeaturedUpdatedAt: Date | null;
  homepageFeaturedUpdatedBy: string | null;
  homepageShowcased: boolean | number;
  homepageShowcasedUpdatedAt: Date | null;
  homepageShowcasedUpdatedBy: string | null;
  reviewStatus: "pending" | "approved" | "rejected";
  certLevel: "pending" | "certified" | "premium";
  crmAccess: boolean | number;
  legalPerson: string | null;
  regAddress: string | null;
  approvedPhotoCount: number | string;
  hasPublicPublishedInventory: number | string | boolean;
};

type AuditRow = {
  action: string;
  payloadHash: string;
  afterValue: unknown;
};

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
  return db;
}

function normalizeOperator(operator: InternalCompanyHomepageOperator) {
  return {
    id: String(operator.id).trim(),
    name: operator.name.trim(),
    role: operator.role.trim(),
    ipAddress: operator.ipAddress?.trim() || null,
    userAgent: operator.userAgent?.trim() || null,
  };
}

function normalizeCreditCode(creditCode: string) {
  const normalized = normalizeEnterpriseCreditCode(creditCode);
  if (!normalized) throw new TRPCError({ code: "BAD_REQUEST", message: "统一社会信用代码无效" });
  return normalized;
}

function publicProfileEligible(row: CompanyFeatureRow) {
  return row.reviewStatus === "approved"
    && (row.certLevel === "certified" || row.certLevel === "premium")
    && Boolean(row.crmAccess)
    && Boolean(row.companyName?.trim())
    && Boolean(row.creditCode?.trim())
    && Boolean(row.legalPerson?.trim())
    && Boolean(row.regAddress?.trim());
}

function eligibility(row: CompanyFeatureRow) {
  const approvedPhotoCount = Number(row.approvedPhotoCount ?? 0);
  const hasPublishedInventory = Boolean(Number(row.hasPublicPublishedInventory ?? 0));
  const isPublicProfileEligible = publicProfileEligible(row);
  const missingReasons: string[] = [];
  if (!isPublicProfileEligible) missingReasons.push("企业公开资料或认证状态待完善");
  if (approvedPhotoCount < 1) missingReasons.push("缺少已公开公司照片");
  if (!hasPublishedInventory) missingReasons.push("缺少公开在售库存");
  return {
    publicProfileEligible: isPublicProfileEligible,
    approvedPhotoCount,
    hasPublishedInventory,
    missingReasons,
    eligible: isPublicProfileEligible && approvedPhotoCount >= 1 && hasPublishedInventory,
  };
}

function status(
  row: CompanyFeatureRow,
  featured = Boolean(row.homepageFeatured),
  showcased = Boolean(row.homepageShowcased),
) {
  return {
    companyId: row.companyId,
    ownerUserId: row.ownerUserId,
    companyName: row.companyName?.trim() || null,
    featured,
    showcased,
    homepageFeaturedUpdatedAt: row.homepageFeaturedUpdatedAt,
    homepageFeaturedUpdatedBy: row.homepageFeaturedUpdatedBy,
    homepageShowcasedUpdatedAt: row.homepageShowcasedUpdatedAt,
    homepageShowcasedUpdatedBy: row.homepageShowcasedUpdatedBy,
    ...eligibility(row),
  };
}

function assertExpectedOwner(row: CompanyFeatureRow, expectedOwnerUserId: number) {
  if (row.ownerUserId !== expectedOwnerUserId) {
    throw new TRPCError({ code: "CONFLICT", message: "企业所有者已变化，请刷新后重试" });
  }
}

async function loadCompany(database: any, normalizedCreditCode: string, forUpdate = false) {
  const query = database
    .select({
      companyId: companies.id,
      ownerUserId: companies.userId,
      companyName: companies.companyName,
      creditCode: companies.creditCode,
      homepageFeatured: companies.homepageFeatured,
      homepageFeaturedUpdatedAt: companies.homepageFeaturedUpdatedAt,
      homepageFeaturedUpdatedBy: companies.homepageFeaturedUpdatedBy,
      homepageShowcased: companies.homepageShowcased,
      homepageShowcasedUpdatedAt: companies.homepageShowcasedUpdatedAt,
      homepageShowcasedUpdatedBy: companies.homepageShowcasedUpdatedBy,
      reviewStatus: companies.reviewStatus,
      certLevel: companies.certLevel,
      crmAccess: users.crmAccess,
      legalPerson: companies.legalPerson,
      regAddress: companies.regAddress,
      approvedPhotoCount: sql<number>`(
        SELECT COUNT(*)
          FROM company_profile_photos AS approved_company_photo
         WHERE approved_company_photo.companyId = ${companies.id}
           AND approved_company_photo.status = 'approved'
           AND approved_company_photo.deletedAt IS NULL
      )`,
      hasPublicPublishedInventory: sql<number>`EXISTS (
        SELECT 1
          FROM inventories AS public_inventory
         WHERE public_inventory.userId = ${companies.userId}
           AND public_inventory.status = 'published'
           AND public_inventory.companyCatalogVisible = 1
         LIMIT 1
      )`,
    })
    .from(companies)
    .innerJoin(users, eq(users.id, companies.userId))
    .where(eq(companies.creditCode, normalizedCreditCode))
    .limit(1);
  const rows = forUpdate ? await query.for("update") : await query;
  return (rows[0] ?? null) as CompanyFeatureRow | null;
}

function canonicalPayload(
  input: HomepageFeatureMutationInput,
  normalizedCreditCode: string,
  operator: ReturnType<typeof normalizeOperator>,
) {
  return {
    action: input.featured ? "homepage_featured_set" : "homepage_featured_cleared",
    creditCode: normalizedCreditCode,
    expectedOwnerUserId: input.expectedOwnerUserId,
    featured: input.featured,
    reason: input.reason.trim(),
    requestId: input.requestId.trim(),
    operator,
  };
}

function hashPayload(payload: ReturnType<typeof canonicalPayload>) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function auditValue(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // Historic malformed JSON cannot establish an idempotent result.
    }
  }
  return {};
}

function idempotentFeaturedState(audit: AuditRow, expectedAction: string, expectedHash: string) {
  if (audit.payloadHash !== expectedHash || audit.action !== expectedAction) {
    throw new TRPCError({ code: "CONFLICT", message: "requestId 已用于不同的首页优质商家操作" });
  }
  const after = auditValue(audit.afterValue);
  if (typeof after.homepageFeatured !== "boolean") {
    throw new TRPCError({ code: "CONFLICT", message: "requestId 对应的首页优质商家审计无效" });
  }
  return after.homepageFeatured;
}

/** 按统一信用代码和预期企业主账号读取后台可见的首页优质状态与展示资格。 */
export async function getInternalCompanyHomepageFeatureStatus(input: CompanyLookupInput) {
  const db = await requireDb();
  const normalizedCreditCode = normalizeCreditCode(input.creditCode);
  const row = await loadCompany(db, normalizedCreditCode);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "企业不存在" });
  assertExpectedOwner(row, input.expectedOwnerUserId);
  return status(row);
}

/**
 * 设置或取消首页优质商家。即使当前暂不具备公开展示资格也允许保存后台状态；
 * 公开查询仍会实时以资格条件二次过滤，绝不会因该状态泄露未公开企业。
 */
export async function setInternalCompanyHomepageFeatured(input: HomepageFeatureMutationInput) {
  const db = await requireDb();
  const normalizedCreditCode = normalizeCreditCode(input.creditCode);
  const operator = normalizeOperator(input.operator);
  const payload = canonicalPayload(input, normalizedCreditCode, operator);
  const expectedHash = hashPayload(payload);

  const result = await db.transaction(async tx => {
    const row = await loadCompany(tx, normalizedCreditCode, true);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "企业不存在" });
    assertExpectedOwner(row, input.expectedOwnerUserId);

    const [existingAudit] = await tx
      .select({
        action: companyHomepageFeatureAudits.action,
        payloadHash: companyHomepageFeatureAudits.payloadHash,
        afterValue: companyHomepageFeatureAudits.afterValue,
      })
      .from(companyHomepageFeatureAudits)
      .where(eq(companyHomepageFeatureAudits.requestId, input.requestId.trim()))
      .limit(1)
      .for("update");
    const action = payload.action;
    if (existingAudit) {
      const homepageFeatured = idempotentFeaturedState(existingAudit as AuditRow, action, expectedHash);
      return { success: true as const, idempotent: true, ...status(row, homepageFeatured) };
    }

    const now = new Date();
    const beforeValue = {
      homepageFeatured: Boolean(row.homepageFeatured),
      homepageFeaturedUpdatedAt: row.homepageFeaturedUpdatedAt?.toISOString() ?? null,
      homepageFeaturedUpdatedBy: row.homepageFeaturedUpdatedBy,
    };
    const afterValue = {
      homepageFeatured: input.featured,
      homepageFeaturedUpdatedAt: now.toISOString(),
      homepageFeaturedUpdatedBy: operator.id,
    };
    await tx
      .update(companies)
      .set({
        homepageFeatured: input.featured,
        homepageFeaturedUpdatedAt: now,
        homepageFeaturedUpdatedBy: operator.id,
      })
      .where(and(eq(companies.id, row.companyId), eq(companies.userId, input.expectedOwnerUserId)));
    await tx.insert(companyHomepageFeatureAudits).values({
      companyId: row.companyId,
      ownerUserId: row.ownerUserId,
      action,
      beforeValue,
      afterValue,
      reason: input.reason.trim(),
      requestId: input.requestId.trim(),
      payloadHash: expectedHash,
      operatorId: operator.id,
      operatorName: operator.name,
      operatorRole: operator.role,
      ipAddress: operator.ipAddress,
      userAgent: operator.userAgent,
    });
    return { success: true as const, idempotent: false, ...status(row, input.featured) };
  });
  if (!result.idempotent) invalidateHomeSuppliersPublicCache();
  return result;
}

export async function setInternalCompanyHomepageShowcased(input: HomepageFeatureMutationInput) {
  const db = await requireDb();
  const normalizedCreditCode = normalizeCreditCode(input.creditCode);
  const operator = normalizeOperator(input.operator);
  const payload = {
    action: input.featured ? "homepage_showcased_set" : "homepage_showcased_cleared",
    creditCode: normalizedCreditCode,
    expectedOwnerUserId: input.expectedOwnerUserId,
    featured: input.featured,
    reason: input.reason.trim(),
    requestId: input.requestId.trim(),
    operator,
  };
  const expectedHash = hashPayload(payload);

  const result = await db.transaction(async tx => {
    const row = await loadCompany(tx, normalizedCreditCode, true);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "企业不存在" });
    assertExpectedOwner(row, input.expectedOwnerUserId);

    const [existingAudit] = await tx
      .select({
        action: companyHomepageFeatureAudits.action,
        payloadHash: companyHomepageFeatureAudits.payloadHash,
        afterValue: companyHomepageFeatureAudits.afterValue,
      })
      .from(companyHomepageFeatureAudits)
      .where(eq(companyHomepageFeatureAudits.requestId, input.requestId.trim()))
      .limit(1)
      .for("update");
    if (existingAudit) {
      if (existingAudit.payloadHash !== expectedHash || existingAudit.action !== payload.action) {
        throw new TRPCError({ code: "CONFLICT", message: "requestId 已用于不同的首页展示商家操作" });
      }
      const after = auditValue(existingAudit.afterValue);
      if (typeof after.homepageShowcased !== "boolean") {
        throw new TRPCError({ code: "CONFLICT", message: "requestId 对应的首页展示商家审计无效" });
      }
      return { success: true as const, idempotent: true, ...status(row, Boolean(row.homepageFeatured), after.homepageShowcased) };
    }

    const now = new Date();
    const beforeValue = {
      homepageShowcased: Boolean(row.homepageShowcased),
      homepageShowcasedUpdatedAt: row.homepageShowcasedUpdatedAt?.toISOString() ?? null,
      homepageShowcasedUpdatedBy: row.homepageShowcasedUpdatedBy,
    };
    const afterValue = {
      homepageShowcased: input.featured,
      homepageShowcasedUpdatedAt: now.toISOString(),
      homepageShowcasedUpdatedBy: operator.id,
    };
    await tx
      .update(companies)
      .set({
        homepageShowcased: input.featured,
        homepageShowcasedUpdatedAt: now,
        homepageShowcasedUpdatedBy: operator.id,
      })
      .where(and(eq(companies.id, row.companyId), eq(companies.userId, input.expectedOwnerUserId)));
    await tx.insert(companyHomepageFeatureAudits).values({
      companyId: row.companyId,
      ownerUserId: row.ownerUserId,
      action: payload.action,
      beforeValue,
      afterValue,
      reason: input.reason.trim(),
      requestId: input.requestId.trim(),
      payloadHash: expectedHash,
      operatorId: operator.id,
      operatorName: operator.name,
      operatorRole: operator.role,
      ipAddress: operator.ipAddress,
      userAgent: operator.userAgent,
    });
    return { success: true as const, idempotent: false, ...status(row, Boolean(row.homepageFeatured), input.featured) };
  });
  if (!result.idempotent) invalidateHomeSuppliersPublicCache();
  return result;
}

/** Kept as a narrow testing seam for hash/idempotency contract tests; it does not expose database access. */
export const internalCompanyHomepageFeatureTestUtils = { eligibility, canonicalPayload, hashPayload };
