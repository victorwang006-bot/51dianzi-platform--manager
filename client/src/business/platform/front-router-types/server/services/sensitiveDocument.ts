import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { runForumPdfScanWorker } from "./forumAttachments";

/** Sensitive company documents are intentionally limited to formats that the platform validates server-side. */
export const SENSITIVE_DOCUMENT_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "application/pdf",
] as const;

export type SensitiveDocumentMimeType = (typeof SENSITIVE_DOCUMENT_MIME_TYPES)[number];

export const MAX_SENSITIVE_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_SENSITIVE_DOCUMENT_BASE64_CHARS = 4 * Math.ceil(MAX_SENSITIVE_DOCUMENT_BYTES / 3);
export const MAX_SIGNATURE_BYTES = 400 * 1024;
export const MAX_SIGNATURE_BASE64_CHARS = 4 * Math.ceil(MAX_SIGNATURE_BYTES / 3);

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SOI = Buffer.from([0xff, 0xd8, 0xff]);
const JPEG_EOI = Buffer.from([0xff, 0xd9]);
const MAX_DOCUMENT_IMAGE_PIXELS = 40_000_000;
const MAX_DOCUMENT_IMAGE_DIMENSION = 10_000;
const MAX_SIGNATURE_IMAGE_PIXELS = 4_000_000;
const MAX_SIGNATURE_IMAGE_DIMENSION = 4_096;

type ImageValidationLimits = {
  maxBytes: number;
  maxPixels: number;
  maxDimension: number;
};

export function isSensitiveDocumentMimeType(value: string): value is SensitiveDocumentMimeType {
  return (SENSITIVE_DOCUMENT_MIME_TYPES as readonly string[]).includes(value);
}

/** The key extension always comes from the verified MIME type, never the untrusted client filename. */
export function sensitiveDocumentExtension(mimeType: SensitiveDocumentMimeType): "jpg" | "png" | "pdf" {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  return "pdf";
}

/**
 * Buffer.from(base64) silently accepts malformed input. Decode only canonical base64 so a client
 * cannot smuggle an oversized or differently encoded payload through a superficial length check.
 */
export function decodeCanonicalBase64(
  base64: string,
  maxBytes: number,
  maxBase64Chars = 4 * Math.ceil(maxBytes / 3),
): Buffer {
  if (!base64 || base64.length > maxBase64Chars) {
    throw new Error("文件编码长度无效");
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    throw new Error("文件编码格式无效");
  }
  const decoded = Buffer.from(base64, "base64");
  if (!decoded.length || decoded.length > maxBytes || decoded.toString("base64") !== base64) {
    throw new Error("文件大小或编码无效");
  }
  return decoded;
}

function isAnimatedPng(buffer: Buffer) {
  return buffer.includes(Buffer.from("acTL", "ascii"));
}

/**
 * Fully decode and re-encode before storage. This rejects decoder warnings, animated PNGs and
 * decompression bombs while stripping metadata/trailing bytes that magic-byte checks leave intact.
 */
async function validateAndNormalizeImage(
  buffer: Buffer,
  mimeType: "image/jpeg" | "image/png",
  limits: ImageValidationLimits,
): Promise<Buffer> {
  const hasExpectedMagic = mimeType === "image/jpeg"
    ? buffer.length >= 4 && buffer.subarray(0, 3).equals(JPEG_SOI) && buffer.subarray(-2).equals(JPEG_EOI)
    : buffer.length >= PNG_MAGIC.length && buffer.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC);
  if (!hasExpectedMagic) throw new Error("文件内容与声明格式不一致");
  if (mimeType === "image/png" && isAnimatedPng(buffer)) {
    throw new Error("仅支持单页静态图片");
  }

  try {
    const options = {
      animated: true,
      failOn: "warning" as const,
      limitInputPixels: limits.maxPixels,
      sequentialRead: true,
    };
    const metadata = await sharp(buffer, options).metadata();
    const actualFormat = metadata.format === "jpeg" ? "image/jpeg"
      : metadata.format === "png" ? "image/png"
      : null;
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (
      actualFormat !== mimeType
      || !width
      || !height
      || (metadata.pages ?? 1) !== 1
      || width > limits.maxDimension
      || height > limits.maxDimension
      || width * height > limits.maxPixels
    ) {
      throw new Error("图片结构无效");
    }
    const normalized = mimeType === "image/jpeg"
      ? await sharp(buffer, options).rotate().jpeg({ quality: 92 }).toBuffer()
      : await sharp(buffer, options).rotate().png({ compressionLevel: 9 }).toBuffer();
    if (!normalized.length || normalized.length > limits.maxBytes) {
      throw new Error("图片规范化后超过大小限制");
    }
    return normalized;
  } catch {
    throw new Error("图片结构无效");
  }
}

async function validatePdfStructure(buffer: Buffer) {
  const source = buffer.toString("latin1");
  if (
    !/^%PDF-1\.[0-7](?:\r?\n|\r)/.test(source)
    || !/\b(?:xref|startxref)\b/.test(source)
    || !/%%EOF\s*$/.test(source)
  ) {
    throw new Error("PDF 文件结构无效");
  }
  try {
    const pdf = await PDFDocument.load(buffer, {
      ignoreEncryption: true,
      throwOnInvalidObject: true,
      updateMetadata: false,
    });
    if (pdf.getPageCount() < 1) throw new Error("PDF 没有可读取页面");
  } catch {
    throw new Error("PDF 文件结构无效");
  }
  // pdf-lib permits encrypted PDFs when ignoreEncryption is true. The isolated,
  // memory-limited scanner rejects encryption, active actions and malformed graphs.
  const scan = await runForumPdfScanWorker(buffer);
  if (!scan.ok) throw new Error("PDF 文件结构无效");
}

/** Decode and validate a company license or banking document before it is handed to object storage. */
export async function decodeAndValidateSensitiveDocument(
  base64: string,
  mimeType: SensitiveDocumentMimeType,
): Promise<Buffer> {
  const buffer = decodeCanonicalBase64(
    base64,
    MAX_SENSITIVE_DOCUMENT_BYTES,
    MAX_SENSITIVE_DOCUMENT_BASE64_CHARS,
  );
  if (mimeType === "application/pdf") {
    await validatePdfStructure(buffer);
    return buffer;
  }
  return validateAndNormalizeImage(buffer, mimeType, {
    maxBytes: MAX_SENSITIVE_DOCUMENT_BYTES,
    maxPixels: MAX_DOCUMENT_IMAGE_PIXELS,
    maxDimension: MAX_DOCUMENT_IMAGE_DIMENSION,
  });
}

/** Registration signatures are PNG only and receive the same canonical-base64 and structure checks. */
export async function decodeAndValidateSignaturePng(signatureDataUrl: string): Promise<Buffer> {
  const prefix = "data:image/png;base64,";
  if (!signatureDataUrl.startsWith(prefix)) throw new Error("签名数据格式不正确");
  const base64 = signatureDataUrl.slice(prefix.length);
  const buffer = decodeCanonicalBase64(base64, MAX_SIGNATURE_BYTES, MAX_SIGNATURE_BASE64_CHARS);
  return validateAndNormalizeImage(buffer, "image/png", {
    maxBytes: MAX_SIGNATURE_BYTES,
    maxPixels: MAX_SIGNATURE_IMAGE_PIXELS,
    maxDimension: MAX_SIGNATURE_IMAGE_DIMENSION,
  });
}
