import { TRPCError } from "@trpc/server";
import { BusinessFailureCause } from "../../../shared/businessFailure";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  companies,
  crmOwnerTransferLogs,
  enterpriseMembers,
  enterprises,
  users,
  type Enterprise,
  type EnterpriseMember,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { applyAdminCrmAccess, setCrmAccess } from "../db";
import {
  getAdminCrmAccess,
  getAdminCrmBinding,
  getAdminHkCrmAccess,
  getAdminHkCrmBinding,
  rebindCrmOwnerByEnterpriseOwner,
} from "./customerService";
import {
  normalizeHkEnterpriseRegistrationIdentifier,
  type EnterpriseRegistrationIdentity,
} from "./enterpriseRegistrationIdentity";
import { companyMatchesEnterpriseIdentity, selectEnterpriseCompanyRecord, selectPersonalCompanyRecord } from "./enterpriseCompanySelection";
export { selectEnterpriseCompanyRecord } from "./enterpriseCompanySelection";
import { ERP_PERMISSION_KEYS } from "../../../shared/erpPermissions";
import { requireEnterprisePermissionManager, resolveEnterprisePermissionScope } from "./enterprisePermissions";
import {
  enterpriseSelectionRequiredError,
  getEnterpriseBusinessRequestContext,
} from "./enterpriseRequestContext";
import { sendVerificationCode, verifyCode } from "./smsService";
import {
  createOwnershipTransferVerificationTicket,
  maskOwnershipTransferPhone,
  OWNERSHIP_TRANSFER_SMS_SCENE,
  OWNERSHIP_TRANSFER_TICKET_TTL_SECONDS,
  ownershipTransferVerificationContextKey,
  verifyOwnershipTransferVerificationTicket,
} from "./enterpriseOwnershipTransfer";
import { notifyEnterpriseOwnershipTransferRecipients } from "./enterpriseOwnershipNotifications";

type SessionContext = {
  user: { id: number };
};

export type EnterpriseScope = {
  enterprise: Enterprise;
  member: EnterpriseMember | null;
  dataOwnerUserId: number;
  portalOwnerUserId: number;
};

async function requireDb() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
  }
  return db;
}

function isDuplicateKeyError(error: unknown) {
  const value = error as { code?: string; errno?: number } | null;
  return value?.code === "ER_DUP_ENTRY" || value?.errno === 1062;
}

function affectedRows(result: unknown) {
  return Number((result as unknown as [{ affectedRows?: number }, unknown])?.[0]?.affectedRows ?? 0);
}

async function ensureOwnerPermissions(
  executor: { execute: (...args: any[]) => Promise<unknown> },
  enterpriseId: number,
  ownerUserId: number,
) {
  for (const permissionKey of ERP_PERMISSION_KEYS) {
    await executor.execute(sql`
      INSERT IGNORE INTO enterprise_member_permissions
        (enterpriseMemberId, permissionKey, grantedByUserId)
      SELECT id, ${permissionKey}, ${ownerUserId}
      FROM enterprise_members
      WHERE enterpriseId = ${enterpriseId} AND userId = ${ownerUserId}
      LIMIT 1
    `);
  }
}

export function normalizeEnterpriseCreditCode(creditCode: string) {
  const normalized = creditCode.replace(/\s/g, "").toUpperCase();
  if (!/^[0-9A-HJ-NPQRTUWXY]{18}$/.test(normalized)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "请输入18位统一社会信用代码" });
  }
  return normalized;
}

function normalizeHkRegistrationIdentifier(registrationIdentifier: string) {
  try {
    return normalizeHkEnterpriseRegistrationIdentifier(registrationIdentifier);
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "香港企业标识必须为 HK: 加 8 位商业登记号码 BRN" });
  }
}

function normalizeEnterpriseRegistrationIdentity(input: {
  creditCode?: string | null;
  registrationIdentifier?: string | null;
}): EnterpriseRegistrationIdentity {
  const creditCode = input.creditCode?.trim();
  const registrationIdentifier = input.registrationIdentifier?.trim();
  if (Boolean(creditCode) === Boolean(registrationIdentifier)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "必须且只能提供统一社会信用代码或香港企业标识" });
  }
  return creditCode
    ? { kind: "CN", creditCode: normalizeEnterpriseCreditCode(creditCode) }
    : { kind: "HK", registrationIdentifier: normalizeHkRegistrationIdentifier(registrationIdentifier!) };
}

function enterpriseIdentityMatches(
  enterprise: Pick<Enterprise, "creditCode" | "registrationRegion" | "registrationIdentifier">,
  identity: EnterpriseRegistrationIdentity,
) {
  return identity.kind === "CN"
    ? enterprise.creditCode === identity.creditCode
    : enterprise.registrationRegion === "HK" && enterprise.registrationIdentifier === identity.registrationIdentifier;
}

async function findEnterpriseByIdentity(
  executor: { select: (...args: any[]) => any },
  identity: EnterpriseRegistrationIdentity,
) {
  return (
    await executor
      .select()
      .from(enterprises)
      .where(identity.kind === "CN"
        ? eq(enterprises.creditCode, identity.creditCode)
        : and(
            eq(enterprises.registrationRegion, "HK"),
            eq(enterprises.registrationIdentifier, identity.registrationIdentifier),
          ))
      .limit(1)
  )[0];
}

function normalizeCreditCodeForComparison(creditCode: string | null | undefined) {
  return String(creditCode ?? "").replace(/\s/g, "").toUpperCase();
}

function isClearlyInvalidOrPlaceholderCreditCode(creditCode: string | null | undefined) {
  const normalized = normalizeCreditCodeForComparison(creditCode);
  return !/^[0-9A-HJ-NPQRTUWXY]{18}$/.test(normalized)
    || /^0{18}$/.test(normalized)
    || /(?:TEST|UNKNOWN|PLACEHOLDER|DEMO|TEMP)/.test(normalized);
}

/**
 * An owner cannot silently repurpose an established enterprise into a different company.
 * A repair is deliberately narrow: an obviously bad legacy code, or a code that conflicts
 * with the owner's already-approved company record and is being restored to that record.
 */
export function canRepairEnterpriseCreditCode(input: {
  currentEnterpriseCreditCode: string | null | undefined;
  requestedCreditCode: string;
  approvedCompanyCreditCode?: string | null;
}) {
  const current = normalizeCreditCodeForComparison(input.currentEnterpriseCreditCode);
  const requested = normalizeCreditCodeForComparison(input.requestedCreditCode);
  if (current === requested) return false;
  if (isClearlyInvalidOrPlaceholderCreditCode(current)) return true;

  const approved = normalizeCreditCodeForComparison(input.approvedCompanyCreditCode);
  return Boolean(approved)
    && current !== approved
    && requested === approved;
}

