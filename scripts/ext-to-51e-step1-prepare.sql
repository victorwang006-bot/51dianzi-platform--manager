-- ============================================================================
-- EXT- 纳入 51E- 编码体系 —— 第 1 阶段：准备（扩容 + 备份 + 120 组去重）
--
-- 本阶段全部操作都是可逆的，且不分配任何流水号。
-- 依赖：materials 表所在库为 dianzi51_admin；前台库为 dianzi51。
-- ============================================================================

-- ─── 1.1 前台库存编码字段扩容 ────────────────────────────────────────────────
-- 51E- + 8 位 = 恰好 12 字符，varchar(12) 零余量，将来任何调整都会静默截断。
-- 纯扩容，不改动任何现有值。
ALTER TABLE dianzi51.inventories MODIFY COLUMN materialCode VARCHAR(32) NULL;

SELECT '--- 1.1 扩容后字段确认 ---' AS step;
SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA='dianzi51' AND TABLE_NAME='inventories' AND COLUMN_NAME='materialCode';

SELECT '--- 1.1 扩容未损坏数据（应仍为 464 条 51E- 引用）---' AS step;
SELECT COUNT(*) AS inv_ref_51e FROM dianzi51.inventories WHERE materialCode LIKE '51E-%';

-- ─── 1.2 备份 EXT- 原始编码 ──────────────────────────────────────────────────
DROP TABLE IF EXISTS _bak_materials_ext_to51e;
CREATE TABLE _bak_materials_ext_to51e (
  id INT PRIMARY KEY,
  oldMaterialNo VARCHAR(32) NOT NULL,
  partNumber VARCHAR(128),
  oldLifecycle VARCHAR(16),
  oldStatus VARCHAR(16),
  backedUpAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_old (oldMaterialNo)
);

INSERT INTO _bak_materials_ext_to51e (id, oldMaterialNo, partNumber, oldLifecycle, oldStatus)
SELECT id, materialNo, partNumber, lifecycle, status
FROM materials WHERE materialNo LIKE 'EXT-%';

SELECT '--- 1.2 备份行数（应为 599738）---' AS step;
SELECT COUNT(*) AS backup_rows FROM _bak_materials_ext_to51e;

-- ─── 1.3 处理 120 组撞型号：EXT- 影子记录标废弃 ──────────────────────────────
-- 判定依据：该 EXT- 记录的型号已存在一条 51E- 正式记录。
-- 这些记录不参与流水号分配（不浪费正式编码）。
DROP TABLE IF EXISTS _work_ext_shadow;
CREATE TABLE _work_ext_shadow (
  extId INT PRIMARY KEY,
  extNo VARCHAR(32),
  partNumber VARCHAR(128),
  keepId INT,
  keepNo VARCHAR(32),
  KEY idx_keep (keepId)
);

INSERT INTO _work_ext_shadow (extId, extNo, partNumber, keepId, keepNo)
SELECT e.id, e.materialNo, e.partNumber, p.id, p.materialNo
FROM materials e
JOIN materials p
  ON p.materialNo LIKE '51E-%'
 AND UPPER(p.partNumber) = UPPER(e.partNumber)
WHERE e.materialNo LIKE 'EXT-%';

SELECT '--- 1.3 影子记录数（应为 120）---' AS step;
SELECT COUNT(*) AS shadow_rows, COUNT(DISTINCT partNumber) AS distinct_pn FROM _work_ext_shadow;

SELECT '--- 1.3 安全校验：保留侧必须持有图片资产（应 120/120）---' AS step;
SELECT
  SUM(m.coverImageUrl IS NOT NULL AND m.coverImageUrl <> '') AS keep_has_cover,
  SUM(m.status = 'enabled') AS keep_enabled
FROM _work_ext_shadow w JOIN materials m ON m.id = w.keepId;

SELECT '--- 1.3 安全校验：影子侧必须无图片、无库存引用（应 0）---' AS step;
SELECT
  SUM(m.coverImageUrl IS NOT NULL AND m.coverImageUrl <> '') AS shadow_has_cover,
  (SELECT COUNT(*) FROM dianzi51.inventories i
     JOIN _work_ext_shadow w2 ON i.materialCode = w2.extNo) AS shadow_inv_ref
FROM _work_ext_shadow w JOIN materials m ON m.id = w.extId;

-- 将影子记录的 EXT- 编码作为 external 别名挂到保留侧，
-- 保证外部系统用旧编码查询会落到资产齐全的正式记录上。
INSERT IGNORE INTO material_code_aliases (materialId, aliasCode, aliasType, source)
SELECT keepId, extNo, 'external', 'ext-to-51e-shadow-2026-08-16'
FROM _work_ext_shadow;

SELECT '--- 1.3 影子别名写入数 ---' AS step;
SELECT COUNT(*) AS shadow_alias_rows FROM material_code_aliases
WHERE source = 'ext-to-51e-shadow-2026-08-16';

-- 标记影子记录废弃（保留记录本身，符合 MATERIAL_PHYSICAL_DELETE_FORBIDDEN）
UPDATE materials m
JOIN _work_ext_shadow w ON w.extId = m.id
SET m.lifecycle = 'obsolete', m.status = 'disabled';

SELECT '--- 1.3 废弃标记结果 ---' AS step;
SELECT m.lifecycle, m.status, COUNT(*) AS cnt
FROM materials m JOIN _work_ext_shadow w ON w.extId = m.id
GROUP BY m.lifecycle, m.status;

SELECT '--- 1.3 保留侧仍为 active/enabled（应 120）---' AS step;
SELECT m.lifecycle, m.status, COUNT(*) AS cnt
FROM materials m JOIN _work_ext_shadow w ON w.keepId = m.id
GROUP BY m.lifecycle, m.status;

-- ─── 1.4 待纳编总量确认 ──────────────────────────────────────────────────────
SELECT '--- 1.4 实际待分配流水号的行数（599738 - 120 = 599618）---' AS step;
SELECT COUNT(*) AS to_assign
FROM materials m
WHERE m.materialNo LIKE 'EXT-%'
  AND NOT EXISTS (SELECT 1 FROM _work_ext_shadow w WHERE w.extId = m.id);
