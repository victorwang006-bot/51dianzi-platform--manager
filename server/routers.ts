import { COOKIE_NAME } from "@shared/const";
import {
  hasAdminPermission,
  type AdminPermission,
  type AdminRole,
} from "@shared/adminPermissions";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  getResetChannels,
  hashPassword,
  loginWithPassword,
  recoverUsernameWithCode,
  requestPasswordReset,
  requestUsernameRecovery,
  resetPasswordWithCode,
  verifyPassword,
} from "./adminAuth";
import type { TrpcContext } from "./_core/context";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import * as db from "./db";
import { storagePut } from "./storage";
import { saveLocalFile } from "./localUpload";
import {
  getPlatformOrderDetail,
  getPlatformOrderStats,
  listPlatformOrders,
} from "./platformOrderApi";
import { getPlatformUserStats, listPlatformUsers } from "./platformUserApi";
import { validatePlatformCrmRebindTarget } from "./platformCrmApi";
// 允许的上传类型与大小限制
const MAX_PDF_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const IMAGE_MIME_MAP: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** 图片魔数校验：核对文件头是否与声明的 mimeType 匹配，拒绝伪装图片的垃圾数据 */
function isValidImageBuffer(buffer: Buffer, mimeType: string): boolean {
  if (buffer.length < 12) return false;
  switch (mimeType) {
    case "image/png":
      return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case "image/jpeg":
      return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    case "image/webp":
      return buffer.subarray(0, 4).toString("latin1") === "RIFF" && buffer.subarray(8, 12).toString("latin1") === "WEBP";
    case "image/gif": {
      const head = buffer.subarray(0, 6).toString("latin1");
      return head === "GIF87a" || head === "GIF89a";
    }
    default:
      return false;
  }
}

// 管理员权限中间件：要求 role 为 admin
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "需要管理员权限" });
  }
  return next({ ctx });
});

/** 本地账号按 adminRole 校验；Manus OAuth 管理员兼容为 super_admin。 */
const adminPermissionProcedure = (permission: AdminPermission) =>
  adminProcedure.use(({ ctx, next }) => {
    const role: AdminRole = ctx.adminAccount?.adminRole ?? "super_admin";
    if (!hasAdminPermission(role, permission)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "当前角色无权执行此操作" });
    }
    return next({ ctx });
  });

const materialReadProcedure = adminPermissionProcedure("materials.read");
const materialWriteProcedure = adminPermissionProcedure("materials.write");
const merchantReadProcedure = adminPermissionProcedure("merchants.read");
const merchantWriteProcedure = adminPermissionProcedure("merchants.write");
const messageReadProcedure = adminPermissionProcedure("messages.read");
const messageWriteProcedure = adminPermissionProcedure("messages.write");
const orderReadProcedure = adminPermissionProcedure("orders.read");
const adminManageProcedure = adminPermissionProcedure("admins.manage");
const crmRebindProcedure = adminProcedure.use(({ ctx, next }) => {
  const role: AdminRole = ctx.adminAccount?.adminRole ?? "super_admin";
  if (role !== "super_admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "只有超级管理员可以执行 ERP 超级管理员换绑" });
  }
  return next({ ctx });
});

function auditActorFromContext(ctx: TrpcContext) {
  const forwarded = ctx.req.headers["x-forwarded-for"];
  const forwardedIp = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0]?.trim();
  return {
    operatorId: ctx.user?.id ?? null,
    operatorName: ctx.user?.name ?? ctx.adminAccount?.username ?? "system",
    operatorRole: ctx.adminAccount?.adminRole ?? "super_admin",
    ipAddress: forwardedIp || ctx.req.ip || null,
    userAgent: ctx.req.headers["user-agent"] ?? null,
  };
}

// 前台对接鉴权：请求头 x-portal-key 必须与 PORTAL_API_KEY 一致
function assertPortalKey(req: { headers: Record<string, unknown> }) {
  const expected = process.env.PORTAL_API_KEY;
  if (!expected) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "PORTAL_API_KEY 未配置，前台对接接口不可用" });
  }
  const provided = req.headers["x-portal-key"];
  if (typeof provided !== "string" || provided !== expected) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "无效的对接密钥" });
  }
}

/**
 * 解析前台提交的销售负责人，输出待写入商户的 salesOwner / salesOwnerCode。
 *
 * 三种语义：
 *   - 两者均 undefined → 返回 {}，不改动现有归属（如前台本次未提交该字段）
 *   - staffCode 为 null/空串 → 显式清空归属
 *   - 否则必须命中后台启用名单，未命中直接报错
 *
 * 不允许将未校验的自由文本写入商户资料，否则后台拿到的姓名可能对不上任何真实销售。
 */
