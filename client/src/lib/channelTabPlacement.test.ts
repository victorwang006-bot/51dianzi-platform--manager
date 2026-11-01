import fs from "node:fs";
import { describe, expect, it } from "vitest";

const official = fs.readFileSync(
  new URL("../pages/OfficialChannelInventory.tsx", import.meta.url),
  "utf8"
);
const legacy = fs.readFileSync(
  new URL(
    "../business/platform/client/src/pages/ChannelInventoryHost.tsx",
    import.meta.url
  ),
  "utf8"
);

describe("channel tabs change placement, not their functions", () => {
  it("starts official inventory on stocks with inventory first", () => {
    expect(official).toContain('useState<"sources" | "stocks">("stocks")');
    const tabs = official.slice(
      official.indexOf('aria-label="渠道库存内容"'),
      official.indexOf(
        '{tab === "sources" ? (',
        official.indexOf('aria-label="渠道库存内容"')
      )
    );
    expect(tabs.indexOf('setTab("stocks")')).toBeLessThan(
      tabs.indexOf('setTab("sources")')
    );
    expect(tabs).toMatch(/setTab\("stocks"\)[\s\S]*渠道库存/);
    expect(tabs).toMatch(/setTab\("sources"\)[\s\S]*渠道管理/);
  });
  it("retains official queries and all source/stock action mapping", () => {
    expect(official).toContain("officialChannelInventory.listSources");
    expect(official).toContain("officialChannelInventory.listStocks");
    expect(official).toContain('tab === "sources" && canCreateSource');
    expect(official).toContain('tab === "stocks" && canCreateStock');
    expect(official).toContain('openSourceEditor({ mode: "create" })');
    expect(official).toContain('openStockEditor({ mode: "create" })');
  });
  it("puts inventory first in the old admin host without rewriting the merchant authorization", () => {
    expect(legacy).toContain('useState<"channels" | "materials">("materials")');
    const tabs = legacy.slice(
      legacy.indexOf('className="ci-tabs"'),
      legacy.indexOf("{message ?", legacy.indexOf('className="ci-tabs"'))
    );
    expect(tabs.indexOf('setTab("materials")')).toBeLessThan(
      tabs.indexOf('setTab("channels")')
    );
    expect(legacy).not.toContain(
      "管理渠道资料与渠道库存。数量、价格和税务口径未确认"
    );
    expect(legacy).toContain("hasInventoryManage");
    expect(legacy).toContain('aria-label="渠道管理列表"');
  });
});
