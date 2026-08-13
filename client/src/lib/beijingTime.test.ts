import { describe, expect, it } from "vitest";
import {
  beijingTimestamp,
  databaseBeijingTimestamp,
  formatBeijingDate,
  formatBeijingDateTime,
  formatDatabaseBeijingDate,
  formatDatabaseBeijingDateTime,
} from "./beijingTime";

describe("北京时间统一格式化", () => {
  it("将Drizzle错误编码的数据库墙上时间恢复为真实北京时间", () => {
    const drizzleValue = new Date("2026-08-13T15:46:03.000Z");
    expect(formatDatabaseBeijingDateTime(drizzleValue, "-", true)).toBe("2026/08/13 15:46:03");
    expect(databaseBeijingTimestamp(drizzleValue)).toBe(Date.parse("2026-08-13T07:46:03.000Z"));
  });

  it("将真实UTC瞬时明确转换为北京时间", () => {
    const instant = new Date("2026-08-13T07:46:03.000Z");
    expect(formatBeijingDateTime(instant, "-", true)).toBe("2026/08/13 15:46:03");
    expect(beijingTimestamp(instant)).toBe(Date.parse("2026-08-13T07:46:03.000Z"));
  });

  it("将MySQL无时区字符串明确解释为北京时间而非浏览器本地时间", () => {
    expect(formatBeijingDateTime("2026-08-13 15:46:03", "-", true)).toBe("2026/08/13 15:46:03");
  });

  it("在北京时间跨日边界区分真实瞬时与数据库墙上时间", () => {
    const encodedWallClock = new Date("2026-08-13T16:30:00.000Z");
    expect(formatDatabaseBeijingDate(encodedWallClock)).toBe("2026/08/13");
    expect(formatBeijingDate(encodedWallClock)).toBe("2026/08/14");
  });

  it("对空值和非法值使用指定回退文案", () => {
    expect(formatDatabaseBeijingDateTime(null, "—")).toBe("—");
    expect(formatBeijingDate("invalid", "待确认")).toBe("待确认");
  });
});
