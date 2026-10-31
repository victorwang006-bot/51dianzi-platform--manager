import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { TRPCError } from "@trpc/server";
import { unzipSync } from "fflate";
import sharp from "sharp";
import {
  decodeChatAttachment,
  MAX_CHAT_IMAGE_BYTES,
  type ChatAttachmentKind,
} from "./chatAttachments";

const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_IMAGE_DIMENSION = 10_000;
const MAX_ZIP_ENTRIES = 2_000;
const MAX_ZIP_TOTAL_BYTES = 60 * 1024 * 1024;
const MAX_ZIP_ENTRY_BYTES = 30 * 1024 * 1024;
const MAX_ZIP_COMPRESSION_RATIO = 100;
const MAX_ZIP_SCAN_BYTES = 20 * 1024 * 1024;
const MAX_PDF_OBJECTS = 10_000;
const PDF_SCAN_TIMEOUT_MS = 8_000;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const ZIP_ENCRYPTION_FLAGS = 0x2041;

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ALLOWED_FORUM_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  DOCX_MIME,
  XLSX_MIME,
]);
const IMAGE_FORMAT_BY_MIME = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export type ForumAttachmentInput = {
  kind: ChatAttachmentKind;
  fileName: string;
  mimeType: string;
  base64: string;
};

type DecodedAttachment = ReturnType<typeof decodeChatAttachment>;
type ZipEntry = {
  name: string;
  lowerName: string;
  compressedSize: number;
  originalSize: number;
};

class ScanRejection extends Error {}

function reject(reason: string): never {
  throw new ScanRejection(reason);
}

function badRequest(reason: string): never {
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: `文件安全扫描未通过：${reason}`,
  });
}

function requireRange(buffer: Buffer, offset: number, length: number) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > buffer.length) {
    reject("压缩文件结构无效");
  }
}

function decodeZipName(bytes: Buffer, utf8: boolean) {
  if (!utf8 && bytes.some(byte => byte > 0x7f)) {
    reject("压缩文件包含无法安全识别的条目名称");
  }
  try {
    const name = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (name.normalize("NFKC") !== name) {
      reject("压缩文件包含不安全的条目名称");
    }
    return name;
  } catch (error) {
    if (error instanceof ScanRejection) throw error;
    reject("压缩文件包含无法安全识别的条目名称");
  }
}

function validateZipPath(name: string) {
  if (!name || name.includes("\\") || name.startsWith("/") || /^[a-z]:/i.test(name) || /[\0-\x1f\x7f]/.test(name)) {
    reject("压缩文件包含不安全的条目路径");
  }
  const pathWithoutDirectorySlash = name.endsWith("/") ? name.slice(0, -1) : name;
  const segments = pathWithoutDirectorySlash.split("/");
  if (!pathWithoutDirectorySlash || segments.some(segment => !segment || segment === "." || segment === "..")) {
    reject("压缩文件包含路径穿越条目");
  }
}

function validateEntryName(entry: ZipEntry) {
  const lower = entry.lowerName;
  if (
    lower.includes("vbaproject")
    || /(^|\/)macrosheets?(\/|$)/.test(lower)
    || /(^|\/)activex(\/|$)/.test(lower)
    || /(^|\/)embeddings?(\/|$)/.test(lower)
    || /(^|\/)customui(\/|$)/.test(lower)
    || /(^|\/)externallinks?(\/|$)/.test(lower)
    || /(^|\/)connections(?:\.xml)?$/.test(lower)
    || lower.includes("oleobject")
    || /\.(?:bin|exe|js|vbs|ps1|bat|cmd|com|scr|dll|jar)$/.test(lower)
  ) {
    reject("Office 文件包含宏、嵌入对象或危险条目");
  }
}

