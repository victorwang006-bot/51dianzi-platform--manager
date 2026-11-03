// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  archive: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  member: vi.fn(),
  refresh: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  overview: {
    available: true,
    serverScope: { isSuperAdmin: true },
    teams: [{ id: 2, name: "空团队", status: "active", revision: 5 }],
    members: [] as {
      adminUserId: number;
      teamId: number;
      role: string;
      revision: number;
      officialPermissions: string[];
    }[],
  },
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    officialTeams: {
      archive: {
        useMutation: () => ({ mutateAsync: state.archive, isPending: false }),
      },
      create: {
        useMutation: () => ({ mutateAsync: state.create, isPending: false }),
      },
      update: {
        useMutation: () => ({ mutateAsync: state.update, isPending: false }),
      },
      setMember: {
        useMutation: () => ({ mutateAsync: state.member, isPending: false }),
      },
    },
  },
}));
vi.mock("sonner", () => ({
  toast: { success: state.success, error: state.error },
}));
vi.mock("@/lib/officialChannelInventoryUi", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@/lib/officialChannelInventoryUi")
  >()),
  readOfficialTeamsOverview: () => state.overview,
}));
import OfficialTeamPermissionSection from "./OfficialTeamPermissionSection";
let root: Root;
let host: HTMLDivElement;
function button(label: string) {
  const result = Array.from(document.querySelectorAll("button")).find(
    item => item.textContent === label
  );
  if (!result) throw new Error(`Button not found: ${label}`);
  return result;
}
async function click(label: string) {
  await act(async () => {
    button(label).click();
    await Promise.resolve();
  });
}
async function render() {
  await act(async () => {
    root.render(
      React.createElement(OfficialTeamPermissionSection, {
        adminUserId: 30004,
        hasRealAdminAccount: true,
        targetIsSuperAdmin: true,
        overviewData: {},
        overviewLoading: false,
        overviewError: null,
        onRetryOverview: state.refresh,
      })
    );
  });
}
beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  state.overview.serverScope.isSuperAdmin = true;
  state.overview.members = [];
  state.archive.mockResolvedValue({ success: true });
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true)
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
describe("Employee-page existing team management deletion", () => {
  it("shows existing teams and deletion without assigning this employee first", async () => {
    await render();
    await click("管理团队");
    expect(document.body.textContent).toContain("现有团队");
    expect(button("创建团队")).toBeTruthy();
    expect(button("删除")).toBeTruthy();
    await click("删除");
    expect(window.confirm).toHaveBeenCalledWith(
      "删除团队“空团队”？员工和历史资料保留。"
    );
    expect(state.archive).toHaveBeenCalledOnce();
    expect(state.archive.mock.calls[0][0]).toMatchObject({
      id: 2,
      expectedRevision: 5,
      requestId: expect.any(String),
    });
    expect(state.refresh).toHaveBeenCalledOnce();
    expect(state.success).toHaveBeenCalledWith("团队已删除");
    expect(state.create).not.toHaveBeenCalled();
  });
  it("does not send deletion when confirmation is cancelled", async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    await render();
    await click("管理团队");
    await click("删除");
    expect(state.archive).not.toHaveBeenCalled();
  });
  it("requires moving existing members out before deletion", async () => {
    state.overview.members = [
      {
        adminUserId: 30009,
        teamId: 2,
        role: "member",
        revision: 1,
        officialPermissions: [],
      },
    ];
    await render();
    await click("管理团队");
    await click("删除");
    expect(state.error).toHaveBeenCalledWith("请先移出团队成员");
    expect(window.confirm).not.toHaveBeenCalled();
    expect(state.archive).not.toHaveBeenCalled();
  });
  it("does not expose writable management to an unprivileged account", async () => {
    state.overview.serverScope.isSuperAdmin = false;
    await render();
    expect(button("管理团队").disabled).toBe(true);
    expect(state.archive).not.toHaveBeenCalled();
  });
});
