import { z } from "zod";

export const INBOUND_DOCUMENT_KINDS = ["contract", "bank_receipt"] as const;
export const INBOUND_DOCUMENT_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export const INBOUND_DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;
export const INBOUND_DOCUMENT_MAX_PER_KIND = 5;
export const INBOUND_DOCUMENT_ACCESS_SECONDS = 300;
export const inboundDocumentKindSchema = z.enum(INBOUND_DOCUMENT_KINDS);
export const inboundDocumentMimeSchema = z.enum(INBOUND_DOCUMENT_MIME_TYPES);
/** Server-generated keys only: no URL, encoded slash, traversal or arbitrary storage path. */
export const inboundDocumentKeySchema = z.string().max(512).regex(/^inbound-documents\/[1-9][0-9]*\/[1-9][0-9]*\/[a-f0-9-]{36}_[a-f0-9]{8}\.(pdf|jpg|png|webp)$/, "附件引用无效");
export const inboundDocumentNameSchema = z.string().refine(value => !/[\x00-\x1f\x7f]/.test(value), "文件名称无效").trim().min(1).max(255)
  .refine(value => !/[\\/\x00-\x1f\x7f]/.test(value) && value !== "." && value !== "..", "文件名称无效");
export const inboundDocumentRefSchema = z.object({
  kind: inboundDocumentKindSchema, key: inboundDocumentKeySchema, name: inboundDocumentNameSchema,
  mimeType: inboundDocumentMimeSchema, size: z.number().int().positive().max(INBOUND_DOCUMENT_MAX_BYTES),
}).strict();
export const inboundDocumentsSchema = z.array(inboundDocumentRefSchema).max(INBOUND_DOCUMENT_MAX_PER_KIND * 2).superRefine((documents, ctx) => {
  for (const kind of INBOUND_DOCUMENT_KINDS) {
    if (documents.filter(document => document.kind === kind).length > INBOUND_DOCUMENT_MAX_PER_KIND)
      ctx.addIssue({ code: "custom", message: kind === "contract" ? "合同最多5份" : "银行付款水单最多5份" });
  }
  if (new Set(documents.map(document => document.key)).size !== documents.length)
    ctx.addIssue({ code: "custom", message: "附件不能重复选择" });
});
export const inboundDocumentRequestIdSchema = z.string().regex(/^[A-Za-z0-9-]{16,64}$/, "请求标识无效");
/** New/bulk uploads use the exact create clientRequestId. Edit uploads additionally use orderId.
 * Upload alone never creates an order, never changes payment. Omit documents on edit to preserve;
 * [] explicitly clears associations. Signed URLs must never be submitted as references. */
export const inboundDocumentUploadSchema = z.object({
  kind: inboundDocumentKindSchema, fileName: inboundDocumentNameSchema, mimeType: inboundDocumentMimeSchema,
  base64: z.string().min(1).max(Math.ceil(INBOUND_DOCUMENT_MAX_BYTES / 3) * 4 + 128),
  clientRequestId: inboundDocumentRequestIdSchema, orderId: z.number().int().positive().optional(),
}).strict();
export const inboundDocumentsReadSchema = z.object({ id: z.number().int().positive() }).strict();
export const inboundDocumentsSaveSchema = z.object({ id: z.number().int().positive(), documents: inboundDocumentsSchema }).strict();
/** Pending preview: clientRequestId required, edit orderId if supplied during upload.
 * Linked download: id required. No arbitrary key-only download endpoint. */
export const inboundDocumentAccessSchema = z.object({
  key: inboundDocumentKeySchema, id: z.number().int().positive().optional(),
  clientRequestId: inboundDocumentRequestIdSchema.optional(), orderId: z.number().int().positive().optional(),
  mode: z.enum(["preview", "download"]).optional(),
}).strict().refine(value => value.id !== undefined ? value.clientRequestId === undefined && value.orderId === undefined : value.clientRequestId !== undefined, "请选择已关联单据或本次上传范围");
export type InboundDocumentRef = z.infer<typeof inboundDocumentRefSchema>;
export type InboundDocumentUploadInput = z.infer<typeof inboundDocumentUploadSchema>;
export type InboundDocumentAccessInput = z.infer<typeof inboundDocumentAccessSchema>;
export type InboundDocumentScope = { documentsOnly?: true };
export type InboundDocumentsSaveInput = z.infer<typeof inboundDocumentsSaveSchema>;
export type InboundDocumentsSaveResult = { success: true } & InboundDocumentScope;
export type InboundDocumentAccess = InboundDocumentRef & { url: string; expiresIn: number } & InboundDocumentScope;
export type InboundDocumentUploadResult = InboundDocumentAccess;
export type InboundDocumentsReadResult = InboundDocumentAccess[];
