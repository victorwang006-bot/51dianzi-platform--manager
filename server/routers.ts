import { COOKIE_NAME } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import * as db from "./db";

// 管理员权限中间件：要求 role 为 admin
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "需要管理员权限" });
  }
  return next({ ctx });
});

const pageInput = z.object({
  page: z.number().min(1).default(1),
  pageSize: z.number().min(1).max(100).default(20),
});

const materialInput = z.object({
  partNumber: z.string().min(1, "型号不能为空"),
  name: z.string().min(1, "名称不能为空"),
  brand: z.string().optional(),
  category: z.string().optional(),
  package: z.string().optional(),
  description: z.string().optional(),
  referencePrice: z.string().optional(),
  unit: z.string().optional(),
  rohs: z.enum(["compliant", "non_compliant", "unknown"]).optional(),
  lifecycle: z.enum(["active", "nrnd", "eol", "obsolete"]).optional(),
  datasheetUrl: z.string().optional(),
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ─── 物料数据库 ──────────────────────────────────────────────────────────
  material: router({
    list: adminProcedure
      .input(pageInput.extend({
        search: z.string().optional(),
        category: z.string().optional(),
        brand: z.string().optional(),
        lifecycle: z.string().optional(),
        status: z.string().optional(),
      }))
      .query(async ({ input }) => {
        return db.getMaterials(input);
      }),
    detail: adminProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
      const material = await db.getMaterialById(input.id);
      if (!material) throw new TRPCError({ code: "NOT_FOUND", message: "物料不存在" });
      return material;
    }),
    categories: adminProcedure.query(async () => {
      return db.getMaterialCategories();
    }),
    brands: adminProcedure.query(async () => {
      return db.getMaterialBrands();
    }),
    create: adminProcedure.input(materialInput).mutation(async ({ input }) => {
      const material = await db.createMaterial(input);
      return { success: true, material };
    }),
    update: adminProcedure
      .input(materialInput.partial().extend({ id: z.number() }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        try {
          await db.updateMaterial(id, data);
        } catch (e) {
          if (e instanceof Error && e.message === "MATERIAL_NOT_FOUND") {
            throw new TRPCError({ code: "NOT_FOUND", message: "物料不存在" });
          }
          throw e;
        }
        return { success: true };
      }),
    toggleStatus: adminProcedure
      .input(z.object({ id: z.number(), status: z.enum(["enabled", "disabled"]) }))
      .mutation(async ({ input }) => {
        try {
          await db.updateMaterial(input.id, { status: input.status });
        } catch (e) {
          if (e instanceof Error && e.message === "MATERIAL_NOT_FOUND") {
            throw new TRPCError({ code: "NOT_FOUND", message: "物料不存在" });
          }
          throw e;
        }
        return { success: true };
      }),
    remove: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
      try {
        await db.deleteMaterial(input.id);
      } catch (e) {
        if (e instanceof Error && e.message === "MATERIAL_NOT_FOUND") {
          throw new TRPCError({ code: "NOT_FOUND", message: "物料不存在" });
        }
        throw e;
      }
      return { success: true };
    }),
  }),

  // ─── 商户管理 ────────────────────────────────────────────────────────────
  merchant: router({
    list: adminProcedure
      .input(pageInput.extend({ status: z.string().optional(), search: z.string().optional() }))
      .query(async ({ input }) => {
        return db.getMerchants(input);
      }),
    detail: adminProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
      return db.getMerchantById(input.id);
    }),
    review: adminProcedure
      .input(z.object({
        id: z.number(),
        action: z.enum(["approve", "reject", "supplement", "suspend", "terminate", "reactivate"]),
        note: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const statusMap: Record<string, string> = {
          approve: "approved",
          reject: "terminated",
          supplement: "supplement",
          suspend: "suspended",
          terminate: "terminated",
          reactivate: "approved",
        };
        await db.updateMerchantStatus(input.id, statusMap[input.action], input.note, ctx.user.id);
        return { success: true };
      }),
  }),

  // ─── 管理员管理 ──────────────────────────────────────────────────────────
  admin: router({
    list: adminProcedure.input(pageInput).query(async ({ input }) => {
      return db.getAdminUsers(input);
    }),
  }),
});

export type AppRouter = typeof appRouter;
