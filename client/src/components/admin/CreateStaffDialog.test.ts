// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  create: vi.fn(),
  operations: vi.fn(),
  official: vi.fn(),
  changed: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    adminUser: {
      create: { useMutation: () => ({ mutateAsync: state.create }) },
    },
    staffOrganization: {
      setMember: { useMutation: () => ({ mutateAsync: state.operations }) },
    },
    officialTeams: {
      setMember: { useMutation: () => ({ mutateAsync: state.official }) },
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
import CreateStaffDialog, { staffCreateError } from "./CreateStaffDialog";
let host: HTMLDivElement;
let root: Root;
const teams = [
  { domain: "operations" as const, id: 1, name: "运营团队" },
  { domain: "official" as const, id: 1, name: "官方团队" },
];
async function render(canManageAdmin = true, open = true) {
  await act(async () =>
    root.render(
      React.createElement(CreateStaffDialog, {
        open,
        onOpenChange: state.close,
        canManageAdmin,
        teams,
        onChanged: state.changed,
      })
    )
  );
}
async function input(id: string, value: string) {
  await act(async () => {
    const element = document.getElementById(id) as HTMLInputElement;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function select(value: string) {
  await act(async () => {
    const element = document.getElementById(
      "staff-create-team"
    ) as HTMLSelectElement;
    element.value = value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function fill() {
  await input("staff-create-username", "new.staff");
  await input("staff-create-name", "新员工");
  await input("staff-create-phone", "13800000000");
  await input("staff-create-password", "password123");
}
async function submit() {
  await act(async () =>
    document
      .querySelector("[role=dialog] form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
}
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  state.create.mockResolvedValue({ id: 456 });
  state.operations.mockResolvedValue({ success: true });
  state.official.mockResolvedValue({ success: true });
  state.changed.mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
describe("CreateStaffDialog", () => {
  it("creates an ordinary account with explicit minimal native permission and no ERP/scope grants", async () => {
    await render();
    await fill();
    await submit();
    expect(state.create).toHaveBeenCalledWith({
      username: "new.staff",
      displayName: "新员工",
      phone: "13800000000",
      password: "password123",
      adminRole: "merchant_mgr",
      permissions: ["materials.read"],
      salesStaffCodes: [],
    });
    expect(state.operations).not.toHaveBeenCalled();
    expect(state.official).not.toHaveBeenCalled();
    expect(state.close).toHaveBeenCalledWith(false);
    expect(state.changed).toHaveBeenCalled();
  });
  it("routes the same numeric team ID to the selected domain and only adds a member", async () => {
    await render();
    await fill();
    await select("official:1");
    await submit();
    expect(state.operations).not.toHaveBeenCalled();
    expect(state.official).toHaveBeenCalledWith(
      expect.objectContaining({
        adminUserId: 456,
        teamId: 1,
        role: "member",
        expectedRevision: 0,
      })
    );
    expect(state.official.mock.calls[0][0]).not.toHaveProperty(
      "officialPermissions"
    );
  });
  it("preserves created ID after assignment fails and retries the same idempotent assignment only", async () => {
    state.operations.mockRejectedValueOnce(new Error("团队暂不可用"));
    await render();
    await fill();
    await select("operations:1");
    await submit();
    expect(document.querySelector("[role=alert]")?.textContent).toContain(
      "员工已创建，分组失败，请重试"
    );
    expect(document.body.textContent).toContain("员工 ID 456 已创建");
    expect(state.close).not.toHaveBeenCalled();
    expect(
      (document.getElementById("staff-create-password") as HTMLInputElement)
        .value
    ).toBe("");
    const firstPayload = state.operations.mock.calls[0][0];
    await submit();
    expect(state.create).toHaveBeenCalledTimes(1);
    expect(state.operations).toHaveBeenCalledTimes(2);
    expect(state.operations.mock.calls[1][0]).toEqual(firstPayload);
    expect(state.close).toHaveBeenCalledWith(false);
  });
  it.each(["operations", "official"] as const)("locks an unconfirmed %s assignment across switching and reopening, then replays the committed request", async domain => {
    const mutation = domain === "operations" ? state.operations : state.official;
    const other = domain === "operations" ? state.official : state.operations;
    let committed: unknown;
    mutation.mockImplementation(async payload => {
      if (!committed) {
        committed = { ...payload };
        throw new Error("响应丢失（服务端已提交 revision 1）");
      }
      // Model server replay before CAS: a changed request would conflict.
      if (JSON.stringify(payload) !== JSON.stringify(committed))
        throw new Error("revision conflict");
      return { success: true };
    });
    await render();
    await fill();
    await select(`${domain}:1`);
    await submit();
    const teamSelect = () => document.getElementById("staff-create-team") as HTMLSelectElement;
    expect(teamSelect().disabled).toBe(true);
    expect(state.close).not.toHaveBeenCalled();
    await select(`${domain === "operations" ? "official" : "operations"}:1`);
    expect(teamSelect().value).toBe(`${domain}:1`);
    await select("");
    expect(teamSelect().value).toBe(`${domain}:1`);
    await select(`${domain}:1`);
    await act(async () => {
      const close = Array.from(document.querySelectorAll("button")).find(button => button.textContent === "稍后分组")!;
      close.click();
    });
    expect(state.close).toHaveBeenCalledWith(false);
    await render(true, false);
    await render();
    expect(document.body.textContent).toContain("员工 ID 456 已创建");
    expect(teamSelect().disabled).toBe(true);
    expect(teamSelect().value).toBe(`${domain}:1`);
    state.close.mockClear();
    await submit();
    expect(state.create).toHaveBeenCalledTimes(1);
    expect(mutation).toHaveBeenCalledTimes(2);
    expect(mutation.mock.calls[1][0]).toEqual(committed);
    expect(other).not.toHaveBeenCalled();
    expect(state.close).toHaveBeenCalledWith(false);
  });
  it("blocks duplicate submits synchronously while account creation is pending", async () => {
    let finish!: (value: { id: number }) => void;
    state.create.mockReturnValue(
      new Promise(resolve => {
        finish = resolve;
      })
    );
    await render();
    await fill();
    await act(async () => {
      const form = document.querySelector("[role=dialog] form")!;
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      );
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      );
    });
    expect(state.create).toHaveBeenCalledTimes(1);
    await act(async () => finish({ id: 456 }));
  });
  it("does not mutate when caller cannot manage admin accounts", async () => {
    await render(false);
    await submit();
    expect(state.create).not.toHaveBeenCalled();
    expect(state.operations).not.toHaveBeenCalled();
  });
  it("keeps server validation errors concise and does not report success on create failure", async () => {
    state.create.mockRejectedValueOnce(
      new Error(JSON.stringify([{ message: "用户名已存在" }]))
    );
    await render();
    await fill();
    await submit();
    expect(document.querySelector("[role=alert]")?.textContent).toBe(
      "用户名已存在"
    );
    expect(state.close).not.toHaveBeenCalled();
    expect(
      staffCreateError(new Error("普通用户至少需要一个业务模块权限"))
    ).toBe("普通用户至少需要一个业务模块权限");
  });
  it("does not duplicate a successful create if cache invalidation fails", async () => {
    state.changed.mockRejectedValue(new Error("refresh failed"));
    await render();
    await fill();
    await submit();
    expect(state.create).toHaveBeenCalledTimes(1);
    expect(state.close).toHaveBeenCalledWith(false);
  });
});
