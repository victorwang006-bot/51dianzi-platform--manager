-- 型号联想慢的原因诊断（只读，不改任何数据）
--
-- 目标：搞清 ~600ms 耗在哪里，避免凭猜测加索引。
-- 需要分清三种可能：
--   A. 全表扫描（LIKE '%kw%' 前导通配符使索引失效）
--   B. 排序开销（ORDER BY 里含表达式，无法用索引排序）
--   C. 网络/连接开销（与 SQL 无关，加索引也没用）

SELECT '=== 1. 表规模与现有索引 ===' AS section;
SELECT table_rows, ROUND(data_length/1024/1024) AS data_mb,
       ROUND(index_length/1024/1024) AS index_mb
FROM information_schema.tables
WHERE table_schema='dianzi51_admin' AND table_name='materials';

SELECT '=== 2. materials 上的索引 ===' AS section;
SELECT index_name, seq_in_index, column_name, cardinality, index_type
FROM information_schema.statistics
WHERE table_schema='dianzi51_admin' AND table_name='materials'
ORDER BY index_name, seq_in_index;

SELECT '=== 3. partNumber 字段定义与字符集 ===' AS section;
SELECT column_name, column_type, character_set_name, collation_name
FROM information_schema.columns
WHERE table_schema='dianzi51_admin' AND table_name='materials'
  AND column_name IN ('partNumber','status','lifecycle','materialNo');

SELECT '=== 4. 执行计划：当前联想查询（前缀+两侧模糊）===' AS section;
EXPLAIN SELECT id, partNumber, name, brand, category, `package`
FROM materials
WHERE status='enabled' AND (partNumber LIKE 'STM32F103%' OR partNumber LIKE '%STM32F103%')
ORDER BY (partNumber LIKE 'STM32F103%') DESC, partNumber ASC
LIMIT 20;

SELECT '=== 5. 执行计划：仅前缀匹配（对照，应能用索引）===' AS section;
EXPLAIN SELECT id, partNumber FROM materials
WHERE status='enabled' AND partNumber LIKE 'STM32F103%'
ORDER BY partNumber ASC LIMIT 20;

SELECT '=== 6. 执行计划：仅两侧模糊（对照，必然全表）===' AS section;
EXPLAIN SELECT id, partNumber FROM materials
WHERE status='enabled' AND partNumber LIKE '%STM32F103%'
ORDER BY partNumber ASC LIMIT 20;

SELECT '=== 7. 前缀匹配能覆盖多少需求（关键决策依据）===' AS section;
-- 若绝大多数关键词用前缀就能查到，则"仅未命中时才做模糊"的两段式可行
SELECT
  (SELECT COUNT(*) FROM materials WHERE status='enabled' AND partNumber LIKE 'STM32F103%') AS prefix_hits,
  (SELECT COUNT(*) FROM materials WHERE status='enabled' AND partNumber LIKE '%STM32F103%') AS infix_hits;

SELECT '=== 8. status 分布（能否靠 status 索引先缩小范围）===' AS section;
SELECT status, COUNT(*) AS cnt FROM materials GROUP BY status;

SELECT '=== 9. partNumber 长度分布（评估前缀索引长度）===' AS section;
SELECT
  MIN(CHAR_LENGTH(partNumber)) AS min_len,
  MAX(CHAR_LENGTH(partNumber)) AS max_len,
  ROUND(AVG(CHAR_LENGTH(partNumber)),1) AS avg_len
FROM materials;
