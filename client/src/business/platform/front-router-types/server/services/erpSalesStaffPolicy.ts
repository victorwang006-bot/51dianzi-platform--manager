/**
 * ERP 新开通时不可再选择的历史销售联系人。
 *
 * 这里只影响后台动态名单的返回与新提交校验，不更新 companies 表，
 * 因而历史已保存负责人仍可审计和展示。
 */
const DISABLED_ERP_SALES_STAFF_NAMES = new Set(["bella", "ocean", "victor"]);

function normalizeStaffDisplayName(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

export function filterSelectableErpSalesStaff<T extends { displayName: string }>(
  staff: readonly T[],
): T[] {
  return staff.filter(
    item => !DISABLED_ERP_SALES_STAFF_NAMES.has(normalizeStaffDisplayName(item.displayName)),
  );
}
