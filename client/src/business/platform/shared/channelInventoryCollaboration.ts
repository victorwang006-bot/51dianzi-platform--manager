import { z } from "zod";

const positiveInt = z.number().int().safe().positive();
export const channelCollaborationExpectedContext = {
  expectedEnterpriseId: positiveInt.optional(),
  expectedActorUserId: positiveInt.optional(),
};
const requestId = z.string().uuid("请求号无效").transform(value => value.toLowerCase());
const content = z.string().trim().min(1, "请输入备注内容").max(2_000, "备注内容不能超过 2000 个字符");
export const teamMaterialPublicUpdateFields = {
  partNumber: z.string().transform(value => value.normalize("NFKC").trim()).pipe(z.string().min(1, "请输入型号").max(128)).optional(),
  brand: z.string().trim().min(1, "请输入品牌").max(64).optional(),
  qty: z.number().int().safe().min(0).max(2_147_483_647).nullable().optional(),
  dateCode: z.string().trim().max(32).nullable().optional(),
  price: z.string().trim().max(32).regex(/^(?:0|[1-9]\d{0,14})(?:\.\d{1,12})?$/, "价格格式无效").nullable().optional(),
  taxIncluded: z.boolean().nullable().optional(),
  leadTime: z.string().trim().max(64).nullable().optional(),
};
export const teamMaterialForEditSchema = z.object({ id: positiveInt, ...channelCollaborationExpectedContext }).strict();
export const teamMaterialUpdateSchema = z.object({ id: positiveInt, expectedRevision: positiveInt, ...teamMaterialPublicUpdateFields, requestId, ...channelCollaborationExpectedContext }).strict()
  .refine(input => Object.keys(teamMaterialPublicUpdateFields).some(key => input[key as keyof typeof teamMaterialPublicUpdateFields] !== undefined), { message: "请至少提供一个要更新的库存字段" });
export const collaborationNotesListSchema = z.object({ materialId: positiveInt, page: z.number().int().safe().min(1).max(1_000_000).default(1), pageSize: z.number().int().safe().min(1).max(100).default(50), ...channelCollaborationExpectedContext }).strict();
export const collaborationNotesAddSchema = z.object({ materialId: positiveInt, content, requestId, ...channelCollaborationExpectedContext }).strict();
export const collaborationNotesEditSchema = z.object({ noteId: positiveInt, expectedRevision: positiveInt, content, requestId, ...channelCollaborationExpectedContext }).strict();
export type TeamMaterialUpdateInput = z.input<typeof teamMaterialUpdateSchema>;
export type CollaborationNoteAddInput = z.input<typeof collaborationNotesAddSchema>;
export type CollaborationNoteEditInput = z.input<typeof collaborationNotesEditSchema>;
