import { TRPCError } from "@trpc/server";

/** Public messages never expose another merchant, a private document key or an owner ID. */
export function cnReviewCrmError(error: unknown): TRPCError | null {
  const message = error instanceof Error ? error.message : "";
  const reason = (error as { reason?: string } | null)?.reason;
  if (message === "MERCHANT_NOT_FOUND") return new TRPCError({ code: "NOT_FOUND", message: "商户不存在或不在您负责的范围内" });
  if (message === "CN_REGISTRATION_REQUIRED") return new TRPCError({ code: "PRECONDITION_FAILED", message: "该商户不是中国内地注册企业" });
  if (reason === "CN_REGISTRATION_NOT_APPROVED") return new TRPCError({ code: "PRECONDITION_FAILED", message: "企业资料尚未审核通过，请在审核操作中一次确认审核并开通 ERP" });
  if (["CN_REVIEW_VERSION_CHANGED", "CN_REVIEW_CANDIDATE_NOT_FOUND", "CN_REVIEW_MERCHANT_STATE_INVALID", "CN_REVIEW_MERCHANT_UPDATE_FAILED"].includes(message)) return new TRPCError({ code: "CONFLICT", message: "待审核企业资料已变化，请刷新后重新核对" });
  if (message === "CN_REVIEW_COMPLETION_CHANGED") return new TRPCError({ code: "CONFLICT", message: "该审核版本已处理或 ERP 状态已变化，请刷新后按当前状态操作" });
  if (message === "CN_REVIEW_ALREADY_DECIDED") return new TRPCError({ code: "CONFLICT", message: "该版本已完成不同审核决定，请刷新" });
  if (["CN_REVIEW_SUBJECT_MISMATCH", "CN_REVIEW_OWNER_OR_SUBJECT_INVALID", "CN_PLATFORM_REVIEW_OR_OWNER_INVALID", "CN_REVIEW_PLATFORM_SUBJECT_NOT_FOUND", "该商户已绑定其他前台账号，不能通过开通操作直接换绑"].includes(message)) return new TRPCError({ code: "PRECONDITION_FAILED", message: "企业主体或负责人绑定不一致，不能开通或改绑，请使用既有合法变更流程" });
  if (message === "CRM_DUPLICATE_OPENING") return new TRPCError({ code: "CONFLICT", message: "该公司名称或营业执照已申请／开通，请勿重复开通" });
  if (message === "CRM_DUPLICATE_LOCK_UNAVAILABLE") return new TRPCError({ code: "CONFLICT", message: "其他开通申请正在处理，请稍后重试" });
  if (message === "CN_REVIEW_CONFIRMATION_REQUIRED") return new TRPCError({ code: "BAD_REQUEST", message: "请人工确认同时审核企业资料并开通 ERP" });
  if (["CN_REVIEW_CANDIDATE_INVALID", "CN_REVIEW_UNSUPPORTED_DRAFT_FIELD", "CN_REVIEW_DOCUMENT_REFERENCE_INVALID", "CN_REVIEW_DOCUMENT_MIGRATION_REQUIRED"].includes(message)) return new TRPCError({ code: "PRECONDITION_FAILED", message: "待审核企业资料或证件无效，无法安全通过，请核对资料" });
  return null;
}
