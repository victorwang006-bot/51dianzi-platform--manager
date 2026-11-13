import { describe, expect, it } from "vitest";
import { getAdminWorkspaceDropdownWidth } from "./adminWorkspaceDropdownWidth";

describe("desktop dropdown border-box widths", () => {
  it.each([
    ["sales-orders", 160], ["inventory-management", 160], ["procurement-management", 160],
    ["operations", 168], ["organization", 176],
  ] as const)("%s uses %spx", (id, width) => {
    expect(getAdminWorkspaceDropdownWidth(id)).toBe(width);
    expect(getAdminWorkspaceDropdownWidth(id, 2)).toBe(width);
  });
  it("keeps the child width distinct from its narrower operations parent", () => {
    expect(getAdminWorkspaceDropdownWidth("operations", 3)).toBe(176);
  });
});
