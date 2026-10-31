import { sql } from "drizzle-orm";

const DAY_MS = 86_400_000;
const SHANGHAI_OFFSET_MS = 8 * 3_600_000;
export const ROLLING_SEARCH_HEAT_HOURS = 168;

/** Exact elapsed time, not seven calendar dates or a window rounded to an hour. */
export function rollingSearchHeatWindow(now = new Date()) {
  const end = new Date(now.getTime());
  const start = new Date(end.getTime() - ROLLING_SEARCH_HEAT_HOURS * 3_600_000);
  // The full first Beijing day is needed to replay legacy daily actor ordinals.
  const contextStart = new Date(
    Math.floor((start.getTime() + SHANGHAI_OFFSET_MS) / DAY_MS) * DAY_MS - SHANGHAI_OFFSET_MS,
  );
  return { start, end, contextStart };
}

export type RollingSearchHeatRow = {
  partNumber: string;
  searchCount: number;
  weightedSearchCount: number;
  weightedScore: number;
  rollingWeightedScoreMilli: number;
};

/**
 * New events carry their original transactionally computed score, including zero.
 * Only model-days with NULL legacy scores need replay of actor/network rules in
 * (occurredAt,id) order. Eight-day raw retention covers the required day context.
 * Never allocate daily totals uniformly across hours. UNIX_TIMESTAMP makes the
 * Beijing day and elapsed-time bounds independent of the connection timezone.
 */
export function rollingSearchHeatQuery(now: Date, partNumber?: string) {
  const { start, end, contextStart } = rollingSearchHeatWindow(now);
  const partFilter = partNumber ? sql`AND partNumberNormalized = ${partNumber}` : sql``;
  return sql`
    WITH context_events AS (
      SELECT * FROM popular_search_events
       WHERE occurredAt >= FROM_UNIXTIME(${contextStart.getTime() / 1000})
         AND occurredAt < FROM_UNIXTIME(${end.getTime() / 1000})
         ${partFilter}
    ), dated_events AS (
      SELECT *, FLOOR((UNIX_TIMESTAMP(occurredAt) + 28800) / 86400) AS beijingDay
        FROM context_events
    ), actor_ordinals AS (
      SELECT *,
             ROW_NUMBER() OVER (
               PARTITION BY partNumberNormalized, beijingDay, actorHash
               ORDER BY occurredAt, id
             ) AS actorOrdinal,
             ROW_NUMBER() OVER (
               PARTITION BY partNumberNormalized, beijingDay, networkHash, actorHash
               ORDER BY occurredAt, id
             ) AS networkActorOrdinal
        FROM dated_events
    ), network_ordinals AS (
      SELECT *, SUM(CASE WHEN networkActorOrdinal = 1 THEN 1 ELSE 0 END) OVER (
               PARTITION BY partNumberNormalized, beijingDay, networkHash
               ORDER BY occurredAt, id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
             ) AS networkDistinctActors
        FROM actor_ordinals
    ), scored_events AS (
      SELECT partNumberNormalized, occurredAt, COALESCE(weightedScoreMilli,
             (CASE WHEN actorOrdinal = 1 THEN 11 WHEN actorOrdinal = 2 THEN 5
                   WHEN actorOrdinal = 3 THEN 3 WHEN actorOrdinal <= 10 THEN 1 ELSE 0 END)
             * (CASE WHEN networkDistinctActors <= 3 THEN 1000
                     WHEN networkDistinctActors <= 10 THEN 500
                     WHEN networkDistinctActors <= 20 THEN 200 ELSE 0 END)
             ) AS effectiveScoreMilli
        FROM network_ordinals
    )
    SELECT partNumberNormalized AS partNumber,
           COUNT(*) AS searchCount,
           SUM(CASE WHEN effectiveScoreMilli > 0 THEN 1 ELSE 0 END) AS weightedSearchCount,
           SUM(effectiveScoreMilli) AS weightedScore,
           SUM(effectiveScoreMilli) AS rollingWeightedScoreMilli
      FROM scored_events
     WHERE occurredAt >= FROM_UNIXTIME(${start.getTime() / 1000})
       AND occurredAt < FROM_UNIXTIME(${end.getTime() / 1000})
       AND (
         EXISTS (SELECT 1 FROM inventories i
                  WHERE i.partNumberNormalized = scored_events.partNumberNormalized
                    AND i.status = 'published' AND i.qtyOnSale > 0)
         OR EXISTS (SELECT 1 FROM appearance_archives a
                     WHERE a.partNumber = scored_events.partNumberNormalized)
       )
     GROUP BY partNumberNormalized
     HAVING SUM(effectiveScoreMilli) > 0
  `;
}

/** A historical chart point is a 168-hour index at the end of that Beijing day. */
export function rollingDailyTotals(
  rows: ReadonlyArray<{ searchDate: string; weightedScoreMilli: number; weightedSearchCount: number }>,
  dateKey: string,
) {
  const dayEnd = new Date(`${dateKey}T00:00:00+08:00`).getTime() + DAY_MS;
  const firstDate = new Date(dayEnd - 7 * DAY_MS + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
  return rows.reduce((total, row) => {
    if (row.searchDate >= firstDate && row.searchDate <= dateKey) {
      total.weightedScoreMilli += Math.max(0, Number(row.weightedScoreMilli) || 0);
      total.weightedSearchCount += Math.max(0, Number(row.weightedSearchCount) || 0);
    }
    return total;
  }, { weightedScoreMilli: 0, weightedSearchCount: 0 });
}
