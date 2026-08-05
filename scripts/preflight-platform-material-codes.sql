-- 只读预检：执行结果必须满足 total = distinctCodes、missingCode = 0、duplicateGroups = 0。
START TRANSACTION READ ONLY;

SELECT COUNT(*) AS total,
       SUM(materialNo IS NULL OR TRIM(materialNo) = '') AS missingCode,
       COUNT(DISTINCT materialNo) AS distinctCodes,
       COUNT(DISTINCT UPPER(TRIM(partNumber))) AS distinctPartNumbers
FROM materials;

SELECT UPPER(TRIM(partNumber)) AS normalizedPartNumber,
       UPPER(TRIM(COALESCE(brand, ''))) AS normalizedBrand,
       COUNT(*) AS duplicateCount
FROM materials
GROUP BY normalizedPartNumber, normalizedBrand
HAVING COUNT(*) > 1;

SELECT CASE
         WHEN materialNo REGEXP '^51E-[0-9]{8}$' THEN 'platform'
         WHEN materialNo REGEXP '^MAT2026[A-Z]?[0-9]{4}$' THEN 'legacy'
         ELSE 'unexpected'
       END AS codeType,
       COUNT(*) AS count
FROM materials
GROUP BY codeType;

COMMIT;
