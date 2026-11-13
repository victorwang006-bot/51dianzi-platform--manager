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

/** Read one authorized real material; never accept seller, receiver or publicId. */
export const previewFactoryMaterialReceptionInputSchema = z.object({
  materialId: positiveId,
  expectedRevision: positiveId,
  expectedEnterpriseId: positiveId.optional(),
  expectedActorUserId: positiveId.optional(),
}).strict();
export const factoryMaterialReceptionSummarySchema = z.object({
  status: z.enum(["ready", "pending"]),
  recipientName: z.string().trim().min(1).max(128).nullable(),
  responsibilityVersion: z.number().int().safe().nonnegative(),
  reason: z.string().max(500).nullable().optional(),
}).strict().refine(value => value.status !== "ready" ||
  (value.recipientName !== null && value.responsibilityVersion > 0), "接待证据不足");
export const previewFactoryMaterialReceptionResultSchema = z.object({
  reception: factoryMaterialReceptionSummarySchema,
}).strict();
export type PreviewFactoryMaterialReceptionInput = z.input<typeof previewFactoryMaterialReceptionInputSchema>;
export type FactoryMaterialReceptionSummary = z.output<typeof factoryMaterialReceptionSummarySchema>;
export type PreviewFactoryMaterialReceptionResult = z.output<typeof previewFactoryMaterialReceptionResultSchema>;
