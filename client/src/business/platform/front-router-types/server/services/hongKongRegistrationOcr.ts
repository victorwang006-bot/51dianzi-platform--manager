import sharp from "sharp";
import { Readable } from "node:stream";
import { createRequire } from "node:module";
import { ENV } from "../_core/env";
import { convertPdfFirstPageToJpeg } from "./pdfToImage";
import { normalizeHkBrCertificateNumber, normalizeHkDate, type HkDocumentKind, type HkExtractedFields } from "../../../shared/hongKongRegistration";
import type { SensitiveDocumentMimeType } from "./sensitiveDocument";

export const HK_OCR_ENDPOINT = "https://xianggyyzz.market.alicloudapi.com/ocrservice/multiBlicenseHk";
export const HK_OCR_BASE64_LIMIT = 4 * 1024 * 1024;
const require = createRequire(import.meta.url);
const sdk = require("@alicloud/ocr-api20210707") as typeof import("@alicloud/ocr-api20210707");

export function isHongKongOcrConfigured() {
  return Boolean(process.env.ALIYUN_HK_OCR_APPCODE?.trim());
}

/** 仅OCR副本压缩；已验证原件由私有存储单独保存，绝不提交公网URL。 */
export async function normalizeHongKongOcrImage(buffer: Buffer, mimeType: SensitiveDocumentMimeType): Promise<Buffer> {
  const image = mimeType === "application/pdf" ? await convertPdfFirstPageToJpeg(buffer) : buffer;
  const metadata = await sharp(image, { limitInputPixels: 40_000_000, failOn: "warning" }).metadata();
  if (!metadata.width || !metadata.height || Math.min(metadata.width, metadata.height) < 15) throw new Error("识别图片最短边不能小于15px");
  for (const quality of [92, 80, 65]) {
    const normalized = await sharp(image, { limitInputPixels: 40_000_000, failOn: "warning" })
      .rotate().flatten({ background: "#ffffff" }).resize({ width: 4096, height: 4096, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality }).toBuffer();
    const meta = await sharp(normalized).metadata();
    if (Math.min(meta.width || 0, meta.height || 0) < 15) throw new Error("识别图片长宽比例无效");
    if (normalized.toString("base64").length <= HK_OCR_BASE64_LIMIT) return normalized;
  }
  throw new Error("识别副本超过接口大小限制，请使用清晰单页证件");
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value === "string") { try { return record(JSON.parse(value)); } catch { return {}; } }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }

/** 云市场官方字段为中文key。只按证件明确字段回填，不用日期或名称猜测主体。 */
export function parseHongKongOcrResponse(raw: unknown, kind: "BR" | "CI") {
  const response = record(raw);
  const type = text(response.type);
  const expected = kind === "BR" ? /香港商业登记证|香港商業登記證|Business Registration/i : /香港公司注册证|香港公司註冊證|Certificate of Incorporation/i;
  if (!expected.test(type)) throw new Error(`请上传正确的${kind}证件`);
  const fields = { ...record(response.data) };
  if (Array.isArray(response.prism_keyValueInfo)) for (const rawItem of response.prism_keyValueInfo) {
    const item = record(rawItem);
    if (text(item.key) && text(item.value)) fields[text(item.key)] = item.value;
  }
  const pick = (...keys: string[]) => keys.map(key => text(fields[key])).find(Boolean) || "";
  const extracted: HkExtractedFields = {};
  const name = pick("公司名称-英文", "业务／法团名称-英文", "业务/法团名称-英文");
  const chinese = pick("公司名称-中文", "业务／法团名称-中文", "业务/法团名称-中文");
  if (name) extracted.companyName = name;
  if (chinese) extracted.chineseName = chinese;
  if (kind === "CI") {
    const number = pick("编号");
    if (number) extracted.ciNumber = number;
    const date = normalizeHkDate(pick("标准化发行时间"));
    if (date) extracted.establishedAt = date;
  } else {
    const number = pick("编号", "登记证号码", "登记证编号");
    if (number) {
      const normalized = normalizeHkBrCertificateNumber(number);
      extracted.registrationNumber = normalized ?? number;
      if (normalized) extracted.brn = normalized.slice(0, 8);
    }
    const nature = pick("业务性质", "業務性質", "Nature of Business");
    const status = pick("法律地位", "法律地位Legal Status", "Legal Status");
    const address = pick("营业地址", "業務地址", "业务地址", "地址");
    if (nature) extracted.businessNature = nature;
    if (status) extracted.legalStatus = status;
    if (address) extracted.regAddress = address;
    const start = normalizeHkDate(pick("标准化生效日期", "生效日期"));
    const expiry = normalizeHkDate(pick("标准化届满日期", "届满日期", "屆滿日期"));
    if (start) extracted.brStartDate = start;
    if (expiry) extracted.brExpiryDate = expiry;
  }
  return { extracted, recognizedType: type };
}

