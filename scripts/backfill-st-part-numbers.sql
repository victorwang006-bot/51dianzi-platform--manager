-- ============================================================================
-- ST 短号型号补全（幂等、可回滚）
--
-- 背景：平台早期批量导入的 464 条 ST 物料，partNumber 被截去尾部 2 位
--       封装+温度等级标识。图片文件名保留了完整型号，据此可精确还原。
--
-- 依据：464 条实测无一例外满足「图片名 = 短号 + 恰好 2 位后缀」，
--       且后缀与 package 字段严格对应（T6=LQFP / U6=UFQFPN / Y6=WLCSP ...）。
--
-- 安全性：
--   1. partNumber 无唯一约束（唯一约束只在 materialNo），改名不会失败
--   2. 图片存 OSS 绝对地址，与型号解耦，改名不影响图片显示
--   3. 前台库存靠 materialCode（51E-）关联，改名不断链
--   4. 执行前先建备份表，可用 rollback-st-part-numbers.sql 一键回滚
--   5. 全部校验前置于 UPDATE，校验不过则不会写入
--
-- 前置条件：图片上传接口的短号回退兼容【必须已部署】，否则运营按旧文档
--           用短号上传图片会报「型号不存在」。
--
-- 注：工作表刻意使用普通表而非 TEMPORARY TABLE——MySQL 不允许同一临时表
--     在一条语句中被引用两次（ERROR 1137），而校验语句需要自连接。
-- ============================================================================

-- ─── 第 1 步：备份 ───────────────────────────────────────────────────────────
DROP TABLE IF EXISTS _bak_materials_st_backfill;
CREATE TABLE _bak_materials_st_backfill AS
SELECT id, materialNo, partNumber, package, coverImageUrl, lifecycle, status,
       NOW() AS backedUpAt
FROM materials
WHERE coverImageUrl IS NOT NULL AND coverImageUrl <> ''
  AND partNumber REGEXP '^STM32';

SELECT '备份完成，行数：' AS step, COUNT(*) AS cnt FROM _bak_materials_st_backfill;

-- ─── 第 2 步：推导完整型号 ───────────────────────────────────────────────────
DROP TABLE IF EXISTS _work_st_backfill;
CREATE TABLE _work_st_backfill (
  id INT PRIMARY KEY,
  oldPn VARCHAR(128),
  newPn VARCHAR(128),
  suffix VARCHAR(8),
  dupExists TINYINT DEFAULT 0,
  INDEX idx_newPn (newPn)
);

INSERT INTO _work_st_backfill (id, oldPn, newPn, suffix)
SELECT
  m.id,
  m.partNumber AS oldPn,
  UPPER(SUBSTRING_INDEX(SUBSTRING_INDEX(m.coverImageUrl, '/', -1), '.', 1)) AS newPn,
  UPPER(SUBSTRING(
    SUBSTRING_INDEX(SUBSTRING_INDEX(m.coverImageUrl, '/', -1), '.', 1),
    CHAR_LENGTH(m.partNumber) + 1
  )) AS suffix
FROM materials m
WHERE m.coverImageUrl IS NOT NULL AND m.coverImageUrl <> ''
  AND m.partNumber REGEXP '^STM32';

-- 标记「完整型号已存在其他记录」的行，供第 3 阶段处理重复
UPDATE _work_st_backfill w
SET dupExists = 1
WHERE EXISTS (
  SELECT 1 FROM materials m2
  WHERE UPPER(m2.partNumber) = w.newPn AND m2.id <> w.id
);

-- ─── 第 3 步：安全校验（不通过则不应继续）───────────────────────────────────
SELECT '--- 校验1：完整型号必须以短号开头（应为 0）---' AS step;
SELECT COUNT(*) AS violation_prefix FROM _work_st_backfill
WHERE newPn NOT LIKE CONCAT(UPPER(oldPn), '%');

SELECT '--- 校验2：多出的后缀必须恰好 2 位（应为 0）---' AS step;
SELECT COUNT(*) AS violation_suffix_len FROM _work_st_backfill
WHERE CHAR_LENGTH(suffix) <> 2;

SELECT '--- 校验3：后缀分布 ---' AS step;
SELECT suffix, COUNT(*) AS cnt FROM _work_st_backfill GROUP BY suffix ORDER BY cnt DESC;

SELECT '--- 校验4：待补全总数 / 完整型号已存在的行数 ---' AS step;
SELECT COUNT(*) AS total_to_backfill,
       SUM(dupExists) AS dup_rows
FROM _work_st_backfill;

-- ─── 第 4 步：执行补全 ───────────────────────────────────────────────────────
UPDATE materials m
JOIN _work_st_backfill w ON w.id = m.id
SET m.partNumber = w.newPn
WHERE CHAR_LENGTH(w.suffix) = 2
  AND w.newPn LIKE CONCAT(UPPER(w.oldPn), '%');

SELECT '补全完成' AS step;

-- ─── 第 5 步：验证 ───────────────────────────────────────────────────────────
SELECT '--- 补全后样例 ---' AS step;
SELECT m.materialNo, b.partNumber AS before_pn, m.partNumber AS after_pn, m.package
FROM materials m
JOIN _bak_materials_st_backfill b ON b.id = m.id
ORDER BY m.materialNo LIMIT 8;

SELECT '--- 图片字段完好性（应为 464）---' AS step;
SELECT COUNT(*) AS cover_unchanged
FROM materials m
JOIN _bak_materials_st_backfill b ON b.id = m.id
WHERE m.coverImageUrl = b.coverImageUrl;

SELECT '--- 仍为短号的残留（应为 0）---' AS step;
SELECT COUNT(*) AS remaining_short
FROM materials m
JOIN _work_st_backfill w ON w.id = m.id
WHERE UPPER(m.partNumber) = UPPER(w.oldPn);

SELECT '--- 补全后产生的同型号重复组数 ---' AS step;
SELECT COUNT(*) AS dup_groups FROM (
  SELECT partNumber FROM materials
  WHERE partNumber REGEXP '^STM32'
  GROUP BY partNumber HAVING COUNT(*) > 1
) t;
