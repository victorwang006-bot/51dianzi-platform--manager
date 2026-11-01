import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { TrpcContext } from "../_core/context";
import { adminProcedure, router } from "../_core/trpc";
import {
  OfficialChannelInventoryError,
  addOfficialChannelStockNote,
  createOfficialChannelSource,
  createOfficialChannelStock,
  exportOfficialChannelStocks,
  getOfficialChannelSource,
  getOfficialChannelStock,
  listOfficialChannelSources,
  listOfficialChannelStockNotes,
  listOfficialChannelStocks,
  offshelfOfficialChannelStock,
  publishOfficialChannelStock,
  setOfficialChannelSourceActive,
  transferOfficialChannelStockOwner,
  updateOfficialChannelSource,
  updateOfficialChannelStock,
} from "../services/officialChannelInventory";

const idSchema = z.number().int().min(1).max(2_147_483_647);
const revisionSchema = z.number().int().min(1).max(2_147_483_647);
const requestIdSchema = z
  .string()
  .trim()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "requestId 格式无效");
const sourceTypeSchema = z.enum(["factory", "agent", "trade", "other"]);
const stockStatusSchema = z.enum(["draft", "published", "offshelf"]);
const pagingSchema = z
  .object({
    limit: z.number().int().min(1).max(100).default(50),
    offset: z.number().int().min(0).max(10_000).default(0),
  })
  .strict();

const sourceNameSchema = z.string().trim().min(1, "来源名称不能为空").max(128);
const partNumberSchema = z.string().trim().min(1, "型号不能为空").max(128);
const brandSchema = z.string().trim().min(1, "品牌不能为空").max(128);
const dateCodeSchema = z.string().trim().min(1).max(64);
const leadTimeSchema = z.string().trim().min(1).max(255);
const internalNoteSchema = z.string().trim().min(1).max(2_000);
const contactText = (max: number) =>
  z
    .union([z.string().trim().max(max), z.null()])
    .optional()
    .transform(value =>
      value === undefined
        ? undefined
        : value === null || value === ""
          ? null
          : value
    );
const priceSchema = z
  .union([
    z
      .string()
      .trim()
      .regex(/^(?:0|[1-9]\d{0,12})(?:\.\d{1,6})?$/, "价格精度或格式无效")
      .max(32),
    z.null(),
  ])
  .optional()
  .transform(value =>
    value === undefined
      ? undefined
      : value === null || value === ""
        ? null
        : value
  );
const qtySchema = z
  .union([z.number().finite().int().min(0).max(2_147_483_647), z.null()])
  .optional();

const createSourceInput = z
  .object({
    requestId: requestIdSchema,
    /** Only a super administrator may select this. The service rejects it for ordinary users. */
    teamId: idSchema.optional(),
    name: sourceNameSchema,
    type: sourceTypeSchema,
    contactName: contactText(128),
    phone: contactText(32),
    wechat: contactText(128),
    qq: contactText(64),
    notes: contactText(2_000),
  })
  .strict();

const updateSourceInput = z
  .object({
    sourceId: idSchema,
    expectedRevision: revisionSchema,
    requestId: requestIdSchema,
    name: sourceNameSchema.optional(),
    type: sourceTypeSchema.optional(),
    contactName: contactText(128),
    phone: contactText(32),
    wechat: contactText(128),
    qq: contactText(64),
    notes: contactText(2_000),
    /** The service permits this only for a freshly revalidated super administrator. */
    publicationApproved: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const patched = [
      "name",
      "type",
      "contactName",
      "phone",
      "wechat",
      "qq",
      "notes",
      "publicationApproved",
    ].some(key => value[key as keyof typeof value] !== undefined);
    if (!patched)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "至少提交一个来源字段",
      });
  });

const createStockInput = z
  .object({
    requestId: requestIdSchema,
    sourceId: idSchema,
    partNumber: partNumberSchema,
    brand: brandSchema,
    qty: qtySchema,
    dateCode: z
      .union([dateCodeSchema, z.null()])
      .optional()
      .transform(value =>
        value === undefined
          ? undefined
          : value === null || value === ""
            ? null
            : value
      ),
    price: priceSchema,
    currency: z.literal("CNY").optional(),
    taxIncluded: z.boolean().nullable().optional(),
    leadTime: z
      .union([leadTimeSchema, z.null()])
      .optional()
      .transform(value =>
        value === undefined
          ? undefined
          : value === null || value === ""
            ? null
            : value
      ),
    note: z
      .union([internalNoteSchema, z.null()])
      .optional()
      .transform(value =>
        value === undefined
          ? undefined
          : value === null || value === ""
            ? null
            : value
      ),
    // teamId / ownerAdminUserId / createdByAdminUserId are intentionally excluded by .strict().
  })
  .strict();

