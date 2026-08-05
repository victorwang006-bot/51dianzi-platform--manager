-- 回滚正式码到迁移前旧码；别名表与序列表保留用于审计，不删除任何追溯数据。
-- 仅在应用停止写入且确认每条物料均有唯一 legacy 别名后执行。

START TRANSACTION;

UPDATE materials AS material
JOIN material_code_aliases AS alias
  ON alias.materialId = material.id AND alias.aliasType = 'legacy'
SET material.materialNo = alias.aliasCode
WHERE material.materialNo REGEXP '^51E-[0-9]{8}$';

COMMIT;

SELECT COUNT(*) AS total,
       SUM(materialNo REGEXP '^51E-[0-9]{8}$') AS remainingPlatformCodes,
       COUNT(DISTINCT materialNo) AS distinctCodes
FROM materials;
