/**
 * BOM 询价单消息解析（管理端）
 *
 * 前台「BOM 智能配单工作台」对无现货料号发起询价时，会向管理端客服会话
 * 推送一条 Markdown 表格形式的询价单消息。本模块负责把该文本解析成结构化
 * 数据，供 Messages.tsx 渲染为表格；无法确认为询价单时返回 null，
 * 由调用方降级为普通文本渲染。
 *
 * ⚠️ 本文件的源码曾一度只存在于生产编译产物中（GitHub 与服务器均无源码），
 * 于 2026-08-15 通过逆向产物还原。下述校验逐条对应原实现，**不可简化**，
 * 原因见各处注释。
 */

/** 询价单表格的固定表头，顺序与列数都参与校验 */
const BOM_INQUIRY_HEADERS = [
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

/** 单条询价明细（全部为展示用字符串，保持前台原始格式，不做二次数值转换） */
export interface BomInquiryRow {
  sequence: string;
  excelRow: string;
  partNumber: string;
  brand: string;
  pkg: string;
  quantity: string;
  aiPrice: string;
  reference: string;
  note: string;
}

export interface BomInquiryMessage {
  title: string;
  totalItems: number;
  rows: BomInquiryRow[];
  disclaimer: string;
  fileName: string | null;
  fileUrl: string | null;
}

/** 消息内容长度上限，防止超长文本拖垮客服端渲染 */
const MAX_CONTENT_LENGTH = 5000;
/** 单次询价明细行数上限，与前台提交限制一致，防伪造超大表格 */
const MAX_ITEMS = 50;
/** 询价 Excel 允许的存储路径前缀 */
const ALLOWED_FILE_PATH_PREFIX = "/manus-storage/bom-inquiries/";
/** 询价 Excel 允许的域名 */
const ALLOWED_FILE_HOST = "51dianzi.com";

/**
 * 拆分 Markdown 表格行：`| a | b |` → ["a", "b"]
 * 不以 | 开头结尾的行一律视为非表格行。
 */
function splitTableRow(line: string): string[] | null {
  if (!line.startsWith("|") || !line.endsWith("|")) return null;
  return line
    .slice(1, -1)
    .split("|")
    .map(cell => cell.trim());
}

/**
 * 校验并解析询价 Excel 下载链接。
 *
 * 安全要点：该链接来自前台用户消息，若不校验来源，攻击者可在询价单中
 * 塞入外部链接伪装成「下载询价Excel」对客服钓鱼。因此这里逐项收紧：
 * 仅 https、仅指定域名、不允许端口/账号密码/query/hash，且路径必须落在
 * 询价单专用目录下。任一条不满足即丢弃链接（消息其余部分仍可正常展示）。
 */
function parseInquiryFileLink(
  line: string,
): { fileName: string; fileUrl: string } | null {
  const matched = /^询价Excel：\[([^\]]{1,255}\.xlsx)\]\((https:\/\/[^\s)]+)\)$/.exec(line);
  if (!matched) return null;

  try {
    const url = new URL(matched[2]);
    if (
      url.protocol === "https:" &&
      url.hostname === ALLOWED_FILE_HOST &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      url.pathname.startsWith(ALLOWED_FILE_PATH_PREFIX)
    ) {
      return { fileName: matched[1], fileUrl: url.toString() };
    }
  } catch {
    // URL 非法直接忽略链接
  }
  return null;
}

/**
 * 尝试把一条前台消息解析为 BOM 询价单。
 * 任一环节不符合约定即返回 null，调用方应降级为普通文本渲染。
 */
export function parseBomInquiryMessage(content: string): BomInquiryMessage | null {
  if (content.length > MAX_CONTENT_LENGTH) return null;

  const lines = content.replace(/\r\n?/g, "\n").split("\n");

  // 首行必须是【BOM询价】共 N 项，N 最多两位
  const headMatched = /^【BOM询价】共 (\d{1,2}) 项$/.exec(lines[0]?.trim() ?? "");
  if (!headMatched) return null;

  const totalItems = Number(headMatched[1]);
  if (!Number.isInteger(totalItems) || totalItems < 1 || totalItems > MAX_ITEMS) {
    return null;
  }

  // 定位表头行：必须与约定表头逐列完全一致
  const headerIndex = lines.findIndex(
    line => splitTableRow(line.trim())?.join("\0") === BOM_INQUIRY_HEADERS.join("\0"),
  );
  if (headerIndex < 0) return null;

  // 表头下一行必须是 Markdown 分隔行（---/:--- /---:）
  const dividerCells = splitTableRow(lines[headerIndex + 1]?.trim() ?? "");
  if (
    !dividerCells ||
    dividerCells.length !== BOM_INQUIRY_HEADERS.length ||
    !dividerCells.every(cell => /^:?-{3,}:?$/.test(cell))
  ) {
    return null;
  }

  // 逐行读取明细，遇空行结束；列数不符即判定整条消息非询价单
  const rows: BomInquiryRow[] = [];
  for (let i = headerIndex + 2; i < lines.length; i += 1) {
    const raw = lines[i].trim();
    if (!raw) break;
    const cells = splitTableRow(raw);
    if (!cells || cells.length !== BOM_INQUIRY_HEADERS.length) return null;
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

  // 实际行数必须与首行声明的项数一致，防止内容被截断或被注入额外行
  if (rows.length !== totalItems) return null;

  const disclaimer = lines.find(line => line.trim().startsWith("说明："))?.trim() ?? "";
  const fileLine = lines.find(line => line.trim().startsWith("询价Excel："))?.trim() ?? "";
  const file = parseInquiryFileLink(fileLine);

  return {
    title: `BOM询价 · ${totalItems}项`,
    totalItems,
    rows,
    disclaimer,
    fileName: file?.fileName ?? null,
    fileUrl: file?.fileUrl ?? null,
  };
}
