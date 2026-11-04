import { z } from "zod";
import { isChannelInventoryBusinessMethodId } from "./channelInventoryBusinessPolicy";

export const officialInventoryPermissionsSchema = z.object({
  read: z.boolean(), write: z.boolean(), note: z.boolean(),
  /** Signed server-local CRM scope projection, NOT a native inventory grant. */
  customerScopeRead: z.boolean().optional(),
  authorizationVersion: z.string().min(8).max(160),
}).strict();
export type OfficialInventoryPermissions = z.infer<typeof officialInventoryPermissionsSchema>;
export const signedOfficialInventoryGrantSchema = z.object({
  schemaVersion: z.literal(1), issuedAt: z.number().int().safe(), expiresAt: z.number().int().safe(),
  permissions: officialInventoryPermissionsSchema,
  signature: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type SignedOfficialInventoryGrant = z.infer<typeof signedOfficialInventoryGrantSchema>;
/** Explicit native-read chains; linked customer methods also recheck native CRM access. */
export const NATIVE_TEAM_READ_METHODS: readonly string[] = [
  "channelInventory.customerSupplySummary", "channelInventory.customerSupplyContext",
  "channelInventory.listTeamMaterials", "channelInventory.listTeamSourceOptions", "channelInventory.getTeamMaterialSource",
  "channelInventory.collaborationNotesList", "channelInventory.collaborationNotesAdd", "channelInventory.collaborationNotesEdit",
];
export function officialInventoryMethodRequirement(method: string): "read" | "write" | "note" | null {
  if (!isChannelInventoryBusinessMethodId(method)) return null;
  if (["channelInventory.notesList", "channelInventory.notesAdd", "channelInventory.notesEdit",
    "channelInventory.collaborationNotesList", "channelInventory.collaborationNotesAdd", "channelInventory.collaborationNotesEdit"].includes(method)) return "note";
  if (["channelInventory.createChannel", "channelInventory.updateChannel", "channelInventory.setChannelActive", "channelInventory.getTeamMaterialForEdit",
    "channelInventory.createCustomerMaterial", "channelInventory.updateTeamMaterial", "channelInventory.createMaterial", "channelInventory.updateMaterial", "channelInventory.setMaterialShare"].includes(method)) return "write";
  return "read";
}
/** Stable canonical JSON is shared with the BFF signer (no browser fields participate). */
export function canonicalOfficialInventoryJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalOfficialInventoryJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalOfficialInventoryJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
