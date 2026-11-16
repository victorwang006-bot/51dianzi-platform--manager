import { z } from "zod";
export const MALL_INVENTORY_METHOD_IDS = ["mallInventory.status", "mallInventory.list", "mallInventory.link", "mallInventory.save", "mallInventory.publish", "mallInventory.offshelf", "mallInventory.requestStatus"] as const;
export function mallInventoryMethodRequirement(method: string): "read" | "write" | "publish" | null {
  if (!(MALL_INVENTORY_METHOD_IDS as readonly string[]).includes(method)) return null;
  if (method === "mallInventory.publish" || method === "mallInventory.offshelf") return "publish";
  if (method === "mallInventory.link" || method === "mallInventory.save") return "write";
  return "read";
}
export const mallInventoryRequestIdSchema = z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/);
export const mallInventoryMutationSchema = z.object({
  inventoryId: z.number().int().positive(),
  expectedVersion: z.number().int().min(0),
  expectedInventoryUpdatedAt: z.coerce.date(),
  expectedInventoryFingerprint: z.string().regex(/^[a-f0-9]{64}$/i),
  expectedOwnershipVersion: z.number().int().positive(),
  expectedPermissionVersion: z.number().int().positive(),
  expectedAuthorizationVersion: z.string().min(8).max(160),
  expectedBusinessAuthorizationVersion: z.string().min(8).max(160),
  requestId: mallInventoryRequestIdSchema,
});
export const mallInventoryListSchema = z.object({
  partNumber: z.string().trim().max(128).optional(), brand: z.string().trim().max(64).optional(),
  status: z.enum(["draft", "published", "offshelf"]).optional(),
  visibility: z.enum(["linked", "unlinked", "all"]).default("linked"),
  inventoryId: z.number().int().positive().optional(),
  page: z.number().int().min(1).default(1), pageSize: z.number().int().min(1).max(100).default(50),
});
