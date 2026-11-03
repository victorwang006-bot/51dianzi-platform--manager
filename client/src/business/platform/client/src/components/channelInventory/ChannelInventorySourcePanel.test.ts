// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => {
  const query = vi.fn();
  return { query, utils: { client: { channelInventory: { getTeamMaterialSource: { query } } } } };
});
vi.mock("../../../../../api/business-trpc", () => ({ trpc: { useUtils: () => runtime.utils } }));
import { ChannelInventorySourcePanel } from "./ChannelInventorySourcePanel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let host: HTMLDivElement;
let trigger: HTMLButtonElement;
let current: boolean;
const onClose = vi.fn();
const onAuthorizationError = vi.fn();
type Props = React.ComponentProps<typeof ChannelInventorySourcePanel>;
const props = (overrides: Partial<Props> = {}): Props => ({ materialId: 101, enterpriseId: 31, actorUserId: 7, scopeKey: "bound-team-v1", isCurrent: () => current, onClose, onAuthorizationError, ...overrides });
async function render(overrides: Partial<Props> = {}) { await act(async () => root.render(React.createElement(ChannelInventorySourcePanel, props(overrides)))); }
async function settle() { await act(async () => { await Promise.resolve(); }); }
function deferred() {
  let resolve!: (value: { name: string }) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<{ name: string }>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function name() { return host.querySelector(".ci-source-name")?.textContent; }
function button(label: string) {
  const result = Array.from(host.querySelectorAll("button")).find(item => item.textContent === label || item.getAttribute("aria-label") === label);
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}
beforeEach(() => {
  current = true;
  onClose.mockReset(); onAuthorizationError.mockReset();
  runtime.query.mockReset().mockResolvedValue({ name: "真实服务名称" });
  host = document.createElement("div"); trigger = document.createElement("button");
  trigger.textContent = "查看来源";
  document.body.append(trigger, host); trigger.focus();
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); trigger.remove(); });

