import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getDb } from "../db";
import { factoryInventoryReception, factoryPublicIdSchema } from "../services/factoryInventoryReception";
import { publicProcedure, router } from "../_core/trpc";
import {
  FACTORY_CHANNEL_SORTS,
  listFactoryChannelPublic,
} from "../services/factoryChannelPublic";

const normalizedText = z
  .string()
  .transform(value => value.normalize("NFKC").trim())
  .pipe(z.string().max(128, "筛选内容不能超过 128 个字符"));

/** Public factory-channel list input; unknown keys are always rejected. */
export const factoryChannelListInputSchema = z
  .object({
    query: normalizedText.optional(),
    brand: normalizedText.optional(),
    pricedOnly: z.boolean().default(false),
    sort: z.enum(FACTORY_CHANNEL_SORTS).default("recent"),
    limit: z.number().int().safe().min(1).max(50).default(20),
    offset: z.number().int().safe().min(0).max(10_000).default(0),
  })
  .strict();

/**
 * Parent integration registers this router at root key `factoryChannel`.
 * It is intentionally query-only: a factory-channel listing can never create
 * an inquiry, order, manager request, or any inventory mutation.
 */
export const factoryChannelRouter = router({
  receptionStatus: publicProcedure
    .input(z.object({ publicId: factoryPublicIdSchema }).strict())
    .query(async ({ ctx, input }) => {
      ctx.res.setHeader("Cache-Control", "no-store");
      const db = await getDb();
      if (!db) return { ready: false, message: "工厂库存接待服务暂不可用" };
      return factoryInventoryReception.status(db, input.publicId);
    }),
  list: publicProcedure
    .input(factoryChannelListInputSchema)
    .query(async ({ input, ctx }) => {
      ctx.res.setHeader("Cache-Control", "no-store");
      try {
        return await listFactoryChannelPublic(input);
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error(
          "[factoryChannel.list] official projection read failed",
          error
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "工厂渠道暂不可用，请稍后重试",
        });
      }
    }),
});
