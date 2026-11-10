// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  query: null as any, edit: vi.fn(), add: vi.fn(), stop: vi.fn(), primary: vi.fn(),
  pending: false, dialogClose: null as (() => void) | null,
  escape: null as ((event: any) => void) | null, outside: null as ((event: any) => void) | null,
  invalidate: vi.fn().mockResolvedValue(undefined), reset: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../../../api/business-trpc", () => ({ trpc: {
  useUtils: () => ({ customer: Object.fromEntries(["contactsList", "contactsSummary", "list", "get"].map(key => [key, { invalidate: runtime.invalidate, reset: runtime.reset }])) }),
  customer: {
    contactsList: { useQuery: () => runtime.query },
    contactsEdit: { useMutation: () => ({ isPending: runtime.pending, mutateAsync: runtime.edit }) },
    contactsAdd: { useMutation: () => ({ isPending: false, mutateAsync: runtime.add }) },
    contactsStop: { useMutation: () => ({ isPending: false, mutateAsync: runtime.stop }) },
    contactsSetPrimary: { useMutation: () => ({ isPending: false, mutateAsync: runtime.primary }) },
  },
} }));
vi.mock("../ui/button", () => ({ Button: ({ children, size: _s, variant: _v, ...props }: any) => React.createElement("button", props, children) }));
vi.mock("../ui/dialog", () => ({
  Dialog: ({ children, onOpenChange }: any) => { runtime.dialogClose = () => onOpenChange(false); return children; },
  DialogContent: ({ children, onEscapeKeyDown, onInteractOutside }: any) => {
    runtime.escape = onEscapeKeyDown; runtime.outside = onInteractOutside;
    return React.createElement("div", { role: "dialog" }, children);
  },
  DialogHeader: ({ children }: any) => children, DialogTitle: ({ children }: any) => children,
  DialogDescription: ({ children }: any) => children, DialogFooter: ({ children }: any) => children,
}));
vi.mock("./CustomerContactFields", () => ({ CustomerContactDraftFields: ({ contact, onChange, disabled }: any) =>
  React.createElement("div", null,
    React.createElement("input", { "aria-label": "draft-name", value: contact.name, disabled,
      onChange: (event: any) => onChange({ ...contact, name: event.target.value }) }),
    React.createElement("button", { disabled, onClick: () => onChange({ ...contact, name: "PRIVATE CONTACT DRAFT" }) }, "change-draft"),
    React.createElement("button", { disabled, onClick: () => onChange({ ...contact, name: "A" }) }, "restore-baseline")) }));
import { CustomerContactsManager, type CustomerContactsManagerProps } from "./CustomerContactsManager";

let root: Root;
let host: HTMLDivElement;
let props: CustomerContactsManagerProps;
function render(changes: Partial<CustomerContactsManagerProps> = {}) {
  props = { ...props, ...changes }; act(() => root.render(React.createElement(CustomerContactsManager, props)));
}
function buttons(label: string): HTMLButtonElement[] { return [...host.querySelectorAll<HTMLButtonElement>("button")].filter(value => value.textContent === label); }
function click(label: string, index = 0) { const target = buttons(label)[index]; if (!target) throw new Error(`missing ${label}`); act(() => target.click()); }
async function settle() { await act(async () => { await Promise.resolve(); }); }
function draftName() { return host.querySelector<HTMLInputElement>('[aria-label="draft-name"]')?.value; }
function editDirty() { click("编辑"); click("change-draft"); expect(draftName()).toBe("PRIVATE CONTACT DRAFT"); }
const contact = (id: string, name: string, primary = false) => ({ id, name, department: "", position: "", methods: [{ type: "mobile", value: "13800138000" }], isPrimary: primary, legacy: false, authorUserId: 7, authorName: "synthetic", createdAt: null, updatedAt: null, version: 3, stoppedAt: null, canEdit: true });
beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  runtime.pending = false;
  for (const fn of [runtime.edit, runtime.add, runtime.stop, runtime.primary]) fn.mockReset().mockResolvedValue({ replayed: false });
  runtime.invalidate.mockClear(); runtime.reset.mockClear();
  runtime.query = { data: { customer: { id: 701, name: "SYNTHETIC", archivedAt: null }, canAdd: true,
    contacts: [contact("a", "A", true), contact("b", "B")] }, isPending: false, isLoading: false, isError: false, isFetching: false,
    refetch: vi.fn().mockResolvedValue({ error: null }) };
  props = { customerId: 701, open: true, scope: { actorUserId: 7, enterpriseId: 31, canManageAll: false },
    scopeReady: true, identityKey: "synthetic:7:31", onClose: vi.fn(), onDirtyChange: vi.fn(), onBusyChange: vi.fn() };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.spyOn(window, "confirm").mockReturnValue(false);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

