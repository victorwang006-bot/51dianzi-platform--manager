// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STAFF_OPERATIONS_TEMPLATES } from "@shared/staffOrganization";

const state = vi.hoisted(() => ({
  location: "/teams",
  canManage: true,
  create: vi.fn(),
  update: vi.fn(),
  member: vi.fn(),
  template: vi.fn(),
  invalidate: vi.fn(),
  auditInputs: vi.fn(),
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, adminRole: "super_admin" } }),
}));
vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("wouter", () => ({ useLocation: () => [state.location, vi.fn()] }));
vi.mock("@/business/api/business-trpc", () => ({
  createBusinessScopeTrpcClient: vi.fn(),
}));
vi.mock("@/lib/trpc", () => {
  const query = (data: unknown) => ({
    data,
    isSuccess: true,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
  return {
    trpc: {
      useUtils: () => ({
        staffOrganization: {
          overview: { invalidate: state.invalidate },
          audit: { invalidate: state.invalidate },
        },
      }),
      business: {
        merchants: { useQuery: () => query({ data: [], sourceTotal: 0 }) },
      },
      staffOrganization: {
        overview: {
          useQuery: () =>
            query({
              actorAdminUserId: 1,
              canManage: state.canManage,
              teams: [
                {
                  id: 10,
                  name: "运营一组",
                  notes: null,
                  status: "active",
                  revision: 3,
                },
                {
                  id: 20,
                  name: "运营二组",
                  notes: null,
                  status: "active",
                  revision: 4,
                },
              ],
              members: [
                {
                  adminUserId: 1,
                  displayName: "管理员",
                  username: "admin",
                  status: "active",
                  adminRole: "super_admin",
                  teamId: 10,
                  teamRole: "leader",
                  revision: 5,
                  sessionVersion: 6,
                  operationsPermissions: ["analytics.read"],
                  permissions: ["admins.manage", "analytics.read"],
                },
                {
                  adminUserId: 2,
                  displayName: "员工甲",
                  username: "staff-a",
                  status: "active",
                  adminRole: "merchant_mgr",
                  teamId: 10,
                  teamRole: "member",
                  revision: 7,
                  sessionVersion: 8,
                  operationsPermissions: [],
                  permissions: ["profile.manage"],
                },
              ],
              templates: STAFF_OPERATIONS_TEMPLATES,
            }),
        },
        audit: {
          useQuery: (input: unknown) => {
            state.auditInputs(input);
            return query({ actorAdminUserId: 1, data: [], total: 41 });
          },
        },
        createTeam: { useMutation: () => ({ mutateAsync: state.create }) },
        updateTeam: { useMutation: () => ({ mutateAsync: state.update }) },
        setMember: { useMutation: () => ({ mutateAsync: state.member }) },
        applyTemplate: { useMutation: () => ({ mutateAsync: state.template }) },
      },
    },
  };
});

import Organization from "@/pages/Organization";
let root: Root | undefined;
let host: HTMLDivElement;
let cache: QueryClient;

function button(label: string, parent: ParentNode = document) {
  const node = Array.from(
    parent.querySelectorAll<HTMLButtonElement>("button")
  ).find(item => item.textContent === label);
  if (!node) throw new Error(`Missing button: ${label}`);
  return node;
}
async function click(label: string, parent: ParentNode = document) {
  await act(async () => button(label, parent).click());
}
async function setValue(
  node: HTMLInputElement | HTMLSelectElement,
  value: string
) {
  await act(async () => {
    const prototype =
      node instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(
      new Event(node instanceof HTMLSelectElement ? "change" : "input", {
        bubbles: true,
      })
    );
  });
}
async function mount() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  cache = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  await act(async () =>
    root!.render(
      React.createElement(
        QueryClientProvider,
        { client: cache },
        React.createElement(Organization)
      )
    )
  );
  await click("运营团队");
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, React });
  vi.clearAllMocks();
  state.location = "/teams";
  state.canManage = true;
  state.member.mockResolvedValue({ targetId: 1, revision: 6 });
  state.invalidate.mockResolvedValue(undefined);
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  cache?.clear();
  host?.remove();
  document.body.innerHTML = "";
});

