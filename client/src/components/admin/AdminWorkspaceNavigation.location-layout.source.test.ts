// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const cssBytes = readFileSync(resolve(import.meta.dirname, "../DashboardLayout.css"));
const baselineBytes = 144081;
const appendedCss = cssBytes.subarray(baselineBytes).toString("utf8");
const rules: postcss.Rule[] = [];
postcss.parse(appendedCss).walkRules(rule => { rules.push(rule); });
const declarations = (rule: postcss.Rule) => Object.fromEntries(rule.nodes.filter((node): node is postcss.Declaration => node.type === "decl").map(node => [node.prop, node.value]));
const navRule = (marker: string) => rules.find(rule => rule.selector.endsWith(`> nav[data-admin-navigation="current-location"][data-admin-list-location-layout="${marker}"]`))!;
const sizingRules = rules.filter(rule => rule.selector.includes(".d51-compact-list-toolbar"));

function fixture(marker?: string, nested = false) {
  const host = document.createElement("div");
  host.innerHTML = `<div class="admin-workspace-shell" data-admin-layout="top-two-level-v1">
    <main class="admin-workspace-shell__main admin-unified-content" data-test-target="main">
      <aside data-business-navigation-state="error">原错误提示 <button>重试</button></aside>
      ${nested ? "<div>" : ""}<nav data-admin-navigation="current-location" ${marker ? `data-admin-list-location-layout="${marker}"` : ""}><ol><li><span aria-current="page">原名称</span></li></ol></nav>${nested ? "</div>" : ""}
      <section data-business-context-verification data-test-target="verification">
        <div data-business-context-content data-test-target="context"><div class="business-native-content" data-test-target="native">
          <section class="aui-page customer-list-page" data-test-target="page"><h1>原可访问标题</h1>
            <div class="d51-compact-list-toolbar"><input aria-label="原筛选"><button>原操作</button><select aria-label="原选项"></select></div>
            <table><tbody><tr><td>原数据<button>原表格操作</button></td></tr></tbody></table>
            <section class="customer-detail-compact"><h2>原详情</h2></section>
            <div role="dialog"><h2>原弹窗标题</h2><button>原弹窗操作</button></div>
          </section>
        </div></div>
      </section>
    </main>
  </div>`;
  return host;
}