export async function getEnterpriseContextForUser(userId: number) {
  const db = await requireDb();
  const request = getEnterpriseBusinessRequestContext(userId);
  const rows = await db
    .select({ enterprise: enterprises, member: enterpriseMembers })
    .from(enterpriseMembers)
    .innerJoin(enterprises, eq(enterpriseMembers.enterpriseId, enterprises.id))
    .where(request?.enterpriseId
      ? and(
          eq(enterpriseMembers.userId, userId),
          eq(enterpriseMembers.enterpriseId, request.enterpriseId),
        )
      : eq(enterpriseMembers.userId, userId))
    .orderBy(asc(enterpriseMembers.enterpriseId))
    // Never turn a multi-enterprise member into whichever row happens to be first.
    .limit(request?.enterpriseId ? 1 : 2);
  if (!request?.enterpriseId && rows.length > 1) throw enterpriseSelectionRequiredError();
  return rows[0] ?? null;
}

function parsePortalUserId(value: string, label: string) {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${label}不是有效前台用户 ID` });
  }
  const userId = Number(normalized);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${label}不是有效前台用户 ID` });
  }
  return userId;
}

/** 后台专用换绑的前置校验：目标必须是同企业、active 的独立账号成员。 */
export async function validateEnterpriseRebindTarget(input: {
  creditCode?: string;
  registrationIdentifier?: string;
  expectedPortalUserId: string;
  newPortalUserId: string;
}) {
  const db = await requireDb();
  const identity = normalizeEnterpriseRegistrationIdentity(input);
  const expectedSuperAdminUserId = parsePortalUserId(input.expectedPortalUserId, "当前超级管理员");
  const targetUserId = parsePortalUserId(input.newPortalUserId, "新超级管理员");
  if (expectedSuperAdminUserId === targetUserId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "新超级管理员不能与当前绑定账号相同" });
  }

  const enterprise = await findEnterpriseByIdentity(db, identity);
  if (!enterprise) {
    throw new TRPCError({ code: "NOT_FOUND", message: "前台尚未建立该企业归属，请先完成企业认领" });
  }
  if (enterprise.superAdminUserId !== expectedSuperAdminUserId) {
    throw new TRPCError({ code: "CONFLICT", message: "前台企业超级管理员已变化，请刷新后重试" });
  }

  const target = (
    await db
      .select({ member: enterpriseMembers, userId: users.id })
      .from(enterpriseMembers)
      .innerJoin(users, eq(enterpriseMembers.userId, users.id))
      .where(
        and(
          eq(enterpriseMembers.enterpriseId, enterprise.id),
          eq(enterpriseMembers.userId, targetUserId),
          eq(enterpriseMembers.status, "active"),
        ),
      )
      .limit(1)
  )[0];
  if (!target) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "新超级管理员必须先以有效独立账号加入当前企业",
    });
  }

  return {
    valid: true,
    enterpriseId: enterprise.id,
    ...(identity.kind === "CN"
      ? { creditCode: identity.creditCode }
      : { registrationIdentifier: identity.registrationIdentifier }),
    expectedSuperAdminUserId,
    targetUserId,
  } as const;
}

export async function getEnterpriseCompany(enterprise: Enterprise) {
  const db = await requireDb();
  const [linked, legacy, ownerEnterprises] = await Promise.all([
    db.select().from(companies).where(eq(companies.enterpriseId, enterprise.id)),
    db.select().from(companies).where(eq(companies.userId, enterprise.crmDataOwnerUserId)),
    db.select({ id: enterprises.id }).from(enterprises)
      .where(eq(enterprises.crmDataOwnerUserId, enterprise.crmDataOwnerUserId)).limit(2),
  ]);
  const candidates = [...linked, ...legacy].filter(company => company.enterpriseId === enterprise.id
    || ownerEnterprises.length === 1 || companyMatchesEnterpriseIdentity(company, enterprise));
  return selectEnterpriseCompanyRecord(enterprise, candidates);
}

async function linkLegacyEnterpriseRows(enterprise: Enterprise) {
  const db = await requireDb();
  await linkSelectedCompanyRecord(db, enterprise.crmDataOwnerUserId, enterprise);
}

async function linkSelectedCompanyRecord(
  executor: Pick<NonNullable<Awaited<ReturnType<typeof getDb>>>, "select" | "update">,
  dataOwnerUserId: number,
  enterprise: Enterprise,
  companyId?: number,
) {
  const rows = await executor.select().from(companies).where(eq(companies.userId, dataOwnerUserId));
  let candidates = rows.filter(row => row.id === companyId);
  if (companyId === undefined) {
    const ownerEnterprises = await executor.select({ id: enterprises.id }).from(enterprises)
      .where(eq(enterprises.crmDataOwnerUserId, dataOwnerUserId)).limit(2);
    // Apply the same legacy attribution rule as reads; a shared owner's blank row has no tenant proof.
    candidates = rows.filter(row => row.enterpriseId === enterprise.id
      || ownerEnterprises.length === 1 || companyMatchesEnterpriseIdentity(row, enterprise));
  }
  const selected = selectEnterpriseCompanyRecord(enterprise, candidates);
  if (!selected) {
    if (companyId !== undefined) throw new TRPCError({ code: "CONFLICT", message: "公司资料不属于当前企业，拒绝关联" });
    return;
  }
  await executor.update(companies).set({ enterpriseId: enterprise.id }).where(and(
    eq(companies.id, selected.id), eq(companies.userId, dataOwnerUserId),
    selected.enterpriseId === null ? isNull(companies.enterpriseId) : eq(companies.enterpriseId, enterprise.id),
  ));
}

/**
 * 后台已明确接受当前 portalUserId 的 CRM 申请后调用。
 * 企业唯一记录和首位 super_admin 成员在同一事务内创建；唯一索引负责并发仲裁。
 */
