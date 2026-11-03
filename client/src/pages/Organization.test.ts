// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STAFF_OPERATIONS_TEMPLATES } from "@shared/staffOrganization";
const state = vi.hoisted(() => ({
  location: "/teams",
  canManage: true,
  actorId: 30004,
  nativePermissions: ["profile.manage"] as string[],
  nativeAuditRows: [] as Record<string, unknown>[],
  create: vi.fn(),
  update: vi.fn(),
  member: vi.fn(),
  template: vi.fn(),
  invalidate: vi.fn(),
  businessOverview: vi.fn(),
  businessAudit: vi.fn(),
  businessAccess: vi.fn(),
  merchants: [] as { id: number; companyName: string; merchantNo: string }[],
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 30004, role: "admin", adminRole: "super_admin" },
  }),
}));
vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", {}, children),
}));
vi.mock("wouter", () => ({
  useLocation: () => [state.location, vi.fn()],
  Link: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
  }) => React.createElement("a", { href, ...props }, children),
}));
vi.mock("@/business/api/business-trpc", () => ({
  createBusinessScopeTrpcClient: () => ({
    organization: {
      overview: { query: state.businessOverview },
      audit: { query: state.businessAudit },
      updateMemberAccess: { mutate: state.businessAccess },
    },
  }),
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
        merchants: {
          useQuery: () =>
            query({
              data: state.merchants,
              sourceTotal: state.merchants.length,
            }),
        },
      },
      staffOrganization: {
        overview: {
          useQuery: () =>
            query({
              actorAdminUserId: state.actorId,
              canManage: state.canManage,
              teams: [
                {
                  id: 1,
                  name: "运营团队",
                  notes: null,
                  status: "active",
                  revision: 1,
                },
              ],
              members: [
                {
                  adminUserId: 30004,
                  displayName: "Victor",
                  username: "admin",
                  status: "active",
                  adminRole: "super_admin",
                  teamId: 1,
                  teamRole: "leader",
                  revision: 1,
                  sessionVersion: 5,
                  operationsPermissions: ["analytics.read"],
                  permissions: ["admins.manage", "analytics.read"],
                },
                {
                  adminUserId: 30009,
                  displayName: "Ocean",
                  username: "ocean",
                  status: "active",
                  adminRole: "merchant_mgr",
                  teamId: 1,
                  teamRole: "leader",
                  revision: 1,
                  sessionVersion: 7,
                  operationsPermissions: [],
                  permissions: state.nativePermissions,
                },
              ],
              templates: STAFF_OPERATIONS_TEMPLATES,
            }),
        },
        audit: {
          useQuery: () =>
            query({
              actorAdminUserId: state.actorId,
              data: state.nativeAuditRows,
              total: state.nativeAuditRows.length,
            }),
        },
        createTeam: { useMutation: () => ({ mutateAsync: state.create }) },
        updateTeam: { useMutation: () => ({ mutateAsync: state.update }) },
        setMember: { useMutation: () => ({ mutateAsync: state.member }) },
        applyTemplate: { useMutation: () => ({ mutateAsync: state.template }) },
      },
    },
  };
});
import Organization, {
  businessOrganizationOverviewSchema,
  businessUpdateAccessResultSchema,
} from "./Organization";
let root: Root;
let host: HTMLDivElement;
let cache: QueryClient;
const modules = ["customers", "demands", "channels", "stocks"].map(module => ({
  module,
  read: true,
  write: true,
  scope: module === "stocks" ? "team" : "self",
  revision: 1,
  explicit: true,
}));
function business(canManage = false) {
  return {
    enterprise: { id: 1, name: "真实企业" },
    actorUserId: 397751,
    canManage,
    teams: [{ id: 1, name: "业务团队", status: "active", revision: 2 }],
    members: [
      {
        userId: 397751,
        username: "victor",
        name: "Victor",
        status: "active",
        enterpriseRole: canManage ? "super_admin" : "member",
        teamId: 1,
        teamRole: "leader",
        revision: 2,
        moduleAccess: modules,
      },
    ],
    templates: [],
  };
}
function button(label: string) {
  const result = Array.from(document.querySelectorAll("button")).find(
    node => node.textContent === label
  );
  if (!result) throw new Error(`button not found: ${label}`);
  return result;
}
async function click(label: string) {
  await act(async () => {
    button(label).click();
    await Promise.resolve();
  });
}
async function mount() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  cache = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  await act(async () => {
    root.render(
      React.createElement(
        QueryClientProvider,
        { client: cache },
        React.createElement(Organization)
      )
    );
  });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, React });
  vi.clearAllMocks();
  state.location = "/teams";
  state.canManage = true;
  state.actorId = 30004;
  state.merchants = [];
  state.nativePermissions = ["profile.manage"];
  state.nativeAuditRows = [];
  state.create.mockResolvedValue({
    targetId: 2,
    revision: 1,
    idempotent: false,
  });
  state.invalidate.mockResolvedValue(undefined);
  state.businessOverview.mockResolvedValue(business());
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  cache?.clear();
  host?.remove();
  document.body.innerHTML = "";
});
describe("Organization UI actual-domain controls", () => {
  it("shows audit instants in Beijing across midnight, independent of visitor timezone", async () => {
    const previous = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      state.location = "/permission-audit";
      state.nativeAuditRows = [
        {
          id: 21,
          action: "staff.member.set",
          actorAdminUserId: 30004,
          targetType: "staff_member",
          targetId: 30009,
          requestId: "timezone-check-001",
          payloadHash: "a".repeat(64),
          beforeData: { role: "member" },
          afterData: { role: "leader" },
          createdAt: "2026-11-02T16:12:13.000Z",
        },
      ];
      await mount();
      await click("运营团队");
      expect(document.body.textContent).toContain("北京时间 / 操作");
      expect(document.body.textContent).toContain("2026-11-03 00:12:13");
      expect(document.body.textContent).not.toContain("2026-11-02 08:12:13");
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
  it("no business binding/merchant disables that domain without blocking operations", async () => {
    await mount();
    expect(document.body.textContent).toContain("业务编辑已禁用");
    expect(document.body.textContent).not.toContain("创建团队");
    await click("运营团队");
    expect(button("创建团队").disabled).toBe(false);
    expect(document.body.textContent).toContain("Victor");
    expect(document.body.textContent).toContain("Ocean");
  });
  it("requires difference preview before mutation and retains inputs/request ID on retry", async () => {
    state.update
      .mockRejectedValueOnce(new Error("暂时不可用"))
      .mockResolvedValue({ targetId: 1, revision: 2 });
    await mount();
    await click("运营团队");
    await click("编辑团队");
    await click("预览变更");
    expect(state.update).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      "团队名称：运营团队 → 运营团队"
    );
    await click("确认保存");
    expect(document.body.textContent).toContain("输入已保留");
    const first = state.update.mock.calls[0][0];
    await click("重试确认保存");
    expect(state.update.mock.calls[1][0].requestId).toBe(first.requestId);
    expect(state.invalidate).toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      "列表以重新读取的服务端数据为准"
    );
  });
  it("native non-super cannot edit and stale other-account data is not displayed", async () => {
    state.canManage = false;
    await mount();
    await click("运营团队");
    expect(button("创建团队").disabled).toBe(true);
    await act(async () => {
      state.actorId = 999;
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: cache },
          React.createElement(Organization)
        )
      );
    });
    expect(document.body.textContent).not.toContain("Ocean");
    expect(document.body.textContent).not.toContain("Victor");
  });
  it("never lets native super_admin impersonate front enterprise owner", async () => {
    state.merchants = [
      { id: 30061, companyName: "真实商户", merchantNo: "M30061" },
    ];
    await mount();
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 30));
    });
    expect(document.body.textContent).toContain("不是企业所有者");
    expect(button("创建团队").disabled).toBe(true);
    expect(document.body.textContent).toContain("真实前台操作者 ID 397751");
  });
  it("template apply is disabled for super_admin but available for ordinary member", async () => {
    state.location = "/role-templates";
    await mount();
    await click("运营团队");
    const buttons = Array.from(document.querySelectorAll("button")).filter(
      node => node.textContent === "应用模板"
    );
    expect(buttons).toHaveLength(2);
    expect(buttons[0].disabled).toBe(true);
    expect(buttons[1].disabled).toBe(false);
  });
  it("previews effective native permissions and submits the overview target session CAS unchanged on retry", async () => {
    state.location = "/role-templates";
    state.nativePermissions = [
      "profile.manage",
      "materials.write",
      "business.inventory.write",
    ];
    state.template
      .mockRejectedValueOnce(
        new Error("员工权限或会话版本已变化，请刷新后重新预览")
      )
      .mockResolvedValue({ targetId: 30009, revision: 2 });
    await mount();
    await click("运营团队");
    const apply = Array.from(document.querySelectorAll("button")).find(
      node => node.textContent === "应用模板" && !node.disabled
    );
    expect(apply).toBeDefined();
    await act(async () => {
      apply!.click();
    });
    await click("预览变更");
    expect(state.template).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("移除：materials.write");
    expect(document.body.textContent).not.toContain(
      "移除：business.inventory.write"
    );
    await click("确认保存");
    expect(state.template.mock.calls[0][0]).toMatchObject({
      adminUserId: 30009,
      templateId: "operations-view",
      expectedRevision: 1,
      expectedSessionVersion: 7,
    });
    expect(document.body.textContent).toContain("输入已保留");
    await click("重试确认保存");
    expect(state.template.mock.calls[1][0]).toEqual(
      state.template.mock.calls[0][0]
    );
  });
  it("disables business module editing for the real enterprise owner's fixed rights", async () => {
    state.location = "/role-templates";
    state.merchants = [
      { id: 30061, companyName: "真实商户", merchantNo: "M30061" },
    ];
    state.businessOverview.mockResolvedValue(business(true));
    await mount();
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 30));
    });
    expect(button("配置模块").disabled).toBe(true);
    expect(document.body.textContent).toContain("企业所有者权利固定，不可更改");
    expect(state.businessAccess).not.toHaveBeenCalled();
  });
  it("reports actual ERP-denied modules after a confirmed business save, without claiming a new grant", async () => {
    state.location = "/role-templates";
    state.merchants = [
      { id: 30061, companyName: "真实商户", merchantNo: "M30061" },
    ];
    const value = business(true);
    value.members[0] = {
      ...value.members[0],
      userId: 409506,
      username: "ocean",
      name: "Ocean",
      enterpriseRole: "member",
    };
    state.businessOverview.mockResolvedValue(value);
    state.businessAccess.mockImplementation(async input => ({
      success: true,
      idempotent: false,
      erpGrantsChanged: false,
      modules: input.modules.map(
        ({
          expectedRevision,
          ...setting
        }: {
          expectedRevision: number;
          module: string;
          read: boolean;
          write: boolean;
          scope: string;
        }) => ({
          ...setting,
          read: false,
          write: false,
          revision: expectedRevision + 1,
          explicit: true,
          entitled: false,
          requested: setting,
          notEntitled: true,
        })
      ),
    }));
    await mount();
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 30));
    });
    await click("配置模块");
    const checkbox = document.querySelector<HTMLInputElement>(
      'input[type="checkbox"]'
    );
    expect(checkbox).not.toBeNull();
    await act(async () => {
      checkbox!.click();
    });
    await click("预览变更");
    expect(state.businessAccess).not.toHaveBeenCalled();
    await click("确认保存");
    expect(state.businessAccess).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain(
      "业务基础授权未开通，模板未扩大权限"
    );
    expect(document.body.textContent).toContain(
      "实际生效：客户：不可读/不可写"
    );
  });
});
describe("Business response runtime contract", () => {
  it("accepts stocks team scope with write=true, keeping other's shares read-only by domain rule", () => {
    const parsed = businessOrganizationOverviewSchema.parse(business());
    expect(
      parsed.members[0].moduleAccess.find(row => row.module === "stocks")
    ).toMatchObject({ scope: "team", write: true });
  });
  it("rejects missing actor/module fields and failed response instead of fabricating success", () => {
    expect(
      businessOrganizationOverviewSchema.safeParse({ success: false }).success
    ).toBe(false);
    expect(
      businessOrganizationOverviewSchema.safeParse({
        ...business(),
        actorUserId: undefined,
      }).success
    ).toBe(false);
    const value = business();
    value.members[0].moduleAccess = value.members[0].moduleAccess.slice(1);
    expect(businessOrganizationOverviewSchema.safeParse(value).success).toBe(
      false
    );
  });
  it("requires the full effective-access response and proof that ERP grants were unchanged", () => {
    const result = {
      success: true,
      idempotent: false,
      erpGrantsChanged: false,
      modules: modules.map(module => ({
        ...module,
        entitled: true,
        requested: {
          module: module.module,
          read: module.read,
          write: module.write,
          scope: module.scope,
        },
        notEntitled: false,
      })),
    };
    expect(businessUpdateAccessResultSchema.safeParse(result).success).toBe(
      true
    );
    expect(
      businessUpdateAccessResultSchema.safeParse({
        success: true,
        idempotent: false,
      }).success
    ).toBe(false);
    expect(
      businessUpdateAccessResultSchema.safeParse({
        ...result,
        erpGrantsChanged: true,
      }).success
    ).toBe(false);
  });
});
