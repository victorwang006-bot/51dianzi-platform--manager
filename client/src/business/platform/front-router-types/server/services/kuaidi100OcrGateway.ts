import { ENV } from "../_core/env";

/**
 * 快递100 快递面单 OCR 识别网关。
 *
 * 只负责协议层：构造请求、解析返回、把错误码翻译成可读信息。
 * 图片来源校验、去重与业务落库由上层 service 负责。
 *
 * 官方文档：https://api.kuaidi100.com/document/ocrshibiejiekouwendang
 *
 * 与实时查询网关（kuaidi100Gateway.ts）的三处重要差异，实现时容易踩错：
 *
 * 1. **鉴权方式不同**：OCR 只需要 `key`，不需要 `customer`，也不需要 `sign` 签名。
 *    实时查询那套 MD5(param+key+customer) 在这里完全用不上。
 * 2. **必须走 https**：官方文档 1.2 节写的是 `http://api.kuaidi100.com/elec/detocr`，
 *    但实测 base64 直传（请求体约 150KB）时 http 端点会直接断开连接并返回
 *    "Remote end closed connection without response"，换成 https 立即正常。
 * 3. **返回字段名与文档不符**：文档写 `confidence`，实际返回 `conf`。
 *    这里两者都兼容，避免快递100 后续修正字段名时失效。
 */

/** 面单上的联系人信息（收件人或寄件人） */
export type OcrContact = {
  /** 姓名 */
  name: string;
  /** 电话 */
  mobile: string;
  /** 省 */
  province: string;
  /** 市 */
  city: string;
  /** 县/区 */
  county: string;
  /** 详细地址 */
  address: string;
  /** 识别出的原始文本，便于人工核对 */
  text: string;
  /** 可信度 0-1，仅供参考 */
  confidence: number;
};

export type OcrRecognizeResult = {
  /** 运单号，OCR 的核心产出 */
  waybill: string;
  /** 条形码值，已去重（快递100 会把同一条码返回两次） */
  barcodes: string[];
  /** 二维码值 */
  qrcodes: string[];
  /** 收件人信息，未识别出时为 null */
  receiver: OcrContact | null;
  /** 寄件人信息，未识别出时为 null */
  sender: OcrContact | null;
  /** 业务类型（如"标准快递"），未识别出时为空串 */
  expType: string;
  /** 集包地 */
  collectPoint: string;
  /** 末端承运商 */
  endPoint: string;
  /** 大头笔信息 */
  bulkpen: string[];
  /** 快递100 任务 ID，用于对账与排障 */
  taskId: string;
};

/**
 * 快递100 OCR 业务错误。
 *
 * `retryable` 用于区分"重试可能成功"（识别失败、网络抖动）
 * 与"重试无意义"（额度耗尽、图片格式错误）。这个区分很关键：
 * OCR 是实时扣费的，对不可重试的错误反复调用只会白烧额度。
 */
export class Kuaidi100OcrError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "Kuaidi100OcrError";
  }
}

/**
 * 错误码映射。
 *
 * 注意 600 与 601 都要处理：文档只列了 601（key已过期），
 * 但实测传错误 key 时返回的是 600（账号不存在）。
 */
const ERROR_MESSAGES: Record<string, { message: string; retryable: boolean }> = {
  "400": { message: "面单图片格式不正确，请上传清晰的 jpg/png 图片", retryable: false },
  "500": { message: "面单识别失败，请换一张更清晰的图片重试", retryable: true },
  "600": { message: "快递100 账号不存在，请检查面单识别授权配置", retryable: false },
  "601": { message: "快递100 面单识别额度已用尽，需要充值", retryable: false },
};

/** 可识别的面单元素，不传时快递100 默认只识别 barcode/receiver/sender */
const DEFAULT_INCLUDE = [
  "barcode",
  "qrcode",
  "receiver",
  "sender",
  "expType",
  "collectPoint",
  "endPoint",
] as const;

/**
 * OCR 是否可用。
 *
 * 与物流查询独立判断：OCR 只需要 key，即使 customer 未配置也能工作。
 */
export function isKuaidi100OcrConfigured(): boolean {
  return Boolean(ENV.kuaidi100OcrEnabled && ENV.kuaidi100Key);
}

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

let fetchImpl: FetchLike | null = null;

/**
 * 允许测试替换底层 fetch。
 *
 * 这一点对 OCR 尤其重要：真实调用是**实时扣费**的，
 * 单元测试若打真接口，每跑一次都在消耗用户的付费额度。
 */
export function setKuaidi100OcrFetchForTests(impl: FetchLike | null) {
  fetchImpl = impl;
}

function currentFetch(): FetchLike {
  if (fetchImpl) return fetchImpl;
  return globalThis.fetch as unknown as FetchLike;
}

/** 兼容 conf 与 confidence 两种字段名，取不到时返回 0 */
function confidenceOf(row: Record<string, unknown>): number {
  const raw = row.conf ?? row.confidence;
  const num = Number(raw);
  return Number.isFinite(num) ? num : 0;
}

