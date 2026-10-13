-- 香港申请稳定版本，只添加NULL兼容列；不重写CN数据。
ALTER TABLE merchants
  ADD COLUMN hkSubmissionId varchar(36) NULL,
  ADD COLUMN hkPayloadHash varchar(64) NULL;
-- 回滚仅关闭HK入口/回退代码，保留已提交审核资料及版本。
