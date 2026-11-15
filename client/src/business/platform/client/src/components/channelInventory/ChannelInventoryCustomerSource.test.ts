// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelInventoryCustomerSource as ChannelInventorySourcePanel } from "./ChannelInventorySourcePanel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let host: HTMLDivElement;
const row = { canEditMaterial: true, canEdit: true, readOnly: false, canViewSource: true, company: { id: 71, name: " 已确认 CRM 客户 " } };
function render(material: React.ComponentProps<typeof ChannelInventorySourcePanel>["material"] = row, contextVerified = true) {
  act(() => root.render(React.createElement(ChannelInventorySourcePanel, { material, contextVerified })));
}
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No production IO in source projection fixtures"); }));
});
afterEach(() => { act(() => root.unmount()); host.remove(); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("来源客户：仅显示当前列表的服务端授权 CRM 投影", () => {
  it("preserves the authorized CRM name, never renders customer ids/private fields or calls the old channel API", () => {
    render({ ...row, company: { id: 987654, name: row.company.name, phone: "SECRET-PHONE", notes: "SECRET-NOTE" } });
    expect(host.textContent).toBe(row.company.name);
    expect(host.querySelector("span")?.title).toBe(row.company.name);
    expect(host.innerHTML).not.toMatch(/987654|SECRET|channelId/);
    expect(host.querySelector("button,a,input,dialog")).toBeNull();
  });
  it.each([
    { canEditMaterial: false }, { canEditMaterial: undefined }, { canEditMaterial: "true" },
    { readOnly: true }, { readOnly: undefined }, { canViewSource: false }, { canViewSource: undefined },
  ])("masks denied or unproven grants immediately, with no hidden name/id/tooltip %j", denial => {
    render(); render({ ...row, ...denial });
    expect(host.textContent).toBe("客户不可查看");
    expect(host.innerHTML).not.toMatch(/已确认|71/);
  });
  it("retains legacy explicit canEdit compatibility only when canEditMaterial was not returned", () => {
    const { canEditMaterial, ...legacy } = row;
    render(legacy); expect(host.textContent).toBe(row.company.name);
    render({ ...legacy, canEdit: false }); expect(host.textContent).toBe("客户不可查看");
  });
  it("masks on context revalidation and fresh revocation without retaining earlier customer names", () => {
    render(); render(row, false); expect(host.textContent).toBe("客户不可查看");
    render(); expect(host.textContent).toBe(row.company.name);
    render({ ...row, canEditMaterial: false }); expect(host.innerHTML).not.toContain(row.company.name);
  });
  it("marks only an authorized explicit null as unlinked; absent/malformed data is not guessed", () => {
    render({ ...row, company: null }); expect(host.textContent).toBe("未关联客户");
    for (const company of [undefined, "客户", { id: "71", name: "BAD" }, { id: 71, name: " " }]) {
      render({ ...row, company }); expect(host.textContent).toBe("客户不可查看");
    }
    render({ ...row, company: null, canViewSource: false }); expect(host.textContent).toBe("客户不可查看");
  });
});