describe("外层位置条 source/style 最小范围契约（非实页渲染验收）", () => {
  it("原 DashboardLayout.css 的 144081 字节/2364 行完整不变，只追加一个 scope", () => {
    expect(digest(cssBytes.subarray(0, baselineBytes))).toBe("146580f41b7f7f917ea1f1fd3074e5f4a2178a4f04d1a110d6be21a3a0773368");
    expect(cssBytes.subarray(0, baselineBytes).toString("utf8").split("\n")).toHaveLength(2364);
    expect(appendedCss.match(/admin-list-outer-location-v1 BEGIN/g)).toHaveLength(1);
    expect(appendedCss.trimEnd()).toMatch(/admin-list-outer-location-v1 END \*\/$/);
    expect(rules).toHaveLength(7);
  });

  it("完整导航源码只允许新增 helper import 与 nav marker，授权/labels/handlers 逐字节不变", () => {
    const text = readFileSync(resolve(import.meta.dirname, "AdminWorkspaceNavigation.tsx"), "utf8");
    expect(text.match(/data-admin-list-location-layout=/g)).toHaveLength(1);
    const previous = text
      .replace('import { getAdminListLocationLayout } from "./adminListLocationLayout";\n', "")
      .replace('\n      data-admin-list-location-layout={getAdminListLocationLayout(location, labels)}>', ">");
    expect(digest(previous)).toBe("5714666edd1af53c590970a6e800bec0c7ced172c1f21d01a7f494ca66e9c5ef");
  });

  it("helper 独立纯函数，不新增 canonical/权限/请求/历史/焦点逻辑", () => {
    const helper = readFileSync(resolve(import.meta.dirname, "adminListLocationLayout.ts"), "utf8");
    expect(helper).toContain('from "../../lib/channelInventoryNavigation"');
    expect(helper).not.toMatch(/fetch\s*\(|window\.|document\.|history\.|\.focus\s*\(|useEffect|useState|canonicalPath|onNavigate|trpc/);
    expect(helper.match(/export function /g)).toHaveLength(1);
  });

  it("root-hidden 是 1px clipped sr-only 绝对脱流，不用 display:none、aria-hidden 或 54px 占位", () => {
    expect(declarations(navRule("root-hidden"))).toEqual({
      position: "absolute", width: "1px", height: "1px", "min-width": "0", "min-height": "0",
      padding: "0", margin: "-1px", overflow: "hidden", clip: "rect(0, 0, 0, 0)",
      "clip-path": "inset(50%)", "white-space": "nowrap", border: "0",
    });
    expect(appendedCss).not.toMatch(/display:\s*none|visibility:\s*hidden|height:\s*54px|height:\s*28px/);
    const priority = navRule("root-hidden").nodes.filter((node): node is postcss.Declaration => node.type === "decl" && !!node.important).map(node => node.prop);
    expect(priority).toEqual(["position", "min-height", "padding", "margin"]);
  });

  it("main/native wrappers 解除旧 tracks，实际客户变体恢复 12px 行间距而不修改业务", () => {
    expect(declarations(rules[0])).toMatchObject({ display: "block", "grid-template-columns": "none", "grid-template-rows": "none", "grid-auto-rows": "auto", "padding-top": "12px" });
    expect(declarations(rules[2])).toMatchObject({ display: "block", "grid-template-columns": "none", "grid-template-rows": "none", "grid-area": "auto" });
    expect(declarations(rules[3])).toEqual({ "grid-template-columns": "minmax(0, 1fr)", "grid-template-rows": "none", "grid-auto-rows": "auto", "row-gap": "12px" });
    for (const rule of rules) for (const selector of rule.selectors) {
      expect(selector).toMatch(/^\.admin-workspace-shell\[data-admin-layout="top-two-level-v1"\] > main\.admin-workspace-shell__main\.admin-unified-content/);
      expect(selector).toContain('nav[data-admin-navigation="current-location"]');
      expect(selector).toContain("data-admin-list-location-layout=");
      expect(selector).not.toMatch(/table|dialog|data-business-navigation-state|\*|:not\(/);
      if (!sizingRules.includes(rule)) expect(selector).not.toMatch(/button|input/);
    }
  });

  it("merchant/staff 原 breadcrumb 20px/8px 并以明确优先级覆盖旧 4px，不隐藏名称", () => {
    const rule = navRule("list-breadcrumb");
    expect(declarations(rule)).toEqual({ "min-height": "20px", padding: "0", margin: "0 0 8px", "font-size": "12px", "line-height": "20px" });
    expect(rule.nodes.find(node => node.type === "decl" && node.prop === "margin")).toMatchObject({ important: true });
  });

  it("只有已标记 toolbar 的控件采用 36px/移动 40px，防止旧 small-button 28px 覆盖", () => {
    expect(sizingRules).toHaveLength(2);
    expect(declarations(sizingRules[0])).toEqual({ "box-sizing": "border-box", height: "36px", "min-height": "36px" });
    expect(declarations(sizingRules[1])).toEqual({ height: "40px", "min-height": "40px" });
    expect(sizingRules[1].parent).toMatchObject({ name: "media", params: "(max-width: 640px)" });
    for (const rule of sizingRules) {
      expect(rule.selector).toContain('.d51-compact-list-toolbar :is(input, select, button, [data-slot="select-trigger"])');
      const dimensions = rule.nodes.filter((node): node is postcss.Declaration => node.type === "decl" && ["height", "min-height"].includes(node.prop));
      expect(dimensions.every(node => node.important)).toBe(true);
    }
  });

  it("尺寸规范不匹配表格、错误提示、详情与弹窗按钮", () => {
    const host = fixture("root-hidden");
    for (const rule of sizingRules) for (const selector of rule.selectors) {
      const targets = Array.from(host.querySelectorAll(selector));
      expect(targets).toHaveLength(3);
      expect(targets.every(target => !!target.closest(".d51-compact-list-toolbar"))).toBe(true);
      expect(targets.some(target => !!target.closest('table, [role="dialog"], aside, .customer-detail-compact'))).toBe(false);
    }
  });

  it.each(["root-hidden", "list-breadcrumb"])("%s 仅匹配 main/nav/必要 wrappers 与 toolbar 控件，不影响告警/数据/详情/弹窗", marker => {
    const host = fixture(marker);
    const targets = new Set<Element>();
    for (const rule of rules) for (const selector of rule.selectors) {
      for (const target of host.querySelectorAll(selector)) targets.add(target);
    }
    expect([...targets].every(target => target.matches('[data-test-target], nav[data-admin-navigation="current-location"]') || (!!target.closest(".d51-compact-list-toolbar") && target.matches('input, select, button, [data-slot="select-trigger"]')))).toBe(true);
    expect([...targets].some(target => target.getAttribute("data-test-target") === "main")).toBe(true);
    expect([...targets].some(target => target.tagName === "NAV")).toBe(true);
    expect([...targets].some(target => target.getAttribute("data-test-target") === "native")).toBe(marker === "root-hidden");
  });

  it.each([undefined, "unknown"])("没有真实 marker (%s) 的详情/未知页不匹配新增规则", marker => {
    const host = fixture(marker);
    for (const rule of rules) for (const selector of rule.selectors) expect(host.querySelectorAll(selector)).toHaveLength(0);
  });

  it("嵌套 nav marker 不能冒充 main 直属定位条", () => {
    const host = fixture("root-hidden", true);
    for (const rule of rules) for (const selector of rule.selectors) expect(host.querySelectorAll(selector)).toHaveLength(0);
  });
});
