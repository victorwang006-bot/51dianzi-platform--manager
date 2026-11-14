// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StaffStatusDialog from "./StaffStatusDialog";
let root: Root, host: HTMLDivElement, props: any;
const target = { id: 20, username: "native-target", name: "目标后台员工", expectedStatus: "active", status: "disabled" };
const button = () => [...document.querySelectorAll<HTMLButtonElement>("button")].find(b => /^(确认停用|确认启用|处理中…)$/.test(b.textContent ?? ""))!;
async function render(change: any = {}) { Object.assign(props, change); await act(async () => root.render(React.createElement(StaffStatusDialog, props))); }
async function reason(value = "实际后台停用原因") {
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>("#staff-status-reason")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  props = { open: true, actorKey: "actor10:epoch7", target, allowed: true, onOpenChange: vi.fn(), mutate: vi.fn().mockResolvedValue({ success: true }), readBack: vi.fn().mockResolvedValue({ id: 20, status: "disabled" }) };
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
describe("Staff account status confirmation (DOM, no native writes)", () => {
  it("names the real backend target and states limited consequences while requiring an audit reason", async () => {
    await render();
    expect(document.body.textContent).toContain("目标后台员工"); expect(document.body.textContent).toContain("native-target");
    expect(document.body.textContent).toContain("撤销全部既有后台会话"); expect(document.body.textContent).toContain("不删除历史数据"); expect(document.body.textContent).toContain("不连带停用或启用前台／小程序账号或企业成员");
    expect(button().disabled).toBe(true); await reason(" "); expect(button().disabled).toBe(true);
    await reason(); await act(async () => button().click());
    expect(props.mutate).toHaveBeenCalledWith({ id: 20, status: "disabled", expectedStatus: "active", reason: "实际后台停用原因" });
    expect(props.readBack).toHaveBeenCalledWith(20); expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });
  it("re-enable confirmation explicitly requires login and does not restore prior sessions", async () => {
    await render({ target: { ...target, expectedStatus: "disabled", status: "active" }, readBack: vi.fn().mockResolvedValue({ id: 20, status: "active" }) });
    expect(document.body.textContent).toContain("必须重新登录"); expect(document.body.textContent).toContain("旧会话不会恢复");
    await reason("实际恢复访问原因"); await act(async () => button().click());
    expect(props.mutate).toHaveBeenCalledWith(expect.objectContaining({ status: "active", expectedStatus: "disabled" }));
  });
  it("synchronous double click submits once; no success before a real status readback", async () => {
    let finish!: (value: any) => void; props.mutate.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await render(); await reason(); await act(async () => { button().click(); button().click(); });
    expect(props.mutate).toHaveBeenCalledTimes(1); expect(props.readBack).not.toHaveBeenCalled(); expect(props.onOpenChange).not.toHaveBeenCalled();
    await act(async () => finish({ success: true })); expect(props.readBack).toHaveBeenCalledTimes(1);
  });
  it.each(["failure", "mismatch"])("confirmed write with readback %s remains open and cannot be repeated", async kind => {
    if (kind === "failure") props.readBack.mockRejectedValue(new Error("mock回读失败"));
    else props.readBack.mockResolvedValue({ id: 20, status: "active" });
    await render(); await reason(); await act(async () => button().click());
    expect(props.onOpenChange).not.toHaveBeenCalled(); expect(document.body.textContent).toContain("勿重复提交"); expect(button().disabled).toBe(true);
    await act(async () => button().click()); expect(props.mutate).toHaveBeenCalledTimes(1);
  });
  it("server conflict is shown without claiming success or reading fabricated state", async () => {
    props.mutate.mockRejectedValue(new Error("账号状态已被其他操作修改，请刷新核验"));
    await render(); await reason(); await act(async () => button().click());
    expect(document.body.textContent).toContain("请刷新核验"); expect(props.readBack).not.toHaveBeenCalled(); expect(props.onOpenChange).not.toHaveBeenCalled();
  });
  it("actor/epoch switches hide reason immediately and ignore late mutation completions", async () => {
    let finish!: (value: any) => void; props.mutate.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await render(); await reason("私有实际原因"); await act(async () => button().click());
    await render({ actorKey: "actor11:epoch8", open: false }); await act(async () => finish({ success: true }));
    expect(props.readBack).not.toHaveBeenCalled(); expect(props.onOpenChange).not.toHaveBeenCalled();
    await render({ open: true }); expect(document.querySelector<HTMLInputElement>("#staff-status-reason")!.value).toBe("");
  });
  it("live authorization/target-state denial disables a prepared confirmation", async () => {
    await render(); await reason(); await render({ allowed: false });
    expect(button().disabled).toBe(true); await act(async () => button().click()); expect(props.mutate).not.toHaveBeenCalled();
  });
});
