UPDATE `materials`
SET `status` = 'disabled', `updatedAt` = CURRENT_TIMESTAMP
WHERE `status` = 'enabled'
  AND (
    LOWER(COALESCE(`name`, '')) LIKE '%立创%'
    OR LOWER(COALESCE(`brand`, '')) LIKE '%立创%'
    OR LOWER(COALESCE(`category`, '')) LIKE '%立创%'
    OR LOWER(COALESCE(`description`, '')) LIKE '%立创%'
    OR LOWER(COALESCE(`name`, '')) LIKE '%lcsc%'
    OR LOWER(COALESCE(`brand`, '')) LIKE '%lcsc%'
    OR LOWER(COALESCE(`category`, '')) LIKE '%lcsc%'
    OR LOWER(COALESCE(`description`, '')) LIKE '%lcsc%'
    OR LOWER(COALESCE(`name`, '')) LIKE '%jlcpcb%'
    OR LOWER(COALESCE(`brand`, '')) LIKE '%jlcpcb%'
    OR LOWER(COALESCE(`category`, '')) LIKE '%jlcpcb%'
    OR LOWER(COALESCE(`description`, '')) LIKE '%jlcpcb%'
    OR LOWER(CONCAT_WS(' ', `name`, `brand`, `category`, `description`))
      REGEXP 'szlcsc|lcsc|jlcpcb|jlcsmt|jlc3dp|jlcmc|jlceda'
  );
