/** 兼容旧客户端的同步接口上限；新页面不再用它拆整份文件。 */
export const INVENTORY_BATCH_IMPORT_LIMIT = 500;

/** 异步任务上传暂存数据时的单请求上限。 */
export const INVENTORY_IMPORT_STAGE_BATCH_SIZE = 500;

/** 单个异步任务的硬上限，避免错误文件无限占用数据库。 */
export const INVENTORY_IMPORT_JOB_ROW_LIMIT = 100_000;

/** worker单个短事务最多处理的暂存行数。 */
export const INVENTORY_IMPORT_WORKER_BATCH_SIZE = 300;

/** 导出未导入行时单次查询上限，避免一次把全部失败行装进内存。 */
export const INVENTORY_IMPORT_ERROR_PAGE_SIZE = 500;

/** 企业每个北京时间自然日允许创建的总行数，管理员可通过环境变量进一步收紧。 */
export const INVENTORY_IMPORT_DEFAULT_DAILY_ROW_LIMIT = 100_000;

/** 企业专属每日导入额度允许配置的绝对上界；单 job/file 上限仍为 100,000。 */
export const INVENTORY_IMPORT_DAILY_ROW_LIMIT_MAX = 300_000;

/** 创建后一直没有收到任何数据的空任务，15分钟后自动取消。 */
export const INVENTORY_IMPORT_EMPTY_STAGING_TTL_MS = 15 * 60 * 1000;

/** 已上传部分数据的任务保留24小时，允许用户重新选择原文件断点续传。 */
export const INVENTORY_IMPORT_PARTIAL_STAGING_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * 将任意数量库存拆成安全请求批次。
 *
 * 新异步流程用本函数把解析结果分批写入暂存表，不直接写正式库存。
 * 该函数不丢弃任何行。
 */
export function splitInventoryImportBatches<T>(
  rows: readonly T[],
  batchSize = INVENTORY_BATCH_IMPORT_LIMIT,
): T[][] {
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error("库存导入批次大小必须为正整数");
  }
  const batches: T[][] = [];
  for (let start = 0; start < rows.length; start += batchSize) {
    batches.push(rows.slice(start, start + batchSize));
  }
  return batches;
}
