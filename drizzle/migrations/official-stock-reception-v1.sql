-- Official stock inquiry reception v1; MySQL 8; REVIEW ONLY in this task.
-- DDL implicitly commits in MySQL. Take a backup and gate deployment first.
-- No identities/owners/seller enterprises or old inquiries are backfilled.
CREATE TABLE IF NOT EXISTS official_channel_stock_reception (
  stockId INT NOT NULL,
  merchantId INT NOT NULL,
  sellerEnterpriseId INT NOT NULL,
  routingMode ENUM('owner', 'explicit') NOT NULL DEFAULT 'owner',
  recipientAdminUserId INT NULL,
  responsibilityVersion INT UNSIGNED NOT NULL DEFAULT 1,
  updatedByAdminUserId INT NOT NULL,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (stockId)
) ENGINE=InnoDB;

-- Add the private projection column iff absent. Keep snapshot's public whitelist unchanged.
SET @official_reception_ddl = IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'official_channel_publications'
      AND COLUMN_NAME = 'reception'),
  'SELECT 1 AS official_reception_column_already_present',
  'ALTER TABLE official_channel_publications ADD COLUMN reception JSON NULL AFTER snapshot'
);
PREPARE official_reception_stmt FROM @official_reception_ddl;
EXECUTE official_reception_stmt;
DEALLOCATE PREPARE official_reception_stmt;

-- Rollback boundary: revert application routing first; KEEP config/projection and
-- audit records. Do not drop/rewrite these records after factory inquiries exist.
-- Only before first use, with approved backup and all readers stopped, may a
-- separate reviewed rollback DROP the new table/column. No DROP is included here.
