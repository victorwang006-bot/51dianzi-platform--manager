import { COOKIE_NAME } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import * as db from "./db";
import { storagePut } from "./storage";

// 允许的上传类型与大小限制
const MAX_PDF_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const IMAGE_MIME_MAP: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

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
  specs: z.record(z.string(), z.string()).optional(),
  referencePrice: z.string().optional(),
  unit: z.string().optional(),
  rohs: z.enum(["compliant", "non_compliant", "unknown"]).optional(),
  lifecycle: z.enum(["active", "nrnd", "eol", "obsolete"]).optional(),
  datasheetUrl: z.string().optional(),
  datasheetFileKey: z.string().optional().nullable(),
  datasheetFileName: z.string().optional().nullable(),
  datasheetFileSize: z.number().optional().nullable(),
  coverImageUrl: z.string().optional().nullable(),
  images: z.array(z.object({
    url: z.string(),
    key: z.string(),
    name: z.string().optional(),
  })).optional().nullable(),
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
    // ── 公开 API（前台调用，无需登录）──────────────────────────────────────
    /** 型号模糊搜索：前台商户上传商品时输入型号触发，返回匹配的候选列表 */
    lookup: publicProcedure
      .input(z.object({ keyword: z.string().min(1).max(64) }))
      .query(async ({ input }) => {
        return db.lookupMaterials(input.keyword);
      }),
    /** 获取指定型号的完整参数：前台搜索结果页展示参数时调用 */
    getSpecs: publicProcedure
      .input(z.object({ partNumber: z.string().min(1).max(128) }))
      .query(async ({ input }) => {
        return db.getMaterialSpecsByPartNumber(input.partNumber);
      }),
    /** 前台综合搜索：关键词 + 分类/品牌 + 参数筛选，返回参数、图片、PDF 规格书 URL */
    search: publicProcedure
      .input(z.object({
        keyword: z.string().max(128).optional(),
        category: z.string().max(64).optional(),
        brand: z.string().max(128).optional(),
        specFilters: z.record(z.string(), z.string()).optional(),
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(50).default(20),
      }))
      .query(async ({ input }) => {
        return db.searchMaterialsPublic(input);
      }),
    // ── 后台管理 API（需要管理员权限）──────────────────────────────────────
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
    /** 上传 PDF 规格书：base64 → S3，返回 key/url/文件名/大小（不直接写库，由 create/update 保存） */
    uploadDatasheet: adminProcedure
      .input(z.object({
        fileName: z.string().min(1).max(256),
        /** base64 编码的文件内容（不含 data: 前缀） */
        base64: z.string().min(1),
      }))
      .mutation(async ({ input }) => {
        if (!input.fileName.toLowerCase().endsWith(".pdf")) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "仅支持 PDF 文件" });
        }
        const buffer = Buffer.from(input.base64, "base64");
        if (buffer.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "文件内容为空" });
        if (buffer.length > MAX_PDF_SIZE) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "PDF 文件不能超过 20MB" });
        }
        // %PDF- 魔数校验，防止伪装文件
        if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "文件不是有效的 PDF" });
        }
        const safeName = input.fileName.replace(/[^\w.\-\u4e00-\u9fa5]/g, "_");
        const fileKey = `datasheets/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
        const { key, url } = await storagePut(fileKey, buffer, "application/pdf");
        return { key, url, fileName: input.fileName, fileSize: buffer.length };
      }),
    /** 上传产品图片：base64 → S3，返回 key/url（不直接写库，由 create/update 保存） */
    uploadImage: adminProcedure
      .input(z.object({
        fileName: z.string().min(1).max(256),
        mimeType: z.string(),
        /** base64 编码的文件内容（不含 data: 前缀） */
        base64: z.string().min(1),
      }))
      .mutation(async ({ input }) => {
        const ext = IMAGE_MIME_MAP[input.mimeType];
        if (!ext) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "仅支持 PNG/JPG/WebP/GIF 图片" });
        }
        const buffer = Buffer.from(input.base64, "base64");
        if (buffer.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "文件内容为空" });
        if (buffer.length > MAX_IMAGE_SIZE) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "图片不能超过 5MB" });
        }
        const fileKey = `material-images/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { key, url } = await storagePut(fileKey, buffer, input.mimeType);
        return { key, url, fileName: input.fileName };
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

  adminUser: router({
    list: adminProcedure.input(pageInput).query(async ({ input }) => {
      return db.getAdminUsers(input);
    }),
    create: adminProcedure.input(z.object({
      username: z.string().min(2).max(64),
      displayName: z.string().max(128).optional().nullable(),
      email: z.string().email().optional().nullable(),
      phone: z.string().max(20).optional().nullable(),
      adminRole: z.enum(["super_admin", "operation", "merchant_mgr", "customer_svc", "risk_control", "finance", "auditor"]),
    })).mutation(async ({ input }) => {
      return db.createAdminUser(input);
    }),
    update: adminProcedure.input(z.object({
      id: z.number(),
      displayName: z.string().max(128).optional().nullable(),
      email: z.string().email().optional().nullable(),
      phone: z.string().max(20).optional().nullable(),
      adminRole: z.enum(["super_admin", "operation", "merchant_mgr", "customer_svc", "risk_control", "finance", "auditor"]).optional(),
      status: z.enum(["active", "disabled", "locked"]).optional(),
    })).mutation(async ({ input }) => {
      const { id, ...rest } = input;
      return db.updateAdminUser(id, rest);
    }),
    toggleStatus: adminProcedure.input(z.object({
      id: z.number(),
      status: z.enum(["active", "disabled"]),
    })).mutation(async ({ input }) => {
      return db.toggleAdminUserStatus(input.id, input.status);
    }),
    remove: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
      return db.deleteAdminUser(input.id);
    }),
  }),
});

export type AppRouter = typeof appRouter;