export async function claimEnterpriseForCrmApplication(input: {
  userId: number;
  creditCode: string;
  companyName: string;
}) {
  const db = await requireDb();
  const creditCode = normalizeEnterpriseCreditCode(input.creditCode);
  const companyName = input.companyName.trim();

  try {
    const result = await db.transaction(async tx => {
      const memberships = await tx
        .select()
        .from(enterpriseMembers)
        .where(eq(enterpriseMembers.userId, input.userId))
        .limit(1);
      const existingMembership = memberships[0];

      const existingEnterprises = await tx
        .select()
        .from(enterprises)
        .where(eq(enterprises.creditCode, creditCode))
        .limit(1);
      const existingEnterprise = existingEnterprises[0];

      if (existingMembership && !existingEnterprise) {
        const currentEnterprise = (
          await tx
            .select()
            .from(enterprises)
            .where(eq(enterprises.id, existingMembership.enterpriseId))
            .limit(1)
            .for("update")
        )[0];
        const approvedCompanies = await tx
          .select({ creditCode: companies.creditCode, reviewStatus: companies.reviewStatus, enterpriseId: companies.enterpriseId })
          .from(companies)
          .where(eq(companies.userId, currentEnterprise?.crmDataOwnerUserId ?? input.userId))
          .for("update");
        const isCurrentOwner = Boolean(
          currentEnterprise
          && existingMembership.role === "super_admin"
          && currentEnterprise.superAdminUserId === input.userId,
        );
        const approvedCompanyCreditCode = approvedCompanies.find(company =>
          company.reviewStatus === "approved"
          && normalizeCreditCodeForComparison(company.creditCode) === creditCode
          && (company.enterpriseId === null || company.enterpriseId === currentEnterprise?.id),
        )?.creditCode ?? null;
        if (
          currentEnterprise
          && currentEnterprise.registrationRegion !== "HK"
          && isCurrentOwner
          && Boolean(approvedCompanyCreditCode)
          && canRepairEnterpriseCreditCode({
            currentEnterpriseCreditCode: currentEnterprise.creditCode,
            requestedCreditCode: creditCode,
            approvedCompanyCreditCode,
          })
        ) {
          await tx
            .update(enterprises)
            .set({ creditCode, companyName })
            .where(eq(enterprises.id, currentEnterprise.id));
          await tx
            .update(enterpriseMembers)
            .set({
              role: "super_admin",
              status: "active",
              inventoryDataScope: "enterprise",
              suspendedAt: null,
            })
            .where(eq(enterpriseMembers.id, existingMembership.id));
          return {
            enterprise: { ...currentEnterprise, creditCode, companyName },
            created: false,
            repairedCreditCode: true,
          };
        }
        throw new TRPCError({
          code: "CONFLICT",
          message: isCurrentOwner
            ? "当前企业信用代码是有效的其他企业代码，不能自动改写"
            : "当前账号已归属其他企业，不能认领新的企业",
        });
      }

      if (existingEnterprise) {
        if (existingEnterprise.superAdminUserId !== input.userId) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "该企业已被认领，请由企业管理员通过手机号发送邀请",
          });
        }
        if (existingMembership && existingMembership.enterpriseId !== existingEnterprise.id) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "当前账号已归属其他企业，不能重复认领",
          });
        }
        if (existingMembership) {
          await tx
            .update(enterpriseMembers)
            .set({
              role: "super_admin",
              status: "active",
              inventoryDataScope: "enterprise",
              suspendedAt: null,
            })
            .where(eq(enterpriseMembers.id, existingMembership.id));
        } else {
          await tx.insert(enterpriseMembers).values({
            enterpriseId: existingEnterprise.id,
            userId: input.userId,
            role: "super_admin",
            status: "active",
            inventoryDataScope: "enterprise",
          });
        }
        await tx
          .update(enterprises)
          .set({ companyName })
          .where(eq(enterprises.id, existingEnterprise.id));
        return { enterprise: { ...existingEnterprise, companyName }, created: false };
      }

      if (existingMembership) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "当前账号已归属其他企业，不能认领新的企业",
        });
      }

      const insertResult = await tx.insert(enterprises).values({
        creditCode,
        companyName,
        superAdminUserId: input.userId,
        crmDataOwnerUserId: input.userId,
      });
      const insertHeader = (insertResult as unknown as Array<{ insertId?: number }>)[0];
      const enterpriseId = Number(insertHeader?.insertId ?? 0);
      const createdRows = enterpriseId > 0
        ? await tx.select().from(enterprises).where(eq(enterprises.id, enterpriseId)).limit(1)
        : await tx.select().from(enterprises).where(eq(enterprises.creditCode, creditCode)).limit(1);
      const createdEnterprise = createdRows[0];
      if (!createdEnterprise) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "企业认领失败" });
      }

      await tx.insert(enterpriseMembers).values({
        enterpriseId: createdEnterprise.id,
        userId: input.userId,
        role: "super_admin",
        status: "active",
        inventoryDataScope: "enterprise",
      });
      await linkSelectedCompanyRecord(tx, input.userId, createdEnterprise);
      return { enterprise: createdEnterprise, created: true };
    });

    await ensureOwnerPermissions(db, result.enterprise.id, input.userId);
    await linkLegacyEnterpriseRows(result.enterprise);
    return result;
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    if (isDuplicateKeyError(error)) {
      const existing = await db
        .select()
        .from(enterprises)
        .where(eq(enterprises.creditCode, creditCode))
        .limit(1);
      if (existing[0]?.superAdminUserId === input.userId) {
        return claimEnterpriseForCrmApplication(input);
      }
      throw new TRPCError({
        code: "CONFLICT",
        message: "该企业已被其他账号认领，请联系企业超级管理员邀请加入",
      });
    }
    throw error;
  }
}

/**
 * Local preflight before the independent HK administration system accepts an
 * application. It deliberately checks only stable local identity/membership
 * conflicts; the administration system remains authoritative for approval.
 */
export async function preflightHkEnterpriseClaim(input: {
  userId: number;
  registrationIdentifier: string;
}) {
  const db = await requireDb();
  const registrationIdentifier = normalizeHkRegistrationIdentifier(input.registrationIdentifier);
  const [membership, enterprise] = await Promise.all([
    db.select().from(enterpriseMembers).where(eq(enterpriseMembers.userId, input.userId)).limit(1),
    db.select().from(enterprises).where(and(
      eq(enterprises.registrationRegion, "HK"),
      eq(enterprises.registrationIdentifier, registrationIdentifier),
    )).limit(1),
  ]);
  const currentMembership = membership[0];
  const existingEnterprise = enterprise[0];
  if (currentMembership && currentMembership.enterpriseId !== existingEnterprise?.id) {
    throw new TRPCError({ code: "CONFLICT", message: "当前账号已归属其他企业，不能认领新的企业" });
  }
  if (existingEnterprise && existingEnterprise.superAdminUserId !== input.userId) {
    throw new TRPCError({ code: "CONFLICT", message: "该香港企业已被认领，请由企业管理员通过手机号发送邀请" });
  }
  return {
    registrationIdentifier,
    enterpriseId: existingEnterprise?.id ?? null,
    alreadyClaimed: Boolean(existingEnterprise),
  } as const;
}

/**
 * HK applications use an independent namespaced BRN.  They must never enter
 * the CN creditCode repair path: a member of any other CN/HK enterprise cannot
 * repurpose its membership, and creditCode is explicitly NULL on HK rows.
 */
