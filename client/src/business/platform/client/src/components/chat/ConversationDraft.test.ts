// @vitest-environment jsdom
import React, { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendConversationDraft, useConversationDraft } from "./useConversationDraft";
import QuickPhrases, { DEFAULT_QUICK_PHRASES } from "./QuickPhrases";
import ChatStickerImage from "./ChatStickerImage";

(globalThis as any).React = React;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
let draft: ReturnType<typeof useConversationDraft>;
const observed: string[] = [];
function Harness({ conversationId, scopeKey, allowed }: { conversationId: number | null; scopeKey: string | null; allowed?: readonly number[] }) {
  draft = useConversationDraft(conversationId, scopeKey, allowed);
  observed.push(draft.msgInput);
  useLayoutEffect(() => { host.dataset.committedDraft = draft.msgInput; });
  return createElement("textarea", { value: draft.msgInput, onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => draft.setMsgInput(event.target.value) });
}
const renderDraft = (conversationId: number | null = 1, scopeKey: string | null = "user:1:enterprise:9:business:30061:binding:1", allowed: readonly number[] | undefined = [1, 2]) =>
  act(() => root.render(createElement(Harness, { conversationId, scopeKey, allowed })));
beforeEach(() => { observed.length = 0; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

describe("page-only conversation drafts in real React", () => {
  it("keeps separate customers, appends without changing existing text, and clears only the sent conversation", () => {
    const localWrite = vi.spyOn(Storage.prototype, "setItem");
    renderDraft(); act(() => draft.setMsgInput("客户甲\n原草稿"));
    renderDraft(2); expect(draft.msgInput).toBe("");
    act(() => draft.setMsgInput("客户乙草稿"));
    renderDraft(1); expect(draft.msgInput).toBe("客户甲\n原草稿");
    act(() => draft.setMsgInput(current => appendConversationDraft(current, "交期多久？")));
    expect(draft.msgInput).toBe("客户甲\n原草稿\n交期多久？");
    act(() => draft.setMsgInput("")); expect(draft.msgInput).toBe("");
    renderDraft(2); expect(draft.msgInput).toBe("客户乙草稿");
    expect(localWrite).not.toHaveBeenCalled();
  });

  it.each(["user:2:enterprise:9:business:30061:binding:1", "user:1:enterprise:10:business:30061:binding:1", "user:1:enterprise:9:business:30062:binding:1", "user:1:enterprise:9:business:30061:binding:2"])("isolates identity immediately and rejects an old asynchronous setter: %s", changedScope => {
    renderDraft(); act(() => draft.setMsgInput("旧客户敏感草稿")); const oldSetter = draft.setMsgInput;
    const beforeSwitch = observed.length;
    renderDraft(1, changedScope); expect(observed.slice(beforeSwitch).every(value => value === "")).toBe(true);
    act(() => oldSetter("旧异步回调")); expect(draft.msgInput).toBe("");
    renderDraft(); expect(draft.msgInput).toBe("");
    act(() => oldSetter("切回旧身份后也不能恢复")); expect(draft.msgInput).toBe("");
  });

  it("hides and deletes withdrawn conversations without deleting another customer's draft", () => {
    renderDraft(); act(() => draft.setMsgInput("甲草稿"));
    renderDraft(2); act(() => draft.setMsgInput("乙草稿"));
    const oldSetter = draft.setConversationDraft;
    renderDraft(1, undefined, [2]); expect(draft.msgInput).toBe("");
    act(() => oldSetter(1, "撤权后旧写入"));
    renderDraft(2, undefined, [2]); expect(draft.msgInput).toBe("乙草稿");
    renderDraft(); expect(draft.msgInput).toBe("");
  });

  it("clears on authorization loss/logout, never restores after regrant, and clears on global auth events", () => {
    renderDraft(); act(() => draft.setMsgInput("授权域草稿")); const stale = draft.setMsgInput;
    renderDraft(1, null); expect(draft.msgInput).toBe(""); act(() => stale("无权旧输入"));
    renderDraft(); expect(draft.msgInput).toBe(""); act(() => draft.setMsgInput("退出前草稿"));
    const preLogout = draft.setMsgInput;
    act(() => window.dispatchEvent(new Event("51dianzi:auth-session-cleared")));
    expect(draft.msgInput).toBe(""); act(() => preLogout("退出前异步输入")); expect(draft.msgInput).toBe("");
    act(() => draft.setMsgInput("跨标签退出前草稿"));
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: "51dianzi:auth-session-cleared:v1", newValue: "logout" })));
    expect(draft.msgInput).toBe("");
  });

  it("does not share drafts with a newly mounted page and ignores its retired setters", () => {
    renderDraft(); act(() => draft.setMsgInput("仅旧页面")); const old = draft.setMsgInput;
    act(() => root.unmount()); root = createRoot(host); renderDraft();
    act(() => old("卸载后的旧回调")); expect(draft.msgInput).toBe("");
  });

  it("is idempotent with null scope even when the query returns a new authorized array on every render", () => {
    let renders = 0;
    function UnstableReadonlyHarness() {
      renders += 1;
      const readonlyDraft = useConversationDraft(1, null, [1, 2]);
      return createElement("textarea", { value: readonlyDraft.msgInput, readOnly: true });
    }
    act(() => root.render(createElement(UnstableReadonlyHarness)));
    expect(host.querySelector("textarea")!.value).toBe(""); expect(renders).toBeLessThan(5);
  });
});

