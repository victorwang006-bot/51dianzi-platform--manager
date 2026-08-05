ALTER TABLE `merchants` ADD `crmOwnerPortalUserId` varchar(64);--> statement-breakpoint
UPDATE `merchants`
SET `businessLicense` = UPPER(REPLACE(TRIM(`businessLicense`), ' ', ''))
WHERE `businessLicense` IS NOT NULL AND TRIM(`businessLicense`) <> '';--> statement-breakpoint
UPDATE `merchants` AS `m`
JOIN (
  SELECT
    UPPER(REPLACE(TRIM(JSON_UNQUOTE(JSON_EXTRACT(`companyProfile`, '$.creditCode'))), ' ', '')) AS `creditCode`,
    MIN(TRIM(`portalUserId`)) AS `portalUserId`
  FROM `message_threads`
  WHERE `threadType` = 'crm_apply'
    AND `portalUserId` IS NOT NULL
    AND TRIM(`portalUserId`) <> ''
    AND JSON_UNQUOTE(JSON_EXTRACT(`companyProfile`, '$.creditCode')) IS NOT NULL
  GROUP BY UPPER(REPLACE(TRIM(JSON_UNQUOTE(JSON_EXTRACT(`companyProfile`, '$.creditCode'))), ' ', ''))
  HAVING COUNT(DISTINCT TRIM(`portalUserId`)) = 1
) AS `binding`
  ON `binding`.`creditCode` = `m`.`businessLicense`
SET `m`.`crmOwnerPortalUserId` = `binding`.`portalUserId`
WHERE `m`.`crmOwnerPortalUserId` IS NULL;--> statement-breakpoint
ALTER TABLE `merchants` ADD CONSTRAINT `merchants_businessLicense_unique` UNIQUE(`businessLicense`);
