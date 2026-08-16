-- ============================================================================
-- ST 短号型号补全 —— 回滚脚本
--
-- 用途：将 partNumber 恢复为备份表中的原始短号，并还原 lifecycle/status。
-- 前置：_bak_materials_st_backfill 备份表必须存在（由 backfill 脚本创建）。
-- ============================================================================

SELECT '--- 备份表检查 ---' AS step;
SELECT COUNT(*) AS backup_rows FROM _bak_materials_st_backfill;

UPDATE materials m
JOIN _bak_materials_st_backfill b ON b.id = m.id
SET m.partNumber = b.partNumber,
    m.lifecycle  = b.lifecycle,
    m.status     = b.status;

SELECT '回滚完成，受影响行数：' AS step, ROW_COUNT() AS affected;

SELECT '--- 回滚后样例 ---' AS step;
SELECT m.materialNo, m.partNumber, m.lifecycle, m.status, m.coverImageUrl
FROM materials m
JOIN _bak_materials_st_backfill b ON b.id = m.id
ORDER BY m.materialNo LIMIT 5;
