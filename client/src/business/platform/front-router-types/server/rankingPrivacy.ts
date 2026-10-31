/**
 * 排名内部字段剥离。
 *
 * 背景：搜索接口原先把 `rankingScore`（排名总分）与 `rankingComponents`
 * （价格/新鲜度/成交/入驻各项得分明细）随每条结果下发给客户端。
 *
 * 为什么必须移除：
 * 这两个字段等于把平台排序算法的权重公开。抓取几百条结果做回归，
 * 就能反推出各因子占比，进而针对性刷分 —— 例如发现新鲜度值 20 分，
 * 就写脚本定时刷新库存；发现价格占 50 分，就挂极低价引流款冲排名。
 * 排序公平性是 B2B 平台的核心机制，被逆推后认真经营的商家先受损。
 *
 * 为什么可以安全移除：
 * 排序在服务端完成（SQL ORDER BY + 应用层多样性重排），
 * 客户端只按返回顺序渲染。client/ 全目录对这两个字段零引用。
 *
 * 为什么放在路由层而不是删掉数据层字段：
 * `rankingScore` 参与 SQL 排序，`rankingComponents` 用于生成
 * 「明价优势」「近期刷新」等推荐理由，数据层仍然需要它们。
 * 因此保留内部计算，只在对外响应处剥离 —— 服务端排查排序问题、
 * 管理后台分析时仍可取到完整数据。
 */

/** 对外响应中必须剥离的排名内部字段 */
export const RANKING_INTERNAL_FIELDS = ["rankingScore", "rankingComponents"] as const;

type WithRankingInternals = {
  rankingScore?: unknown;
  rankingComponents?: unknown;
};

/**
 * 剥离单条搜索结果中的排名内部字段。
 *
 * 用解构剔除而非 `delete`：入参可能被上层复用（例如推荐理由已在
 * 数据层基于这些分值算好），原地删除会造成难以定位的副作用。
 */
export function stripRankingInternals<T extends WithRankingInternals>(
  row: T,
): Omit<T, "rankingScore" | "rankingComponents"> {
  const { rankingScore: _score, rankingComponents: _components, ...rest } = row;
  return rest;
}

/** 批量剥离（搜索结果列表） */
export function stripRankingInternalsFromList<T extends WithRankingInternals>(
  rows: T[],
): Array<Omit<T, "rankingScore" | "rankingComponents">> {
  return rows.map(stripRankingInternals);
}
