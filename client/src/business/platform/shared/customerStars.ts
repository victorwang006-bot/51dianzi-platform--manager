import { z } from "zod";
import { customerRequestIdSchema, type CustomerRecord } from "./crmCustomers";

const positiveId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const revision = z.number().int().min(0).max(2147483646);
/** Omitted arguments are valid; no caller-selected actor/enterprise in this query. */
export const customerStarContextInputSchema = z.object({}).strict().optional();
export const customerStarContextSchema = z.object({
  enterpriseId: positiveId,
  actorUserId: positiveId,
  targets: z.array(z.object({ userId: positiveId, name: z.string() }).strict()),
}).strict();
export const customerSetStarSchema = z.object({
  customerId: positiveId,
  targetUserId: positiveId,
  starred: z.boolean(),
  expectedRevision: revision,
  requestId: customerRequestIdSchema,
  expectedEnterpriseId: positiveId,
  expectedActorUserId: positiveId,
  /** Opt-in current-assignee fence; omission preserves historical personal preferences. */
  starMode: z.literal("assignee").optional(),
}).strict();
export const customerSetStarResultSchema = z.object({
  customerId: positiveId,
  targetUserId: positiveId,
  isStarred: z.boolean(),
  starRevision: z.number().int().min(1).max(2147483647),
  requestId: customerRequestIdSchema,
  idempotent: z.boolean(),
}).strict();
/** Required on every customer.list row; absent preferences map to false/revision zero. */
export const customerStarMetadataSchema = z.object({
  isStarred: z.boolean(),
  starRevision: z.number().int().min(0).max(2147483647),
  starUserId: positiveId.nullable(),
  canSetStar: z.boolean(),
}).strict();
/** One exact authorized customer, no keyword scan or caller-selected target. */
export const customerStarStateInputSchema = z.object({
  customerId: positiveId,
  starMode: z.literal("assignee"),
  expectedEnterpriseId: positiveId,
  expectedActorUserId: positiveId,
}).strict();
export const customerStarStateSchema = customerStarMetadataSchema.extend({
  enterpriseId: positiveId,
  actorUserId: positiveId,
  customerId: positiveId,
  assignedUserId: positiveId.nullable(),
}).strict();
export type CustomerStarStateInput = z.infer<typeof customerStarStateInputSchema>;
export type CustomerStarState = z.infer<typeof customerStarStateSchema>;
export type CustomerStarContextInput = z.infer<typeof customerStarContextInputSchema>;
export type CustomerStarContext = z.infer<typeof customerStarContextSchema>;
export type CustomerSetStarInput = z.infer<typeof customerSetStarSchema>;
export type CustomerSetStarResult = z.infer<typeof customerSetStarResultSchema>;
export type CustomerStarMetadata = z.infer<typeof customerStarMetadataSchema>;
export type CustomerListItem = CustomerRecord & CustomerStarMetadata;
