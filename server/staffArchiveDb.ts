import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { adminStaffArchives, adminUsers, adminBusinessStaffBindings, adminBusinessStaffBindingAudits, adminBusinessMerchantScopes, salesStaff, merchants, auditLogs, type AdminStaffArchive } from "../drizzle/schema";
import { getDb, lockActiveSuperAdmins } from "./db";
import type { ResultSetHeader } from "mysql2";
import type { StaffArchiveInput } from "./staffArchiveModel";
import type { PlatformBusinessBinding } from "./platformBusinessApi";

async function database() { const db = await getDb(); if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "归档账本暂不可用" }); return db; }
export async function staffBindingHistory(id: number) {
  const db = await database();
  const current = (await db.select().from(adminBusinessStaffBindings).where(eq(adminBusinessStaffBindings.adminUserId, id)).limit(1))[0];
  if (current?.status === "active" && current.frontUserId && current.frontUserId > 0) return { kind: "bound" as const, current };
  const history = await db.select({ id: adminBusinessStaffBindingAudits.id }).from(adminBusinessStaffBindingAudits)
    .where(and(eq(adminBusinessStaffBindingAudits.adminUserId, id), isNotNull(adminBusinessStaffBindingAudits.frontUserId))).limit(1);
  if (history.length || current?.frontUserId || current?.status === "active") return { kind: "unresolved" as const, current };
  return { kind: "never_bound" as const, current };
}
export async function findStaffArchive(id: number) {
  return (await (await database()).select().from(adminStaffArchives).where(eq(adminStaffArchives.adminUserId, id)).limit(1))[0] ?? null;
}
export type ArchiveProof = {
  actorId: number; actorSessionVersion: number; actorFrontUserId: number | null; actorBindingVersion: number | null;
  frontUserId: number | null; enterpriseId: number | null; binding: PlatformBusinessBinding | null;
  actorName: string; actorRole: string;
};
export async function startStaffArchive(input: StaffArchiveInput, proof: ArchiveProof): Promise<AdminStaffArchive> {
  return (await database()).transaction(async tx => {
    const supers = await lockActiveSuperAdmins(tx);
    const accounts = await tx.select().from(adminUsers).where(sql`${adminUsers.id} IN (${proof.actorId}, ${input.id})`).orderBy(asc(adminUsers.id)).for("update");
    const actor = accounts.find(row => row.id === proof.actorId);
    const target = accounts.find(row => row.id === input.id);
    if (!actor || actor.status !== "active" || actor.sessionVersion !== proof.actorSessionVersion) throw new TRPCError({ code: "FORBIDDEN", message: "操作者权限已变化，请重新登录核验" });
    const actorArchive = await tx.select({ id: adminStaffArchives.id }).from(adminStaffArchives).where(eq(adminStaffArchives.adminUserId, proof.actorId)).limit(1).for("update");
    if (actorArchive.length) throw new TRPCError({ code: "FORBIDDEN", message: "操作者已归档，不能继续删除用户" });
    if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "后台用户不存在" });
    if (proof.actorId === input.id || (proof.frontUserId && proof.actorFrontUserId === proof.frontUserId)) throw new TRPCError({ code: "FORBIDDEN", message: "不能删除自己" });
    const duplicate = await tx.select({ id: adminStaffArchives.id }).from(adminStaffArchives)
      .where(sql`${adminStaffArchives.adminUserId} = ${input.id} OR ${adminStaffArchives.requestId} = ${input.requestId}`).limit(1).for("update");
    if (duplicate.length) throw new TRPCError({ code: "CONFLICT", message: "归档请求号已使用，请读取原请求重试" });
    if (target.sessionVersion !== input.expectedSessionVersion) throw new TRPCError({ code: "CONFLICT", message: "后台账号版本已变化，请刷新后重试" });
    if (target.adminRole === "super_admin" && target.status === "active" && supers.length <= 1) throw new TRPCError({ code: "FORBIDDEN", message: "不能删除最后一个启用的超级管理员" });
    const bindings = await tx.select().from(adminBusinessStaffBindings).where(sql`${adminBusinessStaffBindings.adminUserId} IN (${proof.actorId}, ${input.id})`).for("update");
    const actorBinding = bindings.find(row => row.adminUserId === proof.actorId);
    const targetBinding = bindings.find(row => row.adminUserId === input.id);
    let scopeId: number | null = null;
    if (proof.frontUserId === null) {
      const history = await tx.select({ id: adminBusinessStaffBindingAudits.id }).from(adminBusinessStaffBindingAudits)
        .where(and(eq(adminBusinessStaffBindingAudits.adminUserId, input.id), isNotNull(adminBusinessStaffBindingAudits.frontUserId))).limit(1).for("update");
      if (input.merchantId != null || proof.enterpriseId !== null || proof.binding !== null
        || input.expectedBindingVersion !== 0 || input.expectedRevision !== null || input.nextOwnerUserId || history.length || targetBinding?.frontUserId || targetBinding?.status === "active")
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "员工曾关联主站或请求携带主站身份，不能按未关联账号归档" });
    } else {
      if (!proof.binding || !proof.enterpriseId || !input.merchantId || !input.expectedRevision) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "当前企业离职证明不完整" });
      if (proof.frontUserId === proof.binding.expectedOwnerUserId) throw new TRPCError({ code: "FORBIDDEN", message: "不能删除企业所有者" });
      if (!actorBinding || actorBinding.status !== "active" || actorBinding.frontUserId !== proof.actorFrontUserId || actorBinding.bindingVersion !== proof.actorBindingVersion
        || !targetBinding || targetBinding.status !== "active" || targetBinding.frontUserId !== proof.frontUserId || targetBinding.bindingVersion !== input.expectedBindingVersion)
        throw new TRPCError({ code: "CONFLICT", message: "真实员工绑定已变化，请重新核验" });
      const scope = (await tx.select().from(adminBusinessMerchantScopes).where(and(eq(adminBusinessMerchantScopes.adminUserId, input.id), eq(adminBusinessMerchantScopes.merchantId, input.merchantId))).limit(1).for("update"))[0];
      if (!scope || scope.status !== "active") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "目标员工没有当前企业有效后台范围，不能猜测归属" });
      scopeId = scope.id;
    }
    // Separate native CRM sales responsibilities have no safe handoff API.
    const identities = await tx.select({ code: salesStaff.staffCode }).from(salesStaff).where(eq(salesStaff.adminUserId, input.id)).for("update");
    for (const identity of identities) {
      const owned = await tx.select({ id: merchants.id }).from(merchants).where(eq(merchants.salesOwnerCode, identity.code)).limit(1).for("update");
      if (owned.length) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "请先交接负责业务：后台商户销售归属尚未支持离职转派" });
    }
    const adminOnly = proof.frontUserId === null;
    await tx.insert(adminStaffArchives).values({ adminUserId: input.id, merchantId: adminOnly ? null : input.merchantId,
      enterpriseId: proof.enterpriseId, frontUserId: proof.frontUserId, actorAdminUserId: proof.actorId,
      actorFrontUserId: proof.actorFrontUserId, bindingVersion: input.expectedBindingVersion, actorBindingVersion: proof.actorBindingVersion,
      expectedSessionVersion: input.expectedSessionVersion, resultingSessionVersion: input.expectedSessionVersion + 1,
      requestId: input.requestId, expectedRevision: input.expectedRevision, nextOwnerUserId: input.nextOwnerUserId ?? null,
      enterpriseBinding: proof.binding, state: adminOnly ? "completed" : "access_closed", completedAt: adminOnly ? new Date() : null });
    const [closed] = await tx.update(adminUsers).set({ status: "disabled", sessionVersion: sql`${adminUsers.sessionVersion} + 1` })
      .where(and(eq(adminUsers.id, input.id), eq(adminUsers.sessionVersion, input.expectedSessionVersion)));
    if ((closed as ResultSetHeader).affectedRows !== 1) throw new TRPCError({ code: "CONFLICT", message: "后台账号版本已变化，归档已回滚" });
    // Preserve account, identity, credentials, permission rows and original authors. Status/version revoke backend access.
    await tx.update(salesStaff).set({ status: "inactive" }).where(eq(salesStaff.adminUserId, input.id));
    await tx.update(adminBusinessMerchantScopes).set({ status: "revoked", scopeVersion: sql`${adminBusinessMerchantScopes.scopeVersion} + 1`, revokedAt: new Date(), revokedByAdminUserId: proof.actorId, updatedByAdminUserId: proof.actorId })
      .where(scopeId ? eq(adminBusinessMerchantScopes.id, scopeId) : and(eq(adminBusinessMerchantScopes.adminUserId, input.id), eq(adminBusinessMerchantScopes.status, "active")));
    await tx.insert(auditLogs).values({ operatorId: proof.actorId, operatorName: proof.actorName.slice(0, 64), operatorRole: proof.actorRole.slice(0, 32), module: "admin_users", action: adminOnly ? "staff_archive_completed" : "staff_archive_access_closed", targetType: "admin_user", targetId: String(input.id), afterValue: { requestId: input.requestId, enterpriseId: proof.enterpriseId, adminOnly, state: adminOnly ? "completed" : "access_closed" }, note: adminOnly ? "未关联主站账号离职归档；后台已关闭，历史数据保留。" : "后台已关闭；当前企业离职交接待确认。历史数据保留。" });
    return (await tx.select().from(adminStaffArchives).where(eq(adminStaffArchives.adminUserId, input.id)).limit(1))[0]!;
  });
}
export async function markStaffArchiveAttempt(record: AdminStaffArchive) {
  await (await database()).update(adminStaffArchives).set({ attemptCount: sql`${adminStaffArchives.attemptCount} + 1`, state: "retryable", lastError: "企业离职结果待确认，可使用原请求重试" }).where(and(eq(adminStaffArchives.id, record.id), sql`${adminStaffArchives.state} <> 'completed'`));
}
export async function completeStaffArchive(record: AdminStaffArchive) {
  await (await database()).transaction(async tx => {
    const current = (await tx.select().from(adminStaffArchives).where(eq(adminStaffArchives.id, record.id)).limit(1).for("update"))[0];
    if (!current || current.adminUserId !== record.adminUserId || current.requestId !== record.requestId
      || current.frontUserId !== record.frontUserId || current.enterpriseId !== record.enterpriseId
      || current.actorAdminUserId !== record.actorAdminUserId) throw new TRPCError({ code: "CONFLICT", message: "归档账本身份已变化，不能确认完成" });
    if (current.state === "completed") return;
    await tx.update(adminStaffArchives).set({ state: "completed", completedAt: new Date(), lastError: null }).where(eq(adminStaffArchives.id, record.id));
    await tx.insert(auditLogs).values({ operatorId: record.actorAdminUserId, module: "admin_users", action: "staff_archive_completed", targetType: "admin_user", targetId: String(record.adminUserId), afterValue: { requestId: record.requestId, enterpriseId: record.enterpriseId }, note: "当前企业成员资格已撤销，后台已关闭，历史数据保留。" });
  });
}
export async function failStaffArchive(record: AdminStaffArchive, message: string) {
  await (await database()).update(adminStaffArchives).set({ state: "retryable", lastError: message.slice(0, 512) }).where(and(eq(adminStaffArchives.id, record.id), sql`${adminStaffArchives.state} <> 'completed'`));
}
