import { z } from "zod";

export const SALES_ORDER_DRAFT_MAX_BYTES = 128 * 1024;
export const SALES_ORDER_DRAFT_MAX_REVISION = Number.MAX_SAFE_INTEGER - 1;
export type SalesOrderDraftJson = null | boolean | number | string | SalesOrderDraftJson[] | { [key: string]: SalesOrderDraftJson };

/** Bounded JSON, not arbitrary records. Never transform/strip saved UI fields. */
function validJson(value: unknown, depth = 0, seen = new Set<object>()): value is SalesOrderDraftJson {
  if (depth > 12) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "string") return value.length <= 8192;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  let valid: boolean;
  if (Array.isArray(value)) valid = value.length <= 200 && value.every(item => validJson(item, depth + 1, seen));
  else {
    const proto = Object.getPrototypeOf(value);
    const keys = Object.keys(value);
    valid = (proto === Object.prototype || proto === null) && keys.length <= 100 && keys.every(key =>
      key.length <= 128 && !["__proto__", "constructor", "prototype"].includes(key) && validJson((value as Record<string, unknown>)[key], depth + 1, seen));
  }
  seen.delete(value);
  return valid;
}
const json = z.custom<SalesOrderDraftJson>(value => validJson(value), "草稿结构无效或层级/字段数量超限");
const record = z.custom<Record<string, SalesOrderDraftJson>>(value =>
  value !== null && typeof value === "object" && !Array.isArray(value) && validJson(value), "草稿表单须为有限JSON对象");
const draftId = z.number().int().positive().max(2147483647);
const revision = z.number().int().nonnegative().max(SALES_ORDER_DRAFT_MAX_REVISION);
const company = z.object({
  lines: z.array(json).max(200).optional(),
  salesTaxMode: z.enum(["tax_included", "tax_excluded"]).optional(),
  dueDate: z.string().max(32).optional(),
  confirmationNote: z.string().max(500).optional(),
  customerConfirmed: z.boolean().optional(),
  uncertain: record.nullable().optional(),
}).catchall(json);
export const salesOrderDraftPayloadSchema = z.object({
  customer: record.nullable().optional(),
  source: z.enum(["company_stock", "demand"]).optional(),
  demandId: draftId.nullable().optional(),
  company: company.optional(),
  form: record.optional(),
}).strict().superRefine((value, ctx) => {
  // Validate the complete tree too (including catchall keys); TextEncoder is browser-safe.
  if (!validJson(value) || new TextEncoder().encode(JSON.stringify(value)).length > SALES_ORDER_DRAFT_MAX_BYTES) {
    ctx.addIssue({ code: "custom", message: "草稿结构无效或大小超过128KiB限制" });
  }
});
export const salesOrderDraftGetSchema = z.object({}).strict();
export const salesOrderDraftSaveSchema = z.object({ expectedRevision: revision, payload: salesOrderDraftPayloadSchema }).strict();
export const salesOrderDraftDeleteSchema = z.object({ expectedRevision: revision }).strict();
export const salesOrderDraftMutationResultSchema = z.object({ revision: revision.positive(), updatedAt: z.string().min(1).max(64) }).strict();
export const salesOrderDraftResultSchema = z.object({
  draftId, revision: revision.positive(), updatedAt: z.string().min(1).max(64), payload: salesOrderDraftPayloadSchema.nullable(),
}).strict().nullable();
export type SalesOrderDraftPayload = z.infer<typeof salesOrderDraftPayloadSchema>;
export type SalesOrderDraftSaveInput = z.infer<typeof salesOrderDraftSaveSchema>;
export type SalesOrderDraftDeleteInput = z.infer<typeof salesOrderDraftDeleteSchema>;
export type SalesOrderDraftMutationResult = z.infer<typeof salesOrderDraftMutationResultSchema>;
export type SalesOrderDraftResult = z.infer<typeof salesOrderDraftResultSchema>;