function inspectZip(buffer: Buffer) {
  if (buffer.length < 22) reject("压缩文件结构无效");
  const searchStart = Math.max(0, buffer.length - 22 - 0xffff);
  let eocdOffset = -1;
  for (let offset = buffer.length - 22; offset >= searchStart; offset -= 1) {
    if (buffer.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) {
      const commentLength = buffer.readUInt16LE(offset + 20);
      if (offset + 22 + commentLength === buffer.length) {
        eocdOffset = offset;
        break;
      }
    }
  }
  if (eocdOffset < 0) reject("压缩文件结构无效");

  const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
  const centralDisk = buffer.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocdOffset + 8);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (
    diskNumber !== 0
    || centralDisk !== 0
    || entriesOnDisk !== entryCount
    || entryCount === 0
    || entryCount === 0xffff
    || centralSize === 0xffffffff
    || centralOffset === 0xffffffff
    || entryCount > MAX_ZIP_ENTRIES
  ) {
    reject(entryCount > MAX_ZIP_ENTRIES ? "压缩文件条目过多" : "不支持此压缩文件结构");
  }
  requireRange(buffer, centralOffset, centralSize);
  if (centralOffset + centralSize !== eocdOffset) reject("压缩文件目录结构无效");

  const entries: ZipEntry[] = [];
  const seenNames = new Set<string>();
  let cursor = centralOffset;
  let totalOriginalSize = 0;
  for (let index = 0; index < entryCount; index += 1) {
    requireRange(buffer, cursor, 46);
    if (buffer.readUInt32LE(cursor) !== ZIP_CENTRAL_SIGNATURE) reject("压缩文件目录结构无效");
    const flags = buffer.readUInt16LE(cursor + 8);
    const compression = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const originalSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const diskStart = buffer.readUInt16LE(cursor + 34);
    const externalAttributes = buffer.readUInt32LE(cursor + 38);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    requireRange(buffer, cursor, recordLength);

    if (flags & ZIP_ENCRYPTION_FLAGS) reject("不允许加密的 Office 文件");
    if (compression !== 0 && compression !== 8) reject("压缩文件使用了不支持的压缩方式");
    if (compressedSize === 0xffffffff || originalSize === 0xffffffff || localOffset === 0xffffffff || diskStart !== 0) {
      reject("不支持此压缩文件结构");
    }
    const unixMode = (externalAttributes >>> 16) & 0xf000;
    if (unixMode === 0xa000) reject("压缩文件包含符号链接");

    const name = decodeZipName(buffer.subarray(cursor + 46, cursor + 46 + nameLength), Boolean(flags & 0x0800));
    validateZipPath(name);
    const lowerName = name.toLowerCase();
    if (seenNames.has(lowerName)) reject("压缩文件包含重复条目");
    seenNames.add(lowerName);

    const isDirectory = name.endsWith("/");
    if (!isDirectory && originalSize > MAX_ZIP_ENTRY_BYTES) reject("压缩文件中的单个条目过大");
    totalOriginalSize += originalSize;
    if (totalOriginalSize > MAX_ZIP_TOTAL_BYTES) reject("压缩文件解压后过大");
    if (!isDirectory && originalSize > 0 && (compressedSize === 0 || originalSize / compressedSize > MAX_ZIP_COMPRESSION_RATIO)) {
      reject("压缩文件压缩比异常");
    }

    requireRange(buffer, localOffset, 30);
    if (buffer.readUInt32LE(localOffset) !== ZIP_LOCAL_SIGNATURE) reject("压缩文件本地条目结构无效");
    const localFlags = buffer.readUInt16LE(localOffset + 6);
    const localCompression = buffer.readUInt16LE(localOffset + 8);
    const localCompressedSize = buffer.readUInt32LE(localOffset + 18);
    const localOriginalSize = buffer.readUInt32LE(localOffset + 22);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    requireRange(buffer, localOffset + 30, localNameLength + localExtraLength);
    const localName = decodeZipName(
      buffer.subarray(localOffset + 30, localOffset + 30 + localNameLength),
      Boolean(localFlags & 0x0800),
    );
    if (
      localName !== name
      || localFlags !== flags
      || localCompression !== compression
      || (localFlags & ZIP_ENCRYPTION_FLAGS)
      || (!(localFlags & 0x0008) && (localCompressedSize !== compressedSize || localOriginalSize !== originalSize))
    ) {
      reject("压缩文件本地条目与目录不一致");
    }
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    requireRange(buffer, dataOffset, compressedSize);
    if (dataOffset + compressedSize > centralOffset) reject("压缩文件条目范围无效");

    const entry = { name, lowerName, compressedSize, originalSize };
    validateEntryName(entry);
    entries.push(entry);
    cursor += recordLength;
  }
  if (cursor !== centralOffset + centralSize) reject("压缩文件目录结构无效");
  return entries;
}

