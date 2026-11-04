// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  result: null as any, inputs: [] as any[], options: [] as any[],
  add: vi.fn(), edit: vi.fn(), complete: vi.fn(), close: vi.fn(),
}));
vi.mock("../../../../../api/business-trpc", () => ({ trpc: {
  useUtils: () => ({ client: { channelInventory: { collaborationNotesAdd: { mutate: runtime.add }, collaborationNotesEdit: { mutate: runtime.edit } } } }),
  channelInventory: { collaborationNotesList: { useQuery: (input: unknown, options: unknown) => { runtime.inputs.push(input); runtime.options.push(options); return runtime.result; } } },
} }));
import { CollaborationNotesPanel } from "./CollaborationNotesPanel";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const own = { id: 501, materialId: 101, authorUserId: 7, authorName: "本人作者", content: "协作核实交期", revision: 4, createdAt: "2026-11-03T01:00:00.000Z", updatedAt: "2026-11-03T02:00:00.000Z", canEdit: true };
const peer = { ...own, id: 502, authorUserId: 8, authorName: "团队同事", content: "团队同事的协作备注", canEdit: false };
const fixture = (overrides: Record<string, unknown> = {}) => ({ data: { items: [own, peer], total: 2, page: 1, pageSize: 20, canAdd: true }, isLoading: false, isError: false, error: new Error("read error"), refetch: vi.fn().mockResolvedValue(undefined), ...overrides });
let root: Root | null;
let host: HTMLDivElement;
let allowed = true;
let props: React.ComponentProps<typeof CollaborationNotesPanel>;
function render(overrides: Partial<typeof props> = {}) {
  props = { ...props, ...overrides };
  act(() => root?.render(React.createElement(CollaborationNotesPanel, props)));
}
function button(text: string) {
  const element = Array.from(document.querySelectorAll("button")).find(item => item.textContent?.trim() === text);
  if (!element) throw new Error(`Missing button ${text}`);
  return element;
}
function click(element: Element) { act(() => { element.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); }
function textarea() {
  const element = document.querySelector("textarea");
  if (!element) throw new Error("Missing note input");
  return element;
}
function type(content: string) {
  const element = textarea();
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(element, content);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function settle() { await act(async () => { await Promise.resolve(); }); }
beforeEach(() => {
  runtime.result = fixture(); runtime.inputs = []; runtime.options = [];
  runtime.add.mockReset().mockResolvedValue({ item: own }); runtime.edit.mockReset().mockResolvedValue({ item: own });
  runtime.complete.mockReset(); runtime.close.mockReset(); allowed = true;
  props = { materialId: 101, partNumber: "LM358DR", brand: "TI", enterpriseId: 31, actorUserId: 7, canAddNote: true, isCurrent: () => allowed, onClose: runtime.close, onComplete: runtime.complete };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root?.unmount()); root = null; document.body.replaceChildren(); });

describe("isolated public collaboration notes", () => {
  it("lists only collaboration author/time/content and exposes edit only to the author", () => {
    render();
    expect(document.body.textContent).toContain("本人作者");
    expect(document.body.textContent).toContain("团队同事的协作备注");
    expect(document.body.textContent).toContain("2026-11-03 09:00");
    expect(document.body.textContent).toContain("修改于 2026-11-03 10:00");
    expect(document.querySelectorAll(".ci-note-entry button")).toHaveLength(1);
    expect(document.body.textContent).not.toContain("原库存备注");
    expect(runtime.inputs.at(-1)).toEqual({ materialId: 101, page: 1, pageSize: 20, expectedEnterpriseId: 31, expectedActorUserId: 7 });
    expect(runtime.options.at(-1)).toMatchObject({ retry: false, refetchOnWindowFocus: true, trpc: { abortOnUnmount: true } });
  });

  it("does not grant leader-like canEdit flags on somebody else's note", () => {
    runtime.result = fixture({ data: { items: [{ ...peer, canEdit: true }], total: 1, canAdd: true } });
    render();
    expect(document.querySelector(".ci-note-entry button")).toBeNull();
    expect(runtime.edit).not.toHaveBeenCalled();
  });

  it("keeps history and add input together, focuses a populated dialog and stays open after saving", async () => {
    render(); await settle();
    const dialog = document.querySelector('[role="dialog"]');
    expect(document.activeElement).toBe(dialog);
    expect(document.querySelector('[aria-label="协作备注历史"]')?.textContent).toContain(peer.content);
    expect(document.querySelector('[aria-label="新增协作备注"]')).not.toBeNull();
    const saved = { ...own, id: 503, content: "只读成员也能写协作信息" };
    runtime.result.refetch.mockImplementationOnce(async () => {
      runtime.result = fixture({ data: { items: [saved, own, peer], total: 3, page: 1, pageSize: 20, canAdd: true } });
      render();
    });
    type("只读成员也能写协作信息");
    click(button("保存协作备注")); await settle();
    expect(runtime.add).toHaveBeenCalledWith({ materialId: 101, content: "只读成员也能写协作信息", expectedEnterpriseId: 31, expectedActorUserId: 7, requestId: expect.stringMatching(/^[a-f0-9-]{36}$/i) }, { signal: expect.any(AbortSignal) });
    expect(runtime.edit).not.toHaveBeenCalled();
    expect(runtime.complete).toHaveBeenCalledTimes(1);
    expect(runtime.close).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    expect(document.querySelectorAll(".ci-note-entry")).toHaveLength(3);
    expect(document.querySelector('[aria-label="协作备注历史"]')?.textContent).toContain(saved.content);
    expect(textarea().value).toBe("");
    expect(button("保存协作备注").disabled).toBe(true);
    expect(document.body.textContent).not.toContain("原库存备注");
  });

  it("waits for the first successful zero-note load before focusing input, and never refocuses on refresh", async () => {
    runtime.result = fixture({ data: undefined, isLoading: true });
    render();
    expect(document.activeElement).toBe(document.querySelector('[role="dialog"]'));
    expect(document.querySelector("textarea")).toBeNull();
    runtime.result = fixture({ data: { items: [], total: 0, page: 1, pageSize: 20, canAdd: true } });
    render(); await settle();
    expect(document.activeElement).toBe(textarea());
    expect(document.querySelector('[aria-label="协作备注历史"]')?.textContent).toContain("暂无协作备注");
    button("刷新备注").focus();
    runtime.result = fixture({ data: { items: [], total: 0, page: 1, pageSize: 20, canAdd: true }, isFetching: true });
    render();
    expect(document.activeElement).toBe(button("刷新备注"));
    runtime.result = fixture({ data: { items: [], total: 0, page: 1, pageSize: 20, canAdd: true } });
    render();
    expect(document.activeElement).toBe(button("刷新备注"));
  });

  it("does not take focus when populated history becomes empty later", () => {
    render();
    button("刷新备注").focus();
    runtime.result = fixture({ data: { items: [], total: 0, canAdd: true } }); render();
    expect(document.activeElement).toBe(button("刷新备注"));
  });

  it("does not take focus if the user moved before the initial zero-note load completed", () => {
    runtime.result = fixture({ data: undefined, isLoading: true }); render();
    button("刷新备注").focus();
    runtime.result = fixture({ data: { items: [], total: 0, canAdd: true } }); render();
    expect(document.activeElement).toBe(button("刷新备注"));
  });

  it.each(["server", "row", "native"])("shows history but no add area when %s denies adding, with no zero-note focus", denial => {
    runtime.result = fixture({ data: { items: [], total: 0, canAdd: denial !== "server" } });
    render({ canAddNote: denial !== "row", canWriteNote: denial !== "native" });
    expect(document.querySelector('[aria-label="协作备注历史"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="新增协作备注"]')).toBeNull();
    expect(document.querySelector("textarea")).toBeNull();
    expect(document.body.textContent).toContain("当前不可新增协作备注");
    expect(document.activeElement).toBe(document.querySelector('[role="dialog"]'));
  });

  it("allows only author editing without granting add or somebody else's edit rights", async () => {
    runtime.result = fixture({ data: { items: [own, { ...peer, canEdit: true }], total: 2, canAdd: false } });
    render({ canAddNote: false });
    expect(document.querySelector("textarea")).toBeNull();
    expect(document.querySelectorAll(".ci-note-entry button")).toHaveLength(1);
    click(button("修改我的备注"));
    expect(document.activeElement).toBe(textarea());
    type("只有作者能改的协作记录"); click(button("保存备注修改")); await settle();
    expect(runtime.edit).toHaveBeenCalledWith(expect.objectContaining({ noteId: own.id, expectedRevision: own.revision }), { signal: expect.any(AbortSignal) });
    expect(runtime.add).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-label="协作备注历史"]')).not.toBeNull();
    expect(document.querySelector("textarea")).toBeNull();
    expect(runtime.close).not.toHaveBeenCalled();
  });

  it("preserves draft, focus and selection through refetch without taking focus back", () => {
    render(); textarea().focus();
    type("未完成的协作草稿"); const input = textarea(); input.setSelectionRange(2, 4);
    runtime.result = fixture(); render();
    expect(textarea()).toBe(input); expect(input.value).toBe("未完成的协作草稿");
    expect(document.activeElement).toBe(input); expect(input.selectionStart).toBe(2);
    button("刷新备注").focus(); render();
    expect(document.activeElement).toBe(button("刷新备注"));
  });

  it("keeps an add draft through notes pagination and continues adding from history", () => {
    runtime.result = fixture({ data: { items: [own], total: 45, page: 1, pageSize: 20, canAdd: true } });
    render(); type("翻页不丢失的草稿"); click(button("下一页"));
    expect(runtime.inputs.at(-1)).toMatchObject({ page: 2 });
    expect(textarea().value).toBe("翻页不丢失的草稿");
    expect(document.querySelector('[aria-label="新增协作备注"]')).not.toBeNull();
  });

  it("sends author note CAS with no material/private/ownership fields", async () => {
    render(); click(button("修改我的备注")); await settle();
    type("作者自己的修改"); click(button("保存备注修改")); await settle();
    expect(runtime.edit).toHaveBeenCalledWith({ noteId: 501, expectedRevision: 4, content: "作者自己的修改", expectedEnterpriseId: 31, expectedActorUserId: 7, requestId: expect.stringMatching(/^[a-f0-9-]{36}$/i) }, { signal: expect.any(AbortSignal) });
    expect(runtime.add).not.toHaveBeenCalled();
    expect(runtime.edit.mock.calls[0][0]).not.toHaveProperty("authorUserId");
    expect(runtime.edit.mock.calls[0][0]).not.toHaveProperty("materialId");
  });

  it.each(["add", "edit"])("freezes %s content and request ID after unknown results", async mode => {
    const mutation = mode === "add" ? runtime.add : runtime.edit;
    mutation.mockRejectedValueOnce(new Error("response unknown")).mockResolvedValueOnce({ item: own });
    render();
    if (mode === "edit") click(button("修改我的备注"));
    type("未知请求不重复提交");
    click(button(mode === "add" ? "保存协作备注" : "保存备注修改")); await settle();
    expect(textarea().disabled).toBe(true); expect(button("关闭").disabled).toBe(true);
    expect(document.body.textContent).toContain("保存结果未确认");
    const original = mutation.mock.calls[0][0];
    click(button("按原请求重试")); await settle();
    expect(mutation.mock.calls[1][0]).toEqual(original);
    expect(runtime.complete).toHaveBeenCalledTimes(1);
  });

  it("unlocks a definitive CAS conflict without silently advancing its revision", async () => {
    runtime.edit.mockRejectedValueOnce(Object.assign(new Error("备注已由另一会话修改，请刷新"), { data: { code: "CONFLICT" } }));
    render(); click(button("修改我的备注")); type("保留冲突时自己的草稿");
    click(button("保存备注修改")); await settle();
    expect(textarea().disabled).toBe(false); expect(textarea().value).toBe("保留冲突时自己的草稿");
    expect(document.body.textContent).toContain("另一会话修改");
    expect(runtime.result.refetch).toHaveBeenCalled();
    expect(runtime.edit.mock.calls[0][0].expectedRevision).toBe(4);
    expect(runtime.complete).not.toHaveBeenCalled();
  });

  it("clears a definitive add failure's frozen request before a new save", async () => {
    runtime.add.mockRejectedValueOnce(Object.assign(new Error("新增条件已变化"), { data: { code: "PRECONDITION_FAILED" } }));
    render(); type("明确失败的原草稿"); click(button("保存协作备注")); await settle();
    const original = runtime.add.mock.calls[0][0];
    expect(textarea().disabled).toBe(false);
    expect(button("关闭").disabled).toBe(false);
    expect(runtime.result.refetch).toHaveBeenCalledTimes(1);
    type("重新核实后的新草稿"); click(button("保存协作备注")); await settle();
    expect(runtime.add.mock.calls[1][0].requestId).not.toBe(original.requestId);
    expect(runtime.add.mock.calls[1][0].content).toBe("重新核实后的新草稿");
    expect(runtime.complete).toHaveBeenCalledTimes(1);
    expect(runtime.close).not.toHaveBeenCalled();
  });

  it("fails closed when live add or author-edit rights are revoked", async () => {
    render(); type("权限撤销后的草稿");
    render({ canAddNote: false });
    expect(document.querySelector("textarea")).toBeNull();
    expect(runtime.add).not.toHaveBeenCalled();
    render({ canAddNote: true }); click(button("修改我的备注")); type("待保存修改");
    runtime.result = fixture({ data: { items: [{ ...own, canEdit: false }], total: 1, canAdd: true } }); render();
    expect(button("保存备注修改").disabled).toBe(true); expect(textarea().disabled).toBe(true);
    click(button("保存备注修改")); await settle(); expect(runtime.edit).not.toHaveBeenCalled();
  });

  it("aborts pending writes on unmount and suppresses stale completion", async () => {
    let finish!: () => void;
    runtime.add.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    render(); type("将被清理的旧上下文草稿"); click(button("保存协作备注"));
    const signal = runtime.add.mock.calls[0][1].signal as AbortSignal;
    await act(async () => root?.unmount()); root = null; allowed = false;
    expect(signal.aborted).toBe(true);
    await act(async () => { finish(); await Promise.resolve(); });
    expect(runtime.complete).not.toHaveBeenCalled();
    expect(runtime.result.refetch).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("将被清理的旧上下文草稿");
  });

  it("traps keyboard focus, supports Escape and restores the opening trigger", async () => {
    const trigger = document.createElement("button"); trigger.textContent = "备注入口"; document.body.prepend(trigger); trigger.focus();
    render(); await settle();
    const last = button("保存协作备注"); type("可保存内容"); last.focus();
    act(() => last.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
    expect(document.activeElement?.getAttribute("aria-label")).toBe("关闭协作备注");
    act(() => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(runtime.close).toHaveBeenCalledTimes(1);
    await act(async () => root?.unmount()); root = null;
    expect(document.activeElement).toBe(trigger);
  });

  it("rejects whitespace-only or overlong content without a mutation", async () => {
    render(); type(" "); expect(button("保存协作备注").disabled).toBe(true);
    type("字".repeat(2001)); click(button("保存协作备注")); await settle();
    expect(document.body.textContent).toContain("1 到 2000 字"); expect(runtime.add).not.toHaveBeenCalled();
  });

  it("exports the real panel DOM with long model, history and input when explicitly requested", () => {
    render({ partNumber: "TPS7A4701RGWRABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-LONG-ALPHABETIC-MODEL", brand: "TEXAS INSTRUMENTS" });
    expect(document.querySelectorAll(".ci-note-entry")).toHaveLength(2);
    expect(document.querySelector('[aria-label="新增协作备注"] textarea')).not.toBeNull();
    if (process.env.NOTES_DOM_FIXTURE_DIR) {
      mkdirSync(process.env.NOTES_DOM_FIXTURE_DIR, { recursive: true });
      writeFileSync(resolve(process.env.NOTES_DOM_FIXTURE_DIR, "v18-collaboration-panel.html"), `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>真实协作备注组件 DOM</title></head><body>${host.innerHTML}</body></html>\n`);
    }
  });
});


let denialCommits: string[] = [];
function DenialCommitProbe() {
  React.useLayoutEffect(() => { denialCommits.push(host.innerHTML); });
  return React.createElement(CollaborationNotesPanel, props);
}
function renderDenialProbe() { act(() => root?.render(React.createElement(DenialCommitProbe))); }

describe("R3 immediate read-denial cleanup", () => {
  it.each(["FORBIDDEN", "NOT_FOUND", "UNAUTHORIZED", "context"])("masks old author-edit data in the first committed DOM for %s while parent row remains mounted", code => {
    renderDenialProbe(); click(button("修改我的备注")); type("PREVIOUSLY-AUTHORIZED-EDIT-DRAFT");
    expect(textarea().value).toBe("PREVIOUSLY-AUTHORIZED-EDIT-DRAFT");
    const oldData = runtime.result.data; denialCommits = [];
    if (code === "context") allowed = false;
    else runtime.result = fixture({ data: oldData, isError: true, error: Object.assign(new Error("当前库存不可读"), { data: { code } }) });
    renderDenialProbe();
    expect(denialCommits.length).toBeGreaterThan(0);
    expect(denialCommits[0]).not.toContain("PREVIOUSLY-AUTHORIZED-EDIT-DRAFT");
    expect(denialCommits[0]).not.toContain("协作核实交期");
    expect(denialCommits[0]).not.toContain("团队同事的协作备注");
    expect(denialCommits[0]).not.toContain("/ 2000");
    expect(denialCommits[0]).not.toContain("textarea");
    expect(document.querySelector("textarea")).toBeNull();
    expect(button("关闭").disabled).toBe(false);
    expect(runtime.edit).not.toHaveBeenCalled();
  });

  it("releases an unknown write lock on explicit read denial so close remains usable", async () => {
    runtime.edit.mockRejectedValueOnce(new Error("unknown write response"));
    renderDenialProbe(); click(button("修改我的备注")); type("UNKNOWN-WRITE-OLD-CONTENT");
    click(button("保存备注修改")); await settle();
    expect(button("关闭").disabled).toBe(true);
    const signal = runtime.edit.mock.calls[0][1].signal as AbortSignal;
    runtime.result = fixture({ data: runtime.result.data, isError: true, error: Object.assign(new Error("访问已撤销"), { data: { code: "FORBIDDEN" } }) });
    denialCommits = []; renderDenialProbe();
    expect(denialCommits[0]).not.toContain("UNKNOWN-WRITE-OLD-CONTENT");
    expect(signal.aborted).toBe(true);
    expect(button("关闭").disabled).toBe(false);
    click(button("关闭")); expect(runtime.close).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain("按原请求重试");
  });

  it("aborts a pending write when list rejects read and ignores its stale completion", async () => {
    let finish!: () => void;
    runtime.edit.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    renderDenialProbe(); click(button("修改我的备注")); type("PENDING-OLD-EDIT"); click(button("保存备注修改"));
    const signal = runtime.edit.mock.calls[0][1].signal as AbortSignal;
    runtime.result = fixture({ data: runtime.result.data, isError: true, error: Object.assign(new Error("访问已撤销"), { data: { code: "NOT_FOUND" } }) });
    renderDenialProbe(); expect(signal.aborted).toBe(true); expect(button("关闭").disabled).toBe(false);
    await act(async () => { finish(); await Promise.resolve(); });
    expect(runtime.complete).not.toHaveBeenCalled();
    expect(document.body.innerHTML).not.toContain("PENDING-OLD-EDIT");
  });

  it("does not treat a temporary network error as a definitive read denial", async () => {
    renderDenialProbe(); click(button("修改我的备注")); type("NETWORK-RETRY-OWN-DRAFT");
    runtime.result = fixture({ data: runtime.result.data, isError: true, error: new Error("network disconnected") });
    renderDenialProbe();
    expect(textarea().value).toBe("NETWORK-RETRY-OWN-DRAFT");
    expect(textarea().disabled).toBe(true);
    expect(button("关闭").disabled).toBe(false);
    runtime.result = fixture(); renderDenialProbe();
    expect(textarea().value).toBe("NETWORK-RETRY-OWN-DRAFT");
    expect(button("保存备注修改").disabled).toBe(false);
  });
});
