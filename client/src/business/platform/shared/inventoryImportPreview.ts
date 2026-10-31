import { z } from "zod";
import { importRowSchema } from "./inventoryImportValidation";

/**
 * The simplified upload protocol is deliberately explicit.  Stage must not
 * silently accept a V3 row after a preview fingerprint has been dropped.
 */
export const INVENTORY_IMPORT_PREVIEW_POLICY_VERSION = 3 as const;

export const inventoryImportPreviewRowSchema = importRowSchema.safeExtend({
  sourceRowNumber: z.number().int().min(2),
  preserveBlankFields: z.literal(true),
  clearFields: z.array(z.string()).max(0),
  importPolicyVersion: z.literal(INVENTORY_IMPORT_PREVIEW_POLICY_VERSION),
});

/** The request shape intentionally has no client-created fingerprint. */
export const inventoryImportPreviewInputSchema = z.object({
  rows: z.array(inventoryImportPreviewRowSchema).min(1).max(500),
}).superRefine((input, ctx) => {
  let previousRowNumber = 1;
  input.rows.forEach((row, index) => {
    if (row.sourceRowNumber <= previousRowNumber) {
      ctx.addIssue({
        code: "custom",
        path: ["rows", index, "sourceRowNumber"],
        message: "Excel 原始行号必须严格递增且不能重复",
      });
    }
    previousRowNumber = row.sourceRowNumber;
  });
});

/** A V3 stage row must carry the exact server-issued preview token. */
export const inventoryImportV3StageRowSchema = inventoryImportPreviewRowSchema.safeExtend({
  expectedFingerprint: z.union([
    z.literal("new"),
    z.string().regex(/^[a-f0-9]{64}$/i),
  ]),
});

export type InventoryImportPreviewRow = z.infer<typeof inventoryImportPreviewRowSchema>;
export type InventoryImportV3StageRow = z.infer<typeof inventoryImportV3StageRowSchema>;
