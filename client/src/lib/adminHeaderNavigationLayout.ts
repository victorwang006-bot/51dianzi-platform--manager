export type AdminHeaderNavigationLayout = {
  visibleBusinessCount: number;
  collapseUtilities: boolean;
};

/** Presentation budget only. Never filter the authorized route/item collection. */
export function getAdminHeaderNavigationLayout({
  width,
  businessCount,
  utilityCount,
  accountWidth = 0,
  cellWidth = 124,
  utilityWidth = 140,
  gap = 8,
  groupGap = 16,
  moreWidth = 68,
}: {
  width: number;
  businessCount: number;
  utilityCount: number;
  accountWidth?: number;
  cellWidth?: number;
  utilityWidth?: number;
  gap?: number;
  groupGap?: number;
  moreWidth?: number;
}): AdminHeaderNavigationLayout {
  // Detached/SSR/no-layout environments keep every authorized entry available.
  if (!Number.isFinite(width) || width <= 0) {
    return { visibleBusinessCount: businessCount, collapseUtilities: false };
  }
  const accountBudget = accountWidth > 0 ? accountWidth + (businessCount || utilityCount ? groupGap : 0) : 0;
  const utilityBudget = utilityCount > 0 ? utilityCount * utilityWidth + (utilityCount - 1) * gap : 0;
  const available = Math.max(0, width - accountBudget);
  const minimumBusiness = businessCount > 0 ? Math.min(businessCount * cellWidth + (businessCount - 1) * gap, cellWidth + gap + moreWidth) : 0;
  const collapseUtilities = utilityCount > 0 && utilityBudget + (businessCount > 0 ? groupGap + minimumBusiness : 0) > available;
  const businessBudget = Math.max(0, available - (collapseUtilities ? 0 : utilityBudget + (businessCount > 0 && utilityCount > 0 ? groupGap : 0)));
  const totalBusiness = businessCount * cellWidth + Math.max(0, businessCount - 1) * gap;
  if (!collapseUtilities && totalBusiness <= businessBudget) {
    return { visibleBusinessCount: businessCount, collapseUtilities: false };
  }
  // More carries overflow business entries AND, on narrow viewports, utilities.
  const visibleBusinessCount = Math.min(businessCount,
    Math.max(0, Math.floor((businessBudget - moreWidth) / (cellWidth + gap))));
  return { visibleBusinessCount, collapseUtilities };
}
