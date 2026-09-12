-- Security hardening for local administrator accounts.
-- Existing local JWTs intentionally lack sessionVersion and are rejected after deployment;
-- this is safer than honoring a previously issued one-year credential window.

ALTER TABLE `admin_users`
  ADD COLUMN `usernameCanonical` varchar(64) NULL AFTER `username`,
  ADD COLUMN `sessionVersion` int NOT NULL DEFAULT 1 AFTER `status`;
--> statement-breakpoint

-- Trim normalizes legacy names; LOWER makes the constraint independent of a
-- deployment's database collation. Administrators must resolve any legacy
-- collision before this migration is applied.
UPDATE `admin_users`
SET `username` = TRIM(`username`),
    `usernameCanonical` = LOWER(TRIM(`username`));
--> statement-breakpoint

ALTER TABLE `admin_users`
  MODIFY COLUMN `usernameCanonical` varchar(64) NOT NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX `admin_users_username_canonical_unique`
  ON `admin_users` (`usernameCanonical`);
