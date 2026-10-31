/** 单个企业允许同时在线（published）的库存硬上限。 */
export const INVENTORY_PUBLISHED_ROW_LIMIT = 100_000;

/** 企业专属额度允许配置的绝对上界；无论数据库或调用方传入何值都不得超过此值。 */
export const INVENTORY_PUBLISHED_ROW_LIMIT_MAX = 500_000;

/** 我的库存与待发布列表默认每页条数。 */
export const INVENTORY_LIST_DEFAULT_PAGE_SIZE = 50;

/** 库存列表接口允许的最大每页条数，防止旧客户端请求全量数据。 */
export const INVENTORY_LIST_MAX_PAGE_SIZE = 100;

/** 一键发布后台任务单个短事务最多处理的草稿数。 */
export const INVENTORY_PUBLISH_WORKER_BATCH_SIZE = 300;
