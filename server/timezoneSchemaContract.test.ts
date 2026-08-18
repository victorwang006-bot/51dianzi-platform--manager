import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 时区口径契约（管理端）。
 *
 * 管理端与前台**读写同一个 MySQL 库**，因此两端的时间列口径必须完全一致。
 * 若只有一端使用北京时间口径，会出现「同一行数据在前台与后台相差 8 小时」
 * ——这比原本的偏移问题更难排查，因为两边各自看都「像是对的」。
 *
 * 根因：drizzle-orm 0.44.6 的 timestamp 列硬编码按 UTC 读写
 * （mapFromDriverValue 加 "+0000"、mapToDriverValue 用 toISOString()），
 * 而库内 DATETIME 存的是北京时间字面值。
 * 给连接串加 timezone 参数无效（已实测），必须在 ORM 列类型层修正。
 */

const schemaSrc = readFileSync(join(process.cwd(), "drizzle/schema.ts"), "utf8");

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const schemaCode = stripComments(schemaSrc);

describe("时区口径契约：管理端 schema 必须与前台一致", () => {
  it("不得从 drizzle-orm/mysql-core 导入原生 timestamp", () => {
    const importBlock = schemaCode.match(
      /import\s*\{[\s\S]*?\}\s*from\s*["']drizzle-orm\/mysql-core["']/,
    );
    expect(importBlock, "未找到 drizzle-orm/mysql-core 导入语句").toBeTruthy();

    const names = importBlock![0]
      .replace(/[\s\S]*?\{/, "")
      .replace(/\}[\s\S]*/, "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);

    expect(names, "禁止导入原生 timestamp（应使用 beijingTime）").not.toContain("timestamp");
    expect(names, "必须导入 customType 以定义 beijingTime").toContain("customType");
  });

  it("必须定义 beijingTime，且读按 +08:00、写按 Asia/Shanghai", () => {
    expect(schemaCode).toContain("const beijingTime = customType<");
    expect(schemaCode, "fromDriver 必须按 +08:00 解析").toContain('"+08:00"');
    expect(schemaCode, "toDriver 必须按 Asia/Shanghai 格式化").toContain('timeZone: "Asia/Shanghai"');
    expect(schemaCode).toMatch(/const\s+timestamp\s*=\s*beijingTime/);
  });

  it("beijingTime 内不得使用 toISOString（UTC 脏数据的根因）", () => {
    const block = schemaCode.slice(
      schemaCode.indexOf("const beijingTime"),
      schemaCode.indexOf("const timestamp"),
    );
    expect(block.length, "未能定位 beijingTime 定义块").toBeGreaterThan(100);
    expect(block).not.toContain("toISOString");
  });

  it("fromDriver 必须放行已是 Date 的值，避免二次偏移", () => {
    const block = schemaCode.slice(
      schemaCode.indexOf("const beijingTime"),
      schemaCode.indexOf("const timestamp"),
    );
    expect(block).toContain("instanceof Date");
  });

  it("不得残留 .defaultNow() / .onUpdateNow()（customType 不支持，仅运行时报错）", () => {
    expect(schemaCode).not.toContain(".defaultNow()");
    expect(schemaCode).not.toContain(".onUpdateNow()");
  });

  it("必须用 DEFAULT_NOW 保留数据库默认值语义且数量不缩水", () => {
    expect(schemaCode).toMatch(/const\s+DEFAULT_NOW\s*=\s*sql`CURRENT_TIMESTAMP`/);

    // 原有 38 处 defaultNow、14 处 onUpdateNow，数量骤降说明有字段漏改
    const defaultCount = (schemaCode.match(/\.default\(DEFAULT_NOW\)/g) ?? []).length;
    expect(defaultCount, "DEFAULT_NOW 数量异常，疑有字段漏改").toBeGreaterThanOrEqual(36);

    const onUpdateCount = (schemaCode.match(/\.\$onUpdate\(/g) ?? []).length;
    expect(onUpdateCount, "$onUpdate 数量异常，updatedAt 可能不再自动更新").toBeGreaterThanOrEqual(13);
  });
});
