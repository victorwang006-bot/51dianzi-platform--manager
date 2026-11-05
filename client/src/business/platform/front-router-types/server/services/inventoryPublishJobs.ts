import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { and, asc, desc, eq, gt, inArray, isNull, lte, max, or, sql } from "drizzle-orm";
import {
  enterpriseMemberPermissions,
  enterpriseMembers,
  enterprises,
  inventories,
  inventoryPublishJobErrors,
  inventoryPublishJobs,
  type InventoryPublishJob,
} from "../../drizzle/schema";
import {
  INVENTORY_PUBLISH_WORKER_BATCH_SIZE,
} from "../../../shared/inventorySafetyLimits";
import { canPublishInventoryAvailability } from "../../../shared/inventoryAvailability";
import { getDb, withInventoryPublisherLock } from "../db";
import { availableMemoryBytes } from "./inventoryImportJobs";
import { lockActiveInventoryJobMembers } from "./inventoryJobMemberFence";
import {
  assertInventoryQuotaDeploymentReady,
  getInventoryQuota,
  inventoryPublishedLimitMessage,
  isInventoryQuotaDeploymentBusy,
  isInventoryQuotaExceeded,
} from "./inventoryQuota";

const TERMINAL_STATUSES = ["completed", "failed", "cancelled"] as const;
const ACTIVE_STATUSES = ["queued", "running", "paused"] as const;
const LEASE_MS = 30_000;
const MAX_ATTEMPTS = 3;
const MIN_AVAILABLE_MEMORY_BYTES = 1_500 * 1024 * 1024;
const workerInstanceId = `${hostname().slice(0, 32)}:${process.pid}`;

function requireDatabase<T>(value: T | null): asserts value is T {
  if (!value) throw new Error("数据库不可用");
}

function activePublishLeaseCondition(jobId: string, workerId: string, now = new Date()) {
  return and(
    eq(inventoryPublishJobs.id, jobId),
    eq(inventoryPublishJobs.status, "running"),
    eq(inventoryPublishJobs.leaseOwner, workerId),
    gt(inventoryPublishJobs.leaseExpiresAt, now),
  );
}

