-- Manual, additive migration. Operator must verify target database and install
-- this table BEFORE deploying the new service. No runtime DDL, no backfill,
-- no writes to existing inventory, mall evidence, reference cache or audit tables.
CREATE TABLE IF NOT EXISTS `channel_inventory_manual_references` (
  `enterpriseId` BIGINT UNSIGNED NOT NULL,
  `dataOwnerUserId` BIGINT UNSIGNED NOT NULL,
  `materialId` BIGINT UNSIGNED NOT NULL,
  `manualReferenceLcsc` VARCHAR(32) NULL DEFAULT NULL,
  `manualReferenceIckey` VARCHAR(32) NULL DEFAULT NULL,
  `updatedByUserId` BIGINT UNSIGNED NOT NULL,
  `updatedByAdminAccountId` BIGINT UNSIGNED NULL DEFAULT NULL,
  `updatedAt` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`enterpriseId`, `dataOwnerUserId`, `materialId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- The prices are exact nonnegative decimal STRINGS (15 integer / 12 fraction
-- digits), validated by the common public schema. Omitted update fields retain
-- stored values; null explicitly clears. Main inventory revision and the existing
-- collaboration audit fence this table inside the same application transaction.
