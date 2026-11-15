import { z } from "zod";
import { officialInventoryPermissionsSchema as readPermissionsSchema } from "../client/src/business/platform/shared/internalBusinessOfficialInventory";
export { canonicalOfficialInventoryJson, officialInventoryMethodRequirement, NATIVE_TEAM_READ_METHODS, NATIVE_FACTORY_PUBLISH_METHODS } from "../client/src/business/platform/shared/internalBusinessOfficialInventory";

/** Independent write proof, never inferred from channelProfileTeamRead, names or roles.
 * Both identity namespaces are paired, not two independently reorderable ID lists. */
export const channelMaterialManagementSchema = z.object({
  leaderAdminAccountId: z.number().int().safe().positive(),
  recorderBindings: z.array(z.object({
    adminAccountId: z.number().int().safe().positive(),
    staffUserId: z.number().int().safe().positive(),
  }).strict()).min(1).max(500),
}).strict().refine(proof =>
  new Set(proof.recorderBindings.map(row => row.adminAccountId)).size === proof.recorderBindings.length
  && new Set(proof.recorderBindings.map(row => row.staffUserId)).size === proof.recorderBindings.length
  && proof.recorderBindings.some(row => row.adminAccountId === proof.leaderAdminAccountId));
export const officialInventoryPermissionsSchema = readPermissionsSchema.extend({
  /** Explicit merchant stock-write intersection; absent on old grants means false. */
  inventoryScopeWrite: z.boolean().optional(),
  channelMaterialManagement: channelMaterialManagementSchema.optional(),
  /** Actor-only capability, ERP must recheck actual leadership and recorder team. */
  materialBusinessTeamLeaderWrite: z.object({ adminAccountId: z.number().int().safe().positive(), staffUserId: z.number().int().safe().positive() }).strict().optional(),
}).strict();
export type OfficialInventoryPermissions = z.infer<typeof officialInventoryPermissionsSchema>;
export const signedOfficialInventoryGrantSchema = z.object({
  schemaVersion: z.literal(1), issuedAt: z.number().int().safe(), expiresAt: z.number().int().safe(),
  permissions: officialInventoryPermissionsSchema,
  signature: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type SignedOfficialInventoryGrant = z.infer<typeof signedOfficialInventoryGrantSchema>;
