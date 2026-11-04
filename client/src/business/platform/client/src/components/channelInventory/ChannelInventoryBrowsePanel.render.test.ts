// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelInventoryBrowsePanel } from "./ChannelInventoryBrowsePanel";
import type { InventoryManagementClient, ReadableInventoryChannel } from "./management";
let root: Root;
let container: HTMLDivElement;
const context = { expectedEnterpriseId: 31, expectedActorUserId: 7 };
const channel = (id: number): ReadableInventoryChannel => ({ id, name: `渠道-${id}` });
const privateQuery = vi.fn();
const sourcesQuery = vi.fn();
const onSelect = vi.fn();
const onAuthorizationError = vi.fn();
const client = { listChannels: { query: privateQuery }, listTeamSourceOptions: { query: sourcesQuery } } as unknown as InventoryManagementClient;
const props = { client, context, scopeKey: "scope-1", active: true, canReadChannels: true, canReadTeamSources: true, isCurrent: () => true, onSelect, onAuthorizationError };
const settle = async () => { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); }); };
const render = (extra = {}) => act(() => root.render(React.createElement(ChannelInventoryBrowsePanel, { ...props, ...extra })));
const click = (button: HTMLButtonElement) => act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const button = (name: string) => [...container.querySelectorAll("button")].find(item => item.textContent === name)!;
beforeEach(() => {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  vi.clearAllMocks();
  privateQuery.mockImplementation(async (input: { page: number }) => ({ items: Array.from({ length: input.page === 1 ? 100 : 1 }, (_, i) => channel(input.page === 1 ? i + 1 : 101)), total: 101, page: input.page, pageSize: 100, pageCount: 2 }));
  sourcesQuery.mockResolvedValue({ canFilterSource: true, items: [channel(1), channel(201)] });
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
describe("authorized channel inventory browsing", () => {
  it("reads every private page and merges only server-authorized source options without duplicates", async () => {
    render(); await settle();
    expect(privateQuery).toHaveBeenCalledTimes(2);
    expect(privateQuery.mock.calls.map(call => call[0].page)).toEqual([1, 2]);
    expect(privateQuery.mock.calls[0][0]).toMatchObject({ ...context, pageSize: 100 });
    expect(container.textContent).toContain("102 个渠道");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(20);
    click(button("下一页")); expect(container.textContent).toContain("第 2 / 6 页");
  });
  it("selects the exact server-returned channel instead of a name or current stock page", async () => {
    sourcesQuery.mockResolvedValue({ canFilterSource: true, items: [channel(201)] });
    privateQuery.mockResolvedValue({ items: [channel(201)], total: 1, page: 1, pageSize: 100, pageCount: 1 });
    render(); await settle(); click(button("查看该渠道库存"));
    expect(onSelect).toHaveBeenCalledWith({ id: 201, name: "渠道-201", canViewSource: true });
  });
  it("does not invoke private channel or team source APIs without their existing read proof", async () => {
    render({ canReadChannels: false, canReadTeamSources: false }); await settle();
    expect(privateQuery).not.toHaveBeenCalled(); expect(sourcesQuery).not.toHaveBeenCalled();
    expect(container.textContent).toContain("暂无符合条件的渠道");
  });
  it("does not treat denied source filtering as a grant", async () => {
    sourcesQuery.mockResolvedValue({ canFilterSource: false, items: [channel(999)] });
    render({ canReadChannels: false }); await settle();
    expect(privateQuery).not.toHaveBeenCalled(); expect(container.textContent).not.toContain("渠道-999");
  });
  it("drops a delayed response after the enterprise or authorization scope changes", async () => {
    let resolve!: (value: unknown) => void;
    privateQuery.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    render(); await settle(); render({ scopeKey: "scope-2", active: false });
    await act(async () => resolve({ items: [channel(999)], total: 1, page: 1, pageSize: 100, pageCount: 1 }));
    expect(container.textContent).not.toContain("渠道-999"); expect(onSelect).not.toHaveBeenCalled();
  });
});