function decodeXml(bytes: Uint8Array) {
  const buffer = Buffer.from(bytes);
  try {
    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
      return new TextDecoder("utf-16le", { fatal: true }).decode(buffer.subarray(2));
    }
    if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
      const swapped = Buffer.allocUnsafe(buffer.length - 2);
      for (let index = 2; index + 1 < buffer.length; index += 2) {
        swapped[index - 2] = buffer[index + 1]!;
        swapped[index - 1] = buffer[index]!;
      }
      return new TextDecoder("utf-16le", { fatal: true }).decode(swapped);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    reject("Office XML 内容无法安全解析");
  }
}

function scanOfficeArchive(buffer: Buffer, mimeType: string) {
  const entries = inspectZip(buffer);
  const selectedNames = new Set<string>();
  let scanBytes = 0;
  for (const entry of entries) {
    const shouldScan = entry.lowerName === "[content_types].xml"
      || entry.lowerName.endsWith(".xml")
      || entry.lowerName.endsWith(".rels");
    if (shouldScan) {
      scanBytes += entry.originalSize;
      if (scanBytes > MAX_ZIP_SCAN_BYTES) reject("Office 文件需要扫描的内容过大");
      selectedNames.add(entry.name);
    }
  }

  let extracted: Record<string, Uint8Array>;
  try {
    extracted = unzipSync(buffer, {
      filter: entry => selectedNames.has(entry.name),
    });
  } catch {
    reject("Office 压缩结构解析失败");
  }
  const byLowerName = new Map(Object.entries(extracted).map(([name, data]) => [name.toLowerCase(), data]));
  const required = mimeType === DOCX_MIME
    ? ["[content_types].xml", "_rels/.rels", "word/document.xml"]
    : ["[content_types].xml", "_rels/.rels", "xl/workbook.xml"];
  if (required.some(name => !byLowerName.has(name))) {
    reject(mimeType === DOCX_MIME ? "DOCX 缺少必要文档结构" : "XLSX 缺少必要工作簿结构");
  }

  for (const [name, data] of Array.from(byLowerName.entries())) {
    const xml = decodeXml(data);
    if (name === "[content_types].xml" && /macroenabled|vbaproject|ms-excel\.sheet\.binary|macrosheet|activex|oleobject|\bextension\s*=\s*["']bin["']/i.test(xml)) {
      reject("Office 文件包含启用宏或不可扫描的内容类型");
    }
    if (name.endsWith(".rels") && /\btargetmode\s*=\s*["']external["']/i.test(xml)) {
      reject("Office 文件包含外部关系");
    }
    if (/<\s*(?:[\w.-]+:)?(?:oleObject|activeX|externalLink)\b/i.test(xml)) {
      reject("Office 文件包含主动或嵌入内容");
    }
  }
}

type PdfScanWorkerResult =
  | { ok: true }
  | { ok: false; category: "active_content" | "too_many_objects" | "invalid_structure" | "unexpected_failure" };

type PdfScanWorkerOptions = {
  timeoutMs?: number;
  /** Deterministic timeout-test hook; production callers never set this. */
  testDelayMs?: number;
};

function forumPdfWorkerUrl() {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // Bundled production entry: dist/index.js -> dist/forumPdfScanWorker.mjs.
    resolve(moduleDirectory, "forumPdfScanWorker.mjs"),
    // TypeScript source/tests: server/services/forumAttachments.ts -> server/forumPdfScanWorker.mjs.
    resolve(moduleDirectory, "../forumPdfScanWorker.mjs"),
  ];
  const workerPath = candidates.find(candidate => existsSync(candidate));
  if (!workerPath) throw new Error("forum PDF scan worker is missing");
  return pathToFileURL(workerPath);
}

export function runForumPdfScanWorker(buffer: Buffer, options: PdfScanWorkerOptions = {}): Promise<PdfScanWorkerResult> {
  const timeoutMs = options.timeoutMs ?? PDF_SCAN_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.resolve({ ok: false, category: "unexpected_failure" });
  }
  return new Promise(resolveResult => {
    let settled = false;
    let worker: Worker | undefined;
    let timer: NodeJS.Timeout | undefined;
    const finish = (result: PdfScanWorkerResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      worker?.removeAllListeners();
      resolveResult(result);
    };
    try {
      const workerBytes = Uint8Array.from(buffer);
      worker = new Worker(forumPdfWorkerUrl(), {
        workerData: { pdfBytes: workerBytes, testDelayMs: options.testDelayMs },
        transferList: [workerBytes.buffer],
        resourceLimits: {
          maxOldGenerationSizeMb: 128,
          maxYoungGenerationSizeMb: 32,
          stackSizeMb: 4,
        },
      });
    } catch {
      finish({ ok: false, category: "unexpected_failure" });
      return;
    }
    timer = setTimeout(() => {
      void worker.terminate().finally(() => finish({ ok: false, category: "unexpected_failure" }));
    }, timeoutMs);
    timer.unref?.();
    worker.once("message", (message: PdfScanWorkerResult) => {
      const result = message?.ok === true
        ? { ok: true } as const
        : message?.ok === false && ["active_content", "too_many_objects", "invalid_structure", "unexpected_failure"].includes(message.category)
          ? message
          : { ok: false, category: "unexpected_failure" } as const;
      finish(result);
      void worker.terminate();
    });
    worker.once("error", () => finish({ ok: false, category: "unexpected_failure" }));
    worker.once("exit", () => {
      if (!settled) finish({ ok: false, category: "unexpected_failure" });
    });
  });
}

