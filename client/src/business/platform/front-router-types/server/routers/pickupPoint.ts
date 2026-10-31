import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";

const pickupPointInput = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1, "请填写自提点名称").max(128),
  address: z.string().trim().min(5, "请填写完整地址").max(400),
  contactName: z.string().trim().min(1, "请填写联系人").max(64),
  contactPhone: z
    .string()
    .trim()
    .min(6, "请填写联系电话")
    .max(20)
    .regex(/^[0-9+()\-\s]+$/, "联系电话格式不正确"),
  businessHours: z.string().trim().max(128).optional(),
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(999).default(0),
});

export const pickupPointRouter = router({
  mine: protectedProcedure.query(({ ctx }) =>
    db.listSellerPickupPoints(ctx.user.id)
  ),

  forCart: protectedProcedure.query(async ({ ctx }) => {
    const checkedRows = (await db.getCartByUser(ctx.user.id)).filter(
      row => row.checked
    );
    const sellers = new Map<number, string>();
    for (const row of checkedRows) {
      if (row.sellerId) sellers.set(row.sellerId, row.sellerName || "卖家");
    }
    const points = await db.listEnabledPickupPointsForSellers(
      Array.from(sellers.keys())
    );
    return Array.from(sellers, ([sellerId, sellerName]) => ({
      sellerId,
      sellerName,
      pickupPoints: points.filter(point => point.sellerId === sellerId),
    }));
  }),

  save: protectedProcedure
    .input(pickupPointInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const saved = await db.saveSellerPickupPoint(ctx.user.id, input);
        if (!saved)
          throw new TRPCError({ code: "NOT_FOUND", message: "自提点不存在" });
        return { ok: true, id: typeof saved === "number" ? saved : input.id };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "自提点保存失败",
        });
      }
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const removed = await db.deleteSellerPickupPoint(ctx.user.id, input.id);
      if (!removed)
        throw new TRPCError({ code: "NOT_FOUND", message: "自提点不存在" });
      return { ok: true };
    }),
});
