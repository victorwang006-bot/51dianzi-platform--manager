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
const onDenied = vi.fn();
type Props = React.ComponentProps<typeof ChannelInventorySourcePanel>;
const props = (overrides: Partial<Props> = {}): Props => ({ materialId: 101, enterpriseId: 31, actorUserId: 7, scopeKey: "bound-team-v1", isCurrent: () => current, onClose, onDenied, ...overrides });
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
  onClose.mockReset(); onDenied.mockReset();
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

  it.each(["FORBIDDEN", "UNAUTHORIZED"])("fails closed on %s and reports the accurate denial category", async code => {
    runtime.query.mockRejectedValueOnce({ data: { code } });
    await render();
    expect(name()).toBeUndefined();
    expect(onDenied).toHaveBeenCalledWith(code === "UNAUTHORIZED");
    expect(onDenied).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain("真实服务名称");
  });

  it("does not turn a transport error into authorization, and retry uses a fresh query", async () => {
    runtime.query.mockRejectedValueOnce(new Error("connection lost"));
    await render();
    expect(name()).toBeUndefined();
    expect(onDenied).not.toHaveBeenCalled();
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
    await act(async () => later.reject({ data: { code: "FORBIDDEN" } }));
    expect(name()).toBeUndefined(); expect(onDenied).toHaveBeenCalledWith(false);
  });

  it("does not recover stale cached authorization on each reopening", async () => {
    await render(); expect(name()).toBe("真实服务名称");
    await act(async () => root.render(null));
    runtime.query.mockRejectedValueOnce({ data: { code: "FORBIDDEN" } });
    await render();
    expect(runtime.query).toHaveBeenCalledTimes(2);
    expect(name()).toBeUndefined(); expect(onDenied).toHaveBeenCalledWith(false);
  });

  it("aborts on close/unmount and ignores a late success even if transport ignores abort", async () => {
    const late = deferred(); runtime.query.mockReturnValueOnce(late.promise);
    await render();
    const signal = runtime.query.mock.calls[0][1].signal as AbortSignal;
    await act(async () => root.render(null)); expect(signal.aborted).toBe(true);
    await act(async () => late.resolve({ name: "STALE-CLOSED-NAME" }));
    expect(host.textContent).not.toContain("STALE-CLOSED-NAME");
    expect(onDenied).not.toHaveBeenCalled();
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

  it("gives only the newest focus response authority to populate the name", async () => {
    const first = deferred(); const last = deferred();
    runtime.query.mockReturnValueOnce(first.promise).mockReturnValueOnce(last.promise);
    await render();
    const oldSignal = runtime.query.mock.calls[0][1].signal as AbortSignal;
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(oldSignal.aborted).toBe(true);
    await act(async () => last.resolve({ name: "NEWEST" })); expect(name()).toBe("NEWEST");
    await act(async () => first.resolve({ name: "OLDER" })); expect(name()).toBe("NEWEST");
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
