// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InventoryChannelSelector } from "./InventoryChannelSelector";
import type { InventoryManagementClient } from "./management";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const context = { expectedEnterpriseId: 31, expectedActorUserId: 7 };
const channels = vi.fn();
const sources = vi.fn();
const onSelect = vi.fn();
const onAvailability = vi.fn();
const onAuthorizationError = vi.fn();
const client = { listChannels: { query: channels }, listTeamSourceOptions: { query: sources } } as unknown as InventoryManagementClient;
const channel = (id: number) => ({ id, name: `授权渠道-${id}`, canViewSource: true });
const page = (ids: number[], total = ids.length, index = 1) => ({ items: ids.map(channel), total, page: index, pageSize: 100, pageCount: Math.max(1, Math.ceil(total / 100)) });
let root: Root; let container: HTMLDivElement;
function render(extra = {}) { act(() => root.render(React.createElement(InventoryChannelSelector, { client, context, scopeKey: "scope-1", active: true, canReadChannels: true, canReadTeamSources: false, isCurrent: () => true, onSelect, onAvailability, onAuthorizationError, ...extra }))); }
async function settle() { await act(async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); }); }
function select(id: string) { const input = container.querySelector("select")!; act(() => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(input, id); input.dispatchEvent(new Event("change", { bubbles: true })); }); }
beforeEach(() => { vi.clearAllMocks(); channels.mockResolvedValue(page([11, 12])); sources.mockResolvedValue({ items: [], canFilterSource: false }); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
describe("compact authorized channel selection", () => {
  it("shows only verified choices, never an all-channel option, and rejects an invented ID", async () => {
    render(); await settle(); expect(Array.from(container.querySelectorAll("option")).map(item => item.value)).toEqual(["", "11", "12"]);
    expect(container.textContent).not.toContain("全部渠道"); expect(onSelect).not.toHaveBeenCalled(); select("999"); expect(onSelect).not.toHaveBeenCalled(); select("12"); expect(onSelect).toHaveBeenCalledWith(channel(12));
  });
  it("automatically selects exactly one assigned channel", async () => {
    channels.mockResolvedValue(page([11])); render(); await settle(); expect(onSelect).toHaveBeenCalledTimes(1); expect(onSelect).toHaveBeenCalledWith(channel(11));
    expect(onAvailability).toHaveBeenLastCalledWith({ scopeKey: "scope-1", ready: true, channels: [channel(11)] });
  });
  it("does not auto-select or fall back when there are no channels", async () => {
    channels.mockResolvedValue(page([])); render(); await settle(); expect(container.textContent).toContain("暂无分配渠道"); expect(container.querySelector("select")?.disabled).toBe(true); expect(onSelect).not.toHaveBeenCalled();
    expect(onAvailability).toHaveBeenLastCalledWith({ scopeKey: "scope-1", ready: true, channels: [] });
  });
  it("checks every page and does not truncate to upload options", async () => {
    channels.mockImplementation(async ({ page: p }) => page(p === 1 ? Array.from({ length: 100 }, (_, i) => i + 1) : [101], 101, p));
    render(); await settle(); expect(channels).toHaveBeenCalledTimes(2); expect(container.querySelectorAll("option")).toHaveLength(102);
  });
  it("does not convert source denial or a source-denied row into a grant", async () => {
    channels.mockResolvedValue({ ...page([11, 12]), items: [{ ...channel(11), canViewSource: false }, channel(12)] });
    sources.mockResolvedValue({ canFilterSource: false, items: [channel(999)] }); render({ canReadTeamSources: true }); await settle(); expect(container.textContent).not.toContain("渠道-11"); expect(container.textContent).not.toContain("渠道-999"); expect(onSelect).toHaveBeenCalledWith(channel(12));
  });
  it("synchronously suspends selection proof on focus and stays closed on a denial", async () => {
    render({ selectedChannelId: 11 }); await settle(); channels.mockRejectedValue(new Error("授权已撤销"));
    act(() => window.dispatchEvent(new Event("focus"))); expect(onAvailability).toHaveBeenLastCalledWith({ scopeKey: "scope-1", ready: false, channels: [] });
    await settle(); expect(container.textContent).toContain("授权已撤销"); expect(container.textContent).not.toContain("授权渠道-11"); expect(onAuthorizationError).toHaveBeenCalled();
  });
  it("discards delayed results and aborts old reads when scope changes", async () => {
    let finish!: (value: unknown) => void; channels.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); render(); await settle();
    const signal = channels.mock.calls[0][1].signal as AbortSignal; render({ scopeKey: "scope-2", active: false }); expect(signal.aborted).toBe(true);
    await act(async () => finish(page([999]))); expect(container.textContent).not.toContain("授权渠道-999"); expect(onSelect).not.toHaveBeenCalled();
  });
  it("does not probe channel lists without either read capability", async () => {
    render({ canReadChannels: false, canReadTeamSources: false }); await settle(); expect(channels).not.toHaveBeenCalled(); expect(sources).not.toHaveBeenCalled(); expect(onSelect).not.toHaveBeenCalled();
  });
  it("fails closed when pagination totals change mid-read", async () => {
    channels.mockImplementation(async ({ page: p }) => page(p === 1 ? Array.from({ length: 100 }, (_, i) => i + 1) : [101], p === 1 ? 101 : 102, p));
    render(); await settle(); expect(container.textContent).toContain("渠道列表已变化"); expect(onSelect).not.toHaveBeenCalled(); expect(onAvailability).toHaveBeenLastCalledWith({ scopeKey: "scope-1", ready: false, channels: [] });
  });
});
