import { Readable } from "node:stream";
import { createRequire } from "node:module";
import { ENV } from "../_core/env";
import { convertPdfFirstPageToJpeg, isPdfConvertAvailable } from "./pdfToImage";

/**
 * 银行资料识别（开户许可证 / 基本存款账户信息表）。
 *
 * 与营业执照识别保持同构：同一套阿里云 OCR 凭证、同一套 PDF 降级策略、
 * 同样「识别失败不阻塞上传」的原则。
 *
 * 已用生产密钥实测 RecognizeBankAccountLicense 权限正常，
 * 无需额外开通服务。
 */

export type BankAccountLicenseExtractResult = {
  /** 账户名称（开户单位全称） */
  bankAccountName: string;
  /** 账户号码 */
  bankAccountNumber: string;
  /** 开户行 */
  bankName: string;
  /** 法定代表人，仅用于与营业执照交叉核对，不直接回填 */
  legalPerson: string;
};

type OcrSdkModule = typeof import("@alicloud/ocr-api20210707");
const require = createRequire(import.meta.url);
const sdk = require("@alicloud/ocr-api20210707") as OcrSdkModule;

type BankAccountLicenseFields = {
  customerName?: unknown;
  bankAccount?: unknown;
  depositaryBank?: unknown;
  legalRepresentative?: unknown;
};

const EMPTY_RESULT: BankAccountLicenseExtractResult = {
  bankAccountName: "",
  bankAccountNumber: "",
  bankName: "",
  legalPerson: "",
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

/**
 * 清洗账号：只保留数字。
 *
 * 必要性：官方文档示例的返回值就是 "689163495 证异户称"——
 * 证件底纹的水印文字被一并识别了进来。
 * 账号一旦串入杂字，商家极易忽略而直接提交，后果是打款打错账户。
 */
export function normalizeBankAccountNumber(raw: string): string {
  return raw.replace(/\D/g, "");
}

/** 将阿里云 Data JSON 规范化为 CompanyForm 的银行字段 */
export function parseBankAccountLicenseData(
  rawData: unknown,
): BankAccountLicenseExtractResult {
  const envelope = parseJson(rawData);
  if (!envelope || typeof envelope !== "object") return { ...EMPTY_RESULT };

  const nested = parseJson((envelope as { data?: unknown }).data);
  const fields = (
    nested && typeof nested === "object" ? nested : envelope
  ) as BankAccountLicenseFields;

  return {
    bankAccountName: text(fields.customerName),
    bankAccountNumber: normalizeBankAccountNumber(text(fields.bankAccount)),
    bankName: text(fields.depositaryBank),
    legalPerson: text(fields.legalRepresentative),
  };
}

export function isBankAccountLicenseOcrConfigured(): boolean {
  return Boolean(ENV.ocrAccessKeyId && ENV.ocrAccessKeySecret);
}

export function isPdfMimeType(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith("application/pdf");
}

/** 银行资料 PDF 能否自动识别（依赖服务器上的 poppler） */
export async function isPdfBankLicenseOcrAvailable(): Promise<boolean> {
  return isBankAccountLicenseOcrConfigured() && (await isPdfConvertAvailable());
}

function toOcrRequestSource(source: string) {
  if (!source.startsWith("data:")) return { url: source };

  const separator = source.indexOf(",");
  if (separator < 0 || !source.slice(0, separator).includes(";base64")) {
    throw new Error("银行资料图片数据格式无效");
  }
  const body = Buffer.from(source.slice(separator + 1), "base64");
  if (body.length === 0 || body.length > 10 * 1024 * 1024) {
    throw new Error("银行资料图片大小无效");
  }
  return { body: Readable.from([body]) };
}

/** 从 data URL 或远程 URL 取出 PDF 字节，转为首页 JPEG */
async function pdfSourceToJpeg(source: string): Promise<Buffer> {
  let pdf: Buffer;
  if (source.startsWith("data:")) {
    const separator = source.indexOf(",");
    if (separator < 0 || !source.slice(0, separator).includes(";base64")) {
      throw new Error("银行资料 PDF 数据格式无效");
    }
    pdf = Buffer.from(source.slice(separator + 1), "base64");
  } else {
    const res = await fetch(source, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`读取银行资料 PDF 失败（HTTP ${res.status}）`);
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

async function recognizeImageBuffer(
  image: Buffer,
): Promise<BankAccountLicenseExtractResult> {
  const client = createOcrClient();
  const request = new sdk.RecognizeBankAccountLicenseRequest({
    body: Readable.from([image]),
  });
  const response = await client.recognizeBankAccountLicense(request);
  return parseBankAccountLicenseData(response.body?.data);
}

/**
 * 调用阿里云开户许可证 OCR；仅服务端读取凭证。
 *
 * PDF 处理：该接口官方明示不支持 PDF，故先将首页转为 JPEG 再识别。
 *
 * 方向问题：官方文档载明本接口「默认支持图像增强，包括图像自动旋转、
 * 畸变自动矫正」，与营业执照接口一致，因此**无需**自行做旋转重试。
 */
export async function recognizeBankAccountLicense(
  source: string,
  mimeType = "image/png",
): Promise<BankAccountLicenseExtractResult> {
  if (!isBankAccountLicenseOcrConfigured()) {
    throw new Error("银行资料 OCR 服务未配置");
  }

  if (isPdfMimeType(mimeType)) {
    const jpeg = await pdfSourceToJpeg(source);
    return recognizeImageBuffer(jpeg);
  }

  if (!mimeType.startsWith("image/")) {
    throw new Error("银行资料仅支持图片或 PDF 格式");
  }

  const client = createOcrClient();
  const request = new sdk.RecognizeBankAccountLicenseRequest(
    toOcrRequestSource(source),
  );
  const response = await client.recognizeBankAccountLicense(request);
  return parseBankAccountLicenseData(response.body?.data);
}

export function getBankAccountLicenseOcrErrorMeta(error: unknown) {
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