export async function claimHkEnterpriseForCrmApplication(input: {
  userId: number;
  registrationIdentifier: string;
  companyName: string;
}) {
  const db = await requireDb();
  const registrationIdentifier = normalizeHkRegistrationIdentifier(input.registrationIdentifier);
  const companyName = input.companyName.trim();
  if (!companyName) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "企业名称不能为空" });
  }

  let duplicateConflict: unknown = null;
  // A unique-index collision may be a simultaneous retry by the same owner.
  // Limit the replay to one fresh transaction; never recurse indefinitely.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await db.transaction(async tx => {
        const existingMembership = (
          await tx
            .select()
            .from(enterpriseMembers)
            .where(eq(enterpriseMembers.userId, input.userId))
            .limit(1)
            .for("update")
        )[0];
        const existingEnterprise = (
          await tx
            .select()
            .from(enterprises)
            .where(and(
              eq(enterprises.registrationRegion, "HK"),
              eq(enterprises.registrationIdentifier, registrationIdentifier),
            ))
            .limit(1)
            .for("update")
        )[0];

        if (existingMembership && existingMembership.enterpriseId !== existingEnterprise?.id) {
          throw new TRPCError({ code: "CONFLICT", message: "当前账号已归属其他企业，不能认领新的企业" });
        }
        if (existingEnterprise) {
          if (existingEnterprise.superAdminUserId !== input.userId) {
            throw new TRPCError({ code: "CONFLICT", message: "该香港企业已被其他账号认领，请联系企业超级管理员邀请加入" });
          }
          if (existingMembership) {
            await tx.update(enterpriseMembers).set({
              role: "super_admin",
              status: "active",
              inventoryDataScope: "enterprise",
              suspendedAt: null,
            }).where(eq(enterpriseMembers.id, existingMembership.id));
          } else {
            await tx.insert(enterpriseMembers).values({
              enterpriseId: existingEnterprise.id,
              userId: input.userId,
              role: "super_admin",
              status: "active",
              inventoryDataScope: "enterprise",
            });
          }
          await linkSelectedCompanyRecord(tx, existingEnterprise.crmDataOwnerUserId, existingEnterprise);
          return { enterprise: existingEnterprise, created: false };
        }

        if (existingMembership) {
          throw new TRPCError({ code: "CONFLICT", message: "当前账号已归属其他企业，不能认领新的企业" });
        }
        const insertResult = await tx.insert(enterprises).values({
          creditCode: null,
          registrationRegion: "HK",
          registrationIdentifier,
          companyName,
          superAdminUserId: input.userId,
          crmDataOwnerUserId: input.userId,
        });
        const enterpriseId = Number((insertResult as unknown as Array<{ insertId?: number }>)[0]?.insertId ?? 0);
        const createdEnterprise = enterpriseId > 0
          ? (await tx.select().from(enterprises).where(eq(enterprises.id, enterpriseId)).limit(1))[0]
          : (await tx.select().from(enterprises).where(and(
              eq(enterprises.registrationRegion, "HK"),
              eq(enterprises.registrationIdentifier, registrationIdentifier),
            )).limit(1))[0];
        if (!createdEnterprise) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "香港企业认领失败" });
        await tx.insert(enterpriseMembers).values({
          enterpriseId: createdEnterprise.id,
          userId: input.userId,
          role: "super_admin",
          status: "active",
          inventoryDataScope: "enterprise",
        });
        await linkSelectedCompanyRecord(tx, input.userId, createdEnterprise);
        return { enterprise: createdEnterprise, created: true };
      });
      await ensureOwnerPermissions(db, result.enterprise.id, input.userId);
      return result;
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      if (!isDuplicateKeyError(error)) throw error;
      duplicateConflict = error;
    }
  }
  const existing = await db.select().from(enterprises).where(and(
    eq(enterprises.registrationRegion, "HK"),
    eq(enterprises.registrationIdentifier, registrationIdentifier),
  )).limit(1);
  if (existing[0]?.superAdminUserId !== input.userId) {
    throw new TRPCError({ code: "CONFLICT", message: "该香港企业已被其他账号认领，请联系企业超级管理员邀请加入" });
  }
  throw duplicateConflict ?? new TRPCError({ code: "CONFLICT", message: "香港企业认领并发冲突，请重试" });
}

export async function linkCompanyToEnterprise(userId: number, enterpriseId: number, companyId?: number) {
  const db = await requireDb();
  const enterprise = (await db.select().from(enterprises).where(eq(enterprises.id, enterpriseId)).limit(1))[0];
  if (!enterprise || enterprise.superAdminUserId !== userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "当前账号不能关联该企业资料" });
  }
  const member = (await db.select().from(enterpriseMembers).where(and(
    eq(enterpriseMembers.userId, userId), eq(enterpriseMembers.enterpriseId, enterprise.id),
    eq(enterpriseMembers.status, "active"), eq(enterpriseMembers.role, "super_admin"),
  )).limit(1))[0];
  if (!member) throw new TRPCError({ code: "FORBIDDEN", message: "当前账号没有有效企业所有者成员权限" });
  await linkSelectedCompanyRecord(db, enterprise.crmDataOwnerUserId, enterprise, companyId);
}

export async function resolveEnterpriseScope(ctx: SessionContext): Promise<EnterpriseScope | null> {
  const context = await getEnterpriseContextForUser(ctx.user.id);
  if (!context) return null;
  return {
    enterprise: context.enterprise,
    member: context.member,
    dataOwnerUserId: context.enterprise.crmDataOwnerUserId,
    portalOwnerUserId: context.enterprise.superAdminUserId,
  };
}

export async function resolveCrmTargetForUser(userId: number) {
  const db = await requireDb();
  const request = getEnterpriseBusinessRequestContext(userId);
  const context = await getEnterpriseContextForUser(userId);
  if (context) {
    return {
      enterprise: context.enterprise,
      member: context.member,
      company: await getEnterpriseCompany(context.enterprise),
      dataOwnerUserId: context.enterprise.crmDataOwnerUserId,
      portalOwnerUserId: context.enterprise.superAdminUserId,
    };
  }

  if (request?.enterpriseId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "当前账号不是所选企业成员", cause: new BusinessFailureCause("TENANT_ACCESS_REVOKED") });
  }
  const legacyCompanies = await db.select().from(companies)
    .where(and(eq(companies.userId, userId), isNull(companies.enterpriseId)));
  return {
    enterprise: null,
    member: null,
    company: selectPersonalCompanyRecord(userId, legacyCompanies),
    dataOwnerUserId: userId,
    portalOwnerUserId: userId,
  };
}

export async function requireEnterpriseManager(ctx: SessionContext) {
  return requireEnterprisePermissionManager(ctx.user.id);
}

/**
 * 后台专用换绑后的本地角色对账。后台是 CRM owner 权威源；前台仅接受已存在于同企业、状态 active 的独立账号。
 * crmDataOwnerUserId 永不修改，因此库存、入库、出库及看板数据归属保持稳定。
 */
