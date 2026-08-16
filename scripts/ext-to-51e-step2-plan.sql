-- ============================================================================
-- EXT- 纳入 51E- 编码体系 —— 第 2 阶段：生成确定性编码映射表（只读推导，不改 materials）
--
-- 幂等的关键：流水号不用并发取号，而是按 id 升序确定性推导。
--   newSeq = 10983 + ROW_NUMBER() OVER (ORDER BY id)
-- 同一条记录无论重跑多少次都得到同一个编码，中断可安全续做。
--
-- 本阶段只建映射表，不修改 materials，可反复重跑。
-- ============================================================================

DROP TABLE IF EXISTS _work_ext_codemap;
CREATE TABLE _work_ext_codemap (
  id INT PRIMARY KEY,
  oldNo VARCHAR(32) NOT NULL,
  newSeq INT NOT NULL,
  newNo VARCHAR(32) NOT NULL,
  batchNo INT NOT NULL,
  applied TINYINT NOT NULL DEFAULT 0,
  UNIQUE KEY uk_newNo (newNo),
  UNIQUE KEY uk_newSeq (newSeq),
  KEY idx_batch (batchNo, applied)
);

SET @base := (SELECT MAX(CAST(SUBSTRING(materialNo, 5) AS UNSIGNED))
              FROM materials WHERE materialNo LIKE '51E-%');
SELECT '--- 起始基数（现有 51E- 最大流水）---' AS step, @base AS base_seq;

INSERT INTO _work_ext_codemap (id, oldNo, newSeq, newNo, batchNo)
SELECT
  t.id,
  t.materialNo,
  @base + t.rn,
  CONCAT('51E-', LPAD(@base + t.rn, 8, '0')),
  CEIL(t.rn / 5000)
FROM (
  SELECT m.id, m.materialNo,
         ROW_NUMBER() OVER (ORDER BY m.id) AS rn
  FROM materials m
  WHERE m.materialNo LIKE 'EXT-%'
    AND NOT EXISTS (SELECT 1 FROM _work_ext_shadow w WHERE w.extId = m.id)
) t;

SELECT '--- 映射表行数（应为 599618）---' AS step;
SELECT COUNT(*) AS map_rows, MIN(newSeq) AS min_seq, MAX(newSeq) AS max_seq,
       COUNT(DISTINCT batchNo) AS batches
FROM _work_ext_codemap;

SELECT '--- 校验1：新编码不能与现有 51E- 冲突（应为 0）---' AS step;
SELECT COUNT(*) AS collision
FROM _work_ext_codemap c
WHERE EXISTS (SELECT 1 FROM materials m WHERE m.materialNo = c.newNo);

SELECT '--- 校验2：新编码不能与别名表冲突（应为 0）---' AS step;
SELECT COUNT(*) AS alias_collision
FROM _work_ext_codemap c
WHERE EXISTS (SELECT 1 FROM material_code_aliases a WHERE a.aliasCode = c.newNo);

SELECT '--- 校验3：格式合规性（应全部 32 位内、匹配 51E-\\d{8}）---' AS step;
SELECT COUNT(*) AS bad_format FROM _work_ext_codemap
WHERE newNo NOT REGEXP '^51E-[0-9]{8}$' OR CHAR_LENGTH(newNo) <> 12;

SELECT '--- 校验4：流水号连续无空洞 ---' AS step;
SELECT (MAX(newSeq) - MIN(newSeq) + 1) AS span, COUNT(*) AS actual,
       CASE WHEN (MAX(newSeq) - MIN(newSeq) + 1) = COUNT(*) THEN 'OK' ELSE 'GAP' END AS verdict
FROM _work_ext_codemap;

SELECT '--- 映射样例 ---' AS step;
SELECT id, oldNo, newNo, batchNo FROM _work_ext_codemap ORDER BY newSeq LIMIT 5;
SELECT id, oldNo, newNo, batchNo FROM _work_ext_codemap ORDER BY newSeq DESC LIMIT 3;
