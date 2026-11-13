export type AdminWorkspaceDropdownWidthOptions = {
  /** Actual DOM border-box width wins, including badges and custom renderItem. */
  measuredWidth?: number;
  labels?: readonly string[];
  hasArrow?: boolean;
  viewportWidth?: number;
  /** Optional caller-provided font measurement; this module never reads DOM. */
  measureText?: (label: string) => number;
};

/** Content-driven border-box width. The original (workspaceId, level) call stays
 * valid, but without content/measurement it is only a neutral fallback, not CSS.
 * Desktop CSS owns intrinsic sizing; mobile drawers override it at 360px. */
export function getAdminWorkspaceDropdownWidth(
  _workspaceId: string,
  _level: 2 | 3 = 2,
  options: AdminWorkspaceDropdownWidthOptions = {},
): number {
  const measured = options.measuredWidth;
  const textWidths = (options.labels ?? []).map(label => {
    const width = options.measureText?.(label);
    if (width !== undefined && Number.isFinite(width) && width >= 0) return width;
    // No layout (SSR/jsdom/hidden panel): conservative 14px CJK / 7px Latin.
    return Array.from(label).reduce((sum, char) => sum + (/[^\u0000-\u00ff]/.test(char) ? 14 : 7), 0);
  });
  const intrinsic = textWidths.length
    ? Math.max(...textWidths) + 24 + 2 + (options.hasArrow ? 20 : 0)
    : 128;
  const width = measured !== undefined && Number.isFinite(measured) && measured > 0
    ? measured : intrinsic;
  const limit = options.viewportWidth !== undefined && Number.isFinite(options.viewportWidth)
    ? Math.max(0, options.viewportWidth - 16) : Infinity;
  return Math.min(width, limit);
}

/** Clamp a real border-box to the viewport without changing its font or width. */
export function getAdminWorkspaceDropdownLeft(anchorLeft: number, width: number, viewportWidth: number): number {
  return Math.max(8, Math.min(anchorLeft, viewportWidth - width - 8));
}

/** Independently measured parent/child widths; zero gap keeps hover adjacency. */
export function getAdminWorkspaceSubmenuPlacement(
  parentLeft: number, parentWidth: number, childWidth: number, viewportWidth: number,
): { left: number; side: "left" | "right" } {
  const parentRight = parentLeft + parentWidth;
  const side = parentRight + childWidth <= viewportWidth - 8 ? "right" : "left";
  return {
    side,
    left: getAdminWorkspaceDropdownLeft(side === "right" ? parentRight : parentLeft - childWidth, childWidth, viewportWidth),
  };
}
