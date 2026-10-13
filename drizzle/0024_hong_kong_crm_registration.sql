-- 香港 ERP 注册身份与私有审核材料；仅新增/回填，不重写任何既有 CN 业务字段。
-- 本文件按发布流程执行；当前任务不连接生产数据库且不执行迁移。
ALTER TABLE `merchants`
  ADD COLUMN `registrationRegion` enum('CN','HK') NOT NULL DEFAULT 'CN' AFTER `contactEmail`,
  ADD COLUMN `registrationIdentifier` varchar(32) NULL AFTER `registrationRegion`,
  ADD COLUMN `registrationData` json NULL AFTER `registrationIdentifier`,
  ADD COLUMN `registrationPendingData` json NULL AFTER `registrationData`,
  ADD COLUMN `ciObjectKey` varchar(512) NULL AFTER `licenseObjectKey`,
  ADD COLUMN `bankDocumentObjectKey` varchar(512) NULL AFTER `ciObjectKey`;--> statement-breakpoint
ALTER TABLE `merchants`
  ADD CONSTRAINT `merchants_registration_identifier_unique` UNIQUE (`registrationIdentifier`);--> statement-breakpoint
-- 历史 CN 商户维持原 businessLicense；仅为稳定 union identity 填入可验证的18位代码。
UPDATE `merchants`
SET `registrationIdentifier` = CONCAT('CN:', UPPER(REPLACE(TRIM(`businessLicense`), ' ', '')))
WHERE `registrationIdentifier` IS NULL
  AND `businessLicense` IS NOT NULL
  AND UPPER(REPLACE(TRIM(`businessLicense`), ' ', '')) REGEXP '^[0-9A-HJ-NPQRTUWXY]{18}$';
