import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, publicProcedure } from "../_core/trpc";
import {
  officialActorFromContext,
  requireOfficialAdminAccount,
  OFFICIAL_INVENTORY_PERMISSIONS,
  type OfficialInventoryPermission,
} from "../services/officialChannelAccess";
import {
  archiveOfficialTeam,
  createOfficialTeam,
  getOfficialTeamsOverview,
  setOfficialTeamMember,
  updateOfficialTeam,
} from "../services/officialTeams";

const requestIdSchema = z
  .string()
  .trim()
  .min(8, "请求号无效")
  .max(64, "请求号无效")
  .regex(/^[A-Za-z0-9_-]+$/, "请求号只能包含字母、数字、下划线或连字符");
const teamIdSchema = z.number().int().positive("团队标识无效");
const revisionSchema = z.number().int().min(0, "版本号无效");
const officialPermissionsSchema = z
  .array(z.enum(OFFICIAL_INVENTORY_PERMISSIONS))
  .max(OFFICIAL_INVENTORY_PERMISSIONS.length, "官方模块权限数量无效")
  .refine(
    values => new Set(values).size === values.length,
    "官方模块权限不能重复"
  )
  .transform(values => [...values].sort() as OfficialInventoryPermission[]);

/**
 * Unlike legacy dashboard procedures, this gate never treats a Manus OAuth admin as a
 * super-admin-compatible principal. Every member/configuration mutation rechecks the
 * local admin_users sessionVersion in its service transaction as well.
 */
const officialLocalAdminProcedure = publicProcedure.use(({ ctx, next }) => {
  requireOfficialAdminAccount(ctx);
  return next({ ctx });
});

function mapOfficialTeamError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  const code = error instanceof Error ? error.message : "";
  const mapped: Record<string, { code: TRPCError["code"]; message: string }> = {
    OFFICIAL_DATABASE_NOT_AVAILABLE: {
      code: "SERVICE_UNAVAILABLE",
      message: "官方渠道数据服务暂不可用",
    },
    OFFICIAL_TEAM_ID_INVALID: { code: "BAD_REQUEST", message: "团队标识无效" },
    OFFICIAL_TEAM_MEMBER_ADMIN_INVALID: {
      code: "BAD_REQUEST",
      message: "后台员工标识无效",
    },
    OFFICIAL_TEAM_NAME_INVALID: {
      code: "BAD_REQUEST",
      message: "团队名称无效",
    },
    OFFICIAL_TEAM_REVISION_INVALID: {
      code: "BAD_REQUEST",
      message: "版本号无效",
    },
    OFFICIAL_TEAM_ACCOUNT_VERSION_INVALID: {
      code: "BAD_REQUEST",
      message: "员工账号版本无效",
    },
    OFFICIAL_TEAM_ACCOUNT_VERSION_REQUIRED: {
      code: "PRECONDITION_FAILED",
      message: "缺少员工账号版本，请刷新权限配置后重新保存",
    },
    OFFICIAL_TEAM_REQUEST_ID_INVALID: {
      code: "BAD_REQUEST",
      message: "请求号无效",
    },
    OFFICIAL_TEAM_MEMBER_ROLE_INVALID: {
      code: "BAD_REQUEST",
      message: "团队成员身份无效",
    },
    OFFICIAL_TEAM_PERMISSION_INVALID: {
      code: "BAD_REQUEST",
      message: "官方模块权限无效",
    },
    OFFICIAL_TEAM_NOT_FOUND: { code: "NOT_FOUND", message: "团队不存在" },
    OFFICIAL_TEAM_TARGET_ADMIN_NOT_FOUND: {
      code: "NOT_FOUND",
      message: "后台员工不存在",
    },
    OFFICIAL_TEAM_TARGET_ADMIN_INACTIVE: {
      code: "PRECONDITION_FAILED",
      message: "目标后台员工已停用，不能配置官方团队",
    },
    OFFICIAL_TEAM_ARCHIVED: {
      code: "PRECONDITION_FAILED",
      message: "团队已归档，不能继续配置",
    },
    OFFICIAL_TEAM_ARCHIVE_MEMBERS_EXIST: {
      code: "PRECONDITION_FAILED",
      message: "团队仍有成员，请先显式移除或调组",
    },
    OFFICIAL_TEAM_REVISION_CONFLICT: {
      code: "CONFLICT",
      message: "团队已被其他操作更新，请刷新后重试",
    },
    OFFICIAL_TEAM_MEMBER_REVISION_CONFLICT: {
      code: "CONFLICT",
      message: "员工团队配置已变化，请刷新后重试",
    },
    OFFICIAL_TEAM_ACCOUNT_VERSION_CONFLICT: {
      code: "CONFLICT",
      message: "员工账号或权限已变化，请刷新后核对再保存",
    },
    OFFICIAL_TEAM_LEADER_EXISTS: {
      code: "CONFLICT",
      message: "每个官方团队只能设置一名组长",
    },
    OFFICIAL_TEAM_MEMBER_CONFLICT: {
      code: "CONFLICT",
      message: "员工团队配置发生并发冲突，请刷新后重试",
    },
    OFFICIAL_TEAM_REQUEST_ID_REUSED: {
      code: "CONFLICT",
      message: "请求号已被其他配置使用",
    },
    OFFICIAL_TEAM_SUPER_ADMIN_PERMISSIONS_IMMUTABLE: {
      code: "BAD_REQUEST",
      message: "超级管理员权限由系统固定授予，无需配置官方模块权限",
    },
  };
  const match = mapped[code];
  if (match) throw new TRPCError(match);
  console.error("[officialTeams] protected team mutation failed", {
    errorType: error instanceof Error ? error.name : "UnknownError",
  });
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "官方团队配置失败，请稍后重试",
  });
}

