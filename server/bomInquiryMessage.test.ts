import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BOM_INQUIRY_COLUMNS,
  parseBomInquiryMessage,
} from "../client/src/lib/bomInquiryMessage";

const validContent = [
  "【BOM询价】共 2 项",
  "",
  "| 序号 | Excel行 | 料号 | 品牌 | 封装 | 数量 | AI参考价 | 位号 | 备注 |",
  "| --- | ---: | --- | --- | --- | ---: | --- | --- | --- |",
  "| 1 | 2 | STM32F103C8T6 | ST | LQFP-48 | 1000 | ¥7.60 - ¥7.84 | U1｜U2 | 主控 |",
  "| 2 | 3 | AQY4C2PX | Panasonic | DIP | 500 | — | K1 | 待核价 |",
  "",
  "询价Excel：[51电子网-BOM询价-20260808-120000.xlsx](https://51dianzi.com/manus-storage/bom-inquiries/88/51电子网-BOM询价-20260808-120000_a1b2c3d4.xlsx)",
  "",
  "说明：AI参考价仅用于采购寻源参考，不构成交易价格；最终价格以供应商报价为准。",
].join("\n");

describe("后台 BOM询价 消息表格", () => {
  it("严格解析固定九列表格并原样保留料号、价格和位号", () => {
    const parsed = parseBomInquiryMessage(validContent);
    expect(BOM_INQUIRY_COLUMNS).toEqual([
      "序号", "Excel行", "料号", "品牌", "封装", "数量", "AI参考价", "位号", "备注",
    ]);
    expect(parsed).toEqual(expect.objectContaining({
      totalItems: 2,
      title: "BOM询价 · 2项",
    }));
    expect(parsed?.rows[0]).toEqual(expect.objectContaining({
      partNumber: "STM32F103C8T6",
      aiPrice: "¥7.60 - ¥7.84",
      reference: "U1｜U2",
    }));
    expect(parsed?.disclaimer).toContain("不构成交易价格");
    expect(parsed?.fileName).toBe("51电子网-BOM询价-20260808-120000.xlsx");
    expect(parsed?.fileUrl).toContain("/manus-storage/bom-inquiries/88/");
  });

  it("标题行数、表头或分隔符不匹配时返回 null，交由普通纯文本渲染", () => {
    expect(parseBomInquiryMessage(validContent.replace("共 2 项", "共 3 项"))).toBeNull();
    expect(parseBomInquiryMessage(validContent.replace("AI参考价", "物料库参考价"))).toBeNull();
    expect(parseBomInquiryMessage(validContent.replace("| --- | ---:", "| -- | ---:"))).toBeNull();
    expect(parseBomInquiryMessage("普通客服消息\n保持原样")).toBeNull();
    const unsafe = parseBomInquiryMessage(
      validContent.replace("https://51dianzi.com/manus-storage/bom-inquiries/88/", "https://evil.example/"),
    );
    expect(unsafe?.fileName).toBeNull();
    expect(unsafe?.fileUrl).toBeNull();
  });

  it("消息页仅对识别成功的前台消息使用表格组件", () => {
    const source = readFileSync(
      resolve(process.cwd(), "client/src/pages/Messages.tsx"),
      "utf8",
    );
    expect(source).toContain('m.senderType === "portal"');
    expect(source).toContain("parseBomInquiryMessage(m.content)");
    expect(source).toContain("<BomInquiryTable message={bomMessage} />");
    expect(source).toContain("AI参考价");
    expect(source).toContain('className="max-h-[420px] overflow-auto"');
    expect(source).toContain("下载询价Excel");
  });
});
