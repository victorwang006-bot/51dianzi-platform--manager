import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { TRPCError } from "@trpc/server";

export const MAX_CHAT_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_CHAT_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_CHAT_ATTACHMENT_BASE64 = Math.ceil(MAX_CHAT_FILE_BYTES * 1.4) + 256;

export type ChatAttachmentKind = "image" | "file";

type Rule = {
  kind: ChatAttachmentKind;
  extensions: readonly string[];
  matches: (buffer: Buffer) => boolean;
};

const startsWith = (buffer: Buffer, bytes: readonly number[]) =>
  bytes.every((value, index) => buffer[index] === value);
const isZipContainer = (buffer: Buffer) =>
  startsWith(buffer, [0x50, 0x4b, 0x03, 0x04]) ||
  startsWith(buffer, [0x50, 0x4b, 0x05, 0x06]) ||
  startsWith(buffer, [0x50, 0x4b, 0x07, 0x08]);
const isOleContainer = (buffer: Buffer) =>
  startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const includesZipEntryMarker = (buffer: Buffer, marker: string) =>
  buffer.includes(Buffer.from(marker, "utf8"));
const isDocxContainer = (buffer: Buffer) =>
  isZipContainer(buffer) &&
  includesZipEntryMarker(buffer, "[Content_Types].xml") &&
  includesZipEntryMarker(buffer, "word/");
const isXlsxContainer = (buffer: Buffer) =>
  isZipContainer(buffer) &&
  includesZipEntryMarker(buffer, "[Content_Types].xml") &&
  includesZipEntryMarker(buffer, "xl/");
const isSafeText = (buffer: Buffer) => {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  if (sample.includes(0)) return false;
  let controls = 0;
  for (let index = 0; index < sample.length; index += 1) {
    const byte = sample[index] ?? 0;
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) controls += 1;
  }
  return sample.length === 0 || controls / sample.length < 0.02;
};

const RULES: Record<string, Rule> = {
  "image/jpeg": {
    kind: "image",
    extensions: [".jpg", ".jpeg"],
    matches: buffer => startsWith(buffer, [0xff, 0xd8, 0xff]),
  },
  "image/png": {
    kind: "image",
    extensions: [".png"],
    matches: buffer => startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  "image/webp": {
    kind: "image",
    extensions: [".webp"],
    matches: buffer => buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP",
  },
  "application/pdf": {
    kind: "file",
    extensions: [".pdf"],
    matches: buffer => buffer.subarray(0, 5).toString("ascii") === "%PDF-",
  },
  "application/msword": {
    kind: "file",
    extensions: [".doc"],
    matches: isOleContainer,
  },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    kind: "file",
    extensions: [".docx"],
    matches: isDocxContainer,
  },
  "application/vnd.ms-excel": {
    kind: "file",
    extensions: [".xls"],
    matches: isOleContainer,
  },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
    kind: "file",
    extensions: [".xlsx"],
    matches: isXlsxContainer,
  },
  "text/plain": {
    kind: "file",
    extensions: [".txt"],
    matches: isSafeText,
  },
  "text/csv": {
    kind: "file",
    extensions: [".csv"],
    matches: isSafeText,
  },
  "application/csv": {
    kind: "file",
    extensions: [".csv"],
    matches: isSafeText,
  },
};

export const CHAT_ATTACHMENT_ACCEPT = Object.freeze(Object.keys(RULES));

function badRequest(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

export function decodeChatAttachment(input: {
  kind: ChatAttachmentKind;
  fileName: string;
  mimeType: string;
  base64: string;
}) {
  const rule = RULES[input.mimeType.toLowerCase()];
  if (!rule || rule.kind !== input.kind) {
    badRequest(input.kind === "image" ? "仅支持 JPG、PNG、WebP 图片" : "仅支持 PDF、Word、Excel、CSV、TXT 文件");
  }

  const originalName = path.basename(input.fileName.trim()).slice(0, 255);
  const extension = path.extname(originalName).toLowerCase();
  if (!originalName || !rule.extensions.includes(extension)) {
    badRequest("文件扩展名与选择的文件类型不一致");
  }

  const encoded = input.base64.replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
  if (!encoded || encoded.length > MAX_CHAT_ATTACHMENT_BASE64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    badRequest("文件内容无效或超过大小限制");
  }
  const buffer = Buffer.from(encoded, "base64");
  const maxBytes = input.kind === "image" ? MAX_CHAT_IMAGE_BYTES : MAX_CHAT_FILE_BYTES;
  if (!buffer.length || buffer.length > maxBytes) {
    badRequest(input.kind === "image" ? "单张图片不能超过 10MB" : "单个文件不能超过 20MB");
  }
  if (!rule.matches(buffer)) {
    badRequest("文件内容与扩展名或格式不一致");
  }

  const safeStem = path
    .basename(originalName, extension)
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "attachment";
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const objectName = `${Date.now()}-${randomUUID()}-${safeStem}${rule.extensions[0]}`;
  return {
    buffer,
    byteSize: buffer.length,
    originalName,
    mimeType: input.mimeType.toLowerCase(),
    sha256,
    objectName,
  };
}
