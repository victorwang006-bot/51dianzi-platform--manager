import * as XLSX from "xlsx";

/**
 * BOM 询价单 Excel 生成。
 *
 * 用于把「无合格现货」的 BOM 行导出成一份可直接转给供应商的报价表，
 * 随后台询价消息一并下发。时间戳固定按 Asia/Shanghai 生成，
 * 保证无论服务器时区如何配置，文件名与业务方看到的北京时间一致。
 */

export const BOM_INQUIRY_EXCEL_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * 询价单单次最多包含的行数，与撑合上限 BOM_MATCH_MAX_ROWS 对齐。
 *
 * 早期为 50，低于撑合上限 200，造成一张 BOM 能撑合出的无现货行反而无法
 * 一次性询价：前端只能默认勾选前 50 项、其余行静默不勾，用户容易漏发。
 */
export const BOM_INQUIRY_MAX_ITEMS = 200;

export interface BomInquiryExcelRow {
  excelRow: number;
  partNumber: string;
  quantity: number;
  brand?: string;
  pkg?: string;
  reference?: string;
  note?: string;
  referencePrice?: string;
  /** 兼容旧页面提交的字段。 */
  aiPrice?: string;
  /** 未匹配原因，由匹配引擎回填 */
  unmatchedReason: string;
}

/** 生成 Asia/Shanghai 时区的 YYYYMMDD-HHmmss 时间戳 */
function shanghaiStamp(date: Date): string {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("year")}${part("month")}${part("day")}-${part("hour")}${part("minute")}${part("second")}`;
}

export function buildBomInquiryExcel(
  rows: BomInquiryExcelRow[],
  generatedAt: Date = new Date(),
): { fileName: string; buffer: Buffer } {
  if (rows.length < 1 || rows.length > BOM_INQUIRY_MAX_ITEMS) {
    throw new Error(`BOM 询价 Excel 必须包含 1 至 ${BOM_INQUIRY_MAX_ITEMS} 行`);
  }

  const matrix: unknown[][] = [
    ["Excel原行号", "料号", "品牌", "封装", "需求数量", "价格库参考", "位号", "备注", "未匹配原因"],
    ...rows.map((row) => [
      row.excelRow,
      row.partNumber,
      row.brand || "",
      row.pkg || "",
      row.quantity,
      row.referencePrice || row.aiPrice || "",
      row.reference || "",
      row.note || "",
      row.unmatchedReason,
    ]),
    [],
    [
      "说明",
      "价格库参考仅用于采购寻源，不进入购物车或订单结算；最终价格以供应商报价为准。",
    ],
  ];

  const sheet = XLSX.utils.aoa_to_sheet(matrix);
  sheet["!cols"] = [
    { wch: 12 },
    { wch: 28 },
    { wch: 18 },
    { wch: 16 },
    { wch: 14 },
    { wch: 20 },
    { wch: 20 },
    { wch: 34 },
    { wch: 28 },
  ];
  sheet["!autofilter"] = { ref: `A1:I${rows.length + 1}` };

  const workbook = XLSX.utils.book_new();
  workbook.Props = {
    Title: "51电子网 BOM 询价",
    Subject: "无合格现货物料询价",
    Author: "51电子网",
    CreatedDate: generatedAt,
  };
  XLSX.utils.book_append_sheet(workbook, sheet, "未匹配物料");

  const fileName = `51电子网-BOM询价-${shanghaiStamp(generatedAt)}.xlsx`;
  const buffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
    compression: true,
  }) as Buffer;

  return { fileName, buffer };
}
