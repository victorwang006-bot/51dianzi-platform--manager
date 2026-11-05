import { z } from "zod";

const positiveId = z.number().int().safe().positive();
/** Assertions only: never select an identity, company, permissions or snapshot. */
export const publishFactoryMaterialInputSchema = z.object({
  materialId: positiveId,
  expectedRevision: positiveId,
  requestId: z.string().uuid("请求号无效"),
  expectedEnterpriseId: positiveId.optional(),
  expectedActorUserId: positiveId.optional(),
}).strict();
export const publishFactoryMaterialResultSchema = z.object({
  materialId: positiveId,
  publicId: z.string().regex(/^ocp_[a-f0-9]{32}$/),
  status: z.literal("published"),
  revision: positiveId,
}).strict();
export const publishFactoryMaterialSchema = publishFactoryMaterialInputSchema;
export type PublishFactoryMaterialInput = z.input<typeof publishFactoryMaterialInputSchema>;
export type PublishFactoryMaterialResult = z.output<typeof publishFactoryMaterialResultSchema>;
export type FactoryMaterialPublicationStatus = "unpublished" | "published";