async function resolvePortalSalesOwner(
  staffCode?: string | null,
  legacyName?: string | null,
): Promise<{ salesOwner?: string | null; salesOwnerCode?: string | null }> {
  if (staffCode === undefined && legacyName === undefined) return {};
  if (staffCode === null || staffCode === "") {
    return { salesOwner: null, salesOwnerCode: null };
  }

  let staff = staffCode ? await db.getSalesStaffByCode(staffCode) : null;
  // 旧客户端兼容：仅传了姓名时按展示名不区分大小写匹配
  if (!staff && legacyName) {
    const target = legacyName.trim().toLowerCase();
    if (target) {
      const all = await db.listSalesStaff({ activeOnly: false });
      staff = all.find(item => item.displayName.trim().toLowerCase() === target) ?? null;
    }
  }
  if (!staff || staff.status !== "active") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "请选择有效的销售负责人" });
  }
  return { salesOwner: staff.displayName, salesOwnerCode: staff.staffCode };
}

/**
 * 取当前会话的销售可见范围。
 *
 * ⚠️ 返回 undefined 表示「不限制」（超级管理员），返回空数组表示「什么都看不到」。
 * 调用方必须将本函数结果原样传给 db 层，不得用 `?? []` 或 `|| undefined` 改写，
 * 否则会把两种截然相反的语义折叠成同一种，造成越权或误屏蔽。
 */
async function getAdminSalesStaffCodes(ctx: TrpcContext): Promise<string[] | undefined> {
  const account = ctx.adminAccount;
  // 非账号密码会话（Manus OAuth）按超级管理员兼容处理
  if (!account) return undefined;
  if (account.adminRole === "super_admin") return undefined;
  return db.getAdminUserSalesScopeCodes(account.id);
}

/**
 * 将 db 层销售范围相关错误映射为可读的 tRPC 错误。
 * 非目标错误原样抛出，避免屏蔽真正的故障。
 */
function mapSalesScopeError(error: unknown): unknown {
  const message = error instanceof Error ? error.message : "";
  if (message === "INVALID_SALES_STAFF_CODE") {
    return new TRPCError({ code: "BAD_REQUEST", message: "销售权限包含无效或已停用员工" });
  }
  if (message === "SALES_SCOPE_REQUIRED") {
    return new TRPCError({ code: "BAD_REQUEST", message: "请至少为该账号分配一个销售范围" });
  }
  return error;
}

const pageInput = z.object({
  page: z.number().min(1).default(1),
  pageSize: z.number().min(1).max(100).default(20),
});

