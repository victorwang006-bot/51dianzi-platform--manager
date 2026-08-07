export const BOM_INQUIRY_COLUMNS = [
  "序号",
  "Excel行",
  "料号",
  "品牌",
  "封装",
  "数量",
  "AI参考价",
  "位号",
  "备注",
] as const;

export type BomInquiryMessageRow = {
  sequence: string;
  excelRow: string;
  partNumber: string;
  brand: string;
  pkg: string;
  quantity: string;
  aiPrice: string;
  reference: string;
  note: string;
};

export type BomInquiryMessage = {
  title: string;
  totalItems: number;
  rows: BomInquiryMessageRow[];
  disclaimer: string;
  fileName: string | null;
  fileUrl: string | null;
};

function cellsOf(line: string) {
  if (!line.startsWith("|") || !line.endsWith("|")) return null;
  return line.slice(1, -1).split("|").map(cell => cell.trim());
}

/**
 * 只识别主商城生成的固定 BOM询价 Markdown 表格；任何结构偏差均返回 null，
 * 由调用方继续按普通纯文本消息显示，绝不猜测或改写料号等原始字段。
 */
export function parseBomInquiryMessage(content: string): BomInquiryMessage | null {
  if (content.length > 5000) return null;
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const titleMatch = /^【BOM询价】共 (\d{1,2}) 项$/.exec(lines[0]?.trim() ?? "");
  if (!titleMatch) return null;
  const totalItems = Number(titleMatch[1]);
  if (!Number.isInteger(totalItems) || totalItems < 1 || totalItems > 50) return null;

  const headerIndex = lines.findIndex(line => {
    const cells = cellsOf(line.trim());
    return cells?.join("\u0000") === BOM_INQUIRY_COLUMNS.join("\u0000");
  });
  if (headerIndex < 0) return null;

  const separator = cellsOf(lines[headerIndex + 1]?.trim() ?? "");
  if (!separator || separator.length !== BOM_INQUIRY_COLUMNS.length) return null;
  if (!separator.every(cell => /^:?-{3,}:?$/.test(cell))) return null;

  const rows: BomInquiryMessageRow[] = [];
  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) break;
    const cells = cellsOf(line);
    if (!cells || cells.length !== BOM_INQUIRY_COLUMNS.length) return null;
    rows.push({
      sequence: cells[0],
      excelRow: cells[1],
      partNumber: cells[2],
      brand: cells[3],
      pkg: cells[4],
      quantity: cells[5],
      aiPrice: cells[6],
      reference: cells[7],
      note: cells[8],
    });
  }

  if (rows.length !== totalItems) return null;
  const disclaimer = lines.find(line => line.trim().startsWith("说明："))?.trim() ?? "";
  const attachmentLine = lines.find(line => line.trim().startsWith("询价Excel："))?.trim() ?? "";
  const attachmentMatch = /^询价Excel：\[([^\]]{1,255}\.xlsx)\]\((https:\/\/[^\s)]+)\)$/.exec(attachmentLine);
  let fileName: string | null = null;
  let fileUrl: string | null = null;
  if (attachmentMatch) {
    try {
      const parsedUrl = new URL(attachmentMatch[2]);
      if (
        parsedUrl.protocol === "https:"
        && parsedUrl.hostname === "51dianzi.com"
        && parsedUrl.port === ""
        && parsedUrl.username === ""
        && parsedUrl.password === ""
        && parsedUrl.search === ""
        && parsedUrl.hash === ""
        && parsedUrl.pathname.startsWith("/manus-storage/bom-inquiries/")
      ) {
        fileName = attachmentMatch[1];
        fileUrl = parsedUrl.toString();
      }
    } catch {
      // 非法附件 URL 不影响 BOM 表格正文，下载入口保持隐藏。
    }
  }
  return {
    title: `BOM询价 · ${totalItems}项`,
    totalItems,
    rows,
    disclaimer,
    fileName,
    fileUrl,
  };
}
