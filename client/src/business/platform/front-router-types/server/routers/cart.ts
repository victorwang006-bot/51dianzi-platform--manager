import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { hasSellingPrice } from "../../../shared/cartUtils";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";

export const cartRouter = router({
  /** 购物车列表（含库存快照信息） */
  list: protectedProcedure.query(async ({ ctx }) => {
    return db.getCartByUser(ctx.user.id);
  }),

  /** 角标：购物车商品种类数 */
  count: protectedProcedure.query(async ({ ctx }) => {
    return db.getCartCount(ctx.user.id);
  }),

  /** 加入购物车（重复加购合并数量）。buyNow=true 时只勾选该商品 */
  add: protectedProcedure
    .input(
      z.object({
        inventoryId: z.number().int().positive(),
        qty: z.number().int().positive(),
        buyNow: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [inv] = await db.getInventoriesByIds([input.inventoryId]);
      if (!inv || inv.status !== "published") {
        throw new TRPCError({ code: "NOT_FOUND", message: "商品不存在或已下架" });
      }
      if (!hasSellingPrice(inv.priceEx, inv.ladderPrices)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "该商品价格面议，请通过聊一聊与供应商沟通",
        });
      }
      if (inv.taxIncluded === false) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "该商品为未税价，请通过聊一聊确认含税价格、发票、运费及交货方式",
        });
      }
      if (inv.userId === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "不能购买自己发布的库存" });
      }
      const moq = inv.moq || 1;
      if (input.qty < moq) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `最少起订量为 ${moq}` });
      }
      const added = input.buyNow
        ? await db.buyNowToCart(
            ctx.user.id,
            input.inventoryId,
            input.qty,
            Number(inv.qtyOnSale ?? 0),
          )
        : await db.addToCart(
            ctx.user.id,
            input.inventoryId,
            input.qty,
            Number(inv.qtyOnSale ?? 0),
          );
      if (!added) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "加入后数量超过当前可售库存，请刷新后重试",
        });
      }
      return {
        count: await db.getCartCount(ctx.user.id),
        checkoutToken:
          input.buyNow && typeof added === "object" && added
            ? added.checkoutToken
            : null,
      };
    }),

  /** 固定购物车页本次结算条目，后续不再依赖全局 checked 状态。 */
  prepareCheckout: protectedProcedure
    .input(z.object({ cartItemIds: z.array(z.number().int().positive()).min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const prepared = await db.prepareCheckoutSession(ctx.user.id, input.cartItemIds);
      if (!prepared) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "商品信息已变化，请重新确认" });
      }
      return prepared;
    }),

  /** 结算页按服务端快照读取商品，避免页面展示与提交目标脱节。 */
  checkoutSession: protectedProcedure
    .input(z.object({ checkoutToken: z.string().min(16).max(64) }))
    .query(async ({ ctx, input }) => {
      return db.getCheckoutSessionCart(ctx.user.id, input.checkoutToken);
    }),

  /** 更新数量（校验 MOQ） */
  updateQty: protectedProcedure
    .input(z.object({ id: z.number().int(), qty: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const items = await db.getCartByUser(ctx.user.id);
      const item = items.find(i => i.id === input.id);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "购物车条目不存在" });
      const moq = item.moq || 1;
      const qty = Math.max(moq, input.qty);
      await db.updateCartItem(ctx.user.id, input.id, { qty });
      return { qty };
    }),

  /** 勾选/取消勾选 */
  setChecked: protectedProcedure
    .input(z.object({ id: z.number().int(), checked: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await db.updateCartItem(ctx.user.id, input.id, { checked: input.checked });
      return { ok: true };
    }),

  /** 全选/全不选 */
  setAllChecked: protectedProcedure
    .input(
      z.object({
        checked: z.boolean(),
        ids: z.array(z.number().int().positive()).max(100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.ids) {
        await db.setCartCheckedSelection(
          ctx.user.id,
          input.checked,
          Array.from(new Set(input.ids)),
        );
      } else {
        await db.setCartAllChecked(ctx.user.id, input.checked);
      }
      return { ok: true };
    }),

  /** 删除（支持批量） */
  remove: protectedProcedure
    .input(z.object({ ids: z.array(z.number().int()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      await db.removeCartItems(ctx.user.id, input.ids);
      return { count: await db.getCartCount(ctx.user.id) };
    }),
});
