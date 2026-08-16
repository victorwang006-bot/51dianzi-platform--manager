-- ============================================================================
-- EXT- 外部物料纳入 51E- 编码体系 —— 前置勘察（只读）
--
-- 59.9 万条批量改编码是不可逆的高风险操作，动手前必须先答清 6 个问题：
--   1. 待纳编总量、materialNo 字段容量是否够
--   2. 流水号从哪开始、终值是否溢出 8 位
--   3. EXT- 内部是否存在同型号重复（纳编前必须先去重，否则把脏数据洗成正式编码）
--   4. EXT- 与已有 51E- 撞型号的规模（120 组只是有图的那批，实际可能更多）
--   5. 前台库存/别名表是否引用 EXT- 编码（决定要不要同步改引用）
--   6. materialCode 字段长度限制（inventories.materialCode 仅 varchar(12)）
-- ============================================================================

SELECT '=== Q1. 待纳编总量与编码现状 ===' AS step;
SELECT
  SUM(materialNo LIKE 'EXT-%')  AS ext_count,
  SUM(materialNo LIKE '51E-%')  AS e51_count,
  SUM(materialNo NOT LIKE 'EXT-%' AND materialNo NOT LIKE '51E-%') AS other_count,
  COUNT(*) AS total
FROM materials;

SELECT '--- 其他编码前缀的样子 ---' AS step;
SELECT LEFT(materialNo, 8) AS prefix, COUNT(*) AS cnt
FROM materials
WHERE materialNo NOT LIKE 'EXT-%' AND materialNo NOT LIKE '51E-%'
GROUP BY prefix ORDER BY cnt DESC LIMIT 10;

SELECT '=== Q2. 流水号与溢出风险 ===' AS step;
SELECT sequenceKey, nextValue, updatedAt FROM material_number_sequences;

SELECT '--- 现有 51E- 最大流水 / 纳编后终值 / 8位上限 ---' AS step;
SELECT
  MAX(CAST(SUBSTRING(materialNo, 5) AS UNSIGNED)) AS current_max_seq,
  MAX(CAST(SUBSTRING(materialNo, 5) AS UNSIGNED))
    + (SELECT COUNT(*) FROM materials WHERE materialNo LIKE 'EXT-%') AS projected_end_seq,
  99999999 AS max_capacity_8digit
FROM materials WHERE materialNo LIKE '51E-%';

SELECT '=== Q3. EXT- 内部同型号重复（纳编前必须先处理）===' AS step;
SELECT
  COUNT(*) AS dup_pn_groups,
  SUM(cnt) AS rows_involved,
  MAX(cnt) AS max_rows_in_one_group
FROM (
  SELECT UPPER(partNumber) AS upn, COUNT(*) AS cnt
  FROM materials WHERE materialNo LIKE 'EXT-%'
  GROUP BY upn HAVING COUNT(*) > 1
) t;

SELECT '--- 重复最严重的 5 个型号 ---' AS step;
SELECT UPPER(partNumber) AS upn, COUNT(*) AS cnt
FROM materials WHERE materialNo LIKE 'EXT-%'
GROUP BY upn ORDER BY cnt DESC LIMIT 5;

SELECT '=== Q4. EXT- 与 51E- 撞型号的全量规模 ===' AS step;
SELECT COUNT(*) AS ext_rows_colliding_with_51e
FROM materials e
WHERE e.materialNo LIKE 'EXT-%'
  AND EXISTS (
    SELECT 1 FROM materials p
    WHERE p.materialNo LIKE '51E-%'
      AND UPPER(p.partNumber) = UPPER(e.partNumber)
  );

SELECT '=== Q5. EXT- 编码是否被业务引用 ===' AS step;
SELECT
  (SELECT COUNT(*) FROM dianzi51.inventories WHERE materialCode LIKE 'EXT-%') AS inv_ref_ext,
  (SELECT COUNT(*) FROM dianzi51.inventories WHERE materialCode LIKE '51E-%') AS inv_ref_51e,
  (SELECT COUNT(*) FROM dianzi51.inventories
     WHERE materialCode IS NOT NULL AND materialCode <> ''
       AND materialCode NOT LIKE 'EXT-%' AND materialCode NOT LIKE '51E-%') AS inv_ref_other,
  (SELECT COUNT(*) FROM dianzi51.inventories) AS inv_total;

SELECT '--- 别名表现状 ---' AS step;
SELECT COUNT(*) AS alias_total,
       SUM(aliasCode LIKE 'EXT-%') AS alias_from_ext,
       SUM(aliasCode LIKE 'MAT%')  AS alias_from_mat
FROM material_code_aliases;

SELECT '=== Q6. 字段容量 ===' AS step;
SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
FROM information_schema.COLUMNS
WHERE (TABLE_SCHEMA = 'dianzi51_admin' AND TABLE_NAME IN ('materials','material_code_aliases')
       AND COLUMN_NAME IN ('materialNo','partNumber','aliasCode','materialCode'))
   OR (TABLE_SCHEMA = 'dianzi51' AND TABLE_NAME = 'inventories' AND COLUMN_NAME IN ('materialCode','partNumber'))
ORDER BY TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME;

SELECT '=== Q7. EXT- 样例 ===' AS step;
SELECT materialNo, partNumber, brand, category, lifecycle, status
FROM materials WHERE materialNo LIKE 'EXT-%' ORDER BY id LIMIT 5;
