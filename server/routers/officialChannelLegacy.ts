import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import {
  officialActorFromContext,
  requireOfficialAdminAccount,
} from "../services/officialChannelAccess";
import {
  OfficialChannelLegacyError,
  classifyLegacySource,
  importLegacy,
  overviewLegacy,
} from "../services/officialChannelLegacy";

const requestIdSchema = z
  .string()
  .trim()
  .min(8, "请求号无效")
  .max(64, "请求号无效")
  .regex(/^[A-Za-z0-9_-]+$/, "请求号只能包含字母、数字、下划线或连字符");
const positiveIdSchema = z.number().int().min(1).max(2_147_483_647);
const revisionSchema = z.number().int().min(1).max(2_147_483_647);

/**
 * Do not use `adminProcedure`: that legacy compatibility gate permits the broader admin
 * context shape. This route requires the same signed local admin account as the other official
 * routes, then the service locks and rechecks real-time super-admin status in its transaction.
 */
const officialLocalAdminProcedure = publicProcedure.use(({ ctx, next }) => {
  requireOfficialAdminAccount(ctx);
  return next({ ctx });
});

function mapOfficialLegacyError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  const code =
    error instanceof OfficialChannelLegacyError
      ? error.code
      : error instanceof Error
        ? error.message
        : "";
  const mapped: Record<string, { code: TRPCError["code"]; message: string }> = {
    OFFICIAL_LEGACY_ACTOR_REQUIRED: {
      code: "UNAUTHORIZED",
      message: "后台账号会话无效，请重新登录",
    },
    OFFICIAL_LEGACY_DATABASE_NOT_AVAILABLE: {
      code: "SERVICE_UNAVAILABLE",
      message: "官方渠道兼容服务暂不可用",
    },
    OFFICIAL_LEGACY_DATABASE_IDENTIFIER_INVALID: {
      code: "PRECONDITION_FAILED",
      message: "旧资料数据库配置无效",
    },
    PLATFORM_DB_NAME_INVALID: {
      code: "PRECONDITION_FAILED",
      message: "旧资料数据库配置无效",
    },
    OFFICIAL_LEGACY_LOCK_UNAVAILABLE: {
      code: "CONFLICT",
      message: "已有兼容操作正在进行，请稍后重试",
    },
    OFFICIAL_LEGACY_REQUEST_ID_INVALID: {
      code: "BAD_REQUEST",
      message: "请求号无效",
    },
    OFFICIAL_LEGACY_REQUEST_ID_REUSED: {
      code: "CONFLICT",
      message: "请求号已被用于其他兼容操作",
    },
    OFFICIAL_LEGACY_AUDIT_REPLAY_INVALID: {
      code: "CONFLICT",
      message: "兼容操作审计记录不完整，不能安全重试",
    },
    OFFICIAL_LEGACY_TABLES_MISSING: {
      code: "PRECONDITION_FAILED",
      message: "旧渠道资料表不可用，未执行导入",
    },
    OFFICIAL_LEGACY_OFFICIAL_OWNER_INVALID: {
      code: "PRECONDITION_FAILED",
      message: "历史官方资料归属未通过核验，未执行导入",
    },
    OFFICIAL_LEGACY_RESPONSIBLE_BINDING_UNVERIFIED: {
      code: "PRECONDITION_FAILED",
      message: "历史负责人未映射到当前有效后台账号，未执行导入",
    },
    OFFICIAL_LEGACY_SOURCE_INVALID_IDENTIFIER: {
      code: "PRECONDITION_FAILED",
      message: "旧来源资料无效，未执行导入",
    },
    OFFICIAL_LEGACY_SOURCE_OWNER_MISMATCH: {
      code: "PRECONDITION_FAILED",
      message: "旧来源归属不一致，未执行导入",
    },
    OFFICIAL_LEGACY_SOURCE_TYPE_INVALID: {
      code: "PRECONDITION_FAILED",
      message: "旧来源类型无效，未执行导入",
    },
    OFFICIAL_LEGACY_SOURCE_NAME_INVALID: {
      code: "PRECONDITION_FAILED",
      message: "旧来源名称无效，未执行导入",
    },
    OFFICIAL_LEGACY_SOURCE_CONTACT_INVALID: {
      code: "PRECONDITION_FAILED",
      message: "旧来源联系人无效，未执行导入",
    },
    OFFICIAL_LEGACY_SOURCE_PHONE_INVALID: {
      code: "PRECONDITION_FAILED",
      message: "旧来源电话无效，未执行导入",
    },
    OFFICIAL_LEGACY_SOURCE_WECHAT_INVALID: {
      code: "PRECONDITION_FAILED",
      message: "旧来源微信无效，未执行导入",
    },
    OFFICIAL_LEGACY_SOURCE_QQ_INVALID: {
      code: "PRECONDITION_FAILED",
      message: "旧来源 QQ 无效，未执行导入",
    },
    OFFICIAL_LEGACY_SOURCE_NOTES_INVALID: {
      code: "PRECONDITION_FAILED",
      message: "旧来源备注无效，未执行导入",
    },
    OFFICIAL_LEGACY_SOURCE_ACTIVE_INVALID: {
      code: "PRECONDITION_FAILED",
      message: "旧来源状态无效，未执行导入",
    },
    OFFICIAL_LEGACY_SOURCE_CREATED_AT_INVALID: {
      code: "PRECONDITION_FAILED",
      message: "旧来源日期无效，未执行导入",
    },
    OFFICIAL_LEGACY_SOURCE_UPDATED_AT_INVALID: {
      code: "PRECONDITION_FAILED",
      message: "旧来源日期无效，未执行导入",
    },
    OFFICIAL_LEGACY_MATERIAL_INVALID_IDENTIFIER: {
      code: "PRECONDITION_FAILED",
      message: "旧库存资料无效，未执行导入",
    },
    OFFICIAL_LEGACY_MATERIAL_SOURCE_MISMATCH: {
      code: "PRECONDITION_FAILED",
      message: "旧库存来源不一致，未执行导入",
    },
    OFFICIAL_LEGACY_MATERIAL_OWNER_OR_ENTERPRISE_MISMATCH: {
      code: "PRECONDITION_FAILED",
      message: "旧库存归属或企业不一致，未执行导入",
    },
    OFFICIAL_LEGACY_MATERIAL_QTY_INVALID: {
      code: "PRECONDITION_FAILED",
      message: "旧库存数量无效，未执行导入",
    },
    OFFICIAL_LEGACY_MATERIAL_CURRENCY_INVALID: {
      code: "PRECONDITION_FAILED",
      message: "旧库存币种无效，未执行导入",
    },
    OFFICIAL_LEGACY_MATERIAL_PART_NUMBER_INVALID: {
      code: "PRECONDITION_FAILED",
      message: "旧库存型号无效，未执行导入",
    },
    OFFICIAL_LEGACY_MATERIAL_BRAND_INVALID: {
      code: "PRECONDITION_FAILED",
      message: "旧库存品牌无效，未执行导入",
    },
    OFFICIAL_LEGACY_MATERIAL_DATE_CODE_INVALID: {
      code: "PRECONDITION_FAILED",
      message: "旧库存批次无效，未执行导入",
    },
    OFFICIAL_LEGACY_MATERIAL_PRICE_INVALID: {
      code: "PRECONDITION_FAILED",
      message: "旧库存价格无效，未执行导入",
    },
    OFFICIAL_LEGACY_MATERIAL_TAX_INVALID: {
      code: "PRECONDITION_FAILED",
      message: "旧库存税务字段无效，未执行导入",
    },
    OFFICIAL_LEGACY_MATERIAL_LEAD_TIME_INVALID: {
      code: "PRECONDITION_FAILED",
      message: "旧库存交期无效，未执行导入",
    },
    OFFICIAL_LEGACY_MATERIAL_NOTE_INVALID: {
      code: "PRECONDITION_FAILED",
      message: "旧库存备注无效，未执行导入",
    },
    OFFICIAL_LEGACY_MATERIAL_CREATED_AT_INVALID: {
      code: "PRECONDITION_FAILED",
      message: "旧库存日期无效，未执行导入",
    },
    OFFICIAL_LEGACY_MATERIAL_UPDATED_AT_INVALID: {
      code: "PRECONDITION_FAILED",
      message: "旧库存日期无效，未执行导入",
    },
    OFFICIAL_LEGACY_SOURCE_ALREADY_IMPORTED_OR_CONFLICTED: {
      code: "CONFLICT",
      message: "旧来源已接入或存在冲突，未重复导入",
    },
    OFFICIAL_LEGACY_MATERIAL_ALREADY_IMPORTED_OR_CONFLICTED: {
      code: "CONFLICT",
      message: "旧库存已接入或存在冲突，未重复导入",
    },
    OFFICIAL_LEGACY_SOURCE_CREATE_FAILED: {
      code: "INTERNAL_SERVER_ERROR",
      message: "旧来源导入失败，事务已回滚",
    },
    OFFICIAL_LEGACY_MATERIAL_CREATE_FAILED: {
      code: "INTERNAL_SERVER_ERROR",
      message: "旧库存导入失败，事务已回滚",
    },
    OFFICIAL_LEGACY_SOURCE_ID_INVALID: {
      code: "BAD_REQUEST",
      message: "来源标识无效",
    },
    OFFICIAL_LEGACY_TEAM_ID_INVALID: {
      code: "BAD_REQUEST",
      message: "官方团队标识无效",
    },
    OFFICIAL_LEGACY_SOURCE_REVISION_INVALID: {
      code: "BAD_REQUEST",
      message: "来源版本号无效",
    },
    OFFICIAL_LEGACY_CLASSIFICATION_REASON_INVALID: {
      code: "BAD_REQUEST",
      message: "归类原因无效",
    },
    OFFICIAL_LEGACY_SOURCE_NOT_UNCLASSIFIED_LEGACY: {
      code: "PRECONDITION_FAILED",
      message: "来源不是待归类的旧资料",
    },
    OFFICIAL_LEGACY_SOURCE_REVISION_CONFLICT: {
      code: "CONFLICT",
      message: "来源已变化，请刷新后重试",
    },
    OFFICIAL_LEGACY_SOURCE_PUBLISHED_HISTORY: {
      code: "PRECONDITION_FAILED",
      message: "来源已有发布历史，不能作为旧资料首次归类",
    },
    OFFICIAL_LEGACY_STOCK_ALREADY_CLASSIFIED: {
      code: "PRECONDITION_FAILED",
      message: "来源下已有库存被归类，不能重新分配团队",
    },
    OFFICIAL_LEGACY_STOCK_PUBLISHED_HISTORY: {
      code: "PRECONDITION_FAILED",
      message: "来源下库存已有发布历史，不能作为旧资料首次归类",
    },
    OFFICIAL_LEGACY_STOCK_OWNER_INVALID: {
      code: "PRECONDITION_FAILED",
      message: "库存负责人无效，不能归类",
    },
    OFFICIAL_LEGACY_TARGET_TEAM_NOT_ACTIVE: {
      code: "PRECONDITION_FAILED",
      message: "目标官方团队不存在或已归档",
    },
    OFFICIAL_LEGACY_OWNER_NOT_ACTIVE_IN_TARGET_TEAM: {
      code: "PRECONDITION_FAILED",
      message: "所有库存负责人必须是目标官方团队的当前活跃成员",
    },
    OFFICIAL_LEGACY_STOCK_REVISION_CONFLICT: {
      code: "CONFLICT",
      message: "库存已变化，请刷新后重试",
    },
    OFFICIAL_LEGACY_SUPER_ADMIN_REQUIRED: {
      code: "FORBIDDEN",
      message: "仅真实后台超级管理员可操作旧资料兼容服务",
    },
  };
  const match = mapped[code];
  if (match) throw new TRPCError(match);
  console.error(
    "[officialChannelLegacy] protected compatibility operation failed",
    {
      errorType: error instanceof Error ? error.name : "UnknownError",
    }
  );
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "官方旧资料兼容操作失败，请稍后重试",
  });
}

