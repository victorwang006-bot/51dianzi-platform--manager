-- 导出 120 组重复明细（只读）。列别名避开 MySQL 保留字（AS/IS 等）。
SELECT
  pn                AS partNumber,
  aNo               AS keepMaterialNo,
  aLifecycle        AS keepLifecycle,
  aStatus           AS keepStatus,
  aImgs             AS keepImgCount,
  CASE WHEN aDs IS NOT NULL AND aDs <> '' THEN 'Y' ELSE 'N' END AS keepDatasheet,
  aSpecs            AS keepSpecKeys,
  bNo               AS obsoleteMaterialNo,
  bLifecycle        AS obsoleteLifecycle,
  bStatus           AS obsoleteStatus,
  bImgs             AS obsoleteImgCount,
  CASE WHEN bDs IS NOT NULL AND bDs <> '' THEN 'Y' ELSE 'N' END AS obsoleteDatasheet,
  bSpecs            AS obsoleteSpecKeys
FROM _work_st_dup
ORDER BY pn;
