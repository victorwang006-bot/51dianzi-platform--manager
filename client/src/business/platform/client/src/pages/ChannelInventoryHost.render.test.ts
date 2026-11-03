// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => {
  const query = (data: unknown) => ({ data, isLoading: false, isFetching: false, isError: false, refetch: vi.fn() });
  const channel = { id: 11, name: "私有来源", type: "agent", contactName: "本人联系人", phone: null, wechat: null, qq: null, notes: "私有档案备注", active: true, revision: 4, canEdit: true, readOnly: false, updatedAt: "2026-10-02T01:00:00.000Z" };
  const stock = { id: 101, channelId: 11, channelActive: true, partNumber: "OWN-LM358", brand: "TI", qty: null, dateCode: null, price: null, taxIncluded: null, leadTime: null, note: "私有库存备注", noteCount: 0, latestNote: null, revision: 6, shareEnabled: false, canEdit: true, readOnly: false, updatedAt: "2026-10-03T01:00:00.000Z" };
  const mutation = { mutateAsync: vi.fn().mockResolvedValue({}) };
  return {
    enterprise: query({ currentUserId: 7, enterprise: { id: 31 }, permissionKeys: ["inventory.manage"] }),
    channels: query({ items: [channel], total: 1, page: 1, pageCount: 1, canWrite: true }),
    channel: query(channel),
    own: query({ items: [stock], total: 1, page: 1, pageSize: 20, canWrite: true }),
    shared: query({ items: [{ id: 202, partNumber: "TEAM-SN74", brand: "NXP", qty: 100, dateCode: null, price: "1.20", taxIncluded: true, leadTime: "3天", canEdit: false, readOnly: true, updatedAt: "2026-10-03T01:00:00.000Z" }], total: 1, page: 1, pageSize: 20 }),
    utils: { channelInventory: Object.fromEntries(["listChannels", "listMaterials", "listSharedMaterials", "notesList"].map(name => [name, { invalidate: vi.fn().mockResolvedValue(undefined) }])) },
    mutation,
  };
});

vi.mock("../../../../api/business-trpc", () => ({ trpc: {
  useUtils: () => runtime.utils,
  enterprise: { me: { useQuery: () => runtime.enterprise } },
  channelInventory: {
    listChannels: { useQuery: () => runtime.channels },
    getChannel: { useQuery: () => runtime.channel },
    listMaterials: { useQuery: () => runtime.own },
    listSharedMaterials: { useQuery: () => runtime.shared },
    createChannel: { useMutation: () => runtime.mutation },
    updateChannel: { useMutation: () => runtime.mutation },
    setChannelActive: { useMutation: () => runtime.mutation },
    createMaterial: { useMutation: () => runtime.mutation },
    updateMaterial: { useMutation: () => runtime.mutation },
    setMaterialShare: { useMutation: () => runtime.mutation },
  },
} }));

import ChannelInventoryHost from "./ChannelInventoryHost";

let root: Root;
let container: HTMLDivElement;
function button(label: string) {
  const node = Array.from(container.querySelectorAll("button")).find(item => item.textContent === label);
  if (!node) throw new Error(`Missing button ${label}`);
  return node;
}
function click(label: string) { act(() => button(label).click()); }

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(React.createElement(ChannelInventoryHost)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("后台业务镜像渠道库存 Host", () => {
  it("默认本人库存，库存优先于档案，保留简短私有标签及显式北京时间", () => {
    const tabs = container.querySelector('[aria-label="渠道库存内容"]')!;
    expect(Array.from(tabs.querySelectorAll('[role="tab"]')).map(item => item.textContent)).toEqual(["渠道库存", "渠道档案"]);
    expect(tabs.querySelector('[aria-selected="true"]')?.textContent).toBe("渠道库存");
    expect(container.textContent).toContain("OWN-LM358");
    expect(container.textContent).toContain("本人 · 私有");
    expect(container.textContent).toContain("2026-10-03 09:00");
    expect(container.textContent).not.toContain("渠道档案仅当前负责人可见");
    expect(container.textContent).not.toContain("本人负责的库存；默认不共享");
  });

  it("通过渠道档案仍可查看来源列表、打开新增和编辑并返回关联库存", () => {
    click("渠道档案");
    expect(container.querySelector('[aria-label="渠道管理列表"]')).not.toBeNull();
    expect(container.textContent).toContain("本人联系人");
    expect(container.textContent).not.toContain("负责人由服务器按当前业务分工审计");
    expect(button("停用").disabled).toBe(false);
    click("+ 新增渠道");
    expect(container.querySelector('[role="dialog"] h2')?.textContent).toBe("新增渠道");
    click("取消");
    click("编辑");
    expect(container.querySelector('[role="dialog"] h2')?.textContent).toBe("编辑渠道");
    expect(container.querySelector<HTMLInputElement>('[role="dialog"] input')?.value).toBe("私有来源");
    click("取消");
    click("查看库存");
    expect(container.querySelector('[aria-label="渠道库存内容"] [aria-selected="true"]')?.textContent).toBe("渠道库存");
    expect(container.querySelector<HTMLSelectElement>('[aria-label="筛选库存渠道范围"]')?.value).toBe("11");
  });

  it("团队共享始终只读、不显示本人来源或备注，也无编辑和共享按钮", () => {
    click("团队共享（只读）");
    expect(container.textContent).toContain("TEAM-SN74");
    expect(container.textContent).toContain("团队共享 · 只读");
    expect(container.textContent).not.toContain("OWN-LM358");
    expect(container.textContent).not.toContain("私有来源");
    expect(container.textContent).not.toContain("私有库存备注");
    expect(container.textContent).not.toContain("仅展示同队负责人显式共享且当前仍有效的库存");
    expect(container.querySelector('[aria-label="筛选库存渠道范围"]')).toBeNull();
    expect(container.querySelector('[aria-label="打开库存 202 的备注"]')).toBeNull();
    expect(Array.from(container.querySelectorAll("button")).some(item => ["编辑", "共享给同队", "+ 新增库存", "批量上传"].includes(item.textContent ?? ""))).toBe(false);
  });
});
