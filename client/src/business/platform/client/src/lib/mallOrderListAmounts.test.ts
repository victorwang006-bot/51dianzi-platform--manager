import { describe, expect, it } from "vitest";
import { sumMallOrderAmounts } from "./mallOrderListAmounts";

describe("商城订单列表精确金额合计", () => {
  it("空结果合计为零", () => expect(sumMallOrderAmounts([])).toBe("¥0.00"));
  it("不使用浮点数相加", () => expect(sumMallOrderAmounts(["0.10", "0.20"])).toBe("¥0.30"));
  it("保留四位小数", () => expect(sumMallOrderAmounts(["0.0001", "0.1234"])).toBe("¥0.1235"));
  it("大整数仍然精确", () => expect(sumMallOrderAmounts(["9007199254740993.10", "0.20"])).toBe("¥9,007,199,254,740,993.30"));
  it.each(["NaN", "1e3", "-1", "1.12345", ""])("异常值%s不伪造零金额", value => {
    expect(sumMallOrderAmounts([value])).toBe("金额数据待核验");
  });
});
