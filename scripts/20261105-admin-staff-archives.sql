-- REVIEW ONLY. Do not run automatically or use db:push. No existing table/data is changed.
-- Permanent account-retirement fact source: excluded from log retention and cleanup.
-- NULL frontUserId is allowed ONLY after authoritative current binding + all historical binding audits prove never bound.
CREATE TABLE admin_staff_archives (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  adminUserId INT NOT NULL, merchantId INT NULL, enterpriseId INT NULL,
  frontUserId INT NULL, actorAdminUserId INT NOT NULL, actorFrontUserId INT NULL,
  bindingVersion INT NOT NULL, actorBindingVersion INT NULL,
  expectedSessionVersion INT NOT NULL, resultingSessionVersion INT NOT NULL,
  requestId VARCHAR(64) NOT NULL, expectedRevision VARCHAR(64) NULL,
  nextOwnerUserId INT NULL, enterpriseBinding JSON NULL,
  state ENUM('access_closed','retryable','completed') NOT NULL,
  attemptCount INT NOT NULL DEFAULT 0, lastError VARCHAR(512) NULL,
  archivedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completedAt TIMESTAMP NULL,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY admin_staff_archives_admin_unique (adminUserId),
  UNIQUE KEY admin_staff_archives_request_unique (requestId),
  KEY admin_staff_archives_pending_idx (state, updatedAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
