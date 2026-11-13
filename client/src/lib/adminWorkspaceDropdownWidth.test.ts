import { describe, expect, it } from "vitest";
import { getAdminWorkspaceDropdownWidth, getAdminWorkspaceDropdownLeft, getAdminWorkspaceSubmenuPlacement } from "./adminWorkspaceDropdownWidth";

describe("content-driven dropdown width helpers (no DOM or requests)", () => {
  it.each(["sales-orders", "inventory-management", "procurement-management", "operations", "organization"])("%s keeps optional legacy call compatible, not a fixed workspace width", id => {
    expect(getAdminWorkspaceDropdownWidth(id)).toBe(128);
    expect(getAdminWorkspaceDropdownWidth(id, 2)).toBe(128);
    expect(getAdminWorkspaceDropdownWidth(id, 3)).toBe(128);
  });
  it("longest same-level label decides fallback, labels/order never mutated", () => {
    const labels = Object.freeze(["入库", "虚构测试入库", "ABC"]);
    const measureText = (label: string) => Array.from(label).length * 14;
    const options = { labels, measureText };
    expect(getAdminWorkspaceDropdownWidth("fixture", 2, options)).toBe(measureText(labels[1]) + 24 + 2);
    expect(getAdminWorkspaceDropdownWidth("fixture", 3, { ...options, hasArrow: true })).toBe(measureText(labels[1]) + 24 + 2 + 20);
    expect(labels).toEqual(["入库", "虚构测试入库", "ABC"]);
  });
  it("positive finite actual border-box wins over guessed text and includes badge/custom renderer", () => {
    expect(getAdminWorkspaceDropdownWidth("operations", 3, { measuredWidth: 231.75, labels: ["短"] })).toBe(231.75);
    expect(getAdminWorkspaceDropdownWidth("operations", 2, { measuredWidth: 231.75, viewportWidth: 200 })).toBe(200 - 16);
  });
  it.each([0, -1, NaN, Infinity])("unavailable measurement %s uses deterministic content fallback", measuredWidth => {
    expect(getAdminWorkspaceDropdownWidth("fixture", 2, { measuredWidth, labels: ["入库ABC"] })).toBe(2 * 14 + 3 * 7 + 24 + 2);
    expect(getAdminWorkspaceDropdownWidth("fixture", 2, { labels: ["入库ABC"], measureText: () => measuredWidth })).toBe(measuredWidth === 0 ? 24 + 2 : 2 * 14 + 3 * 7 + 24 + 2);
  });
  it("viewport clipping never returns a negative width", () => {
    expect(getAdminWorkspaceDropdownWidth("fixture", 2, { viewportWidth: 8 })).toBe(0);
    expect(getAdminWorkspaceDropdownLeft(1250, 119.5, 1280)).toBe(1280 - 119.5 - 8);
    expect(getAdminWorkspaceDropdownLeft(-20, 119.5, 1280)).toBe(8);
  });
  it("actual narrower parent and child fit right where the obsolete 168/176 would flip left", () => {
    const parentLeft = 1050, parentWidth = 106, childWidth = 92;
    const placement = getAdminWorkspaceSubmenuPlacement(parentLeft, parentWidth, childWidth, 1280);
    expect(placement).toEqual({ side: "right", left: parentLeft + parentWidth });
    expect(parentLeft + 168 + 176).toBeGreaterThan(1280 - 8);
  });
  it("independent wider child flips left and clamps only at viewport edge", () => {
    expect(getAdminWorkspaceSubmenuPlacement(1100, 118, 240, 1280)).toEqual({ side: "left", left: 1100 - 240 });
    expect(getAdminWorkspaceSubmenuPlacement(90, 380, 400, 768)).toEqual({ side: "left", left: 8 });
    expect(getAdminWorkspaceSubmenuPlacement(900, 128, 244, 1280)).toEqual({ side: "right", left: 900 + 128 });
  });
});
