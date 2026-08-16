-- ============================================================================
-- 120 组 ST 重复记录勘察（只读，不做任何写入）
--
-- 目的：补全后 120 个型号各有 2 条记录（新补全的 + 库内原有的）。
--       合并前必须先看清两侧各自持有什么资产，以及哪侧被业务真实引用。
-- ============================================================================

-- 重复组配对表：A=补全而来（有图，在备份表里）B=库内原有
DROP TABLE IF EXISTS _work_st_dup;
CREATE TABLE _work_st_dup (
  pn VARCHAR(128),
  aId INT, aNo VARCHAR(32), aCover VARCHAR(512), aImgs INT, aDs VARCHAR(512),
  aSpecs INT, aLifecycle VARCHAR(16), aStatus VARCHAR(16),
  bId INT, bNo VARCHAR(32), bCover VARCHAR(512), bImgs INT, bDs VARCHAR(512),
  bSpecs INT, bLifecycle VARCHAR(16), bStatus VARCHAR(16),
  INDEX idx_pn (pn), INDEX idx_aNo (aNo), INDEX idx_bNo (bNo)
);

INSERT INTO _work_st_dup
SELECT
  a.partNumber,
  a.id, a.materialNo, a.coverImageUrl, JSON_LENGTH(COALESCE(a.images, JSON_ARRAY())),
  a.datasheetUrl, JSON_LENGTH(COALESCE(a.specs, JSON_OBJECT())), a.lifecycle, a.status,
  b.id, b.materialNo, b.coverImageUrl, JSON_LENGTH(COALESCE(b.images, JSON_ARRAY())),
  b.datasheetUrl, JSON_LENGTH(COALESCE(b.specs, JSON_OBJECT())), b.lifecycle, b.status
FROM materials a
JOIN _bak_materials_st_backfill bak ON bak.id = a.id   -- a 侧 = 本次补全的记录
JOIN materials b ON UPPER(b.partNumber) = UPPER(a.partNumber) AND b.id <> a.id;

SELECT '--- 重复组总数（应为 120）---' AS step;
SELECT COUNT(*) AS dup_pairs, COUNT(DISTINCT pn) AS distinct_pn FROM _work_st_dup;

SELECT '--- 资产分布：两侧各自持有什么 ---' AS step;
SELECT
  SUM(aCover IS NOT NULL AND aCover <> '') AS a_has_cover,
  SUM(bCover IS NOT NULL AND bCover <> '') AS b_has_cover,
  SUM(aImgs > 0) AS a_has_imgs,   SUM(bImgs > 0) AS b_has_imgs,
  SUM(aDs IS NOT NULL AND aDs <> '') AS a_has_datasheet,
  SUM(bDs IS NOT NULL AND bDs <> '') AS b_has_datasheet,
  SUM(aSpecs > 0) AS a_has_specs, SUM(bSpecs > 0) AS b_has_specs
FROM _work_st_dup;

SELECT '--- B 侧编码前缀分布（判断 B 是平台料还是外部料）---' AS step;
SELECT
  CASE WHEN bNo LIKE '51E-%' THEN '51E-（平台正式）'
       WHEN bNo LIKE 'EXT-%' THEN 'EXT-（外部导入）'
       ELSE CONCAT('其他：', LEFT(bNo, 6)) END AS bType,
  COUNT(*) AS cnt
FROM _work_st_dup GROUP BY bType;

SELECT '--- B 侧生命周期/状态分布 ---' AS step;
SELECT bLifecycle, bStatus, COUNT(*) AS cnt FROM _work_st_dup
GROUP BY bLifecycle, bStatus;

SELECT '--- 关键：两侧被前台库存引用的情况 ---' AS step;
SELECT
  SUM(aRef) AS a_referenced_rows, SUM(bRef) AS b_referenced_rows,
  SUM(aRef > 0 AND bRef > 0) AS both_referenced
FROM (
  SELECT d.pn,
    (SELECT COUNT(*) FROM dianzi51.inventories i WHERE i.materialCode = d.aNo) AS aRef,
    (SELECT COUNT(*) FROM dianzi51.inventories i WHERE i.materialCode = d.bNo) AS bRef
  FROM _work_st_dup d
) t;

SELECT '--- 样例 8 组明细 ---' AS step;
SELECT pn, aNo, aImgs AS aI, LEFT(COALESCE(aDs,''),20) AS aDs, aSpecs AS aS,
       bNo, bImgs AS bI, LEFT(COALESCE(bDs,''),20) AS bDs, bSpecs AS bS,
       bLifecycle, bStatus
FROM _work_st_dup ORDER BY pn LIMIT 8;