export async function reconcileEnterpriseSuperAdminFromBinding(input: {
  enterprise: Enterprise;
  remotePortalUserId: string;
  triggeredByUserId: number;
}) {
  if (String(input.enterprise.superAdminUserId) === input.remotePortalUserId) {
    return input.enterprise;
  }
  if (!/^\d+$/.test(input.remotePortalUserId)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "后台 ERP 换绑目标不是有效前台用户 ID，请联系平台管理员",
    });
  }
  const targetUserId = Number(input.remotePortalUserId);
  if (!Number.isSafeInteger(targetUserId) || targetUserId <= 0) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "后台 ERP 换绑目标不是有效前台用户 ID，请联系平台管理员",
    });
  }

  const db = await requireDb();
  const requestId = `admin-rebind:${input.enterprise.id}:${input.enterprise.superAdminUserId}:${targetUserId}`;
  return db.transaction(async tx => {
    const locked = (
      await tx
        .select()
        .from(enterprises)
        .where(eq(enterprises.id, input.enterprise.id))
        .limit(1)
        .for("update")
    )[0];
    if (!locked) {
      throw new TRPCError({ code: "NOT_FOUND", message: "企业不存在" });
    }
    if (locked.superAdminUserId === targetUserId) return locked;

    const previousSuperAdminUserId = locked.superAdminUserId;
    const lockedMembers = await tx
      .select()
      .from(enterpriseMembers)
      .where(
        and(
          eq(enterpriseMembers.enterpriseId, locked.id),
          inArray(enterpriseMembers.userId, [previousSuperAdminUserId, targetUserId]),
        ),
      )
      .orderBy(asc(enterpriseMembers.userId))
      .for("update");
    const previousOwner = lockedMembers.find(row => row.userId === previousSuperAdminUserId);
    const target = lockedMembers.find(row => row.userId === targetUserId);
    if (!previousOwner || previousOwner.role !== "super_admin") {
      throw new TRPCError({ code: "CONFLICT", message: "企业超级管理员状态已变化，请稍后重试" });
    }
    if (!target || target.status !== "active") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "后台换绑目标必须先作为有效独立账号加入当前企业",
      });
    }

    const enterpriseUpdate = await tx
      .update(enterprises)
      .set({ superAdminUserId: targetUserId })
      .where(
        and(
          eq(enterprises.id, locked.id),
          eq(enterprises.superAdminUserId, previousSuperAdminUserId),
        ),
      );
    if (affectedRows(enterpriseUpdate) !== 1) {
      throw new TRPCError({ code: "CONFLICT", message: "企业超级管理员已变化，请稍后重试" });
    }
    const previousOwnerUpdate = await tx
      .update(enterpriseMembers)
      .set({ role: "member" })
      .where(
        and(
          eq(enterpriseMembers.enterpriseId, locked.id),
          eq(enterpriseMembers.userId, previousSuperAdminUserId),
        ),
      );
    if (affectedRows(previousOwnerUpdate) !== 1) {
      throw new TRPCError({ code: "CONFLICT", message: "原企业超级管理员状态已变化，请稍后重试" });
    }
    const nextOwnerUpdate = await tx
      .update(enterpriseMembers)
      .set({
        role: "super_admin",
        status: "active",
        inventoryDataScope: "enterprise",
        suspendedAt: null,
      })
      .where(
        and(
          eq(enterpriseMembers.id, target.id),
          eq(enterpriseMembers.enterpriseId, locked.id),
          eq(enterpriseMembers.status, "active"),
        ),
      );
    if (affectedRows(nextOwnerUpdate) !== 1) {
      throw new TRPCError({ code: "CONFLICT", message: "接收人状态已变化，请稍后重试" });
    }
    await ensureOwnerPermissions(tx, locked.id, targetUserId);
    await tx.insert(crmOwnerTransferLogs).values({
      enterpriseId: locked.id,
      previousSuperAdminUserId,
      nextSuperAdminUserId: targetUserId,
      initiatedByUserId: input.triggeredByUserId,
      reason: "后台专用 ERP 超级管理员换绑同步",
      requestId,
    });

    return { ...locked, superAdminUserId: targetUserId };
  });
}

/**
 * 后台本地绑定完成后调用的单向确认接口。平台不回查后台，直接以 requestId
 * 为幂等键在本地事务内完成企业负责人角色切换；crmDataOwnerUserId 不变。
 */
