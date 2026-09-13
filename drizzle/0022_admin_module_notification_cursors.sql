CREATE TABLE IF NOT EXISTS `admin_module_notification_cursors` (
  `id` int NOT NULL AUTO_INCREMENT,
  `viewerKey` varchar(80) NOT NULL,
  `module` varchar(32) NOT NULL,
  `lastSeenId` bigint NOT NULL DEFAULT 0,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `admin_module_notification_viewer_module_unique` (`viewerKey`, `module`),
  KEY `admin_module_notification_module_seen_idx` (`module`, `lastSeenId`)
);
