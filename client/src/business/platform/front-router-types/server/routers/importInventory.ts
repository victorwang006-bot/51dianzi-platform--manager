import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { installInventoryImportRepairs } from "../services/inventoryImportRepairs";
import { createInventoryImportJobInTransaction, stageInventoryImportBatchInTransaction, finalizeInventoryImportJobInTransaction } from "../services/inventoryImportJobs";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  INVENTORY_BATCH_IMPORT_LIMIT,
  INVENTORY_IMPORT_ERROR_PAGE_SIZE,
  INVENTORY_IMPORT_JOB_ROW_LIMIT,
  INVENTORY_IMPORT_STAGE_BATCH_SIZE,
} from "../../../shared/inventoryImport";
import { inventoryImportPreviewInputSchema } from "../../../shared/inventoryImportPreview";
import { importRowSchema } from "../../../shared/inventoryImportValidation";
import { createCrmPermissionProcedure, router } from "../_core/trpc";
import { previewInventoryImportRows } from "../services/inventoryImportPreview";
import {
  assertInventoryImportJobAccess,
  cancelInventoryImportJob,
  createInventoryImportJob,
  finalizeInventoryImportJob,
  getInventoryImportJob,
  getInventoryImportUploadPlan,
  listInventoryImportErrors,
  listInventoryImportFailedRows,
  listInventoryImportJobs,
  pauseInventoryImportJob,
  resumeInventoryImportJob,
  retryFailedInventoryImportJob,
  stageInventoryImportBatch,
} from "../services/inventoryImportJobs";

export { importRowSchema };

const inventoryPublishProcedure = createCrmPermissionProcedure("inventory.publish");

/** 仅用于识别旧客户端并安全拒绝，禁止恢复逐行同步写库。 */
export const importInventoryBatchInputSchema = z.object({
  rows: z.array(importRowSchema).min(1).max(INVENTORY_BATCH_IMPORT_LIMIT),
  saveAs: z.enum(["draft", "published"]).default("draft"),
});

const jobIdSchema = z.string().uuid();

function taskAccess(ctx: {
  user: { id: number };
  enterprisePermissionScope: {
    enterprise: { id: number };
    member: { inventoryDataScope: "own" | "enterprise" };
    isOwner: boolean;
  };
}) {
  return {
    enterpriseId: ctx.enterprisePermissionScope.enterprise.id,
    viewerUserId: ctx.user.id,
    canAccessEnterpriseJobs:
      ctx.enterprisePermissionScope.isOwner
      || ctx.enterprisePermissionScope.member.inventoryDataScope === "enterprise",
  };
}

function businessError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  if (error instanceof Error && error.message === "库存服务正在更新，请稍后重试") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
  }
  const message = error instanceof Error ? error.message : "库存导入操作失败";
  const isKnownBusinessError = /导入任务|请求号|当前企业|安全上限|最多|暂存|批次|任务创建人|只有暂停|只有处理失败|剩余待处理|不完整|已结束|不存在|预览|Excel 原始/.test(message);
  if (!isKnownBusinessError) {
    const type = error instanceof Error ? error.name : "UnknownError";
    const code = error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "UNKNOWN";
    console.error(`[inventory-import] route failure type=${type} code=${code}`);
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "库存导入服务暂时不可用，请稍后重试" });
  }
  const code = /不存在/.test(message)
    ? "NOT_FOUND"
    : /已有|已用于|已结束|只有/.test(message)
      ? "CONFLICT"
      : /安全上限|最多|超出|不完整/.test(message)
        ? "BAD_REQUEST"
        : "INTERNAL_SERVER_ERROR";
  throw new TRPCError({ code, message });
}

