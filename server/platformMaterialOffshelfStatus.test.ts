import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const db = read("server/db.ts");
const router = read("server/routers.ts");
const panel = read("client/src/components/admin/MerchantMaterialPanel.tsx");

describe("管理后台物料下架状态", () => {
  it("只把仍在发布状态的物料原子更新为 offshelf", () => {
    const block = db.slice(
      db.indexOf("export async function offshelfPlatformInventory"),
      db.indexOf("// ─── 企业公司信息墙"),
    );
    expect(block).toContain("SET status = 'offshelf', publishedAt = NULL");
    expect(block).toContain("offshelfBy = 'admin'");
    expect(block).toContain("i.status = 'published'");
    expect(block).not.toContain("SET status = 'draft'");
  });

  it("路由和界面统一说明进入已下架列表", () => {
    const routeBlock = router.slice(
      router.indexOf("platformMaterial: router"),
      router.indexOf("// ─── 管理员管理"),
    );
    expect(routeBlock).toContain("进入已下架（offshelf）");
    expect(panel).toContain("已进入前台\\u201c已下架\\u201d列表");
    expect(panel).toContain("进入商户的“已下架”列表");
    expect(panel).toContain('item.status === "offshelf" && item.offshelfBy === "admin"');
    expect(panel).not.toContain("下架后物料回到前台“待发布”列表");
  });
});