describe("contacts draft navigation safety (synthetic API only)", () => {
  it("reports fingerprint dirty, returning exactly to baseline clean, and unload false", () => {
    render(); click("编辑"); expect(props.onDirtyChange).toHaveBeenLastCalledWith(false);
    click("change-draft"); expect(props.onDirtyChange).toHaveBeenLastCalledWith(true);
    click("restore-baseline"); expect(props.onDirtyChange).toHaveBeenLastCalledWith(false);
    act(() => root.unmount()); expect(props.onDirtyChange).toHaveBeenLastCalledWith(false); expect(props.onBusyChange).toHaveBeenLastCalledWith(false);
  });
  it.each(["取消编辑", "取消", "关闭", "dialog-close", "escape", "outside"])("%s asks one discard decision; cancel retains A, confirm alone clears", action => {
    render(); editDirty();
    const invoke = () => {
      if (action === "dialog-close") act(() => runtime.dialogClose?.());
      else if (action === "escape" || action === "outside") {
        const event = { preventDefault: vi.fn() }; act(() => (action === "escape" ? runtime.escape : runtime.outside)?.(event)); expect(event.preventDefault).toHaveBeenCalled();
      } else click(action);
    };
    invoke(); expect(window.confirm).toHaveBeenCalledTimes(1); expect(draftName()).toBe("PRIVATE CONTACT DRAFT"); expect(props.onClose).not.toHaveBeenCalled();
    vi.mocked(window.confirm).mockReturnValue(true); invoke(); expect(window.confirm).toHaveBeenCalledTimes(2); expect(draftName()).toBeUndefined();
    expect(props.onDirtyChange).toHaveBeenLastCalledWith(false);
    if (["关闭", "dialog-close", "escape", "outside"].includes(action)) expect(props.onClose).toHaveBeenCalledTimes(1);
  });
  it.each(["edit-B", "add", "stop", "primary"])("%s cannot replace dirty A until discard is confirmed", async action => {
    render(); editDirty();
    const invoke = () => action === "edit-B" ? click("编辑", 1) : action === "add" ? click("＋ 添加联系人") : action === "stop" ? click("停用") : click("设为主联系人");
    invoke(); expect(draftName()).toBe("PRIVATE CONTACT DRAFT"); expect(runtime.primary).not.toHaveBeenCalled();
    vi.mocked(window.confirm).mockReturnValue(true); invoke();
    await settle();
    expect(draftName()).toBe(action === "edit-B" ? "B" : action === "add" ? "" : undefined);
  });
  it("pending blocks close/Escape/outside/replacement; unknown keeps identical request/payload on retry", async () => {
    let reject!: (error: unknown) => void;
    runtime.edit.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    render(); editDirty(); click("保存联系人"); expect(props.onBusyChange).toHaveBeenLastCalledWith(true);
    click("关闭"); act(() => runtime.escape?.({ preventDefault: vi.fn() })); act(() => runtime.outside?.({ preventDefault: vi.fn() })); click("编辑", 1);
    expect(props.onClose).not.toHaveBeenCalled(); expect(window.confirm).not.toHaveBeenCalled(); expect(draftName()).toBe("PRIVATE CONTACT DRAFT");
    await act(async () => reject(new Error("network outcome unknown"))); await settle();
    const original = runtime.edit.mock.calls[0][0]; expect(host.textContent).toContain("正在确认操作结果"); expect(props.onBusyChange).toHaveBeenLastCalledWith(true);
    click("关闭"); expect(props.onClose).not.toHaveBeenCalled();
    click("使用相同请求重试"); await settle(); expect(runtime.edit.mock.calls[1][0]).toEqual(original);
    expect(props.onBusyChange).toHaveBeenLastCalledWith(false); expect(draftName()).toBeUndefined();
  });
  it.each(["identity", "customer", "scope-invalid"])("%s invalidation directly clears, without a discard prompt", async kind => {
    render(); editDirty();
    render(kind === "identity" ? { identityKey: "new-identity" } : kind === "customer" ? { customerId: 702 } : { scopeReady: false, scope: null });
    await settle(); expect(draftName()).toBeUndefined(); expect(window.confirm).not.toHaveBeenCalled(); expect(props.onClose).toHaveBeenCalled();
    expect(props.onDirtyChange).toHaveBeenLastCalledWith(false); expect(props.onBusyChange).toHaveBeenLastCalledWith(false);
  });
  it("old mutation hook pending does not retain a busy lock after identity invalidation", async () => {
    runtime.pending = true; render(); expect(props.onBusyChange).toHaveBeenLastCalledWith(true);
    render({ identityKey: "new-account-new-customer" }); await settle();
    expect(props.onBusyChange).toHaveBeenLastCalledWith(false); expect(window.confirm).not.toHaveBeenCalled();
    click("编辑"); expect(draftName()).toBe("A");
  });
  it("old A success after A→B→A cannot clear the new A draft or invalidate queries", async () => {
    let finish!: (result: unknown) => void; runtime.edit.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(); editDirty(); click("保存联系人");
    render({ customerId: 702 }); render({ customerId: 701 }); editDirty();
    await act(async () => finish({ replayed: false })); await settle();
    expect(draftName()).toBe("PRIVATE CONTACT DRAFT"); expect(runtime.invalidate).not.toHaveBeenCalled(); expect(host.textContent).not.toContain("已保存。");
  });
  it("archived contacts remain read-only and cannot mutate", () => {
    runtime.query.data.customer.archivedAt = "2026-01-01"; render(); click("编辑"); click("设为主联系人"); click("停用");
    expect(buttons("＋ 添加联系人")).toHaveLength(0); expect(draftName()).toBeUndefined();
    expect(runtime.edit).not.toHaveBeenCalled(); expect(runtime.primary).not.toHaveBeenCalled(); expect(runtime.stop).not.toHaveBeenCalled();
  });
});
