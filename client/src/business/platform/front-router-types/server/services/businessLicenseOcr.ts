import { Readable } from "node:stream";
import { createRequire } from "node:module";
import { ENV } from "../_core/env";
import { convertPdfFirstPageToJpeg, isPdfConvertAvailable } from "./pdfToImage";
import { normalizeCompanyEstablishedAt } from "../../../shared/companyEstablishedAt";

export type BusinessLicenseExtractResult = {
  companyName: string;
  creditCode: string;
  regAddress: string;
  legalPerson: string;
  companyType: string;
  establishedAt: string | null;
};

type OcrSdkModule = typeof import("@alicloud/ocr-api20210707");
const require = createRequire(import.meta.url);
const sdk = require("@alicloud/ocr-api20210707") as OcrSdkModule;
type BusinessLicenseFields = {
  companyName?: unknown;
  creditCode?: unknown;
  businessAddress?: unknown;
  legalPerson?: unknown;
  companyType?: unknown;
  /** 阿里云官方字段名首字母大写；兼容少数历史响应的小写别名。 */
  RegistrationDate?: unknown;
  registrationDate?: unknown;
};

const EMPTY_RESULT: BusinessLicenseExtractResult = {
  companyName: "",
  creditCode: "",
  regAddress: "",
  legalPerson: "",
  companyType: "",
  establishedAt: null,
};

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 将阿里云 Data JSON 规范化为现有 CompanyForm 所需字段。 */
export function parseBusinessLicenseData(rawData: unknown): BusinessLicenseExtractResult {
  const envelope = parseJson(rawData);
  if (!envelope || typeof envelope !== "object") return { ...EMPTY_RESULT };

  const nested = parseJson((envelope as { data?: unknown }).data);
  const fields = (
    nested && typeof nested === "object" ? nested : envelope
  ) as BusinessLicenseFields;

  return {
    companyName: text(fields.companyName),
    creditCode: text(fields.creditCode).replace(/\s/g, "").toUpperCase(),
    regAddress: text(fields.businessAddress),
    legalPerson: text(fields.legalPerson),
    companyType: text(fields.companyType),
    establishedAt: normalizeCompanyEstablishedAt(
      fields.RegistrationDate ?? fields.registrationDate,
    ),
  };
}

export function isBusinessLicenseOcrConfigured(): boolean {
  return Boolean(ENV.ocrAccessKeyId && ENV.ocrAccessKeySecret);
}

function toOcrRequestSource(source: string) {
  if (!source.startsWith("data:")) return { url: source };

  const separator = source.indexOf(",");
  if (separator < 0 || !source.slice(0, separator).includes(";base64")) {
    throw new Error("营业执照图片数据格式无效");
  }
  const body = Buffer.from(source.slice(separator + 1), "base64");
  if (body.length === 0 || body.length > 10 * 1024 * 1024) {
    throw new Error("营业执照图片大小无效");
  }
  return { body: Readable.from([body]) };
}

export function isPdfMimeType(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith("application/pdf");
}

/** 从 data URL 或远程 URL 取出 PDF 字节，转为首页 JPEG */
async function pdfSourceToJpeg(source: string): Promise<Buffer> {
  let pdf: Buffer;
  if (source.startsWith("data:")) {
    const separator = source.indexOf(",");
    if (separator < 0 || !source.slice(0, separator).includes(";base64")) {
      throw new Error("营业执照 PDF 数据格式无效");
    }
    pdf = Buffer.from(source.slice(separator + 1), "base64");
  } else {
    // 远程 URL（如已上传的 OSS 地址）：拉回后本地转换
    const res = await fetch(source, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`读取营业执照 PDF 失败（HTTP ${res.status}）`);
    pdf = Buffer.from(await res.arrayBuffer());
  }
  return convertPdfFirstPageToJpeg(pdf);
}

function createOcrClient() {
  const Client = sdk.default;
  const config = {
    accessKeyId: ENV.ocrAccessKeyId,
    accessKeySecret: ENV.ocrAccessKeySecret,
    endpoint: ENV.ocrEndpoint,
    regionId: ENV.ocrRegionId,
    protocol: "https",
    connectTimeout: 10_000,
    readTimeout: 30_000,
  } as ConstructorParameters<typeof Client>[0];
  return new Client(config);
}

/** 直接用图片字节调用识别（PDF 转换后走此路径） */
async function recognizeImageBuffer(image: Buffer): Promise<BusinessLicenseExtractResult> {
  const client = createOcrClient();
  const request = new sdk.RecognizeBusinessLicenseRequest({ body: Readable.from([image]) });
  const response = await client.recognizeBusinessLicense(request);
  return parseBusinessLicenseData(response.body?.data);
}

/** PDF 营业执照能否自动识别（依赖服务器上的转换组件） */
export async function isPdfLicenseOcrAvailable(): Promise<boolean> {
  return isBusinessLicenseOcrConfigured() && (await isPdfConvertAvailable());
}

/**
 * 调用阿里云营业执照 OCR；仅服务端读取凭证。
 *
 * PDF 处理：阿里云该接口官方明示不支持 PDF，
 * 故先将首页转为 JPEG 再识别。
 *
 * 方向问题：已实测确认阿里云接口自带方向纠正——
 * 同一张执照分别旋转 0/90/180/270 度送入，返回字段完全一致，
 * 因此**无需**在此做旋转重试。
 */
export async function recognizeBusinessLicense(
  source: string,
  mimeType = "image/png",
): Promise<BusinessLicenseExtractResult> {
  if (!isBusinessLicenseOcrConfigured()) {
    throw new Error("营业执照 OCR 服务未配置");
  }

  if (isPdfMimeType(mimeType)) {
    const jpeg = await pdfSourceToJpeg(source);
    return recognizeImageBuffer(jpeg);
  }

  if (!mimeType.startsWith("image/")) {
    throw new Error("营业执照仅支持图片或 PDF 格式");
  }

  const client = createOcrClient();
  const request = new sdk.RecognizeBusinessLicenseRequest(toOcrRequestSource(source));
  const response = await client.recognizeBusinessLicense(request);
  return parseBusinessLicenseData(response.body?.data);
}

export function getBusinessLicenseOcrErrorMeta(error: unknown) {
  const candidate = error as {
    code?: unknown;
    statusCode?: unknown;
    requestId?: unknown;
    data?: { Code?: unknown; RequestId?: unknown; statusCode?: unknown };
  };
  return {
    code: text(candidate?.code ?? candidate?.data?.Code) || "UNKNOWN",
    statusCode: Number(candidate?.statusCode ?? candidate?.data?.statusCode) || null,
    requestId: text(candidate?.requestId ?? candidate?.data?.RequestId) || null,
  };
}