async function scanPdf(buffer: Buffer, workerOptions?: PdfScanWorkerOptions) {
  if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") reject("PDF 文件头无效");
  const tail = buffer.subarray(Math.max(0, buffer.length - 1_024)).toString("latin1");
  if (!/%%EOF[\x00\x09\x0a\x0c\x0d\x20]*$/.test(tail)) reject("PDF 文件缺少有效的结尾标记");
  const result = await runForumPdfScanWorker(buffer, workerOptions);
  if (result.ok) return;
  if (result.category === "active_content") reject("PDF 包含主动、嵌入或加密内容");
  if (result.category === "too_many_objects") reject("PDF 对象数量过多");
  reject("PDF 文件结构无效或无法安全解析");
}

function isAnimatedImage(buffer: Buffer, mimeType: string) {
  if (mimeType === "image/png") return buffer.includes(Buffer.from("acTL", "ascii"));
  if (mimeType !== "image/webp") return false;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const chunk = buffer.subarray(offset, offset + 4).toString("ascii");
    const size = buffer.readUInt32LE(offset + 4);
    if (chunk === "ANIM" || (chunk === "VP8X" && offset + 9 <= buffer.length && Boolean(buffer[offset + 8]! & 0x02))) return true;
    const nextOffset = offset + 8 + size + (size & 1);
    if (nextOffset <= offset || nextOffset > buffer.length) break;
    offset = nextOffset;
  }
  return false;
}

