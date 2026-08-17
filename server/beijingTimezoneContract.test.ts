/**
 * 后台时间展示的北京时间契约。
 *
 * 【为什么需要这组测试】
 * 后台消息中心曾出现「客户 00:24 提问、客服 03:54 回复」的诡异记录，
 * 排查后确认：数据库存的是正确的北京时间（16:24 / 19:54），
 * 服务器时区也是 Asia/Shanghai，问题出在前端调用
 * `toLocaleString("zh-CN")` 时**没有指定 timeZone**——
 * `zh-CN` 只决定语言与格式习惯，不决定时区，
 * 因此渲染结果会跟着访问者电脑的时区设置漂移。
 *
 * 前台仓库早前已修复同类问题并建立了 `shared/beijingTime.ts` 与契约测试，
 * 但管理端当时被遗漏，导致同一个坑踩了第二次。
 * 本文件把约束固化到管理端，防止再次回退。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BEIJING_TIME_ZONE,
  formatBeijingDate,
  formatBeijingDateTime,
  formatBeijingDateTimeWithSeconds,
  formatBeijingTime,
  getBeijingDateParts,
} from "../shared/beijingTime";

const ROOT = join(__dirname, "..");

function readSource(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

describe("北京时间格式化行为", () => {
  it("时区常量必须锁定为 Asia/Shanghai", () => {
    expect(BEIJING_TIME_ZONE).toBe("Asia/Shanghai");
  });

  it("UTC 输入必须换算为北京时间的时分", () => {
    // 08:24:59 UTC = 16:24 北京时间，正是本次问题记录的真实时刻
    expect(formatBeijingTime("2026-08-17T08:24:59.000Z")).toBe("16:24");
  });

  it("日期必须输出零填充的横线格式", () => {
    expect(formatBeijingDate("2026-08-17T08:24:59.000Z")).toBe("2026-08-17");
  });

  it("日期时间必须统一为 YYYY-MM-DD HH:mm，不出现斜杠", () => {
    const formatted = formatBeijingDateTime("2026-08-17T08:24:59.000Z");
    expect(formatted).toBe("2026-08-17 16:24");
    expect(formatted).not.toContain("/");
  });

  it("秒级格式用于订单与物料等需要精确时刻的位置", () => {
    expect(formatBeijingDateTimeWithSeconds("2026-08-17T11:54:54.000Z")).toBe(
      "2026-08-17 19:54:54",
    );
  });

  it("跨日的 UTC 时间必须按北京时间归到次日", () => {
    // 20:00 UTC 已是北京时间次日 04:00
    expect(formatBeijingDateTime("2026-08-17T20:00:00.000Z")).toBe(
      "2026-08-18 04:00",
    );
  });

  it("空值与非法输入必须安全降级，不得抛错或输出 Invalid Date", () => {
    for (const value of [null, undefined, "", "not-a-date"]) {
      expect(formatBeijingDateTime(value)).toBe("");
      expect(formatBeijingDate(value)).toBe("");
    }
  });

  it("编号用的日期分量必须取北京时区，跨日边界不得错位", () => {
    // 2026-08-17T16:24:59Z 在北京时间已是 18 日 00:24
    expect(getBeijingDateParts("2026-08-17T16:24:59.000Z")).toEqual({
      year: 2026,
      month: 8,
      day: 18,
    });
    expect(getBeijingDateParts(null)).toBeNull();
  });
});

describe("后台页面必须统一走北京时间模块", () => {
  /** 所有展示业务时间的后台文件。新增此类页面时必须一并登记。 */
  const timeRenderingFiles = [
    "client/src/components/admin/shared.tsx",
    "client/src/pages/Messages.tsx",
    "client/src/components/admin/MerchantMaterialPanel.tsx",
    "client/src/pages/Orders.tsx",
    "client/src/pages/PortalUsers.tsx",
    "client/src/pages/MerchantDetail.tsx",
  ];

  it("这些文件都必须引用共享的北京时间模块", () => {
    for (const file of timeRenderingFiles) {
      expect(
        readSource(file),
        `${file} 未引用 @shared/beijingTime`,
      ).toContain("@shared/beijingTime");
    }
  });

  it("不得再出现未指定时区的日期时间格式化", () => {
    // 纯数字的 toLocaleString（金额、数量）与时区无关，不在拦截范围。
    // 这里只拦截把 Date 转成文本却没锁时区的写法。
    const offenders: string[] = [];
    for (const file of timeRenderingFiles) {
      readSource(file)
        .split("\n")
        .forEach((line, index) => {
          const isDateFormat =
            /new Date\([^)]*\)\.toLocale(String|DateString|TimeString)\(/.test(line) ||
            /\.toLocale(DateString|TimeString)\(/.test(line) ||
            /\bd\.toLocaleString\(/.test(line);
          if (!isDateFormat) return;
          if (line.includes("timeZone")) return;
          offenders.push(`${file}:${index + 1}: ${line.trim()}`);
        });
    }
    expect(
      offenders,
      `以下位置缺少时区限定：\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("服务端编号生成不得使用本地时区的日期方法", () => {
    const source = readSource("server/db.ts");
    const offenders: string[] = [];
    source.split("\n").forEach((line, index) => {
      // 编号拼接场景：同一行里既取日期分量又参与模板字符串拼接
      if (!/getFullYear\(\)|getMonth\(\)|getDate\(\)/.test(line)) return;
      if (line.trimStart().startsWith("*")) return; // 注释说明不算
      offenders.push(`server/db.ts:${index + 1}: ${line.trim()}`);
    });
    expect(
      offenders,
      `编号生成必须经由 getBeijingDateParts()：\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

describe("双仓一致性", () => {
  it("北京时间模块必须标注与前台同步的要求", () => {
    const source = readSource("shared/beijingTime.ts");
    // 该模块在前台与管理端各有一份，注释需提醒同步，避免口径再次分岔
    expect(source).toContain("双仓一致");
    expect(source).toContain("51dianzi-platform");
  });

  it("模块内所有格式化函数都必须显式传入时区常量", () => {
    const source = readSource("shared/beijingTime.ts");
    const localeCalls = source
      .split("\n")
      .filter((line) => /\.toLocale(String|DateString|TimeString)\(/.test(line));
    expect(localeCalls.length).toBeGreaterThan(0);
    // 逐个调用向后取 6 行，确认选项对象里带 timeZone
    const lines = source.split("\n");
    const missing: string[] = [];
    lines.forEach((line, index) => {
      if (!/\.toLocale(String|DateString|TimeString)\(/.test(line)) return;
      const window = lines.slice(index, index + 6).join("\n");
      if (!window.includes("timeZone")) {
        missing.push(`shared/beijingTime.ts:${index + 1}: ${line.trim()}`);
      }
    });
    expect(
      missing,
      `以下调用缺少 timeZone：\n${missing.join("\n")}`,
    ).toEqual([]);
  });
});
