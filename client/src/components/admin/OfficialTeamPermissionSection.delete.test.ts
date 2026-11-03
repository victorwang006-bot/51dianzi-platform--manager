// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OfficialTeamPermissionSection, {
  type ChannelPermissionState,
  type OfficialTeamPermissionHandle,
  type StaffBusinessTeamEditor,
} from "./OfficialTeamPermissionSection";
const mocks = vi.hoisted(() => ({
  member: vi.fn(),
  refresh: vi.fn(),
  team: vi.fn(),
  teamRefresh: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    officialTeams: {
      setMember: { useMutation: () => ({ mutateAsync: mocks.member }) },
    },
  },
}));
vi.mock("sonner", () => ({ toast: { info: mocks.info, error: mocks.error } }));
let root: Root;
let host: HTMLDivElement;
let handle: React.RefObject<OfficialTeamPermissionHandle | null>;
let state: ChannelPermissionState;
function overview(
  permissions: string[] = ["officialInventory.read"],
  version = 8,
  grouped = false
) {
  return {
    currentAccess: {
      adminUserId: 1,
      isSuperAdmin: true,
      teamId: null,
      teamRole: null,
      permissions: [],
    },
    teams: grouped
      ? [{ id: 99, name: "兼容官方组", status: "active", revision: 3 }]
      : [],
    members: grouped
      ? [
          {
            adminUserId: 7,
            displayName: "Jack",
            teamId: 99,
            teamName: "兼容官方组",
            role: "leader",
            revision: 4,
            officialPermissions: permissions,
          },
        ]
      : [],
    targets: [
      {
        adminUserId: 7,
        displayName: "Jack",
        officialPermissions: permissions,
        accountVersion: version,
      },
    ],
  };
}
function business(): StaffBusinessTeamEditor {
  return {
    overview: {
      enterprise: { id: 15, name: "测试企业" },
      actorUserId: 20,
      canManage: true,
      teams: [
        { id: 11, name: "智捷团队1", status: "active", revision: 1 },
        { id: 12, name: "第二业务队", status: "active", revision: 1 },
      ],
      members: [
        {
          userId: 88,
          teamId: 11,
          teamRole: "member",
          revision: 6,
          status: "active",
          enterpriseRole: "member",
        },
      ],
    },
    frontUserId: 88,
    canEdit: true,
    onSave: mocks.team,
    onRetry: mocks.teamRefresh,
  };
}
let data = overview();
let businessEditor = business();
async function render(id = 7, real = true) {
  await act(async () =>
    root.render(
      React.createElement(OfficialTeamPermissionSection, {
        ref: handle,
        adminUserId: id,
        hasRealAdminAccount: real,
        targetIsSuperAdmin: false,
        overviewData: data,
        overviewLoading: false,
        overviewError: null,
        onRetryOverview: mocks.refresh,
        businessTeam: businessEditor,
        onStateChange: (value: ChannelPermissionState) => {
          state = value;
        },
      })
    )
  );
}
function checkbox() {
  const result = host.querySelector<HTMLButtonElement>(
    '[role="checkbox"][aria-label="查看渠道库存"]'
  );
  if (!result) throw new Error("Missing read checkbox");
  return result;
}
async function toggle() {
  await act(async () => checkbox().click());
}
async function save() {
  await act(async () => {
    await handle.current!.save();
  });
}
async function teamChange() {
  await act(async () => {
    const select = host.querySelector<HTMLSelectElement>(
      '[aria-label="渠道库存团队（业务团队）"]'
    )!;
    select.value = "12";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function receipt(permissions: string[], version = 9, grouped = false) {
  return {
    member: grouped
      ? {
          adminUserId: 7,
          displayName: "Jack",
          teamId: 99,
          teamName: "兼容官方组",
          role: "leader",
          revision: 4,
          officialPermissions: permissions,
        }
      : null,
    officialPermissions: permissions,
    revision: grouped ? 4 : 0,
    accountVersion: version,
    requestId: "synthetic_receipt_123",
    idempotent: false,
  };
}
beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  data = overview();
  businessEditor = business();
  state = { dirty: false, saving: false, canSave: false };
  handle = React.createRef();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mocks.member.mockResolvedValue(receipt([]));
  mocks.team.mockResolvedValue({
    saved: true,
    member: { ...businessEditor.overview!.members[0], teamId: 12, revision: 7 },
  });
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true)
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
describe("业务团队复用与原生 grant 回读保存（合成，无真实权限写入）", () => {
  it("Jack无官方成员行仍回显targets的查看权限，业务团队显示既有智捷团队1，不引导建同名官方组", async () => {
    await render();
    expect(checkbox().getAttribute("aria-checked")).toBe("true");
    expect(
      host.querySelector<HTMLSelectElement>(
        '[aria-label="渠道库存团队（业务团队）"]'
      )!.value
    ).toBe("11");
    expect(host.textContent).toContain("智捷团队1");
    expect(host.textContent).not.toContain("管理团队");
    expect(host.textContent).not.toContain("创建团队");
    expect(mocks.member).not.toHaveBeenCalled();
    expect(mocks.team).not.toHaveBeenCalled();
  });
  it("只改查看权限不入任何官方组，使用真实target accountVersion和无成员revision0", async () => {
    await render();
    await toggle();
    expect(state).toMatchObject({ dirty: true, canSave: true });
    await save();
    expect(mocks.member.mock.calls[0][0]).toMatchObject({
      adminUserId: 7,
      teamId: null,
      role: null,
      expectedRevision: 0,
      expectedAccountVersion: 8,
      officialPermissions: [],
    });
    expect(mocks.team).not.toHaveBeenCalled();
    expect(state.dirty).toBe(false);
    expect(host.textContent).toContain("目标员工需重新登录");
  });
  it("只改grant时保留原official teamId/role/member revision而不发送业务teamID", async () => {
    data = overview(undefined, 8, true);
    mocks.member.mockResolvedValue(receipt([], 9, true));
    await render();
    await toggle();
    await save();
    expect(mocks.member.mock.calls[0][0]).toMatchObject({
      teamId: 99,
      role: "leader",
      expectedRevision: 4,
      expectedAccountVersion: 8,
    });
  });
  it("采用mutation的新accountVersion为后续保存基线，旧overview不能冲回旧值", async () => {
    await render();
    await toggle();
    await save();
    await toggle();
    mocks.member.mockResolvedValue(receipt(["officialInventory.read"], 10));
    await save();
    expect(mocks.member.mock.calls[1][0].expectedAccountVersion).toBe(9);
    expect(state.dirty).toBe(false);
  });
  it("相同版本新overview对象不得覆盖dirty，版本变化提示冲突并禁用覆盖保存", async () => {
    await render();
    await toggle();
    data = overview();
    await render();
    expect(checkbox().getAttribute("aria-checked")).toBe("false");
    expect(state.dirty).toBe(true);
    data = overview(["officialInventory.read"], 10);
    await render();
    expect(checkbox().getAttribute("aria-checked")).toBe("false");
    expect(state.canSave).toBe(false);
    expect(host.textContent).toContain("服务端版本已变化");
    await save();
    expect(mocks.member).not.toHaveBeenCalled();
  });
  it("缺失可信target version不得以0或member grant替代", async () => {
    data = overview(undefined, 8, true);
    data.targets = [];
    await render();
    expect(checkbox().disabled).toBe(true);
    expect(state.canSave).toBe(false);
    expect(host.textContent).toContain("可信授权与账号版本");
  });
  it("仅团队修改只调用业务服务并携带其成员revision，不写原生官方成员", async () => {
    await render();
    await teamChange();
    await save();
    expect(mocks.team).toHaveBeenCalledWith({
      teamId: 12,
      teamRole: "member",
      revision: 6,
    });
    expect(mocks.member).not.toHaveBeenCalled();
    expect(state.dirty).toBe(false);
  });
  it("业务关联缺失禁用团队并解释，独立已授权grant仍如实显示", async () => {
    businessEditor = {
      ...business(),
      frontUserId: null,
      canEdit: false,
      reason: "尚未完成真实业务成员关联",
    };
    await render();
    expect(
      host.querySelector<HTMLSelectElement>(
        '[aria-label="渠道库存团队（业务团队）"]'
      )!.disabled
    ).toBe(true);
    expect(host.textContent).toContain("尚未完成真实业务成员关联");
    expect(checkbox().getAttribute("aria-checked")).toBe("true");
  });
  it("团队成功但grant失败分开反馈，保留失败grant草稿，重试不重复写已成功团队", async () => {
    mocks.member.mockRejectedValue(new Error("授权冲突"));
    await render();
    await teamChange();
    await toggle();
    await save();
    expect(host.textContent).toContain("业务团队已保存");
    expect(host.textContent).toContain("渠道库存权限未保存：授权冲突");
    expect(state.dirty).toBe(true);
    mocks.member.mockResolvedValue(receipt([]));
    await save();
    expect(mocks.team).toHaveBeenCalledTimes(1);
    expect(mocks.member).toHaveBeenCalledTimes(2);
  });
  it("团队失败但grant成功不假原子成功，重试不重复写已成功grant", async () => {
    mocks.team.mockRejectedValue(new Error("业务组版本冲突"));
    await render();
    await teamChange();
    await toggle();
    await save();
    expect(host.textContent).toContain("业务团队未保存：业务组版本冲突");
    expect(host.textContent).toContain("渠道库存权限已保存");
    expect(state.dirty).toBe(true);
    mocks.team.mockResolvedValue({
      saved: true,
      member: {
        ...businessEditor.overview!.members[0],
        teamId: 12,
        revision: 7,
      },
    });
    await save();
    expect(mocks.member).toHaveBeenCalledTimes(1);
  });
  it("不完整成功回执不冒充可信新基线，保留草稿并要求刷新核验", async () => {
    mocks.member.mockResolvedValue({ success: true });
    await render();
    await toggle();
    await save();
    expect(state).toMatchObject({ dirty: true, canSave: false });
    expect(host.textContent).toContain("缺少可信版本回执");
  });
  it("换员工隔离草稿与迟到回执，不对新员工继续第二服务写入", async () => {
    let resolveTeam!: (value: unknown) => void;
    mocks.team.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveTeam = resolve;
        })
    );
    await render();
    await teamChange();
    await toggle();
    let pending!: Promise<void>;
    await act(async () => {
      pending = handle.current!.save();
    });
    data = {
      ...overview(),
      targets: [
        {
          adminUserId: 9,
          displayName: "Other",
          officialPermissions: [],
          accountVersion: 2,
        },
      ],
    };
    businessEditor = { ...business(), frontUserId: null, canEdit: false };
    await render(9);
    await act(async () => {
      resolveTeam({ saved: true, member: null });
      await pending;
    });
    expect(mocks.member).not.toHaveBeenCalled();
    expect(state.dirty).toBe(false);
  });
});
