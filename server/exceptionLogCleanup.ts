/**
 * 异常日志保留期清理。
 *
 * 保留 30 天（`LOG_RETENTION_DAYS`），超期自动删除。
 *
 * 为什么不用 cron：管理端是单进程 PM2 服务，进程内定时器足够，
 * 引入外部调度反而增加部署复杂度与失效可能。
 *
 * 注意 PM2 cluster 模式下多实例会各跑一次清理。
 * 这是可接受的：DELETE 幂等，重复执行只会删到 0 条，
 * 不会误删数据，代价仅是一次多余查询。
 */
import { purgeExpiredExceptionLogs } from "./db";
import { LOG_RETENTION_DAYS } from "../shared/exceptionRules";

/** 每 6 小时清理一次。 */
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** 启动后延迟执行，避开服务启动高峰。 */
const INITIAL_DELAY_MS = 5 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;

async function runCleanup(): Promise<void> {
  try {
    const deleted = await purgeExpiredExceptionLogs(LOG_RETENTION_DAYS);
    if (deleted > 0) {
      console.log(
        `[ExceptionLogCleanup] 已清理 ${deleted} 条超过 ${LOG_RETENTION_DAYS} 天的异常日志`,
      );
    }
  } catch (error) {
    // 清理失败不影响服务，下个周期会重试
    console.warn("[ExceptionLogCleanup] 清理失败（将在下个周期重试）:", (error as Error).message);
  }
}

/** 启动定时清理。重复调用安全。 */
export function startExceptionLogCleanup(): void {
  if (timer) return;
  setTimeout(() => {
    void runCleanup();
  }, INITIAL_DELAY_MS).unref?.();
  timer = setInterval(() => {
    void runCleanup();
  }, CLEANUP_INTERVAL_MS);
  timer.unref?.();
}

/** 仅供测试与运维手动触发。 */
export { runCleanup as runExceptionLogCleanupOnce };
