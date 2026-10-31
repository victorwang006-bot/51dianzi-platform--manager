type BankLicenseRecord = {
  bankLicenseObjectKey?: string | null;
  bankLicenseUrl?: string | null;
} | null | undefined;

/** 新申请必须已有服务端持久化的银行资料；兼容历史公开文件及已开通账号的资料编辑。 */
export function bankLicenseMissingForApplication(
  company: BankLicenseRecord,
  alreadyHasCrmAccess: boolean,
): boolean {
  if (alreadyHasCrmAccess) return false;
  return !company?.bankLicenseObjectKey?.trim() && !company?.bankLicenseUrl?.trim();
}