function affectedRows(result: unknown) {
  return Number((result as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
}

function toPublicJob(job: InventoryPublishJob) {
  return {
    id: job.id,
    status: job.status,
    totalRows: job.totalRows,
    processedRows: job.processedRows,
    successRows: job.successRows,
    errorRows: job.errorRows,
    duplicateRows: job.duplicateRows,
    skippedRows: job.skippedRows,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

export async function createInventoryPublishJob(input: {
  enterpriseId: number;
  dataOwnerUserId: number;
  createdByUserId: number;
  scopeOwnerUserId?: number;
  clientRequestId: string;
}) {
  assertInventoryQuotaDeploymentReady();
  const database = await getDb();
  requireDatabase(database);
  try {
    return await withInventoryPublisherLock(input.dataOwnerUserId, input.enterpriseId, () => database.transaction(async tx => {
      const existingRequest = (
        await tx
          .select()
          .from(inventoryPublishJobs)
          .where(
            and(
              eq(inventoryPublishJobs.enterpriseId, input.enterpriseId),
              eq(inventoryPublishJobs.clientRequestId, input.clientRequestId),
            ),
          )
          .limit(1)
      )[0];
      if (existingRequest) return { job: toPublicJob(existingRequest), idempotent: true } as const;

      const active = (
        await tx
          .select({ id: inventoryPublishJobs.id })
          .from(inventoryPublishJobs)
          .where(eq(inventoryPublishJobs.activeEnterpriseId, input.enterpriseId))
          .limit(1)
      )[0];
      if (active) throw new Error("当前企业已有一键发布任务，请等待完成或先取消该任务");

      const quota = await getInventoryQuota(tx, {
        enterpriseId: input.enterpriseId,
        dataOwnerUserId: input.dataOwnerUserId,
      }, { lockEnterprise: true });
      await lockActiveInventoryJobMembers(tx, { ...input, ownerUserId: input.scopeOwnerUserId });
      const [publishedSummary] = await tx
        .select({ count: sql<number>`COUNT(*)` })
        .from(inventories)
        .where(
          and(
            eq(inventories.userId, input.dataOwnerUserId),
            eq(inventories.enterpriseId, input.enterpriseId),
            eq(inventories.status, "published"),
          ),
        );
      if (isInventoryQuotaExceeded(Number(publishedSummary?.count ?? 0), quota.publishedRowLimit)) {
        throw new Error(inventoryPublishedLimitMessage(quota.publishedRowLimit));
      }

      const [legacyDraftSummary] = await tx
        .select({ count: sql<number>`COUNT(*)` })
        .from(inventories)
        .where(and(
          eq(inventories.userId, input.dataOwnerUserId),
          isNull(inventories.enterpriseId),
          eq(inventories.status, "draft"),
          input.scopeOwnerUserId ? eq(inventories.ownerUserId, input.scopeOwnerUserId) : undefined,
        ));
      if (Number(legacyDraftSummary?.count ?? 0) > 0) {
        throw new Error("存在未归属企业的历史草稿库存，批量发布已拒绝；请先完成企业归属核验");
      }

      const draftScope = and(
        eq(inventories.userId, input.dataOwnerUserId),
        eq(inventories.enterpriseId, input.enterpriseId),
        eq(inventories.status, "draft"),
        input.scopeOwnerUserId ? eq(inventories.ownerUserId, input.scopeOwnerUserId) : undefined,
      );
      const [summary] = await tx
        .select({ count: sql<number>`COUNT(*)`, maxId: max(inventories.id) })
        .from(inventories)
        .where(draftScope);
      const totalRows = Number(summary?.count ?? 0);
      const maxInventoryId = Number(summary?.maxId ?? 0);
      if (totalRows === 0 || maxInventoryId === 0) throw new Error("暂无待发布库存");

      const id = randomUUID();
      await tx.insert(inventoryPublishJobs).values({
        id,
        enterpriseId: input.enterpriseId,
        activeEnterpriseId: input.enterpriseId,
        dataOwnerUserId: input.dataOwnerUserId,
        createdByUserId: input.createdByUserId,
        scopeOwnerUserId: input.scopeOwnerUserId ?? null,
        clientRequestId: input.clientRequestId,
        status: "queued",
        totalRows,
        maxInventoryId,
      });
      const created = (
        await tx.select().from(inventoryPublishJobs).where(eq(inventoryPublishJobs.id, id)).limit(1)
      )[0];
      if (!created) throw new Error("一键发布任务创建失败");
      return { job: toPublicJob(created), idempotent: false } as const;
    }));
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code !== "ER_DUP_ENTRY") throw error;
    const sameRequest = (
      await database
        .select()
        .from(inventoryPublishJobs)
        .where(
          and(
            eq(inventoryPublishJobs.enterpriseId, input.enterpriseId),
            eq(inventoryPublishJobs.clientRequestId, input.clientRequestId),
          ),
        )
        .limit(1)
    )[0];
    if (sameRequest) return { job: toPublicJob(sameRequest), idempotent: true } as const;
    throw new Error("当前企业已有一键发布任务，请等待完成或先取消该任务");
  }
}

export async function listInventoryPublishJobs(input: {
  enterpriseId: number;
  viewerUserId: number;
  canAccessEnterpriseJobs: boolean;
  limit?: number;
}) {
  const database = await getDb();
  requireDatabase(database);
  return database
    .select()
    .from(inventoryPublishJobs)
    .where(
      and(
        eq(inventoryPublishJobs.enterpriseId, input.enterpriseId),
        input.canAccessEnterpriseJobs
          ? undefined
          : eq(inventoryPublishJobs.createdByUserId, input.viewerUserId),
      ),
    )
    .orderBy(desc(inventoryPublishJobs.createdAt))
    .limit(Math.min(Math.max(input.limit ?? 10, 1), 30))
    .then(rows => rows.map(toPublicJob));
}

export async function assertInventoryPublishJobAccess(input: {
  jobId: string;
  enterpriseId: number;
  viewerUserId: number;
  canAccessEnterpriseJobs: boolean;
}) {
  const database = await getDb();
  requireDatabase(database);
  const job = (
    await database
      .select()
      .from(inventoryPublishJobs)
      .where(
        and(
          eq(inventoryPublishJobs.id, input.jobId),
          eq(inventoryPublishJobs.enterpriseId, input.enterpriseId),
          input.canAccessEnterpriseJobs
            ? undefined
            : eq(inventoryPublishJobs.createdByUserId, input.viewerUserId),
        ),
      )
      .limit(1)
  )[0];
  if (!job) throw new Error("一键发布任务不存在");
  return job;
}

export async function getInventoryPublishJob(jobId: string, enterpriseId: number) {
  const database = await getDb();
  requireDatabase(database);
  const job = (
    await database
      .select()
      .from(inventoryPublishJobs)
      .where(
        and(
          eq(inventoryPublishJobs.id, jobId),
          eq(inventoryPublishJobs.enterpriseId, enterpriseId),
        ),
      )
      .limit(1)
  )[0];
  if (!job) throw new Error("一键发布任务不存在");
  return toPublicJob(job);
}

export async function listInventoryPublishErrors(jobId: string, enterpriseId: number, limit = 50) {
  const database = await getDb();
  requireDatabase(database);
  return database
    .select({
      inventoryId: inventoryPublishJobErrors.inventoryId,
      partNumber: inventoryPublishJobErrors.partNumber,
      errorCode: inventoryPublishJobErrors.errorCode,
      errorMessage: inventoryPublishJobErrors.errorMessage,
    })
    .from(inventoryPublishJobErrors)
    .innerJoin(inventoryPublishJobs, eq(inventoryPublishJobs.id, inventoryPublishJobErrors.jobId))
    .where(
      and(
        eq(inventoryPublishJobErrors.jobId, jobId),
        eq(inventoryPublishJobs.enterpriseId, enterpriseId),
      ),
    )
    .orderBy(asc(inventoryPublishJobErrors.id))
    .limit(Math.min(Math.max(limit, 1), 200));
}

export async function pauseInventoryPublishJob(jobId: string, enterpriseId: number) {
  const database = await getDb();
  requireDatabase(database);
  await database
    .update(inventoryPublishJobs)
    .set({ status: "paused", leaseOwner: null, leaseExpiresAt: null })
    .where(
      and(
        eq(inventoryPublishJobs.id, jobId),
        eq(inventoryPublishJobs.enterpriseId, enterpriseId),
        inArray(inventoryPublishJobs.status, ["queued", "running"]),
      ),
    );
  return getInventoryPublishJob(jobId, enterpriseId);
}

export async function resumeInventoryPublishJob(jobId: string, enterpriseId: number) {
  assertInventoryQuotaDeploymentReady();
  const database = await getDb();
  requireDatabase(database);
  await database
    .update(inventoryPublishJobs)
    .set({ status: "queued", leaseOwner: null, leaseExpiresAt: null, errorMessage: null })
    .where(
      and(
        eq(inventoryPublishJobs.id, jobId),
        eq(inventoryPublishJobs.enterpriseId, enterpriseId),
        eq(inventoryPublishJobs.status, "paused"),
      ),
    );
  return getInventoryPublishJob(jobId, enterpriseId);
}

export async function retryFailedInventoryPublishJob(jobId: string, enterpriseId: number) {
  assertInventoryQuotaDeploymentReady();
  const database = await getDb();
  requireDatabase(database);
  try {
    return await database.transaction(async tx => {
      const job = (
        await tx
          .select()
          .from(inventoryPublishJobs)
          .where(
            and(
              eq(inventoryPublishJobs.id, jobId),
              eq(inventoryPublishJobs.enterpriseId, enterpriseId),
            ),
          )
          .limit(1)
          .for("update")
      )[0];
      if (!job) throw new Error("一键发布任务不存在");
      if (job.status !== "failed") throw new Error("只有系统处理失败的任务可以重试");
      await lockActiveInventoryJobMembers(tx, { ...job, ownerUserId: job.scopeOwnerUserId });
      if (job.processedRows >= job.totalRows) throw new Error("该任务没有剩余待处理库存");
      const active = (
        await tx
          .select({ id: inventoryPublishJobs.id })
          .from(inventoryPublishJobs)
          .where(eq(inventoryPublishJobs.activeEnterpriseId, enterpriseId))
          .limit(1)
      )[0];
      if (active) throw new Error("当前企业已有一键发布任务，请等待完成或先取消该任务");
      await tx
        .update(inventoryPublishJobs)
        .set({
          activeEnterpriseId: enterpriseId,
          status: "queued",
          leaseOwner: null,
          leaseExpiresAt: null,
          attemptCount: 0,
          errorMessage: null,
          finishedAt: null,
        })
        .where(eq(inventoryPublishJobs.id, jobId));
      return toPublicJob({
        ...job,
        activeEnterpriseId: enterpriseId,
        status: "queued",
        leaseOwner: null,
        leaseExpiresAt: null,
        attemptCount: 0,
        errorMessage: null,
        finishedAt: null,
      });
    });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "ER_DUP_ENTRY") {
      throw new Error("当前企业已有一键发布任务，请等待完成或先取消该任务");
    }
    throw error;
  }
}

export async function cancelInventoryPublishJob(jobId: string, enterpriseId: number) {
  const database = await getDb();
  requireDatabase(database);
  await database
    .update(inventoryPublishJobs)
    .set({
      status: "cancelled",
      activeEnterpriseId: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(inventoryPublishJobs.id, jobId),
        eq(inventoryPublishJobs.enterpriseId, enterpriseId),
        inArray(inventoryPublishJobs.status, [...ACTIVE_STATUSES]),
      ),
    );
  return getInventoryPublishJob(jobId, enterpriseId);
}

export async function claimNextInventoryPublishJob(workerId = workerInstanceId) {
  if (isInventoryQuotaDeploymentBusy()) return null;
  const database = await getDb();
  requireDatabase(database);
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
  return database.transaction(async tx => {
    const candidate = (
      await tx
        .select()
        .from(inventoryPublishJobs)
        .where(
          or(
            eq(inventoryPublishJobs.status, "queued"),
            and(
              eq(inventoryPublishJobs.status, "running"),
              or(isNull(inventoryPublishJobs.leaseExpiresAt), lte(inventoryPublishJobs.leaseExpiresAt, now)),
            ),
          ),
        )
        .orderBy(asc(inventoryPublishJobs.createdAt))
        .limit(1)
        .for("update")
    )[0];
    if (!candidate) return null;
    await tx
      .update(inventoryPublishJobs)
      .set({
        status: "running",
        leaseOwner: workerId,
        leaseExpiresAt,
        heartbeatAt: now,
        startedAt: candidate.startedAt ?? now,
        errorMessage: null,
      })
      .where(eq(inventoryPublishJobs.id, candidate.id));
    return { ...candidate, status: "running" as const, leaseOwner: workerId, leaseExpiresAt };
  });
}

async function actorCanStillPublish(job: InventoryPublishJob): Promise<boolean> {
  const database = await getDb();
  requireDatabase(database);
  const rows = await database
    .select({
      role: enterpriseMembers.role,
      status: enterpriseMembers.status,
      inventoryDataScope: enterpriseMembers.inventoryDataScope,
      superAdminUserId: enterprises.superAdminUserId,
      permissionKey: enterpriseMemberPermissions.permissionKey,
    })
    .from(enterpriseMembers)
    .innerJoin(enterprises, eq(enterprises.id, enterpriseMembers.enterpriseId))
    .leftJoin(
      enterpriseMemberPermissions,
      eq(enterpriseMemberPermissions.enterpriseMemberId, enterpriseMembers.id),
    )
    .where(
      and(
        eq(enterpriseMembers.enterpriseId, job.enterpriseId),
        eq(enterpriseMembers.userId, job.createdByUserId),
      ),
    );
  if (rows.length === 0 || rows[0].status !== "active") return false;
  const isOwner = rows[0].role === "super_admin" || rows[0].superAdminUserId === job.createdByUserId;
  if (!isOwner && job.scopeOwnerUserId === null && rows[0].inventoryDataScope !== "enterprise") {
    return false;
  }
  return isOwner || rows.some(row => row.permissionKey === "inventory.publish");
}

type PublishFailure = {
  id: number;
  partNumber: string;
  code: string;
  message: string;
  fields: string[];
};

function groupFailuresByCode(failures: readonly PublishFailure[]) {
  const groups = new Map<string, PublishFailure[]>();
  for (const failure of failures) {
    const key = `${failure.code}:${failure.message}:${failure.fields.join(",")}`;
    groups.set(key, [...(groups.get(key) ?? []), failure]);
  }
  return Array.from(groups.values());
}

export async function processInventoryPublishBatch(
  claimedJob: InventoryPublishJob,
  workerId = workerInstanceId,
  batchSize = INVENTORY_PUBLISH_WORKER_BATCH_SIZE,
) {
  const database = await getDb();
  requireDatabase(database);
  if (await availableMemoryBytes() < MIN_AVAILABLE_MEMORY_BYTES) {
    const [pauseResult] = await database
      .update(inventoryPublishJobs)
      .set({ status: "paused", leaseOwner: null, leaseExpiresAt: null, errorMessage: "服务器可用内存不足，任务已自动暂停" })
      .where(activePublishLeaseCondition(claimedJob.id, workerId));
    return {
      processed: 0,
      success: 0,
      errors: 0,
      duplicates: 0,
      paused: affectedRows(pauseResult) === 1,
      completed: false,
    } as const;
  }

  const current = (
    await database
      .select()
      .from(inventoryPublishJobs)
      .where(activePublishLeaseCondition(claimedJob.id, workerId))
      .limit(1)
  )[0];
  if (!current || current.status !== "running" || current.leaseOwner !== workerId) {
    return { processed: 0, success: 0, errors: 0, duplicates: 0, paused: false, completed: false } as const;
  }
  if (!(await actorCanStillPublish(current))) {
    const [permissionResult] = await database
      .update(inventoryPublishJobs)
      .set({
        status: "failed",
        activeEnterpriseId: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        errorMessage: "任务创建人的库存发布权限已失效",
        finishedAt: new Date(),
      })
      .where(activePublishLeaseCondition(current.id, workerId));
    return {
      processed: 0,
      success: 0,
      errors: 0,
      duplicates: 0,
      paused: false,
      completed: affectedRows(permissionResult) === 1,
    } as const;
  }

  const result = await withInventoryPublisherLock(
    current.dataOwnerUserId,
    current.enterpriseId,
    () => database.transaction(async tx => {
      const freshJob = (
        await tx
          .select()
          .from(inventoryPublishJobs)
          .where(eq(inventoryPublishJobs.id, current.id))
          .limit(1)
          .for("update")
      )[0];
      if (
        !freshJob
        || freshJob.status !== "running"
        || freshJob.leaseOwner !== workerId
        || !freshJob.leaseExpiresAt
        || freshJob.leaseExpiresAt.getTime() <= Date.now()
      ) {
        return { processed: 0, success: 0, errors: 0, duplicates: 0, paused: false, completed: false };
      }

      const enterprise = (
        await tx
          .select({ superAdminUserId: enterprises.superAdminUserId })
          .from(enterprises)
          .where(eq(enterprises.id, freshJob.enterpriseId))
          .limit(1)
          .for("update")
      )[0];
      const jobMemberIds = Array.from(new Set([freshJob.createdByUserId, ...(freshJob.scopeOwnerUserId ? [freshJob.scopeOwnerUserId] : [])])).sort((a, b) => a - b);
      const jobMembers = (
        await tx
          .select({
            id: enterpriseMembers.id,
            userId: enterpriseMembers.userId,
            role: enterpriseMembers.role,
            status: enterpriseMembers.status,
            inventoryDataScope: enterpriseMembers.inventoryDataScope,
          })
          .from(enterpriseMembers)
          .where(
            and(
              eq(enterpriseMembers.enterpriseId, freshJob.enterpriseId),
              inArray(enterpriseMembers.userId, jobMemberIds),
            ),
          )
          .orderBy(asc(enterpriseMembers.userId))
          .for("update")
      );
      const member = jobMembers.find(row => row.userId === freshJob.createdByUserId);
      const scopeOwnerActive = !freshJob.scopeOwnerUserId || jobMembers.some(row => row.userId === freshJob.scopeOwnerUserId && row.status === "active");
      const isOwner = Boolean(
        member
        && (member.role === "super_admin" || enterprise?.superAdminUserId === freshJob.createdByUserId),
      );
      const permissionRows = member && member.role !== "super_admin"
        ? await tx
            .select({ permissionKey: enterpriseMemberPermissions.permissionKey })
            .from(enterpriseMemberPermissions)
            .where(eq(enterpriseMemberPermissions.enterpriseMemberId, member.id))
            .for("update")
        : [];
      const permissionActive = Boolean(
        member
        && member.status === "active"
        && scopeOwnerActive
        && (freshJob.scopeOwnerUserId !== null || isOwner || member.inventoryDataScope === "enterprise")
        && (
          isOwner
          || permissionRows.some(row => row.permissionKey === "inventory.publish")
        ),
      );
      if (!permissionActive) {
        const [permissionResult] = await tx
          .update(inventoryPublishJobs)
          .set({
            status: "failed",
            activeEnterpriseId: null,
            leaseOwner: null,
            leaseExpiresAt: null,
            errorMessage: "任务创建人的库存发布权限已失效",
            finishedAt: new Date(),
          })
          .where(activePublishLeaseCondition(freshJob.id, workerId));
        return {
          processed: 0,
          success: 0,
          errors: 0,
          duplicates: 0,
          paused: false,
          completed: affectedRows(permissionResult) === 1,
        };
      }

      const effectiveBatchSize = Math.min(Math.max(batchSize, 1), INVENTORY_PUBLISH_WORKER_BATCH_SIZE);
      const rows = await tx
        .select({
          id: inventories.id,
          partNumber: inventories.partNumber,
          partNumberNormalized: inventories.partNumberNormalized,
          leadTime: inventories.leadTime,
          qtyOnSale: inventories.qtyOnSale,
          qtyOrder: inventories.qtyOrder,
        })
        .from(inventories, { forceIndex: "inventories_user_status_id_idx" })
        .where(
          and(
            eq(inventories.userId, freshJob.dataOwnerUserId),
            eq(inventories.enterpriseId, freshJob.enterpriseId),
            freshJob.scopeOwnerUserId
              ? eq(inventories.ownerUserId, freshJob.scopeOwnerUserId)
              : undefined,
            eq(inventories.status, "draft"),
            gt(inventories.id, freshJob.lastInventoryId),
            lte(inventories.id, freshJob.maxInventoryId),
          ),
        )
        .orderBy(asc(inventories.id))
        .limit(effectiveBatchSize)
        .for("update");

      if (rows.length === 0) {
        const skipped = Math.max(0, freshJob.totalRows - freshJob.processedRows);
        const [completionResult] = await tx
          .update(inventoryPublishJobs)
          .set({
            status: "completed",
            activeEnterpriseId: null,
            processedRows: freshJob.totalRows,
            errorRows: sql`${inventoryPublishJobs.errorRows} + ${skipped}`,
            skippedRows: sql`${inventoryPublishJobs.skippedRows} + ${skipped}`,
            leaseOwner: null,
            leaseExpiresAt: null,
            heartbeatAt: new Date(),
            finishedAt: new Date(),
          })
          .where(activePublishLeaseCondition(freshJob.id, workerId));
        if (affectedRows(completionResult) !== 1) {
          throw new Error("发布任务租约已失效");
        }
        return { processed: skipped, success: 0, errors: skipped, duplicates: 0, paused: false, completed: true };
      }

      const failures: PublishFailure[] = [];
      const candidates: Array<(typeof rows)[number] & { partNumberNormalized: string }> = [];
      const seen = new Set<string>();
      for (const row of rows) {
        const partNumberNormalized = row.partNumberNormalized
          ?? row.partNumber.normalize("NFKC").trim().toUpperCase();
        if (!row.leadTime?.trim()) {
          failures.push({ id: row.id, partNumber: row.partNumber, code: "MISSING_LEAD_TIME", message: "请先填写货期后再发布", fields: ["leadTime"] });
        } else if (!canPublishInventoryAvailability(row)) {
          failures.push({ id: row.id, partNumber: row.partNumber, code: "INVALID_QUANTITY", message: "请填写现货库存或订货库存后再发布", fields: ["qtyOnSale"] });
        } else if (seen.has(partNumberNormalized)) {
          failures.push({ id: row.id, partNumber: row.partNumber, code: "DUPLICATE_PART_NUMBER", message: "该企业已有相同型号的已发布库存，或任务内型号重复", fields: ["partNumber"] });
        } else {
          seen.add(partNumberNormalized);
          candidates.push({ ...row, partNumberNormalized });
        }
      }

      const existingPublished = candidates.length > 0
        ? await tx
            .select({ partNumberNormalized: inventories.partNumberNormalized })
            .from(inventories)
            .where(
              and(
                eq(inventories.userId, freshJob.dataOwnerUserId),
            eq(inventories.enterpriseId, freshJob.enterpriseId),
                eq(inventories.status, "published"),
                inArray(inventories.partNumberNormalized, candidates.map(row => row.partNumberNormalized)),
              ),
            )
        : [];
      const existingPartNumbers = new Set(existingPublished.map(row => row.partNumberNormalized));
      const uniqueCandidates = candidates.filter(row => {
        if (!existingPartNumbers.has(row.partNumberNormalized)) return true;
        failures.push({ id: row.id, partNumber: row.partNumber, code: "DUPLICATE_PART_NUMBER", message: "您已发布相同产品，请勿重复发布，如有更改请在下架编辑后重新发布", fields: ["partNumber"] });
        return false;
      });

      const quota = await getInventoryQuota(tx, {
        enterpriseId: freshJob.enterpriseId,
        dataOwnerUserId: freshJob.dataOwnerUserId,
      }, { lockEnterprise: true });
      const publishedLimitMessage = inventoryPublishedLimitMessage(quota.publishedRowLimit);
      const [publishedSummary] = await tx
        .select({ count: sql<number>`COUNT(*)` })
        .from(inventories)
        .where(
          and(
            eq(inventories.userId, freshJob.dataOwnerUserId),
            eq(inventories.enterpriseId, freshJob.enterpriseId),
            eq(inventories.status, "published"),
          ),
        );
      const availableSlots = Math.max(
        0,
        quota.publishedRowLimit - Number(publishedSummary?.count ?? 0),
      );
      const publishable = uniqueCandidates.slice(0, availableSlots);
      for (const row of uniqueCandidates.slice(availableSlots)) {
        failures.push({
          id: row.id,
          partNumber: row.partNumber,
          code: "PUBLISHED_LIMIT_REACHED",
          message: publishedLimitMessage,
          fields: [],
        });
      }

      const now = new Date();
      if (publishable.length > 0) {
        await tx
          .update(inventories)
          .set({
            status: "published",
            publishedAt: now,
            offshelfBy: null,
            offshelfReason: null,
            publishErrorCode: null,
            publishErrorMessage: null,
            publishErrorFields: null,
            publishFailedAt: null,
            publishAttemptedByUserId: freshJob.createdByUserId,
            publishAttemptCount: 0,
          })
          .where(
            and(
              inArray(inventories.id, publishable.map(row => row.id)),
              eq(inventories.userId, freshJob.dataOwnerUserId),
            eq(inventories.enterpriseId, freshJob.enterpriseId),
              eq(inventories.status, "draft"),
            ),
          );
      }

      for (const group of groupFailuresByCode(failures)) {
        const sample = group[0];
        await tx
          .update(inventories)
          .set({
            publishErrorCode: sample.code,
            publishErrorMessage: sample.message.slice(0, 255),
            publishErrorFields: sample.fields,
            publishFailedAt: now,
            publishAttemptedByUserId: freshJob.createdByUserId,
            publishAttemptCount: sql`${inventories.publishAttemptCount} + 1`,
          })
          .where(
            and(
              inArray(inventories.id, group.map(row => row.id)),
              eq(inventories.userId, freshJob.dataOwnerUserId),
            eq(inventories.enterpriseId, freshJob.enterpriseId),
              eq(inventories.status, "draft"),
            ),
          );
      }
      if (failures.length > 0) {
        await tx
          .insert(inventoryPublishJobErrors)
          .values(
            failures.map(failure => ({
              jobId: freshJob.id,
              inventoryId: failure.id,
              partNumber: failure.partNumber,
              errorCode: failure.code,
              errorMessage: failure.message.slice(0, 255),
            })),
          )
          .onDuplicateKeyUpdate({
            set: {
              errorCode: sql`VALUES(${inventoryPublishJobErrors.errorCode})`,
              errorMessage: sql`VALUES(${inventoryPublishJobErrors.errorMessage})`,
            },
          });
      }

      const processed = rows.length;
      const duplicateRows = failures.filter(failure => failure.code === "DUPLICATE_PART_NUMBER").length;
      const lastInventoryId = rows[rows.length - 1].id;
      const completed = rows.length < effectiveBatchSize
        || lastInventoryId >= freshJob.maxInventoryId;
      const unaccountedAtEnd = completed
        ? Math.max(0, freshJob.totalRows - freshJob.processedRows - processed)
        : 0;
      const [progressResult] = await tx
        .update(inventoryPublishJobs)
        .set({
          status: completed ? "completed" : "running",
          activeEnterpriseId: completed ? null : freshJob.enterpriseId,
          processedRows: sql`${inventoryPublishJobs.processedRows} + ${processed + unaccountedAtEnd}`,
          successRows: sql`${inventoryPublishJobs.successRows} + ${publishable.length}`,
          errorRows: sql`${inventoryPublishJobs.errorRows} + ${failures.length + unaccountedAtEnd}`,
          duplicateRows: sql`${inventoryPublishJobs.duplicateRows} + ${duplicateRows}`,
          skippedRows: sql`${inventoryPublishJobs.skippedRows} + ${unaccountedAtEnd}`,
          lastInventoryId,
          leaseOwner: completed ? null : workerId,
          leaseExpiresAt: completed ? null : new Date(Date.now() + LEASE_MS),
          heartbeatAt: now,
          finishedAt: completed ? now : null,
        })
        .where(activePublishLeaseCondition(freshJob.id, workerId));
      if (affectedRows(progressResult) !== 1) {
        throw new Error("发布任务租约已失效");
      }
      return {
        processed: processed + unaccountedAtEnd,
        success: publishable.length,
        errors: failures.length + unaccountedAtEnd,
        duplicates: duplicateRows,
        paused: false,
        completed,
      };
    }),
  );

  return result;
}

export async function recordInventoryPublishFailure(
  jobId: string,
  workerId: string,
  error: unknown,
) {
  const database = await getDb();
  requireDatabase(database);
  const rawMessage = error instanceof Error ? error.message : "";
  const errorCode = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const retryable = /库存发布操作繁忙/.test(rawMessage) || new Set([
    "EAI_AGAIN",
    "ECONNREFUSED",
    "ECONNRESET",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "ETIMEDOUT",
    "PROTOCOL_CONNECTION_LOST",
    "ER_CON_COUNT_ERROR",
    "ER_LOCK_DEADLOCK",
    "ER_LOCK_WAIT_TIMEOUT",
    "ER_SERVER_SHUTDOWN",
    "ER_TOO_MANY_USER_CONNECTIONS",
  ]).has(errorCode);
  await database.transaction(async tx => {
    const leaseCheckAt = new Date();
    const current = (
      await tx
        .select({ attemptCount: inventoryPublishJobs.attemptCount })
        .from(inventoryPublishJobs)
        .where(activePublishLeaseCondition(jobId, workerId, leaseCheckAt))
        .limit(1)
        .for("update")
    )[0];
    if (!current) return;
    const attempts = retryable ? current.attemptCount : current.attemptCount + 1;
    const terminal = attempts >= MAX_ATTEMPTS;
    const [failureResult] = await tx
      .update(inventoryPublishJobs)
      .set({
        attemptCount: attempts,
        status: terminal ? "failed" : "queued",
        activeEnterpriseId: terminal ? null : undefined,
        leaseOwner: null,
        leaseExpiresAt: null,
        errorMessage: terminal
          ? "后台发布连续失败，请点击“重试剩余库存”或联系平台管理员"
          : retryable
            ? "系统暂时繁忙，任务正在自动排队重试"
            : "任务处理失败，系统将自动重试",
        finishedAt: terminal ? new Date() : null,
      })
      .where(activePublishLeaseCondition(jobId, workerId, leaseCheckAt));
    if (affectedRows(failureResult) !== 1) {
      throw new Error("发布任务租约已失效");
    }
  });
}

export async function cleanupExpiredInventoryPublishHistory(now = new Date(), retentionDays = 30) {
  const database = await getDb();
  requireDatabase(database);
  const safeDays = Math.min(Math.max(Math.trunc(retentionDays), 7), 365);
  const cutoff = new Date(now.getTime() - safeDays * 24 * 60 * 60 * 1000);
  const expired = await database
    .select({ id: inventoryPublishJobs.id })
    .from(inventoryPublishJobs)
    .where(
      and(
        inArray(inventoryPublishJobs.status, [...TERMINAL_STATUSES]),
        lte(inventoryPublishJobs.finishedAt, cutoff),
      ),
    )
    .orderBy(asc(inventoryPublishJobs.finishedAt))
    .limit(20);
  const jobIds = expired.map(job => job.id);
  if (jobIds.length === 0) return 0;
  await database.transaction(async tx => {
    await tx.delete(inventoryPublishJobErrors).where(inArray(inventoryPublishJobErrors.jobId, jobIds));
    await tx.delete(inventoryPublishJobs).where(inArray(inventoryPublishJobs.id, jobIds));
  });
  return jobIds.length;
}

export function inventoryPublishWorkerId(): string {
  return workerInstanceId;
}

export function isTerminalInventoryPublishStatus(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}
