import { TRPCError } from "@trpc/server";
import { previewEnterpriseMemberHandoff, handoffEnterpriseMemberBusiness } from "./enterpriseMemberHandoff";

/** Only verified positive responsibility is blocking; history authors are not owners. */
export function archiveResponsibilityBlockers(unsupported: readonly { key: string; label: string; reason: string; blocking?: boolean; present?: boolean }[]) {
  return unsupported.map(item => ({ ...item, blocking: item.blocking === true }));
}
export async function previewEnterpriseMemberArchive(input: { actorUserId: number; targetUserId: number }) {
  if (input.actorUserId === input.targetUserId) throw new TRPCError({ code: "FORBIDDEN", message: "不能删除自己" });
  const preview = await previewEnterpriseMemberHandoff({ ...input, mode: "handoff_remove", requireCompleteResponsibilityCoverage: true });
  return { ...preview, unsupported: archiveResponsibilityBlockers(preview.unsupported) };
}
export async function archiveEnterpriseMember(input: {
  actorUserId: number; targetUserId: number; nextOwnerUserId?: number;
  expectedRevision: string; requestId: string;
}) {
  if (input.actorUserId === input.targetUserId) throw new TRPCError({ code: "FORBIDDEN", message: "不能删除自己" });
  // The transaction repeats the strict check; no client preview or optimistic UI can bypass it.
  return handoffEnterpriseMemberBusiness({ ...input, mode: "handoff_remove", requireCompleteResponsibilityCoverage: true });
}
