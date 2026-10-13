-- 为 HK ERP owner 换绑账本新增稳定 union identity；CN creditCode 继续可空且原值不变。
-- 仅新增字段，不执行数据回填或修改现有商户绑定。
ALTER TABLE `crm_owner_rebind_logs`
  ADD COLUMN `registrationIdentifier` varchar(32) NULL AFTER `creditCode`;
