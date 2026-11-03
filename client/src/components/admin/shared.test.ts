import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EmptyState, PageHeader, StatusBadge, formatDateTime } from "./shared";

const originalReact = (globalThis as typeof globalThis & { React?: unknown }).React;
beforeAll(() => Object.assign(globalThis, { React }));
afterAll(() => {
  if (originalReact === undefined) {
    delete (globalThis as typeof globalThis & { React?: unknown }).React;
  } else {
    Object.assign(globalThis, { React: originalReact });
  }
});

describe("shared admin secondary-copy policy", () => {
  it.each([
    ["商户管理", "ERP 开通审核、账号绑定、协议状态与结算账户配置"],
    ["物料数据库", "电子元器件物料主数据管理：型号、品牌、封装、参数与生命周期"],
    ["员工与权限", "统一管理团队成员、后台角色、ERP 权限与数据范围。"],
    ["用户管理", "普通用户创建后自动生成销售身份并默认绑定本人；可追加其他普通用户形成主管范围"],
    ["组织管理", "业务团队使用真实前台企业身份；运营团队使用独立后台工作人员身份。两域分别保存、分别审计，不是跨库单事务；岗位与模块授权互不替代。"],
  ])("renders %s without its persistent introductory description", (title, description) => {
    const html = renderToStaticMarkup(React.createElement(PageHeader, { title, description }));
    expect(html).toContain(`<h1 class="text-xl font-semibold text-foreground">${title}</h1>`);
    expect(html).not.toContain(description);
    expect(html).not.toContain("<p");
  });

  it("keeps action controls, disabled state and their short status text", () => {
    const html = renderToStaticMarkup(React.createElement(PageHeader, {
      title: "员工与权限",
      actions: React.createElement("button", { type: "button", disabled: true }, "请先关联员工"),
    }));
    expect(html).toContain('class="flex shrink-0 flex-wrap items-center gap-2"');
    expect(html).toContain('<button type="button" disabled="">请先关联员工</button>');
  });

  it.each(["加载失败，请重试", "无权限", "请先关联员工"])("does not suppress operational messages: %s", message => {
    const html = renderToStaticMarkup(React.createElement(EmptyState, { message }));
    expect(html).toContain(message);
  });

  it.each(["私有", "共享", "只读"])("preserves short status labels: %s", label => {
    expect(renderToStaticMarkup(React.createElement(StatusBadge, { label, style: "gray" }))).toContain(label);
  });

  it("leaves the shared Beijing-time formatter unchanged", () => {
    const result = formatDateTime("2026-11-03T01:00:00.000Z");
    expect(result).toBe("2026-11-03 09:00");
    expect(formatDateTime(null)).toBe("-");
  });
});