/**
 * Parent root router mounts this only as `officialChannelLegacy: officialChannelLegacyRouter`.
 * It is not mounted under a merchant/ERP root and exposes no public or ordinary-admin method.
 */
export const officialChannelLegacyRouter = router({
  overviewLegacy: officialLocalAdminProcedure.query(async ({ ctx }) => {
    try {
      return await overviewLegacy(officialActorFromContext(ctx));
    } catch (error) {
      return mapOfficialLegacyError(error);
    }
  }),

  importLegacy: officialLocalAdminProcedure
    .input(z.object({ requestId: requestIdSchema }).strict())
    .mutation(async ({ ctx, input }) => {
      try {
        return await importLegacy(officialActorFromContext(ctx), input);
      } catch (error) {
        return mapOfficialLegacyError(error);
      }
    }),

  classifyLegacySource: officialLocalAdminProcedure
    .input(
      z
        .object({
          sourceId: positiveIdSchema,
          teamId: positiveIdSchema,
          expectedRevision: revisionSchema,
          requestId: requestIdSchema,
          reason: z
            .string()
            .trim()
            .min(1, "归类原因不能为空")
            .max(1000, "归类原因最多 1000 个字符"),
        })
        .strict()
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await classifyLegacySource(officialActorFromContext(ctx), input);
      } catch (error) {
        return mapOfficialLegacyError(error);
      }
    }),
});