describe("organization unified presentation", () => {
  it.each([
    ["/teams", "组织与团队"],
    ["/role-templates", "岗位权限模板"],
    ["/permission-audit", "权限变更审计"],
  ])(
    "uses a compact public page header, tabs, toolbar and panels on %s",
    async (route, title) => {
      state.location = route;
      await mount();
      const page = document.querySelector("[data-organization-page]")!;
      expect(page.classList.contains("aui-page")).toBe(true);
      expect(page.getAttribute("data-admin-ui-system")).toBe(
        "channel-inventory"
      );
      expect(page.querySelectorAll("h1")).toHaveLength(1);
      const heading = page.querySelector(".aui-page-header .aui-page-title")!;
      expect(heading.textContent).toBe(title);
      expect(heading.classList.contains("sr-only")).toBe(false);
      const tabs = page.querySelector('.aui-page-tabs[role="tablist"]')!;
      expect(tabs.getAttribute("aria-label")).toBe("组织领域");
      expect(tabs.querySelectorAll('[role="tab"]')).toHaveLength(2);
      expect(tabs.querySelector('[aria-selected="true"]')?.textContent).toBe(
        "运营团队"
      );
      expect(
        page.querySelector(
          '.org-toolbar.aui-filterbar[aria-label="组织工具栏"]'
        )
      ).not.toBeNull();
      expect(
        page.querySelectorAll(".org-panel.aui-data-panel").length
      ).toBeGreaterThan(0);
      expect(page.querySelector('nav[aria-label="组织页面"]')).toBeNull();
    }
  );

  it("retains team selection, member search and clearing without writes", async () => {
    await mount();
    const teams = document.querySelector('[aria-label="团队列表"]')!;
    const members = document.querySelector('[aria-label="成员列表"]')!;
    expect(teams.getAttribute("role")).toBe("region");
    expect(
      members.querySelector('.aui-filterbar[aria-label="成员筛选"]')
    ).not.toBeNull();
    expect(members.querySelector("table.org-actions-table")).not.toBeNull();
    await click("运营二组", teams);
    expect(
      teams.querySelector('[data-team-id="20"]')?.getAttribute("data-selected")
    ).toBe("true");
    expect(members.textContent).toContain("0 位成员");
    expect(members.textContent).not.toContain("员工甲");
    await click("清除筛选", members);
    await setValue(
      document.querySelector<HTMLInputElement>('[aria-label="搜索成员"]')!,
      "staff-a"
    );
    expect(members.textContent).toContain("员工甲");
    expect(members.textContent).not.toContain("管理员");
    await setValue(
      document.querySelector<HTMLInputElement>('[aria-label="搜索团队"]')!,
      "二组"
    );
    expect(teams.querySelectorAll("[data-team-id]")).toHaveLength(1);
    expect(state.member).not.toHaveBeenCalled();
    expect(state.update).not.toHaveBeenCalled();
  });

  it("keeps member relationship changes behind the original preview and revision check", async () => {
    await mount();
    await click("配置团队");
    await setValue(
      document.querySelector<HTMLSelectElement>('[role="dialog"] select')!,
      ""
    );
    await click("预览变更");
    expect(state.member).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "不会迁移官方库存"
    );
    await click("确认保存");
    expect(state.member).toHaveBeenCalledWith(
      expect.objectContaining({
        adminUserId: 1,
        teamId: null,
        role: null,
        expectedRevision: 5,
        requestId: expect.stringMatching(/^org_/),
      })
    );
    expect(state.invalidate).toHaveBeenCalled();
  });

  it("keeps team deletion and authorization guards unchanged", async () => {
    await mount();
    const populated = document.querySelector('[data-team-id="10"]')!;
    expect(button("删除", populated).disabled).toBe(true);
    expect(button("删除", populated).title).toBe("请先移出团队成员");
    state.location = "/role-templates";
    await act(async () =>
      root!.render(
        React.createElement(
          QueryClientProvider,
          { client: cache },
          React.createElement(Organization)
        )
      )
    );
    const apply = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button")
    ).filter(node => node.textContent === "应用模板");
    expect(apply.map(node => node.disabled)).toEqual([true, false]);
    expect(document.querySelector("table.org-actions-table")).not.toBeNull();
    expect(state.template).not.toHaveBeenCalled();
  });

  it("does not enable writes or claim full team totals for non-managers", async () => {
    state.canManage = false;
    await mount();
    expect(document.body.textContent).toContain("当前可见 2 位，非团队总人数");
    for (const label of ["创建团队", "编辑团队", "配置团队", "删除"]) {
      expect(button(label).disabled).toBe(true);
    }
  });

  it("retains the 20-row audit page queries and previous/next availability", async () => {
    state.location = "/permission-audit";
    await mount();
    expect(state.auditInputs).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 20,
    });
    expect(button("上一页").disabled).toBe(true);
    await click("下一页");
    expect(state.auditInputs).toHaveBeenLastCalledWith({
      page: 2,
      pageSize: 20,
    });
    await click("下一页");
    expect(button("下一页").disabled).toBe(true);
    expect(document.querySelector(".org-pagination")?.textContent).toContain(
      "第 3 页 · 共 41 条"
    );
    await click("上一页");
    expect(state.auditInputs).toHaveBeenLastCalledWith({
      page: 2,
      pageSize: 20,
    });
  });

  it("uses compact local control/heading sizes and right-aligned actions without scaling hacks", () => {
    const css = readFileSync("client/src/pages/Organization.css", "utf8");
    expect(css).toMatch(/h2\s*\{\s*font-size:\s*var\(--admin-content-section-title-size, 15px\)/);
    expect(css).toMatch(/min-height:\s*var\(--admin-content-control-height, 32px\)/);
    expect(css).toMatch(/border-radius:\s*6px/);
    expect(css).toMatch(
      /\.org-actions-table td:last-child\s*\{\s*text-align:\s*right/
    );
    expect(css).not.toMatch(
      /!important|\bzoom\s*:|\btransform\s*:|font-size:\s*22px|min-height:\s*36px/
    );
  });
});