export async function completeEnterpriseSuperAdminTransferFromAdmin(input: {
  creditCode?: string;
  registrationIdentifier?: string;
  expectedPortalUserId: string;
  newPortalUserId: string;
  reason: string;
  requestId: string;
}) {
  const identity = normalizeEnterpriseRegistrationIdentity(input);
  const expectedSuperAdminUserId = parsePortalUserId(input.expectedPortalUserId, "当前超级管理员");
  const targetUserId = parsePortalUserId(input.newPortalUserId, "新超级管理员");
  const reason = input.reason.trim();
  const requestId = input.requestId.trim();
  if (expectedSuperAdminUserId === targetUserId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "新超级管理员不能与当前绑定账号相同" });
  }
  if (reason.length < 2) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "换绑原因至少需要 2 个字符" });
  }
  if (!requestId || requestId.length > 64) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "换绑请求号无效" });
  }

  const db = await requireDb();
  try {
    const completed = await db.transaction(async tx => {
      const existingLog = (
        await tx
          .select()
          .from(crmOwnerTransferLogs)
          .where(eq(crmOwnerTransferLogs.requestId, requestId))
          .limit(1)
      )[0];
      if (existingLog) {
        if (
          existingLog.previousSuperAdminUserId !== expectedSuperAdminUserId
          || existingLog.nextSuperAdminUserId !== targetUserId
        ) {
          throw new TRPCError({ code: "CONFLICT", message: "换绑请求号已用于其他操作" });
        }
        const enterprise = (
          await tx.select().from(enterprises).where(eq(enterprises.id, existingLog.enterpriseId)).limit(1)
        )[0];
        if (!enterprise || !enterpriseIdentityMatches(enterprise, identity)) {
          throw new TRPCError({ code: "CONFLICT", message: "换绑请求号与企业不匹配" });
        }
        return {
          success: true as const,
          idempotent: true as const,
          enterpriseId: enterprise.id,
          superAdminUserId: enterprise.superAdminUserId,
          notification: {
            enterpriseId: enterprise.id,
            enterpriseName: enterprise.companyName,
            previousOwnerUserId: existingLog.previousSuperAdminUserId,
            nextOwnerUserId: existingLog.nextSuperAdminUserId,
            reason: existingLog.reason,
            requestId: existingLog.requestId,
            completedAt: existingLog.createdAt,
          },
        };
      }

      const locked = identity.kind === "CN"
        ? (
            await tx
              .select()
              .from(enterprises)
              .where(eq(enterprises.creditCode, identity.creditCode))
              .limit(1)
              .for("update")
          )[0]
        : (
            await tx
              .select()
              .from(enterprises)
              .where(and(
                eq(enterprises.registrationRegion, "HK"),
                eq(enterprises.registrationIdentifier, identity.registrationIdentifier),
              ))
              .limit(1)
              .for("update")
          )[0];
      if (!locked) {
        throw new TRPCError({ code: "NOT_FOUND", message: "前台尚未建立该企业归属，请先完成企业认领" });
      }
      if (locked.superAdminUserId !== expectedSuperAdminUserId) {
        throw new TRPCError({ code: "CONFLICT", message: "前台企业超级管理员已变化，请刷新后重试" });
      }

      const lockedMembers = await tx
        .select()
        .from(enterpriseMembers)
        .where(
          and(
            eq(enterpriseMembers.enterpriseId, locked.id),
            inArray(enterpriseMembers.userId, [expectedSuperAdminUserId, targetUserId]),
          ),
        )
        .orderBy(asc(enterpriseMembers.userId))
        .for("update");
      const previousOwner = lockedMembers.find(row => row.userId === expectedSuperAdminUserId);
      const target = lockedMembers.find(row => row.userId === targetUserId);
      if (!previousOwner || previousOwner.role !== "super_admin" || previousOwner.status !== "active") {
        throw new TRPCError({ code: "CONFLICT", message: "企业超级管理员状态已变化，请稍后重试" });
      }
      if (!target || target.status !== "active") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "新超级管理员必须先以有效独立账号加入当前企业",
        });
      }

      const enterpriseUpdate = await tx
        .update(enterprises)
        .set({ superAdminUserId: targetUserId })
        .where(and(
          eq(enterprises.id, locked.id),
          eq(enterprises.superAdminUserId, expectedSuperAdminUserId),
        ));
      if (affectedRows(enterpriseUpdate) !== 1) {
        throw new TRPCError({ code: "CONFLICT", message: "企业超级管理员已变化，请稍后重试" });
      }
      const previousOwnerUpdate = await tx
        .update(enterpriseMembers)
        .set({ role: "member" })
        .where(and(
          eq(enterpriseMembers.enterpriseId, locked.id),
          eq(enterpriseMembers.userId, expectedSuperAdminUserId),
        ));
      if (affectedRows(previousOwnerUpdate) !== 1) {
        throw new TRPCError({ code: "CONFLICT", message: "原企业超级管理员状态已变化，请稍后重试" });
      }
      const nextOwnerUpdate = await tx
        .update(enterpriseMembers)
        .set({
          role: "super_admin",
          status: "active",
          inventoryDataScope: "enterprise",
          suspendedAt: null,
        })
        .where(and(
          eq(enterpriseMembers.id, target.id),
          eq(enterpriseMembers.enterpriseId, locked.id),
          eq(enterpriseMembers.status, "active"),
        ));
      if (affectedRows(nextOwnerUpdate) !== 1) {
        throw new TRPCError({ code: "CONFLICT", message: "接收人状态已变化，请稍后重试" });
      }
      await ensureOwnerPermissions(tx, locked.id, targetUserId);
      await tx.insert(crmOwnerTransferLogs).values({
        enterpriseId: locked.id,
        previousSuperAdminUserId: expectedSuperAdminUserId,
        nextSuperAdminUserId: targetUserId,
        // 后台服务身份而非任何来自浏览器的用户身份。
        initiatedByUserId: expectedSuperAdminUserId,
        reason,
        requestId,
      });
      return {
        success: true as const,
        idempotent: false as const,
        enterpriseId: locked.id,
        superAdminUserId: targetUserId,
        notification: {
          enterpriseId: locked.id,
          enterpriseName: locked.companyName,
          previousOwnerUserId: expectedSuperAdminUserId,
          nextOwnerUserId: targetUserId,
          reason,
          requestId,
          completedAt: new Date(),
        },
      };
    });

    // 51小电通知是后置、幂等的非关键副作用；任何失败都不得撤销已提交的角色切换。
    await notifyEnterpriseOwnershipTransferRecipients(completed.notification);
    return {
      success: completed.success,
      idempotent: completed.idempotent,
      enterpriseId: completed.enterpriseId,
      superAdminUserId: completed.superAdminUserId,
    };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    if (isDuplicateKeyError(error)) {
      // 并发相同 requestId 时重读已提交账本，得到同一个不可变结果。
      return completeEnterpriseSuperAdminTransferFromAdmin(input);
    }
    throw error;
  }
}

/**
 * CRM 业务操作统一门禁：企业成员复用企业稳定数据owner的后台绑定，
 * 但业务数据始终落到不可随超级管理员转让而变化的 crmDataOwnerUserId。
 */
export async function requireCrmEnterpriseAccess(ctx: SessionContext) {
  const request = getEnterpriseBusinessRequestContext(ctx.user.id);
  let scope = await resolveEnterpriseScope(ctx);
  if (request?.enterpriseId && !scope) {
    throw new TRPCError({ code: "FORBIDDEN", message: "当前账号不是所选企业成员", cause: new BusinessFailureCause("TENANT_ACCESS_REVOKED") });
  }
  if (scope?.member?.status === "suspended") {
    // Suspension revokes only this enterprise, never the user's other memberships.
    throw new TRPCError({ code: "FORBIDDEN", message: "企业成员身份已暂停", cause: new BusinessFailureCause("TENANT_ACCESS_REVOKED") });
  }

  const db = await requireDb();
  const company = scope
    ? await getEnterpriseCompany(scope.enterprise)
    : (
        await db
          .select()
          .from(companies)
          .where(eq(companies.userId, ctx.user.id))
          .limit(1)
      )[0];
  const identity = scope
    ? (scope.enterprise.registrationRegion === "HK" && scope.enterprise.registrationIdentifier
        ? { kind: "HK" as const, registrationIdentifier: normalizeHkRegistrationIdentifier(scope.enterprise.registrationIdentifier) }
        : scope.enterprise.creditCode
          ? { kind: "CN" as const, creditCode: normalizeEnterpriseCreditCode(scope.enterprise.creditCode) }
          : null)
    : (company?.registrationRegion === "HK" && company.registrationIdentifier
        ? { kind: "HK" as const, registrationIdentifier: normalizeHkRegistrationIdentifier(company.registrationIdentifier) }
        : company?.creditCode
          ? { kind: "CN" as const, creditCode: normalizeEnterpriseCreditCode(company.creditCode) }
          : null);
  if (!identity) {
    await setCrmAccess(ctx.user.id, false);
    throw new TRPCError({ code: "FORBIDDEN", message: "请先提交企业 ERP 开通申请", cause: new BusinessFailureCause("TENANT_ACCESS_REVOKED") });
  }

  let status;
  try {
    if (scope) {
      const binding = identity.kind === "HK"
        ? await getAdminHkCrmBinding(identity.registrationIdentifier)
        : await getAdminCrmBinding(identity.creditCode);
      if (binding.found && binding.crmOwnerPortalUserId) {
        await reconcileEnterpriseSuperAdminFromBinding({
          enterprise: scope.enterprise,
          remotePortalUserId: binding.crmOwnerPortalUserId,
          triggeredByUserId: ctx.user.id,
        });
        scope = await resolveEnterpriseScope(ctx);
      }
    }
    status = identity.kind === "HK"
      ? await getAdminHkCrmAccess({
          registrationIdentifier: identity.registrationIdentifier,
          portalUserId: scope?.portalOwnerUserId ?? ctx.user.id,
        })
      : await getAdminCrmAccess({
          creditCode: identity.creditCode,
          portalUserId: scope?.portalOwnerUserId ?? ctx.user.id,
        });
  } catch (error) {
    console.error("[enterpriseAccess] 后台 CRM 权威状态查询失败", {
      userId: ctx.user.id,
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "ERP 权限状态暂时无法确认，请稍后重试",
      cause: error,
    });
  }

  await applyAdminCrmAccess(ctx.user.id, status);
  if (!status.allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: status.message || "企业 ERP 权限当前不可用",
      cause: new BusinessFailureCause("TENANT_ACCESS_REVOKED"),
    });
  }
  if (scope) await linkLegacyEnterpriseRows(scope.enterprise);
  return {
    scope,
    company,
    status,
    dataOwnerUserId: scope?.dataOwnerUserId ?? ctx.user.id,
  };
}