const updateStockInput = z
  .object({
    stockId: idSchema,
    expectedRevision: revisionSchema,
    requestId: requestIdSchema,
    sourceId: idSchema.optional(),
    partNumber: partNumberSchema.optional(),
    brand: brandSchema.optional(),
    qty: qtySchema,
    dateCode: z
      .union([dateCodeSchema, z.null()])
      .optional()
      .transform(value =>
        value === undefined
          ? undefined
          : value === null || value === ""
            ? null
            : value
      ),
    price: priceSchema,
    currency: z.literal("CNY").optional(),
    taxIncluded: z.boolean().nullable().optional(),
    leadTime: z
      .union([leadTimeSchema, z.null()])
      .optional()
      .transform(value =>
        value === undefined
          ? undefined
          : value === null || value === ""
            ? null
            : value
      ),
    note: z
      .union([internalNoteSchema, z.null()])
      .optional()
      .transform(value =>
        value === undefined
          ? undefined
          : value === null || value === ""
            ? null
            : value
      ),
  })
  .strict()
  .superRefine((value, ctx) => {
    const patched = [
      "sourceId",
      "partNumber",
      "brand",
      "qty",
      "dateCode",
      "price",
      "currency",
      "taxIncluded",
      "leadTime",
      "note",
    ].some(key => value[key as keyof typeof value] !== undefined);
    if (!patched)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "至少提交一个库存字段",
      });
  });

/** The local context identity is only a hint; every service transaction locks and revalidates it. */
function actorFromContext(ctx: TrpcContext) {
  if (!ctx.adminAccount) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "需要真实后台账号会话",
    });
  }
  return {
    adminUserId: ctx.adminAccount.id,
    sessionVersion: ctx.adminAccount.sessionVersion,
  };
}

async function serviceCall<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    if (!(error instanceof OfficialChannelInventoryError)) throw error;
    const code = error.code;
    if (code.endsWith("_NOT_FOUND") || code.includes("NOT_FOUND_OR_INACTIVE")) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "官方渠道记录不存在或不在当前范围内",
      });
    }
    if (
      code.includes("REVISION_CONFLICT") ||
      code.includes("ALREADY_") ||
      code.includes("STATE_CONFLICT") ||
      code.includes("REQUEST_ID_REUSED")
    ) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "记录已变化或请求号已被用于其他操作，请刷新后重试",
      });
    }
    if (code.includes("ACTOR_REQUIRED")) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "后台账号会话无效，请重新登录",
      });
    }
    if (code.includes("FORBIDDEN") || code.includes("SUPER_ADMIN_REQUIRED")) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "当前后台账号无权执行此官方渠道操作",
      });
    }
    if (code.includes("DATABASE_NOT_AVAILABLE")) {
      throw new TRPCError({
        code: "SERVICE_UNAVAILABLE",
        message: "官方渠道库存服务暂不可用",
      });
    }
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "当前官方渠道库存记录不满足操作条件",
    });
  }
}

const officialAdminProcedure = adminProcedure.use(({ ctx, next }) => {
  // OAuth compatibility/admin role never substitutes for a real local admin_users identity here.
  actorFromContext(ctx);
  return next({ ctx });
});

/**
 * Narrow official-admin API. It is intentionally not attached to merchant businessRouter,
 * and does not expose a public-search, cart, or standard enquiry endpoint.
 */