export async function recognizeHongKongRegistration(buffer: Buffer, mimeType: SensitiveDocumentMimeType, kind: "BR" | "CI") {
  const appCode = process.env.ALIYUN_HK_OCR_APPCODE?.trim();
  if (!appCode) throw new Error("香港证件识别服务未配置");
  const image = await normalizeHongKongOcrImage(buffer, mimeType);
  const response = await fetch(HK_OCR_ENDPOINT, {
    method: "POST", headers: { Authorization: `APPCODE ${appCode}`, "Content-Type": "application/json" },
    body: JSON.stringify({ img: image.toString("base64") }), signal: AbortSignal.timeout(30_000), redirect: "error",
  });
  if (!response.ok) throw new Error(`香港证件识别暂时不可用（HTTP ${response.status}）`);
  const payload = await response.json();
  return parseHongKongOcrResponse(payload, kind);
}

/** BANK使用官方通用文字识别，不将香港银行证明误投内地开户许可证接口。 */
export function parseHongKongBankOcr(raw: unknown): HkExtractedFields {
  const data = record(raw);
  const rows = Array.isArray(data.prism_rowsInfo) ? data.prism_rowsInfo : data.prism_wordsInfo;
  const lines = Array.isArray(rows) ? rows.map(row => text(record(row).word)).filter(Boolean) : text(data.content).split(/\r?\n/);
  const joined = lines.join("\n");
  const extracted: HkExtractedFields = {};
  const labels: Array<[keyof HkExtractedFields, string]> = [
    ["bankAccountName", "(?:Account (?:Name|Holder)|Name of Account|戶名|账户名称|賬戶名稱)"],
    ["bankAccountNumber", "(?:Account (?:Number|No\\.?)|A/C No\\.?|账户号码|賬戶號碼|帳號)"],
    ["bankName", "(?:Bank Name|Name of Bank|银行名称|銀行名稱)"],
    ["bankAddress", "(?:Bank Address|银行地址|銀行地址)"],
    ["swift", "(?:SWIFT(?: Code)?|BIC)"], ["bankCode", "(?:Bank Code|銀行代碼|银行代码)"],
  ];
  for (const [key, label] of labels) {
    const match = new RegExp(`(?:^|\\n)\\s*${label}\\s*[:：]?\\s*([^\\n]+)`, "i").exec(joined);
    if (match?.[1]?.trim()) extracted[key] = match[1].trim();
  }
  return extracted;
}

export async function recognizeHongKongBank(buffer: Buffer, mimeType: SensitiveDocumentMimeType) {
  if (!ENV.ocrAccessKeyId || !ENV.ocrAccessKeySecret) throw new Error("银行证明识别服务未配置");
  const image = await normalizeHongKongOcrImage(buffer, mimeType);
  const client = new sdk.default({ accessKeyId: ENV.ocrAccessKeyId, accessKeySecret: ENV.ocrAccessKeySecret,
    endpoint: ENV.ocrEndpoint, regionId: ENV.ocrRegionId, protocol: "https", connectTimeout: 10_000, readTimeout: 30_000 } as ConstructorParameters<typeof sdk.default>[0]);
  const response = await client.recognizeAdvanced(new sdk.RecognizeAdvancedRequest({ body: Readable.from([image]), needRotate: true, row: true }));
  const body = response.body as { data?: unknown; code?: unknown } | undefined;
  if (body?.code) throw new Error("银行证明识别暂时不可用");
  return { extracted: parseHongKongBankOcr(body?.data), recognizedType: "银行证明" };
}
