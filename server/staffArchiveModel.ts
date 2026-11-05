import { z } from "zod";
import { TRPCError } from "@trpc/server";

export const staffArchivePreviewInput = z.object({ id: z.number().int().positive(), merchantId: z.number().int().positive().nullable().optional() });
export const staffArchiveInput = staffArchivePreviewInput.extend({
  expectedSessionVersion: z.number().int().positive(),
  expectedBindingVersion: z.number().int().min(0),
  expectedRevision: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  nextOwnerUserId: z.number().int().positive().optional(),
  requestId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
});
export type StaffArchiveInput = z.infer<typeof staffArchiveInput>;
export const memberArchivePreviewSchema = z.object({
  enterpriseId: z.number().int().positive(),
  target: z.object({ userId: z.number().int().positive(), displayName: z.string() }),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  inventory: z.object({ total: z.number().int().nonnegative() }),
  inquiries: z.object({ total: z.number().int().nonnegative() }),
  customers: z.object({ total: z.number().int().nonnegative() }),
  limits: z.object({ exceeded: z.boolean() }),
  unsupported: z.array(z.object({ key: z.string(), label: z.string(), reason: z.string(), blocking: z.boolean() })),
  candidates: z.array(z.object({ userId: z.number().int().positive(), displayName: z.string(), eligible: z.boolean(), unavailableReason: z.string().nullable() })),
});
export type MemberArchivePreview = z.infer<typeof memberArchivePreviewSchema>;
export function assertArchivePreview(preview: MemberArchivePreview, input: StaffArchiveInput) {
  if (preview.limits.exceeded) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "请先交接负责业务：业务量超过安全上限" });
  if (preview.unsupported.some(item => item.blocking)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `请先交接负责业务：${preview.unsupported.filter(item => item.blocking).map(item => item.label).join("、")}尚未支持安全移除` });
  if (preview.revision !== input.expectedRevision) throw new TRPCError({ code: "CONFLICT", message: "成员业务已变化，请重新预览" });
  const requiresHandoff = preview.inventory.total + preview.inquiries.total + preview.customers.total > 0;
  if (requiresHandoff && !input.nextOwnerUserId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "请先交接负责业务" });
  if (input.nextOwnerUserId && !preview.candidates.some(item => item.userId === input.nextOwnerUserId && item.eligible)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "请选择当前企业合法的业务接替人" });
}
export function isMemberArchiveReceipt(value: unknown, enterpriseId: number, userId: number): boolean {
  const receipt = value as { success?: unknown; removed?: unknown; enterpriseId?: unknown; targetUserId?: unknown } | null;
  return receipt?.success === true && receipt.removed === true && receipt.enterpriseId === enterpriseId && receipt.targetUserId === userId;
}
