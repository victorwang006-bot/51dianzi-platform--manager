import { sql } from "drizzle-orm";
import { getDb } from "../db";
import type { ChatSyncEventType } from "../../drizzle/schema";
import { pullAdminRepliesForWorker, pushServiceMessageToAdmin } from "./customerService";

/**
 * 客服消息同步队列（transactional outbox）。
 *
 * 前台把"需要同步到管理端"的事件写入 chat_sync_outbox，由 chatSyncWorker
 * 异步领取并投递。这样做的收益是：
 *   1. 管理端故障或网络抖动不会阻塞用户发送消息；
 *   2. 投递失败可按退避重试，不会丢消息；
 *   3. 多个 worker 实例可安全并行（SKIP LOCKED + 租约）。
 */

/** 重试次数上限，超过即标记 dead 不再自动重试。 */
export const CHAT_SYNC_MAX_ATTEMPTS = 8;

/**
 * 各次重试的退避秒数。
 *
 * 前几次快速重试用于跨过瞬时网络抖动；后续拉长到 30 分钟，
 * 避免管理端长时间故障时把队列打成高频空转。
 */
const BACKOFF_SECONDS = [2, 10, 30, 120, 600, 1800, 1800, 1800];

/** 租约超时：投递中任务超过此时长未完成，视为 worker 已崩溃。 */
const LEASE_TIMEOUT_MINUTES = 2;

/** 单批最多领取的任务数上限。 */
const MAX_BATCH_SIZE = 50;

/** 已领取的待投递任务。 */
export type ChatSyncTask = {
  id: number;
  eventKey: string;
  eventType: ChatSyncEventType;
  conversationId: number;
  messageId: number | null;
  attempts: number;
};

/** 一批投递的执行结果统计。 */
export type ChatSyncBatchResult = {
  claimed: number;
  succeeded: number;
  deferred: number;
  dead: number;
};

/** 按已尝试次数计算下次重试的等待秒数。 */
export function getChatSyncRetryDelaySeconds(attempts: number): number {
  const normalizedAttempts = Math.max(1, Math.trunc(attempts));
  return BACKOFF_SECONDS[Math.min(normalizedAttempts - 1, BACKOFF_SECONDS.length - 1)];
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  return db;
}

/**
 * 归一化错误信息以便写入 lastError 列。
 *
 * 折叠空白便于日志检索，截断 1000 字符是因为 lastError 列长度为 varchar(1000)，
 * 超长会直接导致 UPDATE 失败，反而丢掉失败原因。
 */
function cleanError(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return message.replace(/\s+/g, " ").slice(0, 1000);
}

/**
 * 投递一个客服同步事件。
 *
 * eventKey 唯一，因此同一事件重复调用只会入库一次（幂等）。
 * 该函数刻意不抛异常：入队失败不应该阻塞用户发消息这条主链路。
 *
 * @returns 是否新入队了任务
 */
export async function enqueueChatSyncEvent(params: {
  eventKey: string;
  eventType: ChatSyncEventType;
  conversationId: number;
  messageId?: number | null;
}): Promise<boolean> {
  try {
    const db = await requireDb();
    const result = await db.execute(sql`
      INSERT INTO chat_sync_outbox (eventKey, eventType, conversationId, messageId, status, availableAt)
      VALUES (${params.eventKey}, ${params.eventType}, ${params.conversationId},
              ${params.messageId ?? null}, 'pending', NOW())
      ON DUPLICATE KEY UPDATE id = id
    `);
    const header = (result as unknown as [{ insertId?: number }, unknown])[0];
    // 不能用 affectedRows 判断是否新插入：在 ON DUPLICATE KEY UPDATE id = id 下，
    // 驱动层两种情况都返回 1。insertId 才能区分 ——
    // 新插入返回自增主键，幂等命中时返回 0。
    return Number(header.insertId ?? 0) > 0;
  } catch (error) {
    console.error(`[chat-sync] enqueue failed type=${cleanError(error).slice(0, 80)}`);
    return false;
  }
}

/**
 * 回收租约超时的任务。
 *
 * worker 进程被 kill -9 或机器断电时，任务会永久停留在 processing 状态。
 * 这里把超时的任务改回 pending，使其能被重新领取。
 */
export async function recoverStaleChatSyncTasks(): Promise<number> {
  const db = await requireDb();
  const result = await db.execute(sql`
    UPDATE chat_sync_outbox
       SET status = 'pending',
           availableAt = NOW(),
           lockedAt = NULL,
           lockedBy = NULL,
           lastError = '工作进程租约超时，任务已自动恢复',
           updatedAt = NOW()
     WHERE status = 'processing'
       AND lockedAt < DATE_SUB(NOW(), INTERVAL ${LEASE_TIMEOUT_MINUTES} MINUTE)
  `);
  const header = (result as unknown as [{ affectedRows?: number }, unknown])[0];
  return Number(header.affectedRows ?? 0);
}

/**
 * 领取一批待投递任务并加租约。
 *
 * SELECT ... FOR UPDATE SKIP LOCKED 是多实例安全的关键：
 * 其他 worker 正在处理的行会被跳过而非阻塞等待。
 */
