import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "./_core/context";
import * as db from "./db";
import { assertBusinessMerchantAccess, businessEnterpriseBindingFromMerchant, requireBusinessBindingManager } from "./businessAccess";
import { callPlatformBusinessCommand, PlatformBusinessPublicError, type PlatformBusinessBinding } from "./platformBusinessApi";
import { findStaffArchive, staffBindingHistory, startStaffArchive, markStaffArchiveAttempt, completeStaffArchive, failStaffArchive } from "./staffArchiveDb";
import { assertArchivePreview, isMemberArchiveReceipt, memberArchivePreviewSchema, type StaffArchiveInput } from "./staffArchiveModel";

function withArchiveFences<T>(actorId: number, targetId: number, merchantId: number | null | undefined, operation: () => Promise<T>) {
  const ids = Array.from(new Set([actorId, targetId])).sort((a, b) => a - b);
  const lock = (index: number): Promise<T> => index >= ids.length ? operation()
    : db.withBusinessAuthorizationFence({ adminUserId: ids[index]!, ...(merchantId ? { merchantId } : {}) }, () => lock(index + 1));
  return lock(0);
}
async function currentProof(ctx: TrpcContext, id: number, merchantId?: number | null) {
  const sessionActor = requireBusinessBindingManager(ctx);
  if (sessionActor.id === id) throw new TRPCError({ code: "FORBIDDEN", message: "不能删除自己" });
  const account = await db.getAdminUserById(sessionActor.id);
  if (!account || account.status !== "active" || account.sessionVersion !== sessionActor.sessionVersion) throw new TRPCError({ code: "FORBIDDEN", message: "操作者会话或权限已变化，请重新登录" });
  const freshCtx = { ...ctx, adminAccount: account, adminPermissions: await db.getAdminUserPermissions(account.id) } as TrpcContext;
  requireBusinessBindingManager(freshCtx);
  const history = await staffBindingHistory(id);
  if (history.kind === "unresolved") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "员工曾关联主站或绑定异常，请核验企业身份后再删除，不能按未关联账号处理" });
  if (history.kind === "never_bound") return { kind: "admin_only" as const, account, actorBinding: null, targetBinding: null, binding: null };
  if (!merchantId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "已关联员工必须选择已核验的当前企业" });
  const merchant = await assertBusinessMerchantAccess(freshCtx, merchantId, "users", "write");
  const actorBinding = await db.getActiveBusinessStaffBinding(account.id);
  const targetBinding = await db.getActiveBusinessStaffBinding(id);
  if (!actorBinding?.frontUserId || !targetBinding?.frontUserId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "请核验真实业务身份，不能使用后台ID代替" });
  if (actorBinding.frontUserId === targetBinding.frontUserId) throw new TRPCError({ code: "FORBIDDEN", message: "不能删除自己" });
  const binding = businessEnterpriseBindingFromMerchant(merchant);
  if (targetBinding.frontUserId === binding.expectedOwnerUserId) throw new TRPCError({ code: "FORBIDDEN", message: "不能删除企业所有者" });
  return { kind: "enterprise" as const, account, actorBinding, targetBinding, binding };
}
type Proof = Awaited<ReturnType<typeof currentProof>>;
type EnterpriseProof = Extract<Proof, { kind: "enterprise" }>;
async function command(proof: EnterpriseProof, method: "enterprise.archivePreview" | "enterprise.archiveMember", params: unknown, binding?: PlatformBusinessBinding) {
  return callPlatformBusinessCommand({ binding: binding ?? proof.binding, staffUserId: proof.actorBinding.frontUserId,
    bindingVersion: proof.actorBinding.bindingVersion, adminActor: { id: proof.account.id, name: proof.account.displayName || proof.account.username, role: proof.account.adminRole }, requestId: randomUUID(), method, params });
}
function publicPending(record: NonNullable<Awaited<ReturnType<typeof findStaffArchive>>>) {
  return { requestId: record.requestId, expectedSessionVersion: record.expectedSessionVersion, expectedBindingVersion: record.bindingVersion,
    expectedRevision: record.expectedRevision, ...(record.nextOwnerUserId ? { nextOwnerUserId: record.nextOwnerUserId } : {}), state: record.state,
    message: record.lastError ?? "后台访问已关闭，企业离职待处理，可重试原请求" };
}
function verifyReplay(record: NonNullable<Awaited<ReturnType<typeof findStaffArchive>>>, input: StaffArchiveInput, proof: Proof) {
  const isAdminOnly = record.frontUserId === null;
  if (record.requestId !== input.requestId || record.actorAdminUserId !== proof.account.id
    || record.adminUserId !== input.id || record.merchantId !== (input.merchantId ?? null)
    || record.expectedSessionVersion !== input.expectedSessionVersion || record.bindingVersion !== input.expectedBindingVersion
    || record.expectedRevision !== input.expectedRevision || record.nextOwnerUserId !== (input.nextOwnerUserId ?? null)
    || isAdminOnly !== (proof.kind === "admin_only")) throw new TRPCError({ code: "CONFLICT", message: "归档身份或请求内容已变化，不能重放原请求" });
  if (proof.kind === "enterprise" && (record.actorFrontUserId !== proof.actorBinding.frontUserId || record.actorBindingVersion !== proof.actorBinding.bindingVersion
    || record.frontUserId !== proof.targetBinding.frontUserId || record.bindingVersion !== proof.targetBinding.bindingVersion || record.merchantId !== input.merchantId
    || record.enterpriseBinding?.creditCode !== proof.binding.creditCode || record.enterpriseBinding?.registrationIdentifier !== proof.binding.registrationIdentifier
    || record.enterpriseBinding?.expectedOwnerUserId !== proof.binding.expectedOwnerUserId)) throw new TRPCError({ code: "CONFLICT", message: "归档企业或真实绑定已变化，不能重放原请求" });
}
export async function previewStaffArchive(ctx: TrpcContext, input: { id: number; merchantId?: number | null }) {
  const actor = requireBusinessBindingManager(ctx);
  return withArchiveFences(actor.id, input.id, input.merchantId, async () => {
    const proof = await currentProof(ctx, input.id, input.merchantId);
    const record = await findStaffArchive(input.id);
    if (record) {
      if (record.actorAdminUserId !== actor.id || (record.frontUserId !== null && record.merchantId !== input.merchantId)) throw new TRPCError({ code: "FORBIDDEN", message: "该离职请求需由原操作者在原企业核验重试" });
      verifyReplay(record, { id: input.id, merchantId: record.frontUserId === null ? null : input.merchantId,
        requestId: record.requestId, expectedSessionVersion: record.expectedSessionVersion, expectedBindingVersion: record.bindingVersion,
        expectedRevision: record.expectedRevision, ...(record.nextOwnerUserId ? { nextOwnerUserId: record.nextOwnerUserId } : {}) }, proof);
      return { archived: true as const, adminOnly: record.frontUserId === null, pending: publicPending(record), preview: null, expectedSessionVersion: record.expectedSessionVersion, expectedBindingVersion: record.bindingVersion };
    }
    const account = await db.getAdminUserById(input.id);
    if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "后台用户不存在" });
    if (proof.kind === "admin_only") return { archived: false as const, adminOnly: true, pending: null, preview: null, expectedSessionVersion: account.sessionVersion, expectedBindingVersion: 0 };
    const preview = memberArchivePreviewSchema.parse(await command(proof, "enterprise.archivePreview", { userId: proof.targetBinding.frontUserId }));
    if (preview.target.userId !== proof.targetBinding.frontUserId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "主站员工身份不一致，归档已停止" });
    return { archived: false as const, adminOnly: false, pending: null, preview, expectedSessionVersion: account.sessionVersion, expectedBindingVersion: proof.targetBinding.bindingVersion };
  });
}
function completedResult(record: NonNullable<Awaited<ReturnType<typeof findStaffArchive>>>, idempotent: boolean) {
  return { success: true as const, state: "completed" as const, idempotent, requestId: record.requestId,
    backendAccessClosed: true as const, membershipRequired: record.frontUserId !== null,
    enterpriseRemoved: record.frontUserId === null ? null : true, message: "用户已删除，历史数据保留。" };
}
export async function archiveStaff(ctx: TrpcContext, input: StaffArchiveInput) {
  const actor = requireBusinessBindingManager(ctx);
  return withArchiveFences(actor.id, input.id, input.merchantId, async () => {
    const proof = await currentProof(ctx, input.id, input.merchantId);
    let record = await findStaffArchive(input.id);
    const replay = Boolean(record);
    if (record) verifyReplay(record, input, proof);
    else {
      let enterpriseId: number | null = null;
      if (proof.kind === "enterprise") {
        const preview = memberArchivePreviewSchema.parse(await command(proof, "enterprise.archivePreview", { userId: proof.targetBinding.frontUserId }));
        if (preview.target.userId !== proof.targetBinding.frontUserId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "主站员工身份不一致，归档已停止" });
        assertArchivePreview(preview, input); enterpriseId = preview.enterpriseId;
      }
      record = await startStaffArchive(input, { actorId: proof.account.id, actorSessionVersion: proof.account.sessionVersion,
        actorFrontUserId: proof.actorBinding?.frontUserId ?? null, actorBindingVersion: proof.actorBinding?.bindingVersion ?? null,
        frontUserId: proof.targetBinding?.frontUserId ?? null, enterpriseId, binding: proof.binding,
        actorName: proof.account.displayName || proof.account.username, actorRole: proof.account.adminRole });
    }
    if (record.state === "completed") return completedResult(record, replay);
    // Durable close precedes the RPC. Crash/time-out replays its identical remote operation.
    try {
      await markStaffArchiveAttempt(record);
      if (proof.kind !== "enterprise" || !record.enterpriseBinding || !record.frontUserId || !record.enterpriseId || !record.expectedRevision) throw new Error("ARCHIVE_PROOF_MISSING");
      const receipt = await command(proof, "enterprise.archiveMember", { userId: record.frontUserId,
        ...(record.nextOwnerUserId ? { nextOwnerUserId: record.nextOwnerUserId } : {}), requestId: record.requestId, expectedRevision: record.expectedRevision }, record.enterpriseBinding);
      if (!isMemberArchiveReceipt(receipt, record.enterpriseId, record.frontUserId)) throw new Error("INVALID_ARCHIVE_RECEIPT");
      await completeStaffArchive(record);
      return completedResult(record, false);
    } catch (error) {
      const detail = error instanceof PlatformBusinessPublicError ? error.message.slice(0, 400) : "企业离职结果未确认，请使用原请求重试";
      const message = `后台访问已关闭，企业离职待处理：${detail}`;
      await failStaffArchive(record, message).catch(() => undefined);
      return { success: false as const, state: "retryable" as const, requestId: record.requestId, backendAccessClosed: true as const, membershipRequired: true, enterpriseRemoved: false, message };
    }
  });
}
