import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");
const workbench = readFileSync(new URL("../client/src/business/BusinessWorkbenchPage.tsx", import.meta.url), "utf8");

describe("原工作台根入口路由完整性", () => {
  it("/workbench 真实注册且位于原 AuthGate 内，不能仅有子页面而让根入口掉入404", () => {
    const gate = app.indexOf("<AuthGate>");
    const root = app.indexOf('<Route path={"/workbench"} component={BusinessWorkbenchRoute} />');
    const child = app.indexOf('<Route path={"/workbench/inventory"}');
    const fallback = app.indexOf("<Route component={NotFoundRoute} />");
    const close = app.indexOf("</AuthGate>", gate);
    expect(gate).toBeGreaterThan(-1);
    expect(root).toBeGreaterThan(gate);
    expect(child).toBeGreaterThan(root);
    expect(fallback).toBeGreaterThan(child);
    expect(close).toBeGreaterThan(fallback);
    expect(app).toContain('<LazyBusinessWorkbench routeBase="/workbench" />');
    expect(workbench).toContain('path="/"');
  });
});