export async function claimChatSyncTasks(
  workerId: string,
  limit = 10,
): Promise<ChatSyncTask[]> {
  const db = await requireDb();
  const batchSize = Math.max(1, Math.min(MAX_BATCH_SIZE, Math.trunc(limit)));

  return db.transaction(async tx => {
    const selection = await tx.execute(sql`
      SELECT id
        FROM chat_sync_outbox
       WHERE status = 'pending' AND availableAt <= NOW()
       ORDER BY availableAt ASC, id ASC
       LIMIT ${batchSize}
       FOR UPDATE SKIP LOCKED
    `);
    const selectedRows = (selection as unknown as [Array<{ id: number }>, unknown])[0];
    const ids = selectedRows.map(row => Number(row.id)).filter(Number.isInteger);
    if (ids.length === 0) return [];

    const idList = sql.join(
      ids.map(id => sql`${id}`),
      sql`, `,
    );

    // attempts 在领取时即自增，保证即使 worker 随后崩溃，重试次数也已计数，
    // 不会出现"崩溃导致无限重试"。
    await tx.execute(sql`
      UPDATE chat_sync_outbox
         SET status = 'processing',
             attempts = attempts + 1,
             lockedAt = NOW(),
             lockedBy = ${workerId},
             updatedAt = NOW()
       WHERE id IN (${idList})
    `);

    const claimed = await tx.execute(sql`
      SELECT id, eventKey, eventType, conversationId, messageId, attempts
        FROM chat_sync_outbox
       WHERE id IN (${idList})
         AND status = 'processing'
         AND lockedBy = ${workerId}
       ORDER BY id ASC
    `);
    const claimedRows = (claimed as unknown as [
      Array<{
        id: number;
        eventKey: string;
        eventType: ChatSyncEventType;
        conversationId: number;
        messageId: number | null;
        attempts: number;
      }>,
      unknown,
    ])[0];

    return claimedRows.map(task => ({
      ...task,
      id: Number(task.id),
      conversationId: Number(task.conversationId),
      messageId: task.messageId == null ? null : Number(task.messageId),
      attempts: Number(task.attempts),
    }));
  });
}

/**
 * 标记任务投递成功。
 *
 * WHERE 条件带 lockedBy，确保租约已被他人接管时本次更新不生效，
 * 避免"超时被回收后原 worker 又迟到报成功"造成状态错乱。
 */
export async function completeChatSyncTask(taskId: number, workerId: string): Promise<void> {
  const db = await requireDb();
  await db.execute(sql`
    UPDATE chat_sync_outbox
       SET status = 'succeeded',
           lockedAt = NULL,
           lockedBy = NULL,
           lastError = NULL,
           updatedAt = NOW()
     WHERE id = ${taskId} AND status = 'processing' AND lockedBy = ${workerId}
  `);
}

/**
 * 标记任务投递失败：未达上限则退避重试，否则标记 dead。
 */
export async function failChatSyncTask(
  task: Pick<ChatSyncTask, "id" | "attempts">,
  workerId: string,
  error: unknown,
): Promise<{ dead: boolean; availableAt: Date }> {
  const db = await requireDb();
  const dead = task.attempts >= CHAT_SYNC_MAX_ATTEMPTS;
  const delaySeconds = getChatSyncRetryDelaySeconds(task.attempts);
  const availableAt = new Date(Date.now() + delaySeconds * 1000);

  await db.execute(sql`
    UPDATE chat_sync_outbox
       SET status = ${dead ? "dead" : "pending"},
           availableAt = ${availableAt},
           lockedAt = NULL,
           lockedBy = NULL,
           lastError = ${cleanError(error)},
           updatedAt = NOW()
     WHERE id = ${task.id} AND status = 'processing' AND lockedBy = ${workerId}
  `);

  return { dead, availableAt };
}

/** 按事件类型分派到具体的同步实现。 */
export async function processChatSyncTask(task: ChatSyncTask): Promise<void> {
  if (task.eventType === "push_service_message") {
    if (!task.messageId) throw new Error("客服消息推送任务缺少 messageId");
    await pushServiceMessageToAdmin(task.messageId);
    return;
  }
  if (task.eventType === "pull_service_replies") {
    await pullAdminRepliesForWorker(task.conversationId);
    return;
  }
  // 穷尽检查：新增事件类型但忘记实现时，TypeScript 会在此处报错。
  const exhaustive: never = task.eventType;
  throw new Error(`未知客服同步任务: ${String(exhaustive)}`);
}

/**
 * 执行一批投递：领取、逐个处理、按结果标记。
 *
 * 单个任务失败不影响同批其他任务，各自独立记账。
 */
export async function runChatSyncBatch(
  workerId: string,
  limit = 10,
): Promise<ChatSyncBatchResult> {
  const tasks = await claimChatSyncTasks(workerId, limit);
  let succeeded = 0;
  let deferred = 0;
  let dead = 0;

  for (const task of tasks) {
    try {
      await processChatSyncTask(task);
      await completeChatSyncTask(task.id, workerId);
      succeeded += 1;
    } catch (error) {
      const result = await failChatSyncTask(task, workerId, error);
      if (result.dead) dead += 1;
      else deferred += 1;
    }
  }

  return { claimed: tasks.length, succeeded, deferred, dead };
}
