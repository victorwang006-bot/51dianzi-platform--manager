-- 后台负责人本地绑定后，平台企业角色确认的可重试账本状态。
-- requestId 已唯一；此迁移只为既有账本增加确认闭环，不修改任何商户绑定。
ALTER TABLE `crm_owner_rebind_logs`
  ADD COLUMN `creditCode` varchar(64) NULL AFTER `nextOwnerPortalUserId`,
  ADD COLUMN `platformSyncStatus` enum('pending','completed','retryable') NOT NULL DEFAULT 'pending' AFTER `userAgent`,
  ADD COLUMN `platformSyncError` varchar(1000) NULL AFTER `platformSyncStatus`,
  ADD COLUMN `platformSyncAttemptCount` int NOT NULL DEFAULT 0 AFTER `platformSyncError`,
  ADD COLUMN `platformSyncedAt` timestamp NULL AFTER `platformSyncAttemptCount`;
