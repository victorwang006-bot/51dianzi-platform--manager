import { z } from "zod";
const id = z.number().int().safe().positive();
export const inventoryManagementExpectedContext = { expectedEnterpriseId: id.optional(), expectedActorUserId: id.optional() };
const requestId = z.string().uuid("请求号无效").transform(value => value.toLowerCase());
const page = z.number().int().safe().min(1).max(1_000_000).default(1);
const pageSize = z.number().int().safe().min(1).max(100).default(20);
export const deleteMaterialsSchema = z.object({ items: z.array(z.object({ id, expectedRevision: id }).strict()).min(1).max(100), requestId, ...inventoryManagementExpectedContext }).strict()
  .refine(value => new Set(value.items.map(item => item.id)).size === value.items.length, { message: "库存编号不可重复" });
export const listDeletedMaterialsSchema = z.object({ page, pageSize, ...inventoryManagementExpectedContext }).strict();
export const restoreMaterialSchema = z.object({ id, expectedRevision: id, requestId, ...inventoryManagementExpectedContext }).strict();
export const createUploadBatchSchema = z.object({ channelId: id, fileName: z.string().trim().min(1).max(255), totalRows: z.number().int().safe().min(1).max(1000), requestId, ...inventoryManagementExpectedContext }).strict();
export const listUploadBatchesSchema = z.object({ page, pageSize, channelId: id.optional(), archived: z.boolean().optional(), ...inventoryManagementExpectedContext }).strict();
export const updateUploadBatchSchema = z.object({ id, expectedRevision: id, name: z.string().trim().min(1).max(128).optional(), archived: z.boolean().optional(), requestId, ...inventoryManagementExpectedContext }).strict()
  .refine(value => value.name !== undefined || value.archived !== undefined, { message: "请提供批次名称或归档状态" });
export const previewDeleteUploadBatchSchema = z.object({ id, ...inventoryManagementExpectedContext }).strict();
export const deleteUploadBatchSchema = z.object({ id, expectedRevision: id, requestId, ...inventoryManagementExpectedContext }).strict();
export type DeleteMaterialsInput = z.input<typeof deleteMaterialsSchema>;
export type RestoreMaterialInput = z.input<typeof restoreMaterialSchema>;
export type CreateUploadBatchInput = z.input<typeof createUploadBatchSchema>;
export type ListUploadBatchesInput = z.input<typeof listUploadBatchesSchema>;
export type UpdateUploadBatchInput = z.input<typeof updateUploadBatchSchema>;
export type PreviewDeleteUploadBatchInput = z.input<typeof previewDeleteUploadBatchSchema>;
export type DeleteUploadBatchInput = z.input<typeof deleteUploadBatchSchema>;
export type DeleteMaterialsResult = { deletedCount: number; skippedCount: number; results: { id: number; success: boolean; reason?: string }[] };
export type DeletedMaterial = { id: number; partNumber: string; brand: string; revision: number; deletedAt: Date | string; uploadBatchId: number | null; canRestore: boolean };
export type UploadBatch = { id: number; batchCode: string; name: string | null; fileName: string; channelId: number; channelName: string; uploadedByName: string; createdAt: Date | string; totalRows: number; successCount: number; remainingCount: number; revision: number; archived: boolean };
export const CHANNEL_MANAGEMENT_BUSINESS_INPUT_SCHEMAS: Record<string, z.ZodTypeAny> = {
  "channelInventory.deleteMaterials": deleteMaterialsSchema,
  "channelInventory.listDeletedMaterials": listDeletedMaterialsSchema,
  "channelInventory.restoreMaterial": restoreMaterialSchema,
  "channelInventory.createUploadBatch": createUploadBatchSchema,
  "channelInventory.listUploadBatches": listUploadBatchesSchema,
  "channelInventory.updateUploadBatch": updateUploadBatchSchema,
  "channelInventory.previewDeleteUploadBatch": previewDeleteUploadBatchSchema,
  "channelInventory.deleteUploadBatch": deleteUploadBatchSchema,
};
