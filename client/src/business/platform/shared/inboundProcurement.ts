import { z } from "zod";

/** API identity is numeric; UI draft strings must be normalized before submit. */
export const inboundBuyerUserIdSchema = z.number().int().positive().safe();
export type InboundProcurementBuyerOption = { userId: number; name: string; username?: string };
export type InboundProcurementBuyers = {
  actorUserId: number;
  canChooseBuyer: boolean;
  teamId: number | null;
  options: InboundProcurementBuyerOption[];
  scope: "self" | "team" | "enterprise";
};
export function normalizeInboundBuyerDraft(value: string | number | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed = typeof value === "number" ? value : /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;
  return inboundBuyerUserIdSchema.parse(parsed);
}
