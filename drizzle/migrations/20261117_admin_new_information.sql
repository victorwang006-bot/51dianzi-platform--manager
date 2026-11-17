-- Admin new information v1. Empty metadata side tables only.
-- No history backfill, business-table changes, foreign keys or runtime DDL.
CREATE TABLE IF NOT EXISTS `admin_new_information_states` (
  `adminUserId` int unsigned NOT NULL,
  `module` enum('customers','inventory','mall','reception','procurement','inbound','sales') NOT NULL,
  `initialized` int unsigned NOT NULL DEFAULT 0,
  `lastCount` int unsigned NOT NULL DEFAULT 0,
  `lastChildren` json DEFAULT NULL,
  PRIMARY KEY (`adminUserId`, `module`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `admin_new_information_seen` (
  `adminUserId` int unsigned NOT NULL,
  `module` enum('customers','inventory','mall','reception','procurement','inbound','sales') NOT NULL,
  `eventKey` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (`adminUserId`, `module`, `eventKey`)
) ENGINE=InnoDB;
