-- 迁移后验收：前四项必须分别为 total、0、total、total；invalidCode 和 invalidSequence 必须为 0。
START TRANSACTION READ ONLY;

SELECT COUNT(*) AS total,
       SUM(materialNo IS NULL OR TRIM(materialNo) = '') AS missingCode,
       COUNT(DISTINCT materialNo) AS distinctCodes,
       SUM(materialNo REGEXP '^51E-[0-9]{8}$') AS validPlatformCodes,
       SUM(materialNo NOT REGEXP '^51E-[0-9]{8}$') AS invalidCode
FROM materials;

SELECT COUNT(*) AS legacyAliasCount,
       COUNT(DISTINCT aliasCode) AS distinctLegacyAliases,
       COUNT(DISTINCT materialId) AS aliasedMaterialCount
FROM material_code_aliases
WHERE aliasType = 'legacy';

SELECT sequenceKey, nextValue,
       (SELECT COALESCE(MAX(CAST(SUBSTRING(materialNo, 5) AS UNSIGNED)), 0) + 1 FROM materials) AS expectedNextValue,
       nextValue <> (SELECT COALESCE(MAX(CAST(SUBSTRING(materialNo, 5) AS UNSIGNED)), 0) + 1 FROM materials) AS invalidSequence
FROM material_number_sequences
WHERE sequenceKey = 'platform_material';

SELECT alias.aliasCode, material.materialNo AS platformCode, material.partNumber, material.brand
FROM material_code_aliases AS alias
JOIN materials AS material ON material.id = alias.materialId
WHERE alias.aliasType = 'legacy'
ORDER BY alias.id
LIMIT 20;

COMMIT;