export const officialChannelInventoryRouter = router({
  listSources: officialAdminProcedure
    .input(
      z
        .object({
          query: z.string().trim().min(1).max(128).optional(),
          active: z.boolean().optional(),
          type: sourceTypeSchema.optional(),
          ...pagingSchema.shape,
        })
        .strict()
    )
    .query(({ ctx, input }) =>
      serviceCall(() =>
        listOfficialChannelSources(actorFromContext(ctx), input)
      )
    ),

  getSource: officialAdminProcedure
    .input(z.object({ sourceId: idSchema }).strict())
    .query(({ ctx, input }) =>
      serviceCall(() =>
        getOfficialChannelSource(actorFromContext(ctx), input.sourceId)
      )
    ),

  createSource: officialAdminProcedure
    .input(createSourceInput)
    .mutation(({ ctx, input }) =>
      serviceCall(() =>
        createOfficialChannelSource(actorFromContext(ctx), input)
      )
    ),

  updateSource: officialAdminProcedure
    .input(updateSourceInput)
    .mutation(({ ctx, input }) =>
      serviceCall(() =>
        updateOfficialChannelSource(actorFromContext(ctx), input)
      )
    ),

  setSourceActive: officialAdminProcedure
    .input(
      z
        .object({
          sourceId: idSchema,
          active: z.boolean(),
          expectedRevision: revisionSchema,
          requestId: requestIdSchema,
        })
        .strict()
    )
    .mutation(({ ctx, input }) =>
      serviceCall(() =>
        setOfficialChannelSourceActive(actorFromContext(ctx), input)
      )
    ),

  listStocks: officialAdminProcedure
    .input(
      z
        .object({
          sourceId: idSchema.optional(),
          status: stockStatusSchema.optional(),
          query: z.string().trim().min(1).max(128).optional(),
          ...pagingSchema.shape,
        })
        .strict()
    )
    .query(({ ctx, input }) =>
      serviceCall(() => listOfficialChannelStocks(actorFromContext(ctx), input))
    ),

  getStock: officialAdminProcedure
    .input(z.object({ stockId: idSchema }).strict())
    .query(({ ctx, input }) =>
      serviceCall(() =>
        getOfficialChannelStock(actorFromContext(ctx), input.stockId)
      )
    ),

  createStock: officialAdminProcedure
    .input(createStockInput)
    .mutation(({ ctx, input }) =>
      serviceCall(() =>
        createOfficialChannelStock(actorFromContext(ctx), input)
      )
    ),

  updateStock: officialAdminProcedure
    .input(updateStockInput)
    .mutation(({ ctx, input }) =>
      serviceCall(() =>
        updateOfficialChannelStock(actorFromContext(ctx), input)
      )
    ),

  publishStock: officialAdminProcedure
    .input(
      z
        .object({
          stockId: idSchema,
          expectedRevision: revisionSchema,
          requestId: requestIdSchema,
        })
        .strict()
    )
    .mutation(({ ctx, input }) =>
      serviceCall(() =>
        publishOfficialChannelStock(actorFromContext(ctx), input)
      )
    ),

  offshelfStock: officialAdminProcedure
    .input(
      z
        .object({
          stockId: idSchema,
          expectedRevision: revisionSchema,
          requestId: requestIdSchema,
        })
        .strict()
    )
    .mutation(({ ctx, input }) =>
      serviceCall(() =>
        offshelfOfficialChannelStock(actorFromContext(ctx), input)
      )
    ),

  listNotes: officialAdminProcedure
    .input(z.object({ stockId: idSchema, ...pagingSchema.shape }).strict())
    .query(({ ctx, input }) =>
      serviceCall(() =>
        listOfficialChannelStockNotes(actorFromContext(ctx), input)
      )
    ),

  addNote: officialAdminProcedure
    .input(
      z
        .object({
          stockId: idSchema,
          body: internalNoteSchema,
          requestId: requestIdSchema,
        })
        .strict()
    )
    .mutation(({ ctx, input }) =>
      serviceCall(() =>
        addOfficialChannelStockNote(actorFromContext(ctx), input)
      )
    ),

  exportStocks: officialAdminProcedure
    .input(
      z
        .object({
          stockIds: z.array(idSchema).min(1).max(1_000).optional(),
          status: stockStatusSchema.optional(),
          sourceId: idSchema.optional(),
        })
        .strict()
    )
    .query(({ ctx, input }) =>
      serviceCall(() =>
        exportOfficialChannelStocks(actorFromContext(ctx), input)
      )
    ),

  transferOwner: officialAdminProcedure
    .input(
      z
        .object({
          stockId: idSchema,
          targetAdminUserId: idSchema,
          reason: z.string().trim().min(1, "交接原因不能为空").max(1_000),
          expectedRevision: revisionSchema,
          requestId: requestIdSchema,
        })
        .strict()
    )
    .mutation(({ ctx, input }) =>
      serviceCall(() =>
        transferOfficialChannelStockOwner(actorFromContext(ctx), input)
      )
    ),
});
