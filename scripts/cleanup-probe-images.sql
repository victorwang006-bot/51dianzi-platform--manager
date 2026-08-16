-- ============================================================================
-- 清理验证短号回退时注入的探针图（1x1 PNG）
-- 仅移除 images 数组中 url 指向 /uploads/material-images/ 的探针项，
-- 不触碰 coverImageUrl（仍为 OSS 原图）。
-- ============================================================================

SELECT '--- 清理前：含探针图的记录 ---' AS step;
SELECT id, materialNo, partNumber, JSON_LENGTH(images) AS imgCount, coverImageUrl
FROM materials
WHERE partNumber IN ('STM32F058T8Y6','STM32F038K6U6');

-- 只保留 url 以 http 开头（OSS）的图片项，删除本地探针
UPDATE materials
SET images = COALESCE((
      SELECT JSON_ARRAYAGG(item)
      FROM JSON_TABLE(images, '$[*]' COLUMNS (item JSON PATH '$')) jt
      WHERE JSON_UNQUOTE(JSON_EXTRACT(item, '$.url')) LIKE 'http%'
    ), JSON_ARRAY())
WHERE partNumber IN ('STM32F058T8Y6','STM32F038K6U6')
  AND JSON_SEARCH(images, 'one', '/uploads/material-images/%', NULL, '$[*].url') IS NOT NULL;

SELECT '--- 清理后 ---' AS step;
SELECT id, materialNo, partNumber, JSON_LENGTH(images) AS imgCount, coverImageUrl
FROM materials
WHERE partNumber IN ('STM32F058T8Y6','STM32F038K6U6');
