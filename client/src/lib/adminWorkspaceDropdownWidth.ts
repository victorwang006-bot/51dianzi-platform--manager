/** Desktop border-box widths. Mobile drawers override inline widths in CSS. */
export function getAdminWorkspaceDropdownWidth(workspaceId: string, level: 2 | 3 = 2): number {
  if (level === 3) return 176;
  if (workspaceId === "sales-orders" || workspaceId === "inventory-management" || workspaceId === "procurement-management") return 160;
  if (workspaceId === "operations") return 168;
  return 176;
}
