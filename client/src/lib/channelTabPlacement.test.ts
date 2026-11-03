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
    expect(tabs.indexOf('changeTab("materials")')).toBeGreaterThanOrEqual(0);
    expect(tabs.indexOf('changeTab("channels")')).toBeGreaterThanOrEqual(0);
    expect(tabs.indexOf('changeTab("materials")')).toBeLessThan(
      tabs.indexOf('changeTab("channels")')
    );
    expect(legacy).not.toContain(
      "管理渠道资料与渠道库存。数量、价格和税务口径未确认"
    );
    expect(legacy).toContain("hasInventoryManage");
    expect(legacy).toContain('aria-label="渠道管理列表"');
  });

  it("keeps private/shared boundaries, source actions and Beijing dates while removing persistent prose", () => {
    expect(legacy).toContain('import { trpc } from "../../../../api/business-trpc"');
    expect(legacy).toContain('changeTab("channels")}>渠道档案</button>');
    expect(legacy).not.toContain("渠道档案仅当前负责人可见");
    expect(legacy).not.toContain("本人负责的库存；默认不共享");
    expect(legacy).not.toContain("仅展示同队负责人显式共享且当前仍有效的库存");
    expect(legacy).not.toContain("负责人由服务器按当前业务分工审计");
    expect(legacy).toContain("openChannelCreate");
    expect(legacy).toContain("openChannelEdit(channel)");
    expect(legacy).toContain("toggleChannel(channel)");
    expect(legacy).toContain("!material.canEdit || material.readOnly");
    expect(legacy).toContain("当前库存为只读，不能新增或修改备注。");
    expect(legacy).toContain("material.canViewSource && (material.isMine || canFilterSource)");
    expect(legacy).not.toContain("<h1>渠道库存</h1>");
    expect(legacy).not.toContain(">可见范围</th>");
    expect(legacy).toContain(">表格上传</button>");
    expect(legacy).toContain(">单条上传</button>");
    expect(legacy).toContain('className="ci-tabbar"');
    expect(legacy).toContain("该渠道本人有权读取的全部库存；不含联系人和私有备注");
    expect(legacy).toContain('return formatBeijingDateTime(value) || "—"');
    expect(legacy).not.toContain("new Intl.DateTimeFormat");
  });
});