/**
 * 后台专用 owner 换绑成功后调用的本地原子落账。
 * requestId 唯一，expectedSuperAdminUserId 防止并发覆盖；crmDataOwnerUserId 始终不变。
 */
export async function completeEnterpriseSuperAdminTransfer(
  ctx: SessionContext,
  input: {
    targetUserId: number;
    expectedSuperAdminUserId: number;
    reason: string;
    requestId: string;
  },
) {
  const scope = await requireEnterpriseManager(ctx);
  if (scope.member.role !== "super_admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "只有企业超级管理员可转让权限" });
  }
  if (input.expectedSuperAdminUserId !== ctx.user.id) {
    throw new TRPCError({ code: "CONFLICT", message: "企业超级管理员已变化，请刷新后重试" });
  }
  const db = await requireDb();

  try {
    return await db.transaction(async tx => {
      const existingLog = (
        await tx
          .select()
          .from(crmOwnerTransferLogs)
          .where(eq(crmOwnerTransferLogs.requestId, input.requestId))
          .limit(1)
      )[0];
      if (existingLog) {
        if (
          existingLog.enterpriseId !== scope.enterprise.id
          || existingLog.previousSuperAdminUserId !== input.expectedSuperAdminUserId
          || existingLog.nextSuperAdminUserId !== input.targetUserId
        ) {
          throw new TRPCError({ code: "CONFLICT", message: "幂等请求号已用于其他转让" });
        }
        return { success: true, idempotent: true, enterpriseId: scope.enterprise.id } as const;
      }

      const locked = (
        await tx
          .select()
          .from(enterprises)
          .where(eq(enterprises.id, scope.enterprise.id))
          .limit(1)
          .for("update")
      )[0];
      if (!locked || locked.superAdminUserId !== input.expectedSuperAdminUserId) {
        throw new TRPCError({ code: "CONFLICT", message: "企业超级管理员已变化，请刷新后重试" });
      }

      const lockedMembers = await tx
        .select()
        .from(enterpriseMembers)
        .where(
          and(
            eq(enterpriseMembers.enterpriseId, locked.id),
            inArray(enterpriseMembers.userId, [input.expectedSuperAdminUserId, input.targetUserId]),
          ),
        )
        .orderBy(asc(enterpriseMembers.userId))
        .for("update");
      const currentOwner = lockedMembers.find(row => row.userId === input.expectedSuperAdminUserId);
      const target = lockedMembers.find(row => row.userId === input.targetUserId);
      if (!currentOwner || currentOwner.status !== "active" || currentOwner.role !== "super_admin") {
        throw new TRPCError({ code: "CONFLICT", message: "企业超级管理员状态已变化，请刷新后重试" });
      }
      if (!target || target.status !== "active") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "接收人必须是当前企业的有效独立账号成员" });
      }

      const enterpriseUpdate = await tx
        .update(enterprises)
        .set({ superAdminUserId: input.targetUserId })
        .where(
          and(
            eq(enterprises.id, locked.id),
            eq(enterprises.superAdminUserId, input.expectedSuperAdminUserId),
          ),
        );
      if (affectedRows(enterpriseUpdate) !== 1) {
        throw new TRPCError({ code: "CONFLICT", message: "企业超级管理员已变化，请刷新后重试" });
      }
      const previousOwnerUpdate = await tx
        .update(enterpriseMembers)
        .set({ role: "member" })
        .where(
          and(
            eq(enterpriseMembers.enterpriseId, locked.id),
            eq(enterpriseMembers.userId, input.expectedSuperAdminUserId),
          ),
        );
      if (affectedRows(previousOwnerUpdate) !== 1) {
        throw new TRPCError({ code: "CONFLICT", message: "原企业超级管理员状态已变化，请刷新后重试" });
      }
      const nextOwnerUpdate = await tx
        .update(enterpriseMembers)
        .set({
          role: "super_admin",
          status: "active",
          inventoryDataScope: "enterprise",
          suspendedAt: null,
        })
        .where(
          and(
            eq(enterpriseMembers.id, target.id),
            eq(enterpriseMembers.enterpriseId, locked.id),
            eq(enterpriseMembers.status, "active"),
          ),
        );
      if (affectedRows(nextOwnerUpdate) !== 1) {
        throw new TRPCError({ code: "CONFLICT", message: "接收人状态已变化，请刷新后重试" });
      }
      await ensureOwnerPermissions(tx, locked.id, input.targetUserId);
      await tx.insert(crmOwnerTransferLogs).values({
        enterpriseId: locked.id,
        previousSuperAdminUserId: input.expectedSuperAdminUserId,
        nextSuperAdminUserId: input.targetUserId,
        initiatedByUserId: ctx.user.id,
        reason: input.reason.trim(),
        requestId: input.requestId,
      });

      return { success: true, idempotent: false, enterpriseId: locked.id } as const;
    });
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    if (isDuplicateKeyError(error)) {
      const existing = (
        await db
          .select()
          .from(crmOwnerTransferLogs)
          .where(eq(crmOwnerTransferLogs.requestId, input.requestId))
          .limit(1)
      )[0];
      if (
        existing?.enterpriseId === scope.enterprise.id
        && existing.previousSuperAdminUserId === input.expectedSuperAdminUserId
        && existing.nextSuperAdminUserId === input.targetUserId
      ) {
        return { success: true, idempotent: true, enterpriseId: scope.enterprise.id } as const;
      }
    }
    throw error;
  }
}

/**
 * Browser-initiated transfer is manager-first: local roles are intentionally not changed
 * here. The manager persists its authoritative CRM binding and calls internalCrm.completeRebind
 * to perform the local atomic role switch.
 */
async function requireActiveNonOwnerOwnershipTransferTarget(input: {
  enterpriseId: number;
  actorUserId: number;
  targetUserId: number;
}) {
  const db = await requireDb();
  const target = (
    await db
      .select({ role: enterpriseMembers.role, status: enterpriseMembers.status })
      .from(enterpriseMembers)
      .where(and(
        eq(enterpriseMembers.enterpriseId, input.enterpriseId),
        eq(enterpriseMembers.userId, input.targetUserId),
      ))
      .limit(1)
  )[0];
  if (!target || target.status !== "active" || target.role === "super_admin") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "接收人必须是本企业正常的非所有者成员",
    });
  }
  if (input.targetUserId === input.actorUserId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "不能转让给当前企业所有者本人" });
  }
  return { db, target };
}