function getMaterialAuditActor(ctx: TrpcContext): db.MaterialAuditActor {
  const forwardedFor = ctx.req.headers["x-forwarded-for"];
  const userAgent = ctx.req.headers["user-agent"];
  return {
    operatorId: ctx.adminAccount?.id ?? ctx.user?.id ?? null,
    operatorName: ctx.adminAccount?.username ?? ctx.user?.name ?? "admin",
    operatorRole: ctx.adminAccount?.adminRole ?? "super_admin",
    ipAddress:
      (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor?.split(",")[0]?.trim())
      ?? ctx.req.ip
      ?? ctx.req.socket?.remoteAddress
      ?? null,
    userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent ?? null,
  };
}

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
    me: publicProcedure.query(opts => {
      if (!opts.ctx.user) return null;
      // 附带账号密码登录会话的后台角色（Manus OAuth 会话则为 super_admin 兼容显示）
      return {
        ...opts.ctx.user,
        adminRole: opts.ctx.adminAccount?.adminRole ?? ("super_admin" as const),
        username: opts.ctx.adminAccount?.username ?? null,
      };
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    /** 账号密码登录（admin_users 表账号） */
    login: publicProcedure
      .input(z.object({
        username: z.string().min(1, "请输入用户名").max(64),
        password: z.string().min(1, "请输入密码").max(128),
      }))
      .mutation(async ({ ctx, input }) => {
        const account = await loginWithPassword(ctx.req, ctx.res, input.username, input.password);
        return { success: true, account } as const;
      }),
    /** 读取当前登录账号的个人信息（个人信息页使用） */
    profile: adminProcedure.query(async ({ ctx }) => {
      const account = ctx.adminAccount;
      if (!account) {
        throw new TRPCError({ code: "FORBIDDEN", message: "当前会话不支持编辑个人信息" });
      }
      return {
        username: account.username,
        displayName: account.displayName ?? "",
        phone: account.phone ?? "",
        email: account.email ?? "",
        adminRole: account.adminRole === "super_admin" ? ("super_admin" as const) : ("merchant_mgr" as const),
      };
    }),
    /** 本人修改显示名称、手机号和邮箱；直接更新后台用户管理使用的同一记录。 */
    updateProfile: adminProcedure
      .input(z.object({
        displayName: z.string().trim().min(1, "请输入用户名称").max(128),
        phone: z.string().trim().max(32).refine(
          value => value === "" || /^\+?\d{7,20}$/.test(value),
          "请输入有效手机号",
        ),
        email: z.string().trim().max(255).refine(
          value => value === "" || z.string().email().safeParse(value).success,
          "请输入有效邮箱",
        ),
      }))
      .mutation(async ({ ctx, input }) => {
        const account = ctx.adminAccount;
        if (!account) {
          throw new TRPCError({ code: "FORBIDDEN", message: "当前会话不支持编辑个人信息" });
        }
        await db.updateAdminUser(account.id, {
          displayName: input.displayName,
          // 空串视为「清空绑定」，存 null 而非空字符串，避免找回密码时匹配到空值
          phone: input.phone || null,
          email: input.email ? input.email.toLowerCase() : null,
        });
        const updated = await db.getAdminUserById(account.id);
        if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "后台用户不存在" });
        return {
          username: updated.username,
          displayName: updated.displayName ?? "",
          phone: updated.phone ?? "",
          email: updated.email ?? "",
          adminRole: updated.adminRole === "super_admin" ? ("super_admin" as const) : ("merchant_mgr" as const),
        };
      }),
    /** 当前登录账号修改自己的密码（仅账号密码登录会话可用） */
    changePassword: protectedProcedure
      .input(z.object({
        oldPassword: z.string().min(1),
        newPassword: z.string().min(8, "新密码至少 8 位").max(128),
      }))
      .mutation(async ({ ctx, input }) => {
        const account = ctx.adminAccount;
        if (!account || !account.passwordHash) {
          throw new TRPCError({ code: "FORBIDDEN", message: "当前会话不支持修改密码" });
        }
        const ok = await verifyPassword(input.oldPassword, account.passwordHash);
        if (!ok) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "原密码错误" });
        }
        // 新旧相同必须显式拒绝：否则用户以为已改密，实际密码未变，
        // 若其正因怀疑泄露而改密，会错认为风险已解除。
        if (input.oldPassword === input.newPassword) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "新密码不能与当前密码相同" });
        }
        await db.setAdminUserPassword(account.id, await hashPassword(input.newPassword));
        return { success: true } as const;
      }),
    /** 找回密码：查询账号可用的验证渠道（脱敏手机号/邮箱） */
    resetChannels: publicProcedure
      .input(z.object({ username: z.string().min(1).max(64) }))
      .query(async ({ input }) => {
        return getResetChannels(input.username);
      }),
    /** 找回密码：发送验证码到绑定的手机/邮箱 */
    requestReset: publicProcedure
      .input(z.object({
        username: z.string().min(1).max(64),
        channel: z.enum(["sms", "email"]),
      }))
      .mutation(async ({ input }) => {
        return requestPasswordReset(input.username, input.channel);
      }),
    /** 找回密码：校验验证码并设置新密码 */
    resetPassword: publicProcedure
      .input(z.object({
        username: z.string().min(1).max(64),
        code: z.string().length(6, "请输入 6 位验证码"),
        newPassword: z.string().min(8, "新密码至少 8 位").max(128),
      }))
      .mutation(async ({ input }) => {
        return resetPasswordWithCode(input.username, input.code, input.newPassword);
      }),
    /** 找回用户名：向绑定的手机号/邮箱发送验证码 */
    requestUsernameRecovery: publicProcedure
      .input(z.object({
        channel: z.enum(["sms", "email"]),
        target: z.string().min(4).max(320),
      }))
      .mutation(async ({ input }) => {
        return requestUsernameRecovery(input.channel, input.target);
      }),
    /** 找回用户名：校验验证码并返回绑定的用户名 */
    recoverUsername: publicProcedure
      .input(z.object({
        channel: z.enum(["sms", "email"]),
        target: z.string().min(4).max(320),
        code: z.string().length(6, "请输入 6 位验证码"),
      }))
      .mutation(async ({ input }) => {
        return recoverUsernameWithCode(input.channel, input.target, input.code);
      }),
  }),

  // ─── 前台注册用户（主站用户表为唯一事实源，后台仅做代理）──────────────────
  frontendUser: router({
    stats: messageReadProcedure.query(async () => {
      const [platformStats, erpUserIds] = await Promise.all([
        getPlatformUserStats(),
        db.getEnabledErpPortalUserIds(),
      ]);
      const erpUsers = erpUserIds.length;
      return {
        ...platformStats,
        erpUsers,
        ordinaryUsers: Math.max(platformStats.totalUsers - erpUsers, 0),
      };
    }),
    list: messageReadProcedure
      .input(pageInput.extend({ keyword: z.string().trim().max(100).optional() }))
      .query(async ({ input }) => {
        const [result, erpUserIds] = await Promise.all([
          listPlatformUsers(input),
          db.getEnabledErpPortalUserIds(),
        ]);
        const erpSet = new Set(erpUserIds);
        return {
          ...result,
          rows: result.rows.map(user => ({
            ...user,
            userType: erpSet.has(String(user.id)) ? "erp" as const : "ordinary" as const,
          })),
        };
      }),
  }),

  // ─── 商城真实订单（后台仅做代理，不读取/写入本地 SO 订单表）──────────────
  order: router({
    /*
     * 三个接口均需传入 getAdminSalesStaffCodes(ctx)。
     *
     * 改动前它们未传任何范围，而商户管理已做隔离，形成越权：
     * 任何能进订单页的后台账号都能看到全平台订单
     * （含他人客户的采购明细、收货人与手机号）。
     * 详情同样必须传，否则遍历 orderId 即可绕过列表过滤。
     * 返回值三态语义请见 getAdminSalesStaffCodes 注释，切勿折叠。
     */
    stats: orderReadProcedure.query(async ({ ctx }) =>
      getPlatformOrderStats(await getAdminSalesStaffCodes(ctx))),
    list: orderReadProcedure
      .input(pageInput.extend({
        keyword: z.string().trim().max(100).optional(),
        /* 必须与前台 ORDER_STATUSES 全集一致：漏值会让该状态无法被筛选 */
        status: z.enum(["pending", "paid", "shipped", "done", "refund", "cancel", "refunded"]).optional(),
        buyerId: z.number().int().positive().optional(),
        sellerId: z.number().int().positive().optional(),
        createdFrom: z.number().int().nonnegative().optional(),
        createdTo: z.number().int().nonnegative().optional(),
      }))
      .query(async ({ ctx, input }) =>
        listPlatformOrders(input, await getAdminSalesStaffCodes(ctx))),
    detail: orderReadProcedure
      .input(z.object({ orderId: z.number().int().positive() }))
      .query(async ({ ctx, input }) =>
        getPlatformOrderDetail(input.orderId, await getAdminSalesStaffCodes(ctx))),
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
    list: materialReadProcedure
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
    detail: materialReadProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
      const material = await db.getMaterialById(input.id);
      if (!material) throw new TRPCError({ code: "NOT_FOUND", message: "物料不存在" });
      return material;
    }),
    categories: materialReadProcedure.query(async () => {
      return db.getMaterialCategories();
    }),
    brands: materialReadProcedure.query(async () => {
      return db.getMaterialBrands();
    }),
    create: materialWriteProcedure.input(materialInput).mutation(async ({ ctx, input }) => {
      const material = await db.createMaterial(input, getMaterialAuditActor(ctx));
      return { success: true, material };
    }),
    update: materialWriteProcedure
      .input(materialInput.partial().extend({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        try {
          await db.updateMaterial(id, data, {
            ...getMaterialAuditActor(ctx),
            action: "material.update",
            note: "物料业务属性更新；平台物料码保持不变",
          });
        } catch (e) {
          if (e instanceof Error && e.message === "MATERIAL_NOT_FOUND") {
            throw new TRPCError({ code: "NOT_FOUND", message: "物料不存在" });
          }
          throw e;
        }
        return { success: true };
      }),
    toggleStatus: materialWriteProcedure
      .input(z.object({ id: z.number(), status: z.enum(["enabled", "disabled"]) }))
      .mutation(async ({ ctx, input }) => {
        try {
          await db.updateMaterial(input.id, { status: input.status }, {
            ...getMaterialAuditActor(ctx),
            action: input.status === "disabled" ? "material.disable" : "material.enable",
            note: input.status === "disabled"
              ? "物料已停用；平台物料码永久保留"
              : "物料已重新启用；沿用原平台物料码",
          });
        } catch (e) {
          if (e instanceof Error && e.message === "MATERIAL_NOT_FOUND") {
            throw new TRPCError({ code: "NOT_FOUND", message: "物料不存在" });
          }
          throw e;
        }
        return { success: true };
      }),
    /** 向后兼容旧客户端的 remove 调用，但只执行软归档，绝不物理删除主档。 */
    remove: materialWriteProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
      try {
        await db.archiveMaterial(input.id, getMaterialAuditActor(ctx));
      } catch (e) {
        if (e instanceof Error && e.message === "MATERIAL_NOT_FOUND") {
          throw new TRPCError({ code: "NOT_FOUND", message: "物料不存在" });
        }
        throw e;
      }
      return { success: true, archived: true };
    }),
    /** 上传 PDF 规格书：base64 → S3，返回 key/url/文件名/大小（不直接写库，由 create/update 保存） */
    uploadDatasheet: materialWriteProcedure
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
    uploadImage: materialWriteProcedure
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
    list: merchantReadProcedure
      .input(pageInput.extend({ status: z.string().optional(), search: z.string().optional() }))
      .query(async ({ ctx, input }) => {
        // 非超级管理员仅可见自己销售范围内的商户（三态语义，勿改写）
        return db.getMerchants(input, await getAdminSalesStaffCodes(ctx));
      }),
    detail: merchantReadProcedure.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
      return db.getMerchantById(input.id, await getAdminSalesStaffCodes(ctx));
    }),
    review: merchantWriteProcedure
      .input(z.object({
        id: z.number(),
        action: z.enum(["approve", "supplement", "suspend", "reactivate"]),
        note: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const statusMap: Record<string, string> = {
          approve: "approved",
          supplement: "supplement",
          suspend: "suspended",
          reactivate: "approved",
        };
        await db.updateMerchantStatus(input.id, statusMap[input.action], input.note, ctx.user.id);
        return { success: true };
      }),
    /** 设置商户 ERP 开通状态（enabled=通过 rejected=拒绝 disabled=暂停） */
    setCrmStatus: merchantWriteProcedure
      .input(z.object({
        id: z.number(),
        crmStatus: z.enum(["none", "pending", "enabled", "disabled", "rejected"]),
        portalUserId: z.string().trim().min(1, "前台用户 ID 不能为空").max(64).optional().nullable(),
        note: z.string().max(1000).optional().nullable(),
      }))
      .mutation(async ({ ctx, input }) => {
        return db.setMerchantCrmStatus({
          merchantId: input.id,
          crmStatus: input.crmStatus,
          portalUserId: input.portalUserId,
          note: input.note,
          actor: auditActorFromContext(ctx),
        });
      }),
    /** 专用换绑：只变更 ERP 超级管理员绑定，不改变企业、ERP 状态或既有业务数据。 */
    rebindCrmOwner: crmRebindProcedure
      .input(z.object({
        id: z.number().int().positive(),
        expectedPortalUserId: z.string().trim().min(1, "当前超级管理员用户 ID 不能为空").max(64),
        newPortalUserId: z.string().trim().min(1, "新超级管理员用户 ID 不能为空").max(64),
        reason: z.string().trim().min(2, "换绑原因至少需要 2 个字符").max(1000),
        requestId: z.string().trim().min(8, "换绑请求号无效").max(128),
      }))
      .mutation(async ({ ctx, input }) => {
        const merchant = await db.getMerchantById(input.id);
        if (!merchant) {
          throw new TRPCError({ code: "NOT_FOUND", message: "商户不存在" });
        }
        if (!merchant.businessLicense?.trim()) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "商户未登记统一社会信用代码，无法校验换绑目标",
          });
        }
        const creditCode = merchant.businessLicense.trim();
        await validatePlatformCrmRebindTarget({
          creditCode,
          expectedPortalUserId: input.expectedPortalUserId,
          newPortalUserId: input.newPortalUserId,
        });
        return db.rebindMerchantCrmOwner({
          merchantId: input.id,
          expectedPortalUserId: input.expectedPortalUserId,
          newPortalUserId: input.newPortalUserId,
          reason: input.reason,
          requestId: input.requestId,
          actor: auditActorFromContext(ctx),
        });
      }),
    /**
     * 给商户"发信"：发送平台消息到该商户关联的前台客服会话（首次自动建会话并复用）。
     * 前台"联系客服"按钮通过 portal.getUnread 轮询该会话显示红点提醒。
     */
    sendMessage: messageWriteProcedure
      .input(z.object({
        id: z.number(),
        content: z.string().min(1, "消息内容不能为空").max(5000),
      }))
      .mutation(async ({ ctx, input }) => {
        return db.sendMerchantMessage({
          merchantId: input.id,
          content: input.content,
          adminId: ctx.user.id,
          adminName: ctx.user.name ?? "平台客服",
        });
      }),
  }),

  // ─── 前台对接（商家入驻资料提交）──────────────────────────────────────────
  portal: router({
    /**
     * 前台「销售负责人」下拉的数据源。鉴权：x-portal-key。
     * 仅对外输出工号与展示名，不泄露 adminUserId / status / sortOrder 等内部字段。
     */
    listSalesStaff: publicProcedure.query(async ({ ctx }) => {
      assertPortalKey(ctx.req);
      const staff = await db.listSalesStaff();
      return staff.map(item => ({ staffCode: item.staffCode, displayName: item.displayName }));
    }),

    /**
     * 前台商家提交入驻资料。鉴权：请求头 x-portal-key 必须等于 PORTAL_API_KEY 环境变量。
     * 文件类字段（营业执照图、协议文件）传前台已上传好的可访问 URL。
     */
    submitMerchant: publicProcedure
      .input(z.object({
        companyName: z.string().min(2).max(256),
        contactName: z.string().min(1).max(64),
        contactPhone: z.string().min(5).max(20),
        contactEmail: z.string().email().max(320),
        businessLicense: z.string().min(5).max(64),
        licenseImageUrl: z.string().url().max(512).optional().nullable(),
        licenseExpiry: z.coerce.date().optional().nullable(),
        agreementFileUrl: z.string().url().max(512).optional().nullable(),
        agreementSigned: z.boolean().optional().default(false),
        registeredCapital: z.string().max(64).optional().nullable(),
        registeredAddress: z.string().max(512).optional().nullable(),
        businessScope: z.string().max(4000).optional().nullable(),
        establishedDate: z.coerce.date().optional().nullable(),
        legalPersonName: z.string().max(64).optional().nullable(),
        legalPersonIdNo: z.string().max(32).optional().nullable(),
        legalPersonPhone: z.string().max(20).optional().nullable(),
        /**
         * 销售负责人。旧客户端仅传姓名（salesOwner），仅用于兼容；
         * 新客户端提交稳定工号（salesOwnerCode），两者均经后台名单校验。
         */
        salesOwner: z.string().max(64).optional().nullable(),
        salesOwnerCode: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{1,64}$/).optional().nullable(),
      }))
      .mutation(async ({ ctx, input }) => {
        assertPortalKey(ctx.req);
        const owner = await resolvePortalSalesOwner(input.salesOwnerCode, input.salesOwner);
        const { agreementSigned, salesOwner: _legacyOwner, salesOwnerCode: _ownerCode, ...rest } = input;
        const result = await db.upsertPortalMerchant({ ...rest, ...owner, agreementSigned });
        return result;
      }),

    /**
     * 前台"联系我们"提交留言。鉴权：x-portal-key。
     * 首次提交不传 threadNo（返回新会话编号）；追加留言时带上 threadNo。
     */
    submitMessage: publicProcedure
      .input(z.object({
        threadNo: z.string().max(32).optional().nullable(),
        /** 前台可靠重试幂等键；旧调用可不传。 */
        clientMessageId: z.string().uuid().max(64).optional().nullable(),
        subject: z.string().max(256).optional().nullable(),
        contactName: z.string().max(128).optional().nullable(),
        contactPhone: z.string().max(32).optional().nullable(),
        contactEmail: z.string().email().max(320).optional().nullable(),
        portalUserId: z.string().max(64).optional().nullable(),
        /** 会话类型：general=旧版兼容值（服务端归类） inquiry=快速询价 service=在线客服 crm_apply=企业开通申请 */
        threadType: z.enum(["general", "inquiry", "service", "crm_apply"]).optional().nullable(),
        /** 客户公司资料快照（已提交公司资料的用户，前台附带传入，后台会话详情展示） */
        companyProfile: z.object({
          companyName: z.string().max(256).optional().nullable(),
          creditCode: z.string().max(64).optional().nullable(),
          companyType: z.string().max(128).optional().nullable(),
          legalPerson: z.string().max(64).optional().nullable(),
          companyRole: z.string().max(64).optional().nullable(),
          regAddress: z.string().max(512).optional().nullable(),
          certLevel: z.string().max(32).optional().nullable(),
        }).optional().nullable(),
        content: z.string().min(1, "留言内容不能为空").max(5000),
      }))
      .mutation(async ({ ctx, input }) => {
        assertPortalKey(ctx.req);
        return db.createPortalMessage(input);
      }),

    /**
     * 前台企业开通 ERP 申请。鉴权：x-portal-key。
     * 按统一社会信用代码幂等：直接创建/更新商户记录（crmStatus=pending），落后台商户管理页面。
     */
    submitCrmApplication: publicProcedure
      .input(z.object({
        companyName: z.string().min(2).max(256),
        creditCode: z.string().min(5).max(64),
        companyType: z.string().trim().min(1, "企业类型为必填项").max(128),
        companyRole: z.string().trim().min(1, "企业角色为必填项").max(64),
        contactName: z.string().max(64).optional().nullable(),
        contactPhone: z.string().max(20).optional().nullable(),
        contactEmail: z.string().email().max(320).optional().nullable(),
        legalPersonName: z.string().trim().min(1, "法定代表人为必填项").max(64),
        registeredAddress: z.string().trim().min(1, "注册地址为必填项").max(512),
        settlementAccountName: z.string().trim().min(1, "账户名称为必填项").max(128),
        settlementAccount: z.string().trim().min(1, "账户号码为必填项").max(64),
        settlementBank: z.string().trim().min(1, "开户行为必填项").max(128),
        businessScope: z.string().max(4000).optional().nullable(),
        licenseImageUrl: z.string().url().max(512).optional().nullable(),
        portalUserId: z.string().max(64).optional().nullable(),
        note: z.string().max(1000).optional().nullable(),
        /**
         * 销售负责人。与 portal.submitMerchant 保持一致的双字段语义：
         * 新客户端传稳定工号（salesOwnerCode），旧客户端仅传姓名作兼容。
         *
         * 历史缺陷（2026-08-17 修复）：本接口原先没有这两个字段，
         * 前台只能把销售姓名塞进 note 文本，工号完全丢失，
         * 导致 merchants.salesOwnerCode 为空、销售在后台看不到名下客户。
         */
        salesOwner: z.string().max(64).optional().nullable(),
        salesOwnerCode: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{1,64}$/).optional().nullable(),
      }))
      .mutation(async ({ ctx, input }) => {
        assertPortalKey(ctx.req);
        // 必须走统一校验，不得将未校验的自由文本当作归属写入商户。
        const owner = await resolvePortalSalesOwner(input.salesOwnerCode, input.salesOwner);
        const { salesOwner: _legacyOwner, salesOwnerCode: _ownerCode, ...rest } = input;
        return db.submitCrmApplication({ ...rest, ...owner });
      }),

    /**
     * 前台按会话编号拉取全部消息（含后台回复），拉取后前台未读数清零。鉴权：x-portal-key。
     */
    getMessages: publicProcedure
      .input(z.object({ threadNo: z.string().min(1).max(32) }))
      .query(async ({ ctx, input }) => {
        assertPortalKey(ctx.req);
        const result = await db.getPortalThreadMessages(input.threadNo);
        if (!result) {
          throw new TRPCError({ code: "NOT_FOUND", message: "会话不存在" });
        }
        return result;
      }),

    /**
     * 前台查询会话未读回复数（不清零），供"联系客服"按钮红点角标轮询。鉴权：x-portal-key。
     */
    getUnread: publicProcedure
      .input(z.object({ threadNo: z.string().min(1).max(32) }))
      .query(async ({ ctx, input }) => {
        assertPortalKey(ctx.req);
        const result = await db.getPortalThreadUnread(input.threadNo);
        if (!result) {
          throw new TRPCError({ code: "NOT_FOUND", message: "会话不存在" });
        }
        return result;
      }),

    /**
     * 前台校验企业 ERP 访问权限。鉴权：x-portal-key。
     * 入参：统一社会信用代码。返回 allowed / crmStatus / message：
     * enabled → allowed=true；disabled → "您的ERP权限已经被暂停，请联系客服"；
     * pending/rejected/none → 对应提示文案。附带 crmThreadNo（后台发信会话编号，用于前台联系客服红点轮询）。
     */
    getCrmAccess: publicProcedure
      .input(z.object({
        creditCode: z.string().min(5).max(64),
        portalUserId: z.string().max(64).optional().nullable(),
      }))
      .query(async ({ ctx, input }) => {
        assertPortalKey(ctx.req);
        return db.getCrmAccessByCreditCode(input.creditCode, input.portalUserId);
      }),
    /**
     * 前台服务端对账 ERP 企业绑定。仅 x-portal-key 可访问；用于专用换绑后同步企业超级管理员，
     * 不直接暴露给浏览器。
     */
    getCrmBinding: publicProcedure
      .input(z.object({ creditCode: z.string().min(5).max(64) }))
      .query(async ({ ctx, input }) => {
        assertPortalKey(ctx.req);
        return db.getCrmBindingByCreditCode(input.creditCode);
      }),
    /**
     * 上传物料图片并按型号回写 materials 表。鉴权：x-portal-key。
     * 用途：外部任务批量导入物料图片（文件名=型号场景）。
     * 行为：按 partNumber 大小写不敏感精确匹配物料 → 图片存本地磁盘（Nginx/Express 静态服务）→
     *       追加到 images 图集（按 URL 去重，最多 9 张）；asCover=true 或封面为空时设为封面。
     */
    uploadMaterialImage: publicProcedure
      .input(z.object({
        /** 制造商型号，如 STM32F103C8T6（大小写不敏感） */
        partNumber: z.string().min(1).max(128),
        /** 原始文件名（仅记录用） */
        fileName: z.string().min(1).max(256),
        /** image/png | image/jpeg | image/webp | image/gif */
        mimeType: z.string(),
        /** base64 编码图片内容（不含 data: 前缀），≤5MB */
        base64: z.string().min(1),
        /** 是否设为封面图（默认 true；false 时仅当封面为空才设） */
        asCover: z.boolean().optional().default(true),
      }))
      .mutation(async ({ ctx, input }) => {
        assertPortalKey(ctx.req);
        const ext = IMAGE_MIME_MAP[input.mimeType];
        if (!ext) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "仅支持 PNG/JPG/WebP/GIF 图片" });
        }
        const buffer = Buffer.from(input.base64, "base64");
        if (buffer.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "文件内容为空" });
        if (buffer.length > MAX_IMAGE_SIZE) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "图片不能超过 5MB" });
        }
        if (!isValidImageBuffer(buffer, input.mimeType)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "文件内容不是有效的图片（文件头校验失败）" });
        }
        const material = await db.getMaterialByPartNumber(input.partNumber);
        if (!material) {
          throw new TRPCError({ code: "NOT_FOUND", message: `型号 ${input.partNumber} 不存在` });
        }
        const { url } = saveLocalFile("material-images", ext, buffer);
        const result = await db.appendMaterialImage(material.id, {
          url,
          name: input.fileName,
          asCover: input.asCover,
        });
        return {
          partNumber: material.partNumber,
          url,
          coverImageUrl: result.coverImageUrl,
          imageCount: result.imageCount,
        };
      }),
  }),

  // ─── 消息中心（后台管理）──────────────────────────────────────────────────
  message: router({
    /** 会话列表 */
    threads: messageReadProcedure
      .input(pageInput.extend({
        status: z.enum(["open", "closed"]).optional(),
        threadType: z.enum(["inquiry", "service"]).optional(),
        keyword: z.string().max(128).optional(),
      }))
      .query(async ({ input }) => {
        return db.getMessageThreads({
          page: input.page,
          pageSize: input.pageSize,
          status: input.status,
          threadType: input.threadType,
          keyword: input.keyword,
        });
      }),

    /** 会话详情（打开后后台未读清零） */
    detail: messageReadProcedure
      .input(z.object({ threadId: z.number() }))
      .query(async ({ input }) => {
        const result = await db.getMessageThreadDetail(input.threadId);
        if (!result) {
          throw new TRPCError({ code: "NOT_FOUND", message: "会话不存在" });
        }
        return result;
      }),

    /** 回复会话 */
    reply: messageWriteProcedure
      .input(z.object({
        threadId: z.number(),
        content: z.string().min(1, "回复内容不能为空").max(5000),
      }))
      .mutation(async ({ ctx, input }) => {
        return db.replyMessageThread({
          threadId: input.threadId,
          content: input.content,
          adminId: ctx.user.id,
          adminName: ctx.user.name ?? "平台客服",
        });
      }),

    /** 关闭/重开会话 */
    setStatus: messageWriteProcedure
      .input(z.object({
        threadId: z.number(),
        status: z.enum(["open", "closed"]),
      }))
      .mutation(async ({ input }) => {
        return db.setMessageThreadStatus(input.threadId, input.status);
      }),

    /** 未读总数（侧边栏角标轮询） */
    unreadCount: messageReadProcedure.query(async () => {
      return { total: await db.getAdminUnreadTotal() };
    }),
  }),

  // ─── 客户物料管理（前台发布物料，跨库） ──────────────────────────────────
  platformMaterial: router({
    /** 列表：查询商户在前台发布的物料，支持信用代码筛选与关键词搜索 */
    list: merchantReadProcedure
      .input(z.object({
        creditCode: z.string().max(64).optional(),
        keyword: z.string().max(128).optional(),
        status: z.enum(["published", "draft", "offshelf", "all"]).optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
      }).optional())
      .query(async ({ input }) => {
        return db.listMerchantInventories(input ?? {});
      }),
    /** 下架：置回待发布（draft）并记录 offshelfBy='admin' 与必填下架原因，前台向用户展示 */
    offshelf: merchantWriteProcedure
      .input(z.object({
        id: z.number().int().positive(),
        reason: z.string().trim().min(1, "请填写下架原因").max(255, "下架原因不能超过255字"),
      }))
      .mutation(async ({ input }) => {
        return db.offshelfPlatformInventory(input.id, input.reason);
      }),
  }),

  // ─── 管理员管理 ──────────────────────────────────────────────────────────
  admin: router({
    list: adminManageProcedure.input(pageInput).query(async ({ input }) => {
      return db.getAdminUsers(input);
    }),
  }),

  /**
   * 销售身份（只读）。
   *
   * 有意不提供 create/update/delete：销售身份完全由后台用户生命周期驱动，
   * 否则会出现「销售身份存在但对应后台用户已停用/已删除」的幽灵记录，
   * 其名下商户将成为无人可见的孤岛。
   */
  salesStaff: router({
    list: adminManageProcedure
      .input(z.object({ includeInactive: z.boolean().optional() }).optional())
      .query(async ({ input }) => {
        const includeInactive = input?.includeInactive ?? true;
        return db.listSalesStaff({ activeOnly: !includeInactive });
      }),
  }),

  adminUser: router({
    list: adminManageProcedure.input(pageInput).query(async ({ input }) => {
      return db.getAdminUsers(input);
    }),
    create: adminManageProcedure.input(z.object({
      username: z.string().min(2).max(64),
      displayName: z.string().max(128).optional().nullable(),
      email: z.string().email().optional().nullable(),
      phone: z.string().max(20).optional().nullable(),
      adminRole: z.enum(["super_admin", "operation", "merchant_mgr", "customer_svc", "risk_control", "finance", "auditor"]),
      /** 追加的销售可见范围工号（本人工号由后端自动并入） */
      salesStaffCodes: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{1,64}$/)).max(100).optional().default([]),
      password: z.string().min(8, "初始密码至少 8 位").max(128),
    })).mutation(async ({ input }) => {
      const existing = await db.getAdminUserByUsername(input.username);
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "用户名已存在" });
      }
      const { password, ...rest } = input;
      try {
        return await db.createAdminUser({ ...rest, passwordHash: await hashPassword(password) });
      } catch (error) {
        throw mapSalesScopeError(error);
      }
    }),
    update: adminManageProcedure.input(z.object({
      id: z.number(),
      displayName: z.string().max(128).optional().nullable(),
      email: z.string().email().optional().nullable(),
      phone: z.string().max(20).optional().nullable(),
      adminRole: z.enum(["super_admin", "operation", "merchant_mgr", "customer_svc", "risk_control", "finance", "auditor"]).optional(),
      salesStaffCodes: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{1,64}$/)).max(100).optional(),
      status: z.enum(["active", "disabled", "locked"]).optional(),
      /** 传入则重置该账号的登录密码 */
      password: z.string().min(8, "密码至少 8 位").max(128).optional(),
    })).mutation(async ({ ctx, input }) => {
      const { id, password, ...rest } = input;
      // 自我保护：超级管理员不得将自己降级或停用，否则当场失去后台管理权限且无法自行恢复
      if (ctx.adminAccount?.id === id) {
        if (rest.adminRole !== undefined && rest.adminRole !== "super_admin" && ctx.adminAccount.adminRole === "super_admin") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "不能降低自己的管理员角色" });
        }
        if (rest.status !== undefined && rest.status !== "active") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "不能停用当前登录的账号" });
        }
      }
      try {
        await db.updateAdminUser(id, rest);
      } catch (error) {
        throw mapSalesScopeError(error);
      }
      if (password) {
        await db.setAdminUserPassword(id, await hashPassword(password));
      }
      return { success: true };
    }),
    toggleStatus: adminManageProcedure.input(z.object({
      id: z.number(),
      status: z.enum(["active", "disabled"]),
    })).mutation(async ({ input }) => {
      return db.toggleAdminUserStatus(input.id, input.status);
    }),
    remove: adminManageProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
      return db.deleteAdminUser(input.id);
    }),
  }),
});

export type AppRouter = typeof appRouter;
