/**
 * 管理后台浏览器标签页图标（favicon）契约。
 *
 * 【背景】
 * 后台标签页长期显示浏览器默认地球图标。前台仓库已于 5f37add 补齐 favicon，
 * 但管理端是独立仓库，当时未同步，导致后台仍缺失。
 *
 * 【易混点】
 * 页面内 LOGO 与标签页 favicon 是两套独立机制：
 * - 页面内 LOGO：client/src/components/Logo.tsx 的内嵌 SVG 组件
 * - 标签页 favicon：client/public/ 下的位图 + index.html 的 <link rel="icon">
 * 二者不能互相替代。`Logo.tsx` 曾有一个 `LOGO_URL` 导出并注释
 * 「仅为兼容保留（favicon 等场景）」，但它既无人引用、
 * 又指向已失效的 /manus-storage/ 路径，反而误导后人以为 favicon 已配置，
 * 故一并删除。
 *
 * 本测试锁定图标资源与声明的完整性，防止再次漏配或被误删。
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const publicDir = resolve(root, "client/public");
const html = readFileSync(resolve(root, "client/index.html"), "utf8");

/** 图标文件及其最小合理字节数（防止空文件或占位文件通过检查）。 */
const ICONS: Array<{ file: string; minBytes: number }> = [
  { file: "favicon.ico", minBytes: 1000 },
  { file: "favicon-16x16.png", minBytes: 200 },
  { file: "favicon-32x32.png", minBytes: 400 },
  { file: "favicon-96x96.png", minBytes: 1000 },
  { file: "favicon-192x192.png", minBytes: 2000 },
  { file: "favicon-512x512.png", minBytes: 5000 },
  { file: "apple-touch-icon.png", minBytes: 2000 },
];

describe("管理后台 favicon 资源", () => {
  it("七个图标文件必须存在于 client/public 且非空占位", () => {
    for (const { file, minBytes } of ICONS) {
      const path = resolve(publicDir, file);
      expect(existsSync(path), `缺少图标文件 ${file}`).toBe(true);
      expect(
        statSync(path).size,
        `${file} 体积异常偏小，疑似空文件或占位文件`,
      ).toBeGreaterThan(minBytes);
    }
  });

  it("PNG 图标必须有合法文件头", () => {
    for (const { file } of ICONS.filter((i) => i.file.endsWith(".png"))) {
      const buf = readFileSync(resolve(publicDir, file));
      // PNG magic number: 89 50 4E 47
      expect(
        buf.subarray(0, 4).toString("hex"),
        `${file} 不是合法 PNG`,
      ).toBe("89504e47");
    }
  });

  it("favicon.ico 必须是合法 ICO 且内嵌 3 个尺寸", () => {
    const buf = readFileSync(resolve(publicDir, "favicon.ico"));
    // ICO header: reserved(2)=0, type(2)=1, count(2)
    expect(buf.readUInt16LE(0)).toBe(0);
    expect(buf.readUInt16LE(2)).toBe(1);
    expect(
      buf.readUInt16LE(4),
      "favicon.ico 应内嵌 16/32/48 三种尺寸以兼容旧浏览器与系统快捷方式",
    ).toBe(3);
  });
});

describe("管理后台 favicon 声明", () => {
  it("必须声明 .ico 作为通用回退", () => {
    expect(html).toContain('<link rel="icon" href="/favicon.ico" sizes="any" />');
  });

  it("必须声明 16/32/96/192 四种 PNG 尺寸", () => {
    for (const size of [16, 32, 96, 192]) {
      expect(
        html,
        `缺少 ${size}x${size} 的 PNG icon 声明`,
      ).toContain(`sizes="${size}x${size}" href="/favicon-${size}x${size}.png"`);
    }
  });

  it("必须声明 apple-touch-icon 供 iOS 添加到主屏幕使用", () => {
    expect(html).toContain('rel="apple-touch-icon"');
    expect(html).toContain('href="/apple-touch-icon.png"');
  });

  it("所有图标路径必须是根绝对路径", () => {
    // 后台有 /messages、/merchants 等多级路由，
    // 相对路径会被解析到 /messages/favicon.ico 之类的错误位置并 404
    const hrefs = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]*href="([^"]+)"/g)]
      .map((m) => m[1]);
    expect(hrefs.length, "未找到任何 icon 声明").toBeGreaterThanOrEqual(6);
    for (const href of hrefs) {
      expect(href.startsWith("/"), `图标路径 ${href} 不是根绝对路径`).toBe(true);
    }
  });

  it("声明的每个图标文件都必须真实存在，避免 404", () => {
    const hrefs = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]*href="([^"]+)"/g)]
      .map((m) => m[1].replace(/^\//, ""));
    for (const file of hrefs) {
      expect(
        existsSync(resolve(publicDir, file)),
        `index.html 声明了 /${file} 但文件不存在`,
      ).toBe(true);
    }
  });
});

describe("与前台的一致性", () => {
  it("不得残留指向已失效 manus-storage 路径的 LOGO 引用", () => {
    // 旧的 LOGO_URL 指向 /manus-storage/...，迁移到 ECS 后该路径已不可用；
    // 其注释声称用于 favicon，容易误导后人以为已配置
    const logoSource = readFileSync(
      resolve(root, "client/src/components/Logo.tsx"),
      "utf8",
    );
    expect(logoSource).not.toContain("export const LOGO_URL");
    expect(logoSource).not.toContain("/manus-storage/");
  });

  it("页面内 LOGO 仍必须是内嵌 SVG，不得改为依赖 favicon 位图", () => {
    // 内嵌 SVG 的优势是任意缩放不失真、不依赖外部资源
    const logoSource = readFileSync(
      resolve(root, "client/src/components/Logo.tsx"),
      "utf8",
    );
    expect(logoSource).toContain("<svg");
    expect(logoSource).toContain("currentColor");
  });
});
