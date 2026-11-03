// @vitest-environment jsdom
import * as React from "react";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import {
  ADMIN_SYSTEM_RELEASE,
  WorkspaceTabs,
} from "./AdminWorkspaceNavigation";

it("exposes the exact UI release and Beijing timezone without changing navigation labels", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, React });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        createElement(WorkspaceTabs, {
          items: [{ path: "/staff", label: "员工管理" }],
          location: "/staff",
          onNavigate: vi.fn(),
        })
      );
    });
    const nav = host.querySelector("nav");
    expect(ADMIN_SYSTEM_RELEASE).toBe("20261103-channel-import-org-v4");
    expect(nav?.dataset.systemVersion).toBe(ADMIN_SYSTEM_RELEASE);
    expect(nav?.dataset.displayTimeZone).toBe("Asia/Shanghai");
    expect(nav?.title).toContain(`系统版本：${ADMIN_SYSTEM_RELEASE}`);
    expect(nav?.title).toContain("北京时间（UTC+8）");
    expect(nav?.textContent).toBe("组织与权限");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
