import { z } from "zod";
import { businessIndustryCodeSchema } from "../client/src/business/platform/shared/businessIndustry";

const positiveId = z.number().int().safe().positive();
/** Mirror the fixed main-site listTeamMaterials DTO; unknown authority fields fail closed. */
export const channelInventoryListBusinessInputSchema = z.object({
  expectedEnterpriseId: positiveId.optional(),
  expectedActorUserId: positiveId.optional(),
  channelId: positiveId.optional(),
  customerId: positiveId.optional(),
  uploadBatchId: positiveId.optional(),
  partNumber: z.string().transform(value => value.normalize("NFKC").trim()).pipe(z.string().max(128)).optional(),
  brand: z.string().trim().max(64).optional(),
  industryCode: z.union([businessIndustryCodeSchema, z.literal("unset")]).optional(),
  page: z.number().int().safe().min(1).max(1_000_000).default(1),
  pageSize: z.number().int().safe().min(1).max(100).default(20),
  sortBy: z.enum(["qty", "dateCode"]).optional(),
  sortDirection: z.enum(["asc", "desc"]).optional(),
}).strict();
