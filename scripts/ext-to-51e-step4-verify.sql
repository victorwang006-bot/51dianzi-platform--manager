-- ============================================================================
-- EXT- 纳入 51E- 编码体系 —— 第 4 阶段：更新流水号 + 全量校验
-- ============================================================================

-- ─── 4.1 更新流水号表 ───────────────────────────────────────────────────────
UPDATE material_number_sequences
SET nextValue = (SELECT MAX(newSeq) + 1 FROM _work_ext_codemap)
WHERE sequenceKey = 'platform_material';

SELECT '=== 4.1 流水号表 ===' AS step;
SELECT sequenceKey, nextValue, updatedAt FROM material_number_sequences;

-- ─── 4.2 编码体系完整性 ─────────────────────────────────────────────────────
SELECT '=== 4.2 编码分布（EXT- 应为 0，51E- 应为 610721）===' AS step;
SELECT
  SUM(materialNo LIKE '51E-%') AS e51_count,
  SUM(materialNo LIKE 'EXT-%') AS ext_remaining,
  SUM(materialNo NOT LIKE '51E-%' AND materialNo NOT LIKE 'EXT-%') AS other,
  COUNT(*) AS total
FROM materials;

SELECT '--- 4.2 编码唯一性（重复应为 0）---' AS step;
SELECT COUNT(*) AS dup_materialNo FROM (
  SELECT materialNo FROM materials GROUP BY materialNo HAVING COUNT(*) > 1
) t;

SELECT '--- 4.2 编码格式合规（不合规应为 0）---' AS step;
SELECT COUNT(*) AS bad_format FROM materials
WHERE materialNo NOT REGEXP '^51E-[0-9]{8}$';

SELECT '--- 4.2 流水号连续性 ---' AS step;
SELECT MIN(CAST(SUBSTRING(materialNo,5) AS UNSIGNED)) AS min_seq,
       MAX(CAST(SUBSTRING(materialNo,5) AS UNSIGNED)) AS max_seq,
       COUNT(*) AS cnt,
       CASE WHEN MAX(CAST(SUBSTRING(materialNo,5) AS UNSIGNED))
                 - MIN(CAST(SUBSTRING(materialNo,5) AS UNSIGNED)) + 1 = COUNT(*)
            THEN 'OK 无空洞' ELSE ' 存在空洞' END AS verdict
FROM materials WHERE materialNo LIKE '51E-%';

-- ─── 4.3 别名完整性（外部系统可用旧编码反查）────────────────────────────────
SELECT '=== 4.3 别名表分布 ===' AS step;
SELECT aliasType, source, COUNT(*) AS cnt
FROM material_code_aliases GROUP BY aliasType, source ORDER BY cnt DESC;

SELECT '--- 4.3 每条纳编记录都必须有 external 别名（缺失应为 0）---' AS step;
SELECT COUNT(*) AS missing_alias
FROM _work_ext_codemap c
WHERE NOT EXISTS (
  SELECT 1 FROM material_code_aliases a
  WHERE a.materialId = c.id AND a.aliasCode = c.oldNo
);

SELECT '--- 4.3 别名指向正确性抽样（oldNo → newNo）---' AS step;
SELECT a.aliasCode AS old_code, m.materialNo AS new_code, m.partNumber
FROM material_code_aliases a
JOIN materials m ON m.id = a.materialId
WHERE a.source = 'ext-to-51e-2026-08-16'
ORDER BY a.id LIMIT 5;

-- ─── 4.4 图片资产零受损（本次任务的底线要求）────────────────────────────────
SELECT '=== 4.4 464 条封面图完好性（应 464/464 未变）===' AS step;
SELECT COUNT(*) AS cover_unchanged
FROM materials m
JOIN _bak_materials_st_backfill b ON b.id = m.id
WHERE m.coverImageUrl = b.coverImageUrl;

SELECT '--- 4.4 全库有封面图的记录数（应仍为 464）---' AS step;
SELECT COUNT(*) AS total_with_cover FROM materials
WHERE coverImageUrl IS NOT NULL AND coverImageUrl <> '';

-- ─── 4.5 型号字段未被误改 ───────────────────────────────────────────────────
SELECT '=== 4.5 纳编记录的 partNumber 必须一字未动（不符应为 0）===' AS step;
SELECT COUNT(*) AS pn_changed
FROM materials m
JOIN _bak_materials_ext_to51e b ON b.id = m.id
WHERE m.partNumber <> b.partNumber;

-- ─── 4.6 前台库存引用 ───────────────────────────────────────────────────────
SELECT '=== 4.6 前台库存引用完整性 ===' AS step;
SELECT
  (SELECT COUNT(*) FROM dianzi51.inventories WHERE materialCode LIKE '51E-%') AS inv_ref_51e,
  (SELECT COUNT(*) FROM dianzi51.inventories WHERE materialCode LIKE 'EXT-%') AS inv_ref_ext,
  (SELECT COUNT(*) FROM dianzi51.inventories) AS inv_total;

SELECT '--- 4.6 库存引用的编码必须都能在物料库命中（孤儿应为 0）---' AS step;
SELECT COUNT(*) AS orphan_inv
FROM dianzi51.inventories i
WHERE i.materialCode IS NOT NULL AND i.materialCode <> ''
  AND NOT EXISTS (SELECT 1 FROM materials m WHERE m.materialNo = i.materialCode);

-- ─── 4.7 120 组去重结果 ─────────────────────────────────────────────────────
SELECT '=== 4.7 影子记录状态（应 120 条 obsolete/disabled）===' AS step;
SELECT m.lifecycle, m.status, COUNT(*) AS cnt
FROM materials m JOIN _work_ext_shadow w ON w.extId = m.id
GROUP BY m.lifecycle, m.status;

SELECT '--- 4.7 影子记录编码（应仍为 EXT-，未占用正式编码）---' AS step;
SELECT SUM(m.materialNo LIKE 'EXT-%') AS still_ext,
       SUM(m.materialNo LIKE '51E-%') AS became_51e
FROM materials m JOIN _work_ext_shadow w ON w.extId = m.id;

SELECT '--- 4.7 同型号 active 记录唯一性（有图型号不应再有重复 active）---' AS step;
SELECT COUNT(*) AS dup_active_pn FROM (
  SELECT UPPER(partNumber) AS upn FROM materials
  WHERE status = 'enabled' AND partNumber REGEXP '^STM32'
  GROUP BY upn HAVING COUNT(*) > 1
) t;
