import { z } from "zod";

export const OFFICIAL_MALL_IMPORT_LIMIT = 500;
export const OFFICIAL_MALL_BULK_LIMIT = 100;
export const officialMallRequestIdSchema = z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/);
export const officialMallIdSchema = z.number().int().positive().max(2147483647);
export const officialMallRevisionSchema = z.number().int().positive().max(2147483647);
const quantity = z.number().int().min(0).max(2147483647).nullable().default(null);
const packQuantity = z.number().int().min(1).max(2147483647).nullable().default(null);
const price = z.string().trim().max(32).regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/, "单价格式或精度无效");
export const officialMallTierSchema = z.object({ minQty: z.number().int().positive().max(2147483647), price: price.refine(v => Number(v) > 0, "阶梯单价必须大于0") }).strict();
export const officialMallMaterialInputSchema = z.object({
  partNumber: z.string().trim().min(1, "请输入型号").max(128),
  brand: z.string().trim().min(1, "请输入品牌").max(128),
  pkg: z.string().trim().max(128).default(""),
  dateCode: z.string().trim().max(64).default(""),
  qtyOnSale: quantity, qtyStock: quantity, qtyOrder: quantity,
  leadTime: z.string().trim().max(128).default(""),
  priceEx: price.nullable().default(null), taxIncluded: z.boolean().nullable().default(null),
  moq: packQuantity, spq: packQuantity,
  ladderPrices: z.array(officialMallTierSchema).max(10).default([]),
  note: z.string().trim().max(2000).default(""),
}).strict().superRefine((d, ctx) => {
  if (d.qtyOnSale != null && d.qtyStock != null && d.qtyOnSale > d.qtyStock) ctx.addIssue({code:"custom",path:["qtyOnSale"],message:"可售数量不能超过实际库存"});
  let previous = 0;
  d.ladderPrices.forEach((tier, i) => { if (tier.minQty <= previous) ctx.addIssue({code:"custom",path:["ladderPrices",i,"minQty"],message:"梯度数量须递增且不能重复"}); previous = tier.minQty; });
});
export type OfficialMallMaterialInput = z.infer<typeof officialMallMaterialInputSchema>;
export type OfficialMallTier = z.infer<typeof officialMallTierSchema>;
export type OfficialMallStatus = "draft" | "published" | "offshelf";
export interface OfficialMallMaterial extends OfficialMallMaterialInput {
  id: number; revision: number; status: OfficialMallStatus; teamId: number | null;
  ownerAdminUserId: number; createdByAdminUserId: number; updatedByAdminUserId: number;
  publishedByAdminUserId: number | null; createdAt: string | Date; updatedAt: string | Date;
  publishedAt: string | Date | null;
}
export interface OfficialMallPermissions { read: boolean; write: boolean; publish: boolean; }
export interface OfficialMallAccess {
  available: boolean; permissions: OfficialMallPermissions;
  scope: { adminUserId: number; teamId: number | null; teamRole: "member" | "leader" | null; isSuperAdmin: boolean };
  teams?: { id: number; name: string }[];
  message?: string;
}
export interface OfficialMallMutationResult {
  success: boolean; id?: number; revision?: number; status?: OfficialMallStatus;
  idempotent?: boolean; message?: string;
}
export interface OfficialMallDuplicate { id: number; revision: number; partNumber: string; brand: string; pkg: string; dateCode: string; }
export interface OfficialMallSuggestion { partNumber: string; brand: string; pkg: string; }
export interface OfficialMallPreviewRow {
  rowNumber: number; data?: OfficialMallMaterialInput; errors: string[];
  duplicates: OfficialMallDuplicate[]; matches: OfficialMallSuggestion[];
  matchStatus: "exact" | "multiple" | "unmatched";
}
export type OfficialMallDuplicatePolicy = "skip" | "update" | "new";
export interface OfficialMallImportRow {
  rowNumber: number; data: OfficialMallMaterialInput; duplicatePolicy: OfficialMallDuplicatePolicy;
  duplicateId?: number; expectedRevision?: number;
}
export interface OfficialMallImportResult {
  success: boolean; imported: number; updated: number; skipped: number;
  errors: { rowNumber: number; message: string }[];
  ids: number[]; idempotent?: boolean;
}
/** Explicit safe storefront fields only; never expose employee/team/notes/import/source-of-supply. */
export interface OfficialMallPublicMaterial {
  sourceType: "official_mall"; publicId: string; revision: number;
  partNumber: string; brand: string; pkg: string; dateCode: string;
  qtyOnSale: number | null; qtyStock: number | null; qtyOrder: number | null;
  leadTime: string; priceEx: string | null; taxIncluded: boolean | null;
  moq: number | null; spq: number | null; ladderPrices: OfficialMallTier[];
  publishedAt: string;
}
export const officialMallListSchema = z.object({
  partNumber: z.string().trim().max(128).optional(), brand: z.string().trim().max(128).optional(),
  status: z.enum(["draft","published","offshelf"]).optional(),
  page: z.number().int().min(1).max(10000).default(1), pageSize: z.number().int().min(1).max(100).default(30),
}).strict();
export const officialMallRowMutationSchema = z.object({
  id: officialMallIdSchema, expectedRevision: officialMallRevisionSchema, requestId: officialMallRequestIdSchema,
}).strict();
export const officialMallImportRowSchema = z.object({
  rowNumber: z.number().int().positive(), data: officialMallMaterialInputSchema,
  duplicatePolicy: z.enum(["skip","update","new"]).default("skip"),
  duplicateId: officialMallIdSchema.optional(), expectedRevision: officialMallRevisionSchema.optional(),
}).strict().superRefine((r,ctx)=>{ if(r.duplicatePolicy==="update"&&(!r.duplicateId||!r.expectedRevision))ctx.addIssue({code:"custom",message:"更新重复物料必须携带原记录与版本"}); });