describe("真实渠道来源 Panel：只读实时鉴权与生命周期", () => {
  it("uses only the exact material + expected enterprise/actor query and displays name, never extra DTO fields", async () => {
    runtime.query.mockResolvedValueOnce({ name: "合法来源", contactName: "DO-NOT-RENDER-CONTACT", phone: "DO-NOT-RENDER-PHONE", notes: "DO-NOT-RENDER-PRIVATE", channelId: 999 });
    await render();
    expect(runtime.query).toHaveBeenCalledTimes(1);
    expect(runtime.query).toHaveBeenCalledWith({ materialId: 101, expectedEnterpriseId: 31, expectedActorUserId: 7 }, { signal: expect.any(AbortSignal) });
    expect(name()).toBe("合法来源");
    expect(host.innerHTML).not.toMatch(/DO-NOT-RENDER|channelId|999/);
    expect(host.querySelector('select,input,textarea,a,[download]')).toBeNull();
    expect(document.activeElement).toBe(button("关闭渠道来源"));
  });

  it.each(["FORBIDDEN", "NOT_FOUND"])("keeps one stable denied dialog on resource %s without closing or retrying", async code => {
    const failure = { data: { code, businessFailure: "BUSINESS_RESOURCE_FORBIDDEN" } };
    runtime.query.mockRejectedValueOnce(failure);
    await render();
    expect(name()).toBeUndefined();
    expect(onAuthorizationError).toHaveBeenCalledWith(failure);
    expect(onClose).not.toHaveBeenCalled();
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(host.textContent).toContain("暂无权限查看");
    await render(); await settle();
    expect(runtime.query).toHaveBeenCalledTimes(1);
    expect(onAuthorizationError).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain("真实服务名称");
  });

  it("does not turn a transport error into authorization, and retry uses a fresh query", async () => {
    runtime.query.mockRejectedValueOnce(new Error("connection lost"));
    await render();
    expect(name()).toBeUndefined();
    expect(onAuthorizationError).toHaveBeenCalledWith(expect.any(Error));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("来源读取暂时失败，请重试。");
    await act(async () => button("重试读取来源").click());
    expect(runtime.query).toHaveBeenCalledTimes(2);
    expect(name()).toBe("真实服务名称");
  });

  it("clears a successful name before focus reauthorization and removes it on revocation", async () => {
    await render(); expect(name()).toBe("真实服务名称");
    const later = deferred(); runtime.query.mockReturnValueOnce(later.promise);
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(name()).toBeUndefined();
    expect(runtime.query).toHaveBeenCalledTimes(2);
    await act(async () => later.reject({ data: { code: "FORBIDDEN", businessFailure: "BUSINESS_RESOURCE_FORBIDDEN" } }));
    expect(name()).toBeUndefined(); expect(onAuthorizationError).toHaveBeenCalledWith({ data: { code: "FORBIDDEN", businessFailure: "BUSINESS_RESOURCE_FORBIDDEN" } });
    expect(host.textContent).toContain("暂无权限查看");
  });

  it("does not recover stale cached authorization on each reopening", async () => {
    await render(); expect(name()).toBe("真实服务名称");
    await act(async () => root.render(null));
    runtime.query.mockRejectedValueOnce({ data: { code: "FORBIDDEN", businessFailure: "BUSINESS_RESOURCE_FORBIDDEN" } });
    await render();
    expect(runtime.query).toHaveBeenCalledTimes(2);
    expect(name()).toBeUndefined(); expect(onAuthorizationError).toHaveBeenCalledWith({ data: { code: "FORBIDDEN", businessFailure: "BUSINESS_RESOURCE_FORBIDDEN" } });
    expect(host.textContent).toContain("暂无权限查看");
  });

  it("aborts on close/unmount and ignores a late success even if transport ignores abort", async () => {
    const late = deferred(); runtime.query.mockReturnValueOnce(late.promise);
    await render();
    const signal = runtime.query.mock.calls[0][1].signal as AbortSignal;
    await act(async () => root.render(null)); expect(signal.aborted).toBe(true);
    await act(async () => late.resolve({ name: "STALE-CLOSED-NAME" }));
    expect(host.textContent).not.toContain("STALE-CLOSED-NAME");
    expect(onAuthorizationError).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });

  it.each([
    { materialId: 202 }, { enterpriseId: 32 }, { actorUserId: 8 }, { scopeKey: "new-binding-team-role" },
  ])("clears old names and blocks older responses after subject changes %j", async change => {
    const old = deferred(); const next = deferred();
    runtime.query.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    await render(); const oldSignal = runtime.query.mock.calls[0][1].signal as AbortSignal;
    await render(change); expect(oldSignal.aborted).toBe(true);
    await act(async () => old.resolve({ name: "STALE-SUBJECT-NAME" }));
    expect(name()).toBeUndefined();
    await act(async () => next.resolve({ name: "NEW-SUBJECT-NAME" }));
    expect(name()).toBe("NEW-SUBJECT-NAME");
  });

  it("closes and aborts when the live context guard becomes false", async () => {
    const late = deferred(); runtime.query.mockReturnValueOnce(late.promise);
    await render(); const signal = runtime.query.mock.calls[0][1].signal as AbortSignal;
    current = false; await render();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1); expect(signal.aborted).toBe(true);
    await act(async () => late.resolve({ name: "STALE-REVOKED-NAME" }));
    expect(host.innerHTML).not.toContain("STALE-REVOKED-NAME");
  });

  it("coalesces a burst of focus events with an already-pending opening read", async () => {
    const first = deferred(); runtime.query.mockReturnValueOnce(first.promise);
    await render();
    const signal = runtime.query.mock.calls[0][1].signal as AbortSignal;
    await act(async () => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("focus")); });
    expect(runtime.query).toHaveBeenCalledTimes(1); expect(signal.aborted).toBe(false);
    await act(async () => first.resolve({ name: "ONLY-REQUEST" })); expect(name()).toBe("ONLY-REQUEST");
    const refresh = deferred(); runtime.query.mockReturnValueOnce(refresh.promise);
    await act(async () => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("focus")); });
    expect(runtime.query).toHaveBeenCalledTimes(2); expect(name()).toBeUndefined();
    await act(async () => refresh.resolve({ name: "REFRESHED" })); expect(name()).toBe("REFRESHED");
  });

  it("keeps the same dialog and focus while a normal same-identity check masks and resumes the read", async () => {
    await render(); expect(name()).toBe("真实服务名称");
    const dialog = host.querySelector('[role="dialog"]'); const focused = document.activeElement;
    await render({ active: false });
    expect(host.querySelector('[role="dialog"]')).toBe(dialog); expect(document.activeElement).toBe(focused);
    expect(name()).toBeUndefined(); expect(host.textContent).toContain("正在核验来源查看权限");
    await act(async () => window.dispatchEvent(new Event("focus"))); expect(runtime.query).toHaveBeenCalledTimes(1);
    await render({ active: true });
    expect(host.querySelector('[role="dialog"]')).toBe(dialog); expect(name()).toBe("真实服务名称");
    expect(runtime.query).toHaveBeenCalledTimes(2); expect(onClose).not.toHaveBeenCalled();
  });

  it("rejects a late pre-revalidation response after the same identity resumes", async () => {
    const first = deferred(); const second = deferred();
    runtime.query.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await render(); const signal = runtime.query.mock.calls[0][1].signal as AbortSignal;
    await render({ active: false }); expect(signal.aborted).toBe(true);
    await render({ active: true });
    await act(async () => second.resolve({ name: "NEW-AUTHORIZATION" }));
    await act(async () => first.resolve({ name: "LATE-OLD-AUTHORIZATION" }));
    expect(name()).toBe("NEW-AUTHORIZATION"); expect(onClose).not.toHaveBeenCalled();
  });

  it.each([
    ["UNAUTHORIZED", undefined], ["FORBIDDEN", "AUTH_SESSION_INVALID"],
    ["PRECONDITION_FAILED", "STAFF_BINDING_INVALID"], ["FORBIDDEN", "TENANT_ACCESS_REVOKED"],
  ])("clears sensitive data and reports real session failure %s/%s instead of local denial", async (code, businessFailure) => {
    await render();
    const error = { data: { code, businessFailure } }; runtime.query.mockRejectedValueOnce(error);
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(onAuthorizationError).toHaveBeenCalledWith(error); expect(name()).toBeUndefined();
    expect(host.textContent).not.toContain("暂无权限查看"); expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("clears a previously successful name on an unknown error without inventing permission denial", async () => {
    await render(); runtime.query.mockRejectedValueOnce(new Error("unknown transport"));
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(name()).toBeUndefined(); expect(host.textContent).not.toContain("暂无权限查看");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("来源读取暂时失败，请重试。");
  });

  it.each([{ code: "FORBIDDEN" }, { httpStatus: 403 }, { httpStatus: 401 }])("never treats an unclassified security refusal %j as a resource permission fact", async data => {
    await render(); const error = { data }; runtime.query.mockRejectedValueOnce(error);
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(name()).toBeUndefined(); expect(host.textContent).not.toContain("暂无权限查看");
    expect(onAuthorizationError).toHaveBeenCalledWith(error); expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });

  it.each(["escape", "outside", "close"])("supports %s close without writes", async action => {
    await render();
    await act(async () => {
      if (action === "escape") document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      if (action === "outside") (host.querySelector(".ci-modal-backdrop") as HTMLElement).click();
      if (action === "close") button("关闭渠道来源").click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(runtime.query).toHaveBeenCalledTimes(1);
  });

  it("traps Tab inside the minimal read-only dialog", async () => {
    await render();
    await act(async () => button("关闭").focus());
    await act(async () => button("关闭").dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(button("关闭渠道来源"));
    await act(async () => button("关闭渠道来源").dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(button("关闭"));
  });
});