describe("QuickPhrases", () => {
  it("offers exactly six phrases, only invokes onSelect, and appends only after explicit selection", () => {
    const selected = vi.fn();
    act(() => root.render(createElement("form", { onSubmit: selected }, createElement(QuickPhrases, { onSelect: selected }))));
    act(() => host.querySelector("button")!.click());
    const choices = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    expect(choices.map(item => item.textContent)).toEqual([...DEFAULT_QUICK_PHRASES]);
    expect(selected).not.toHaveBeenCalled();
    act(() => choices[2].click()); expect(selected).toHaveBeenCalledTimes(1); expect(selected).toHaveBeenCalledWith("交期多久？");
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });

  it("disables the trigger and hides an open menu immediately on permission loss", () => {
    const selected = vi.fn();
    act(() => root.render(createElement(QuickPhrases, { onSelect: selected })));
    act(() => host.querySelector("button")!.click());
    act(() => root.render(createElement(QuickPhrases, { onSelect: selected, disabled: true })));
    expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
    expect(host.querySelector('[role="menu"]')).toBeNull();
    act(() => host.querySelector<HTMLButtonElement>("button")!.click()); expect(selected).not.toHaveBeenCalled();
    act(() => root.render(createElement(QuickPhrases, { onSelect: selected, disabled: false })));
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });

  it("closes on Escape and outside pointerdown", () => {
    act(() => root.render(createElement(QuickPhrases, { onSelect: vi.fn() })));
    act(() => host.querySelector("button")!.click());
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(host.querySelector('[role="menu"]')).toBeNull();
    act(() => host.querySelector("button")!.click());
    act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });
});

describe("ChatStickerImage", () => {
  it("preserves source/label/dimensions, shows an identifiable fallback on failure and retries a changed source", () => {
    const render = (src: string, alt = "开心笑脸") => act(() => root.render(createElement(ChatStickerImage,
      { src, alt, loading: "lazy", draggable: false, className: "h-24 w-24 object-contain", style: { width: 96 } })));
    render("/stickers/a.webp");
    expect(host.querySelector("img")?.getAttribute("src")).toBe("/stickers/a.webp");
    act(() => host.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(host.querySelector("img")).toBeNull();
    const fallback = host.querySelector<HTMLElement>('[role="img"]')!;
    expect(fallback.textContent).toContain("开心笑脸 · 表情暂不可用");
    expect(fallback.className).toBe("h-24 w-24 object-contain"); expect(fallback.style.width).toBe("96px");
    render("/stickers/b.webp"); expect(host.querySelector("img")).not.toBeNull();
    render("/stickers/a.webp"); expect(host.querySelector("img")).not.toBeNull();
    render("/stickers/c.webp", ""); act(() => host.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(host.textContent).toContain("表情 · 表情暂不可用");
  });
});