/**
 * Parent root router mounts this exactly as `officialTeams: officialTeamsRouter`.
 * All mutations accept only stable admin_users IDs and route-derived local actors.
 */
export const officialTeamsRouter = router({
  overview: officialLocalAdminProcedure.query(async ({ ctx }) => {
    try {
      return await getOfficialTeamsOverview(officialActorFromContext(ctx));
    } catch (error) {
      return mapOfficialTeamError(error);
    }
  }),
  create: officialLocalAdminProcedure
    .input(
      z
        .object({
          name: z
            .string()
            .trim()
            .min(1, "团队名称不能为空")
            .max(128, "团队名称最多 128 个字符"),
          requestId: requestIdSchema,
        })
        .strict()
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await createOfficialTeam(officialActorFromContext(ctx), input);
      } catch (error) {
        return mapOfficialTeamError(error);
      }
    }),
  update: officialLocalAdminProcedure
    .input(
      z
        .object({
          id: teamIdSchema,
          name: z
            .string()
            .trim()
            .min(1, "团队名称不能为空")
            .max(128, "团队名称最多 128 个字符"),
          expectedRevision: revisionSchema,
          requestId: requestIdSchema,
        })
        .strict()
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await updateOfficialTeam(officialActorFromContext(ctx), input);
      } catch (error) {
        return mapOfficialTeamError(error);
      }
    }),
  archive: officialLocalAdminProcedure
    .input(
      z
        .object({
          id: teamIdSchema,
          expectedRevision: revisionSchema,
          requestId: requestIdSchema,
        })
        .strict()
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await archiveOfficialTeam(officialActorFromContext(ctx), input);
      } catch (error) {
        return mapOfficialTeamError(error);
      }
    }),
  setMember: officialLocalAdminProcedure
    .input(
      z
        .object({
          adminUserId: z.number().int().positive("后台员工标识无效"),
          teamId: teamIdSchema.nullable(),
          role: z.enum(["member", "leader"]).nullable(),
          expectedRevision: revisionSchema,
          expectedAccountVersion: revisionSchema.optional(),
          requestId: requestIdSchema,
          officialPermissions: officialPermissionsSchema.optional(),
        })
        .strict()
        .superRefine((value, issue) => {
          if ((value.teamId === null) !== (value.role === null)) {
            issue.addIssue({
              code: z.ZodIssueCode.custom,
              path: value.teamId === null ? ["role"] : ["teamId"],
              message:
                "移出团队时团队和成员身份必须同时为空；配置团队时二者必须同时填写",
            });
          }
        })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await setOfficialTeamMember(
          officialActorFromContext(ctx),
          input
        );
      } catch (error) {
        return mapOfficialTeamError(error);
      }
    }),
});
