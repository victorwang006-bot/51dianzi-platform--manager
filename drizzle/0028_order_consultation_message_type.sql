-- Additive migration only. Do not run automatically from this task.
-- Production already has domestic_substitution; preserve every existing value verbatim
-- and append order_consultation. No tables, rows, or enum values are dropped.
ALTER TABLE `message_threads`
  MODIFY COLUMN `threadType`
    ENUM(
      'general',
      'inquiry',
      'service',
      'onboarding',
      'zhuomuniao_cooperation',
      'crm_apply',
      'complaint',
      'domestic_substitution',
      'order_consultation'
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'general' COMMENT '',
  ALGORITHM=INPLACE,
  LOCK=NONE;
