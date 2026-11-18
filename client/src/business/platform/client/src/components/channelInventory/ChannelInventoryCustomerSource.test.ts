// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelInventoryCustomerSource as ChannelInventorySourcePanel } from "./ChannelInventorySourcePanel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let host: HTMLDivElement;
const row = { canEditMaterial: false, canEdit: false, readOnly: true, canViewSource: true, canViewCustomerSource: true,
  customerSourceState: "matched", company: { id: 71, name: " 虚构已确认 CRM 客户 " } };
function render(material: React.ComponentProps<typeof ChannelInventorySourcePanel>["material"] = row, contextVerified = true) {
  act(() => root.render(React.createElement(ChannelInventorySourcePanel, { material, contextVerified })));
}
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No production IO in source projection fixtures"); }));
});
afterEach(() => { act(() => root.unmount()); host.remove(); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("来源读取独立于编辑：当前列表的授权 CRM / 未关联历史渠道投影", () => {
  it("shows source-only CRM name without edit/write, ids/private fields or old channel API", () => {
    render({ ...row, company: { id: 987654, name: row.company.name, phone: "SECRET-PHONE", notes: "SECRET-NOTE" }, channelSource: { id: 901, name: "STALE-CHANNEL" } });
    expect(host.textContent).toBe(row.company.name);
    expect(host.querySelector("span")?.title).toBe(row.company.name);
    expect(host.innerHTML).not.toMatch(/987654|SECRET|channelId|STALE/);
    expect(host.querySelector("button,a,input,dialog")).toBeNull();
  });
  it.each([
    { canViewSource: false }, { canViewSource: undefined }, { canViewSource: 1 }, { canViewCustomerSource: false },
    { canViewCustomerSource: undefined }, { customerSourceState: "restricted" }, { customerSourceState: undefined },
  ])("masks denied or malformed source grants immediately with no hidden name/id/tooltip %j", denial => {
    render(); render({ ...row, ...denial });
    expect(host.textContent).toBe("客户不可查看");
    expect(host.innerHTML).not.toMatch(/已确认|71/);
  });
  it("does not couple new matched source state to canEditMaterial/readOnly", () => {
    for (const canEditMaterial of [false, undefined, null, "true"]) for (const readOnly of [true, undefined, "false"]) {
      render({ ...row, canEditMaterial, readOnly }); expect(host.textContent).toBe(row.company.name);
    }
  });
  it("legacy old DTO retains the narrower fail-closed edit gate and never guesses a historical channel", () => {
    const legacy = { canEdit: true, readOnly: false, canViewSource: true, company: row.company, channelSource: { id: 901, name: "LEGACY-GUESS" } };
    render(legacy); expect(host.textContent).toBe(row.company.name);
    for (const denial of [{ canEdit: false }, { canEdit: undefined }, { readOnly: true }, { canEditMaterial: false }, { canEditMaterial: undefined }]) {
      render({ ...legacy, ...denial }); expect(host.textContent).toBe("客户不可查看");
    }
    render({ ...legacy, company: null }); expect(host.textContent).toBe("未关联客户");
    expect(host.innerHTML).not.toContain("LEGACY-GUESS");
  });
  it("masks context revalidation and source revocation without retaining previous names", () => {
    render(); render(row, false); expect(host.textContent).toBe("客户不可查看");
    render(); expect(host.textContent).toBe(row.company.name);
    render({ ...row, canViewSource: false }); expect(host.innerHTML).not.toContain(row.company.name);
  });
  it("only explicit unlinked plus authorized valid channel displays the historical label, not a CRM company", () => {
    const unlinked = { ...row, customerSourceState: "unlinked", company: null, channelSource: { id: 901, name: "虚构历史渠道" } };
    render(unlinked); expect(host.textContent).toBe("历史渠道：虚构历史渠道（未关联CRM客户）");
    expect(host.innerHTML).not.toContain("901");
    render(unlinked, false); expect(host.textContent).toBe("客户不可查看");
    for (const channelSource of [undefined, null, "FAKE", { id: "901", name: "FAKE" }, { id: 0, name: "FAKE" }, { id: 901, name: " " }]) {
      render({ ...unlinked, channelSource }); expect(host.textContent).toBe("客户不可查看");
    }
    for (const denied of [{ canViewSource: false }, { customerSourceState: "restricted" }, { customerSourceState: "matched", company: null }, { company: row.company }]) {
      render({ ...unlinked, ...denied }); expect(host.textContent).toBe("客户不可查看");
      expect(host.innerHTML).not.toContain("虚构历史渠道");
    }
  });
  it("matched denied/missing/malformed CRM never falls back to a valid channelSource", () => {
    for (const company of [null, undefined, "客户", { id: "71", name: "BAD" }, { id: 71, name: " " }]) {
      render({ ...row, company, channelSource: { id: 901, name: "PRIVATE-FALLBACK" } });
      expect(host.textContent).toBe("客户不可查看"); expect(host.innerHTML).not.toContain("PRIVATE-FALLBACK");
    }
  });
});