function parseContact(value: unknown): OcrContact | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const contact: OcrContact = {
    name: String(row.name ?? "").trim(),
    mobile: String(row.mobile ?? "").trim(),
    province: String(row.province ?? "").trim(),
    city: String(row.city ?? "").trim(),
    county: String(row.county ?? "").trim(),
    address: String(row.address ?? "").trim(),
    text: String(row.text ?? "").trim(),
    confidence: confidenceOf(row),
  };
  // 全空的联系人对象没有价值，视作未识别，避免界面显示一堆空字段
  const hasAny =
    contact.name || contact.mobile || contact.address || contact.text;
  return hasAny ? contact : null;
}

/**
 * 解析 `{text, conf}` 形态的字段。
 *
 * 这类字段在未识别时返回的是 **null 而不是空对象**（实测 expType、endPoint
 * 都可能为 null），因此必须先判空再取属性，否则会抛 TypeError。
 */
function parseTextField(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const row = value as Record<string, unknown>;
  return String(row.text ?? "").trim();
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  // 用数组去重而非 Set 展开：项目编译目标较低，展开 Set 需要 downlevelIteration
  const seen: string[] = [];
  for (const item of value) {
    const text = String(item ?? "").trim();
    if (text && !seen.includes(text)) seen.push(text);
  }
  return seen;
}

export type OcrInput = {
  /** 图片 base64，**不得包含 data URI 头部** */
  imageBase64: string;
  /**
   * 是否兼容倾斜、旋转与拍照背景干扰。
   *
   * 默认开启：本平台的面单多为卖家手机拍照上传，而非标准电子面单截图，
   * 关闭时识别率明显偏低。
   */
  enableTilt?: boolean;
  /** 需要识别的面单元素，默认识别全部支持的元素 */
  include?: readonly string[];
};

/**
 * 识别面单图片。
 *
 * @throws {Kuaidi100OcrError} 配置缺失、参数非法或快递100 返回业务错误时抛出
 */
export async function recognizeWaybillImage(
  input: OcrInput,
): Promise<OcrRecognizeResult> {
  if (!isKuaidi100OcrConfigured()) {
    throw new Kuaidi100OcrError("NOT_CONFIGURED", "面单识别服务未启用", false);
  }

  const image = input.imageBase64.trim();
  if (!image) {
    throw new Kuaidi100OcrError("EMPTY_IMAGE", "未提供面单图片", false);
  }
  // 带 data URI 头会被快递100 判为"图片base64格式错误"，这里主动拦截并给出明确提示，
  // 避免白白消耗一次扣费额度换回一个 400
  if (image.startsWith("data:")) {
    throw new Kuaidi100OcrError(
      "INVALID_BASE64",
      "面单图片 base64 需去除 data URI 头部",
      false,
    );
  }
  // 快递100 限制 base64 编码后不超过 4M
  if (image.length > 4 * 1024 * 1024) {
    throw new Kuaidi100OcrError(
      "IMAGE_TOO_LARGE",
      "面单图片过大，请压缩后重新上传",
      false,
    );
  }

  const param = JSON.stringify({
    enableTilt: input.enableTilt ?? true,
    include: [...(input.include ?? DEFAULT_INCLUDE)],
    image,
  });

  // OCR 接口只需要 key，无 customer、无 sign
  const body = new URLSearchParams({ key: ENV.kuaidi100Key, param }).toString();

  let raw: string;
  try {
    const resp = await currentFetch()(ENV.kuaidi100OcrEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    raw = await resp.text();
    if (!resp.ok) {
      throw new Kuaidi100OcrError(
        String(resp.status),
        `快递100 面单识别返回 HTTP ${resp.status}`,
        resp.status >= 500,
      );
    }
  } catch (error) {
    if (error instanceof Kuaidi100OcrError) throw error;
    throw new Kuaidi100OcrError(
      "NETWORK",
      `调用面单识别失败：${error instanceof Error ? error.message : String(error)}`,
      true,
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Kuaidi100OcrError("PARSE", "面单识别返回内容无法解析", true);
  }

  const code = String(parsed.code ?? "");
  const taskId = String(parsed.taskId ?? "");
  if (code !== "200") {
    const known = ERROR_MESSAGES[code];
    throw new Kuaidi100OcrError(
      code || "UNKNOWN",
      known?.message ?? String(parsed.message ?? "面单识别失败"),
      known?.retryable ?? false,
    );
  }

  const data = (parsed.data ?? {}) as Record<string, unknown>;
  const barcodes = parseStringArray(data.barcode);
  // 优先取 waybill；部分面单 waybill 为空但条形码识别成功，此时用条形码兜底
  const waybill = String(data.waybill ?? "").trim() || barcodes[0] || "";

  if (!waybill) {
    // 接口返回 200 但没有任何单号，属于"识别到了图但没找到单号"，
    // 换清晰图片重试有意义，因此标记为可重试
    throw new Kuaidi100OcrError(
      "NO_WAYBILL",
      "未能从图片中识别出运单号，请上传更清晰的面单照片",
      true,
    );
  }

  const bulkpen = Array.isArray(data.bulkpen)
    ? data.bulkpen
        .map(item => parseTextField(item))
        .filter((text): text is string => Boolean(text))
    : [];

  return {
    waybill,
    barcodes,
    qrcodes: parseStringArray(data.qrcode),
    receiver: parseContact(data.receiver),
    sender: parseContact(data.sender),
    expType: parseTextField(data.expType),
    collectPoint: parseTextField(data.collectPoint),
    endPoint: parseTextField(data.endPoint),
    bulkpen,
    taskId,
  };
}