async function sanitizeImage(decoded: DecodedAttachment) {
  const expectedFormat = IMAGE_FORMAT_BY_MIME[decoded.mimeType as keyof typeof IMAGE_FORMAT_BY_MIME];
  if (!expectedFormat || isAnimatedImage(decoded.buffer, decoded.mimeType)) reject("仅允许单页静态照片");
  const options = {
    animated: true,
    failOn: "warning" as const,
    limitInputPixels: MAX_IMAGE_PIXELS,
    sequentialRead: true,
  };
  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    metadata = await sharp(decoded.buffer, options).metadata();
  } catch {
    reject("图片无法完整解码或包含解码警告");
  }
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const pages = metadata.pages ?? 1;
  if (metadata.format !== expectedFormat) reject("图片实际格式与声明不一致");
  if (!width || !height || pages !== 1) reject("仅允许单页静态照片");
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION || width * height > MAX_IMAGE_PIXELS) {
    reject("图片尺寸过大（最大 10000×10000 且不超过 4000 万像素）");
  }

  try {
    let pipeline = sharp(decoded.buffer, options).rotate();
    if (expectedFormat === "jpeg") pipeline = pipeline.jpeg({ quality: 92 });
    if (expectedFormat === "png") pipeline = pipeline.png({ compressionLevel: 9 });
    if (expectedFormat === "webp") pipeline = pipeline.webp({ quality: 92 });
    const sanitized = await pipeline.toBuffer({ resolveWithObject: true });
    if (!sanitized.data.length || sanitized.data.length > MAX_CHAT_IMAGE_BYTES) {
      reject("图片重新编码后超过 10MB");
    }
    if (sanitized.info.width > MAX_IMAGE_DIMENSION || sanitized.info.height > MAX_IMAGE_DIMENSION) {
      reject("图片尺寸过大（最大宽高为 10000 像素）");
    }
    return {
      ...decoded,
      buffer: sanitized.data,
      byteSize: sanitized.data.length,
      sha256: createHash("sha256").update(sanitized.data).digest("hex"),
    };
  } catch (error) {
    if (error instanceof ScanRejection) throw error;
    reject("图片无法安全重新编码");
  }
}

/**
 * Forum-only attachment decoder and deep scanner. The chat decoder remains the
 * authoritative first pass for base64, byte limits, MIME/extension and magic bytes.
 */
export async function decodeAndScanForumAttachment(input: ForumAttachmentInput) {
  try {
    let decoded: DecodedAttachment;
    try {
      decoded = decodeChatAttachment(input);
    } catch (error) {
      const reason = error instanceof TRPCError ? error.message : "文件内容无效";
      reject(reason);
    }

    if (!ALLOWED_FORUM_MIMES.has(decoded.mimeType)) {
      reject("论坛仅支持 JPEG、PNG、WebP 静态照片、PDF、DOCX 和 XLSX 文件");
    }
    if (decoded.mimeType.startsWith("image/")) return await sanitizeImage(decoded);
    if (decoded.mimeType === "application/pdf") await scanPdf(decoded.buffer);
    if (decoded.mimeType === DOCX_MIME || decoded.mimeType === XLSX_MIME) {
      scanOfficeArchive(decoded.buffer, decoded.mimeType);
    }
    return decoded;
  } catch (error) {
    if (error instanceof TRPCError && error.code === "BAD_REQUEST" && error.message.startsWith("文件安全扫描未通过：")) {
      throw error;
    }
    if (error instanceof ScanRejection) badRequest(error.message);
    badRequest("文件格式异常或无法安全解析");
  }
}

export const FORUM_ATTACHMENT_ALLOWED_MIME_TYPES = Object.freeze(Array.from(ALLOWED_FORUM_MIMES));

export const FORUM_ATTACHMENT_SECURITY_LIMITS = Object.freeze({
  maxImagePixels: MAX_IMAGE_PIXELS,
  maxImageDimension: MAX_IMAGE_DIMENSION,
  maxZipEntries: MAX_ZIP_ENTRIES,
  maxZipTotalBytes: MAX_ZIP_TOTAL_BYTES,
  maxZipEntryBytes: MAX_ZIP_ENTRY_BYTES,
  maxZipCompressionRatio: MAX_ZIP_COMPRESSION_RATIO,
  maxPdfObjects: MAX_PDF_OBJECTS,
});
