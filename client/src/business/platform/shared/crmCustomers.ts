import { z } from "zod";
import { businessIndustryCodeSchema } from "./businessIndustry";

export const CUSTOMER_GRADES = ["A", "B", "C", "D"] as const;
export const CUSTOMER_STAGES = ["new", "following", "quoted", "won", "paused", "invalid"] as const;
export const CUSTOMER_SCALES = ["unknown", "1-20", "21-50", "51-100", "101-500", "500+"] as const;
export const CUSTOMER_FOLLOW_METHODS = ["phone", "wechat", "email", "visit", "other"] as const;
export const CUSTOMER_GRADE_LABELS = { A: "A · 重点客户", B: "B · 重点培育", C: "C · 普通线索", D: "D · 低优先级" };
export const CUSTOMER_STAGE_LABELS = { new: "新线索", following: "跟进中", quoted: "报价中", won: "已成交", paused: "暂缓", invalid: "无效" };
export const CUSTOMER_SCALE_LABELS = { unknown: "未知", "1-20": "1—20人", "21-50": "21—50人", "51-100": "51—100人", "101-500": "101—500人", "500+": "500人以上" };
export const CUSTOMER_FOLLOW_LABELS = { phone: "电话", wechat: "微信", email: "邮件", visit: "拜访", other: "其他" };
export const customerRequestIdSchema = z.string().min(16).max(80).regex(/^[A-Za-z0-9_-]+$/);
const optionalText = (length: number) => z.string().trim().max(length).default("");

/** Format plausibility only, not verification of ownership or reachability. */
export function isCustomerPhone(value: string): boolean {
  const normalized = value.normalize("NFKC").trim();
  const main = normalized.replace(/\s*(?:ext\.?|x|#|转|分机)\s*\d{1,6}\s*$/i, "");
  if (!/^(?:\+|\(|\d)[\d() .-]*$/.test(main)) return false;
  const digits = main.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return false;
  let balance = 0;
  for (const char of main) {
    if (char === "(") balance++;
    if (char === ")" && --balance < 0) return false;
  }
  return balance === 0;
}
/** Read compatibility: old incomplete records remain accessible and transferable. */
export function customerNeedsCompletion(record: { name?: string | null; contactName?: string | null; phone?: string | null }): boolean {
  return !record.name?.trim() || !record.contactName?.trim() || !record.phone?.trim();
}

export const customerDataSchema = z.object({
  name: z.string().trim().min(1, "请输入客户名称").max(128, "客户名称不能超过128字"),
  industryCode: businessIndustryCodeSchema,
  contactName: z.string({ error: "请输入联系人" }).trim().min(1, "请输入联系人").max(64, "联系人不能超过64字"),
  phone: z.string({ error: "请输入电话" }).trim().min(1, "请输入电话").max(64, "电话不能超过64字").refine(value => !value || isCustomerPhone(value), "请输入有效电话，可填写手机、座机或国际号码"),
  email: z.string().trim().max(254).refine(value => !value || z.string().email().safeParse(value).success, "请输入有效邮箱").default(""),
  province: optionalText(64), city: optionalText(64), district: optionalText(64), address: optionalText(500),
  scale: z.enum(CUSTOMER_SCALES).default("unknown"),
  grade: z.enum(CUSTOMER_GRADES).default("C"),
  stage: z.enum(CUSTOMER_STAGES).default("new"),
  source: optionalText(128),
  nextFollowUpAt: z.string().datetime({ offset: true }).nullable().default(null),
  assignedUserId: z.number().int().positive().optional(),
});
export type CustomerData = z.infer<typeof customerDataSchema>;
export type CustomerRecord = Omit<CustomerData, "assignedUserId" | "industryCode"> & {
  /** Read compatibility only: legacy NULL and unknown historical codes are not guessed. */
  industryCode: string | null;
  id: number; enterpriseId: number; assignedUserId: number; assignedName: string;
  createdByUserId: number; createdByName: string; createdAt: string; updatedAt: string;
  version: number; archivedAt: string | null; archiveReason: string | null; lastFollowUpAt: string | null;
};
export type CustomerFollowUp = {
  id: number; customerId: number; authorUserId: number; authorName: string;
  method: typeof CUSTOMER_FOLLOW_METHODS[number]; content: string; occurredAt: string; createdAt: string;
  correctionOfId: number | null;
};
export type CustomerAudit = {
  id: number; action: string; actorUserId: number; actorName: string; note: string; createdAt: string;
};
export type CustomerMember = { userId: number; name: string };
export const customerCreateSchema = z.object({
  data: customerDataSchema, requestId: customerRequestIdSchema,
  initialFollowUp: z.string().trim().max(4000).default(""),
  confirmDuplicate: z.boolean().default(false),
});
export const customerUpdateSchema = z.object({
  id: z.number().int().positive(), data: customerDataSchema, version: z.number().int().positive(),
  confirmDuplicate: z.boolean().default(false),
});
export const customerListSchema = z.object({
  keyword: optionalText(128), grade: z.enum(CUSTOMER_GRADES).optional(), stage: z.enum(CUSTOMER_STAGES).optional(),
  scope: z.enum(["mine", "all"]).default("mine"), assignedUserId: z.number().int().positive().optional(),
  archived: z.boolean().default(false), due: z.enum(["all", "today", "overdue"]).default("all"),
  page: z.number().int().min(1).max(100000).default(1), pageSize: z.number().int().min(1).max(100).default(20),
});
export const customerFollowUpSchema = z.object({
  customerId: z.number().int().positive(), requestId: customerRequestIdSchema,
  method: z.enum(CUSTOMER_FOLLOW_METHODS).default("phone"),
  content: z.string().trim().min(1, "请输入跟进内容").max(4000),
  occurredAt: z.string().datetime({ offset: true }),
  nextFollowUpAt: z.string().datetime({ offset: true }).nullable(),
  stage: z.enum(CUSTOMER_STAGES).optional(),
  correctionOfId: z.number().int().positive().optional(),
});
