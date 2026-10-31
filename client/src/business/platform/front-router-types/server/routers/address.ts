import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { findRegionPathByCode, formatRegionPath } from "../../../shared/regionDictionary";

export const addressInput = z.object({
  receiver: z.string().trim().min(1, "请输入收货人").max(64, "收货人最多64个字"),
  phone: z.string().regex(/^1\d{10}$/, "请输入有效的11位手机号"),
  region: z.string().trim().min(1, "请选择所在地区").max(255, "所在地区过长"),
  regionCode: z.string().regex(/^\d{6}$/, "请选择完整省市区").refine(code => Boolean(findRegionPathByCode(code)), "请选择有效的所在地区"),
  detail: z.string().trim().min(1, "请输入详细地址").max(255, "详细地址最多255个字"),
  label: z.string().trim().max(20, "地址标签最多20个字").refine(value => !/[\u0000-\u001f\u007f]/.test(value), "地址标签不能包含控制字符").nullable().optional()
    .transform(value => value === undefined ? undefined : value || null),
  isDefault: z.boolean().optional(),
});

export const addressRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => db.getAddressesByUser(ctx.user.id)),
  create: protectedProcedure.input(addressInput).mutation(async ({ ctx, input }) => {
    const existing = await db.getAddressesByUser(ctx.user.id);
    const path = findRegionPathByCode(input.regionCode)!;
    const id = await db.createAddress({
      userId: ctx.user.id,
      receiver: input.receiver,
      phone: input.phone,
      region: formatRegionPath(path),
      regionCode: path.district.code,
      detail: input.detail,
      label: input.label ?? null,
      isDefault: input.isDefault || existing.length === 0,
    });
    return { id };
  }),
  update: protectedProcedure.input(addressInput.extend({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const { id, label, ...patch } = input;
    const existing = await db.getAddressesByUser(ctx.user.id);
    if (!existing.some(a => a.id === id)) throw new TRPCError({ code: "NOT_FOUND", message: "地址不存在" });
    const path = findRegionPathByCode(input.regionCode)!;
    await db.updateAddress(ctx.user.id, id, {
      ...patch,
      region: formatRegionPath(path),
      regionCode: path.district.code,
      // Older website/mini-app clients must not erase labels they do not know about.
      ...(label !== undefined ? { label } : {}),
    });
    return { ok: true };
  }),
  remove: protectedProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ ctx, input }) => {
    await db.deleteAddress(ctx.user.id, input.id);return { ok: true };
  }),
  setDefault: protectedProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ ctx, input }) => {
    await db.updateAddress(ctx.user.id, input.id, { isDefault: true });return { ok: true };
  }),
});