export async function sendEnterpriseOwnershipTransferCode(input: {
  actorUserId: number;
  targetUserId: number;
  requestId: string;
}) {
  const scope = await requireEnterprisePermissionManager(input.actorUserId);
  if (!scope.isOwner || scope.member.role !== "super_admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "只有企业所有者可转让企业所有者身份" });
  }
  const { db } = await requireActiveNonOwnerOwnershipTransferTarget({
    enterpriseId: scope.enterprise.id,
    actorUserId: input.actorUserId,
    targetUserId: input.targetUserId,
  });
  const owner = (
    await db
      .select({ phone: users.phone })
      .from(users)
      .where(eq(users.id, input.actorUserId))
      .limit(1)
  )[0];
  const phone = owner?.phone?.trim();
  if (!phone) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "当前企业所有者未绑定手机，无法发送验证码",
    });
  }
  const verificationContext = ownershipTransferVerificationContextKey({
    actorUserId: input.actorUserId,
    enterpriseId: scope.enterprise.id,
    expectedOwnerUserId: scope.enterprise.superAdminUserId,
    targetUserId: input.targetUserId,
    requestId: input.requestId,
  });
  await sendVerificationCode(OWNERSHIP_TRANSFER_SMS_SCENE, phone, { contextKey: verificationContext });
  return {
    maskedPhone: maskOwnershipTransferPhone(phone),
    retryAfterSeconds: 60,
  } as const;
}

export async function verifyEnterpriseOwnershipTransferCode(input: {
  actorUserId: number;
  targetUserId: number;
  requestId: string;
  code: string;
}) {
  const scope = await requireEnterprisePermissionManager(input.actorUserId);
  if (!scope.isOwner || scope.member.role !== "super_admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "只有企业所有者可转让企业所有者身份" });
  }
  const { db } = await requireActiveNonOwnerOwnershipTransferTarget({
    enterpriseId: scope.enterprise.id,
    actorUserId: input.actorUserId,
    targetUserId: input.targetUserId,
  });
  const owner = (
    await db
      .select({ phone: users.phone })
      .from(users)
      .where(eq(users.id, input.actorUserId))
      .limit(1)
  )[0];
  const phone = owner?.phone?.trim();
  if (!phone) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "当前企业所有者未绑定手机，无法验证验证码",
    });
  }
  const verificationContext = ownershipTransferVerificationContextKey({
    actorUserId: input.actorUserId,
    enterpriseId: scope.enterprise.id,
    expectedOwnerUserId: scope.enterprise.superAdminUserId,
    targetUserId: input.targetUserId,
    requestId: input.requestId,
  });
  const verified = await verifyCode(
    OWNERSHIP_TRANSFER_SMS_SCENE,
    phone,
    input.code,
    { contextKey: verificationContext },
  );
  if (!verified) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "验证码无效或已过期，请重新获取" });
  }
  return {
    verificationTicket: createOwnershipTransferVerificationTicket({
      actorUserId: input.actorUserId,
      enterpriseId: scope.enterprise.id,
      expectedOwnerUserId: scope.enterprise.superAdminUserId,
      targetUserId: input.targetUserId,
      requestId: input.requestId,
    }),
    expiresInSeconds: OWNERSHIP_TRANSFER_TICKET_TTL_SECONDS,
  } as const;
}

/**
 * Browser-initiated transfer remains manager-first: local roles are intentionally not changed
 * here. A bound, HMAC-signed SMS verification ticket is required before the manager persists
 * the authoritative CRM binding and calls internalCrm.completeRebind for the local role switch.
 */
export async function requestEnterpriseOwnershipTransfer(input: {
  actorUserId: number;
  targetUserId: number;
  reason: string;
  requestId: string;
  verificationTicket: string;
  actorName?: string;
}) {
  const ticket = input.verificationTicket.trim();
  const retryScope = await resolveEnterprisePermissionScope(input.actorUserId);
  if (retryScope) {
    const db = await requireDb();
    const existing = (
      await db
        .select()
        .from(crmOwnerTransferLogs)
        .where(eq(crmOwnerTransferLogs.requestId, input.requestId))
        .limit(1)
    )[0];
    // The immutable completed-transfer ledger is a safer authorization proof for an
    // exact replay than an expired ticket: it cannot start a new manager rebind and
    // requires the original actor, enterprise, target, and requestId to all match.
    if (
      existing
      && existing.enterpriseId === retryScope.enterprise.id
      && existing.previousSuperAdminUserId === input.actorUserId
      && existing.nextSuperAdminUserId === input.targetUserId
      && existing.reason === input.reason.trim()
    ) {
      return {
        success: true,
        idempotent: true,
        enterpriseId: retryScope.enterprise.id,
        superAdminUserId: input.targetUserId,
      } as const;
    }
  }

  const scope = await requireEnterprisePermissionManager(input.actorUserId);
  if (!scope.isOwner || scope.member.role !== "super_admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "只有企业所有者可转让企业所有者身份" });
  }
  if (!verifyOwnershipTransferVerificationTicket(ticket, {
    actorUserId: input.actorUserId,
    enterpriseId: scope.enterprise.id,
    expectedOwnerUserId: scope.enterprise.superAdminUserId,
    targetUserId: input.targetUserId,
    requestId: input.requestId,
  })) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "所有者转让验证凭证无效或已过期，请重新验证" });
  }
  const reason = input.reason.trim();
  if (reason.length < 2 || reason.length > 500) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "转让原因需为2至500个字符" });
  }
  await requireActiveNonOwnerOwnershipTransferTarget({
    enterpriseId: scope.enterprise.id,
    actorUserId: input.actorUserId,
    targetUserId: input.targetUserId,
  });

  const identity = scope.enterprise.registrationRegion === "HK"
    ? { registrationIdentifier: normalizeHkRegistrationIdentifier(scope.enterprise.registrationIdentifier || "") }
    : { creditCode: normalizeEnterpriseCreditCode(scope.enterprise.creditCode || "") };
  return rebindCrmOwnerByEnterpriseOwner({
    ...identity,
    expectedPortalUserId: String(input.actorUserId),
    newPortalUserId: String(input.targetUserId),
    reason,
    requestId: input.requestId,
    actorName: input.actorName?.trim() || undefined,
  });
}

export async function listEnterpriseOwnerTransfers(ctx: SessionContext) {
  const scope = await requireEnterpriseManager(ctx);
  const db = await requireDb();
  return db
    .select()
    .from(crmOwnerTransferLogs)
    .where(eq(crmOwnerTransferLogs.enterpriseId, scope.enterprise.id))
    .orderBy(desc(crmOwnerTransferLogs.createdAt));
}
