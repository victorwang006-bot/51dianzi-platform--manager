-- 前置条件：停止后台写入，完成数据库备份，并先运行 preflight-platform-material-codes.sql。
-- 设计：旧码先落别名表；正式码按 materials.id ASC 确定性分配；重复运行不会再次改号。

CREATE TABLE IF NOT EXISTS `material_code_aliases` (
  `id` int AUTO_INCREMENT NOT NULL,
  `materialId` int NOT NULL,
  `aliasCode` varchar(64) NOT NULL,
  `aliasType` enum('legacy','merged','external') NOT NULL,
  `source` varchar(128),
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `material_code_aliases_aliasCode_unique` (`aliasCode`),
  KEY `material_code_aliases_materialId_idx` (`materialId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `material_number_sequences` (
  `sequenceKey` varchar(64) NOT NULL,
  `nextValue` bigint NOT NULL,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`sequenceKey`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;

CREATE TEMPORARY TABLE platform_material_code_mapping AS
SELECT id AS materialId,
       materialNo AS legacyCode,
       CONCAT('51E-', LPAD(ROW_NUMBER() OVER (ORDER BY id), 8, '0')) AS platformCode
FROM materials;

INSERT INTO material_code_aliases (materialId, aliasCode, aliasType, source)
SELECT materialId, legacyCode, 'legacy', 'platform-code-migration-2026-08-03'
FROM platform_material_code_mapping
WHERE legacyCode NOT REGEXP '^51E-[0-9]{8}$'
ON DUPLICATE KEY UPDATE
  materialId = VALUES(materialId),
  aliasType = 'legacy';

UPDATE materials AS material
JOIN platform_material_code_mapping AS mapping ON mapping.materialId = material.id
SET material.materialNo = mapping.platformCode
WHERE material.materialNo NOT REGEXP '^51E-[0-9]{8}$';

INSERT INTO material_number_sequences (sequenceKey, nextValue)
SELECT 'platform_material',
       COALESCE(MAX(CAST(SUBSTRING(materialNo, 5) AS UNSIGNED)), 0) + 1
FROM materials
ON DUPLICATE KEY UPDATE
  nextValue = GREATEST(nextValue, VALUES(nextValue));

DROP TEMPORARY TABLE platform_material_code_mapping;

COMMIT;
