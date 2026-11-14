import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { ChannelReferenceLookupResult } from "../shared/channelReference";
import type { TrpcContext } from "./_core/context";
import { publicProcedure, router } from "./_core/trpc";
import { channelInventoryListBusinessInputSchema } from "./channelInventoryListBusinessInput";
import { lookupChannelReferences } from "./channelReference/service";

export const channelReferenceMaterialIdsSchema = z.array(z.number().int().safe().positive())
  .min(1).max(20).refine(ids => new Set(ids).size === ids.length, "库存行 ID 不可重复");
export const channelReferenceLookupInputSchema = z.object({
  listInput: channelInventoryListBusinessInputSchema,
  materialIds: channelReferenceMaterialIdsSchema,
  refresh: z.boolean().optional(),
}).strict();

export type ApprovedChannelReferenceMaterial = { materialId: number; partNumber: string; brand: string };
export type ReadApprovedChannelReferenceMaterials = (
  ctx: TrpcContext,
  listInput: z.output<typeof channelInventoryListBusinessInputSchema>,
  materialIds: number[],
) => Promise<ApprovedChannelReferenceMaterial[]>;

/** A local BFF namespace, not a new upstream capability or mirrored front method. */
export function createChannelReferenceRouter(readApprovedMaterials: ReadApprovedChannelReferenceMaterials) {
  return router({
    lookup: publicProcedure.input(channelReferenceLookupInputSchema).query(async ({ ctx, input }): Promise<ChannelReferenceLookupResult> => {
      // Every poll/refresh/cache hit first re-reads the original current page with
      // current authorization. The callback releases ALL native/fence locks
      // before public webpage/cache work starts; no client material DTO is used.
      const materials = await readApprovedMaterials(ctx, input.listInput, input.materialIds);
      try {
        return await lookupChannelReferences(materials, { refresh: input.refresh });
      } catch {
        // Do not disguise an authorization failure as a webpage status, nor turn
        // a failed reference service into a fabricated zero/empty success.
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "渠道参考查询暂时不可用，请稍后重试" });
      }
    }),
  });
}