export const importInventoryRouter = router({
  /**
   * 旧同步入口只保留明确错误，避免旧页面继续逐行写正式库存并再次压垮主站。
   */
  batchImport: inventoryPublishProcedure
    .input(importInventoryBatchInputSchema)
    .mutation(() => {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "库存导入已升级为后台安全任务，请刷新页面后重新导入",
      });
    }),

  /**
   * V3 uploads must obtain a server-issued optimistic token before a task is
   * created. This is deliberately a typed base-route procedure, not a repair
   * runtime extension: preview does not create or mutate any import records.
   */
  previewRows: inventoryPublishProcedure
    .input(inventoryImportPreviewInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await previewInventoryImportRows({
          rows: input.rows,
          enterpriseId: ctx.enterprisePermissionScope.enterprise.id,
          dataOwnerUserId: ctx.effectiveUserId!,
          ownerUserId: ctx.user.id,
        });
      } catch (error) {
        businessError(error);
      }
    }),

  createJob: inventoryPublishProcedure
    .input(z.object({
      clientRequestId: z.string().min(16).max(64).regex(/^[A-Za-z0-9_-]+$/),
      fileName: z.string().trim().min(1).max(255),
      fileHash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
      manifestHash: z.string().regex(/^[a-f0-9]{64}$/i),
      totalRows: z.number().int().min(1).max(INVENTORY_IMPORT_JOB_ROW_LIMIT),
      saveAs: z.enum(["draft", "published"]).default("published"),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await createInventoryImportJob({
          enterpriseId: ctx.enterprisePermissionScope.enterprise.id,
          dataOwnerUserId: ctx.effectiveUserId!,
          createdByUserId: ctx.user.id,
          ownerUserId: ctx.user.id,
          clientRequestId: input.clientRequestId,
          fileName: input.fileName,
          fileHash: input.fileHash,
          manifestHash: input.manifestHash,
          totalRows: input.totalRows,
          saveAs: input.saveAs,
        });
      } catch (error) {
        businessError(error);
      }
    }),

  stageBatch: inventoryPublishProcedure
    .input(z.object({
      jobId: jobIdSchema,
      batchIndex: z.number().int().min(0),
      startRow: z.number().int().min(1),
      // Protocol validates job/batch/size; each row is independently checked inside the transaction.
      rows: z.array(z.unknown()).min(1).max(INVENTORY_IMPORT_STAGE_BATCH_SIZE),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await stageInventoryImportBatch({
          ...input,
          enterpriseId: ctx.enterprisePermissionScope.enterprise.id,
          actorUserId: ctx.user.id,
        });
      } catch (error) {
        businessError(error);
      }
    }),

  finalizeJob: inventoryPublishProcedure
    .input(z.object({ jobId: jobIdSchema }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await finalizeInventoryImportJob({
          jobId: input.jobId,
          enterpriseId: ctx.enterprisePermissionScope.enterprise.id,
          actorUserId: ctx.user.id,
        });
      } catch (error) {
        businessError(error);
      }
    }),

  listJobs: inventoryPublishProcedure
    .input(z.object({ limit: z.number().int().min(1).max(30).default(10) }).optional())
    .query(({ ctx, input }) => {
      const access = taskAccess(ctx);
      return listInventoryImportJobs(
        access.enterpriseId,
        input?.limit ?? 10,
        access.viewerUserId,
        access.canAccessEnterpriseJobs,
      );
    }),

  getJob: inventoryPublishProcedure
    .input(z.object({ jobId: jobIdSchema }))
    .query(async ({ ctx, input }) => {
      try {
        await assertInventoryImportJobAccess({ jobId: input.jobId, ...taskAccess(ctx) });
        return await getInventoryImportJob(input.jobId, ctx.enterprisePermissionScope.enterprise.id);
      } catch (error) {
        businessError(error);
      }
    }),

  getUploadPlan: inventoryPublishProcedure
    .input(z.object({ jobId: jobIdSchema }))
    .query(async ({ ctx, input }) => {
      try {
        // Same createdBy/enterprise-scope authorization as getJob; this route
        // returns only batch metadata and has no write side effects.
        await assertInventoryImportJobAccess({ jobId: input.jobId, ...taskAccess(ctx) });
        return await getInventoryImportUploadPlan(
          input.jobId,
          ctx.enterprisePermissionScope.enterprise.id,
        );
      } catch (error) {
        businessError(error);
      }
    }),

  listErrors: inventoryPublishProcedure
    .input(z.object({
      jobId: jobIdSchema,
      limit: z.number().int().min(1).max(200).default(50),
    }))
    .query(async ({ ctx, input }) => {
      try {
        await assertInventoryImportJobAccess({ jobId: input.jobId, ...taskAccess(ctx) });
        return await listInventoryImportErrors(
          input.jobId,
          ctx.enterprisePermissionScope.enterprise.id,
          input.limit,
        );
      } catch (error) {
        businessError(error);
      }
    }),

  listFailedRows: inventoryPublishProcedure
    .input(z.object({
      jobId: jobIdSchema,
      afterRowNumber: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(INVENTORY_IMPORT_ERROR_PAGE_SIZE).default(INVENTORY_IMPORT_ERROR_PAGE_SIZE),
    }))
    .query(async ({ ctx, input }) => {
      try {
        await assertInventoryImportJobAccess({ jobId: input.jobId, ...taskAccess(ctx) });
        return await listInventoryImportFailedRows(
          input.jobId,
          ctx.enterprisePermissionScope.enterprise.id,
          input.afterRowNumber,
          input.limit,
        );
      } catch (error) {
        businessError(error);
      }
    }),

  pauseJob: inventoryPublishProcedure
    .input(z.object({ jobId: jobIdSchema }))
    .mutation(async ({ ctx, input }) => {
      try {
        await assertInventoryImportJobAccess({ jobId: input.jobId, ...taskAccess(ctx) });
        return await pauseInventoryImportJob(input.jobId, ctx.enterprisePermissionScope.enterprise.id);
      } catch (error) {
        businessError(error);
      }
    }),

  resumeJob: inventoryPublishProcedure
    .input(z.object({ jobId: jobIdSchema }))
    .mutation(async ({ ctx, input }) => {
      try {
        await assertInventoryImportJobAccess({ jobId: input.jobId, ...taskAccess(ctx) });
        return await resumeInventoryImportJob(input.jobId, ctx.enterprisePermissionScope.enterprise.id);
      } catch (error) {
        businessError(error);
      }
    }),

  retryFailedJob: inventoryPublishProcedure
    .input(z.object({ jobId: jobIdSchema }))
    .mutation(async ({ ctx, input }) => {
      try {
        await assertInventoryImportJobAccess({ jobId: input.jobId, ...taskAccess(ctx) });
        return await retryFailedInventoryImportJob(
          input.jobId,
          ctx.enterprisePermissionScope.enterprise.id,
        );
      } catch (error) {
        businessError(error);
      }
    }),

  cancelJob: inventoryPublishProcedure
    .input(z.object({ jobId: jobIdSchema }))
    .mutation(async ({ ctx, input }) => {
      try {
        await assertInventoryImportJobAccess({ jobId: input.jobId, ...taskAccess(ctx) });
        return await cancelInventoryImportJob(input.jobId, ctx.enterprisePermissionScope.enterprise.id);
      } catch (error) {
        businessError(error);
      }
    }),
});

installInventoryImportRepairs({importInventoryRouter, inventoryPublishProcedure, z, TRPCError, getDb, sql, importRowSchema, clones:{create:createInventoryImportJobInTransaction,stage:stageInventoryImportBatchInTransaction,finalize:finalizeInventoryImportJobInTransaction}});
