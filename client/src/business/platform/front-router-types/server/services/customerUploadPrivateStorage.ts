import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { inflateRawSync } from "node:zlib";
import * as XLSX from "xlsx";

export type OriginalWorkbookManifest = {
  sheets: Array<{
    sheetIndex: number;
    sheetName: string;
    rows: Array<{
      rowNumber: number;
      originalRowHash: string;
      originalContent: string;
      cells: (string | number | null)[];
    }>;
  }>;
};
export type FileInput = { fileName: string; mimeType: string; base64: string };
export type PrivateStoredFile = {
  locator: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  manifest: OriginalWorkbookManifest | null;
};

const ROOT = "/opt/apps/dianzi51-shared/private/customer-inventory-history";
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_INFLATED = 64 * 1024 * 1024;
const MAX_ENTRIES = 2048;
const MAX_RATIO = 200;
const MAX_SHEETS = 64;
const MAX_ROWS = 10000;
const MAX_TOTAL_ROWS = 50000;
const MAX_COLS = 256;
const MAX_CELLS = 250000;
const MAX_TEXT = 16384;
const MAX_MANIFEST = 8 * 1024 * 1024;
const LOCATOR =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MIME = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
} as const;
const CFB_MAGIC = Buffer.from("d0cf11e0a1b11ae1", "hex");
function reject(message: string): never {
  throw new Error(message);
}
function hash(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function utf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return reject("文件必须是有效 UTF-8 文本");
  }
}
function filename(value: string): { name: string; ext: keyof typeof MIME } {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    !value ||
    value.length > 255 ||
    Buffer.byteLength(value) > 768 ||
    /[\x00-\x1f\x7f/\\:]/.test(value) ||
    value === "." ||
    value.includes("..")
  )
    reject("文件名无效");
  const ext = /\.([^.]+)$/.exec(value)?.[1].toLowerCase();
  if (ext !== "xlsx" && ext !== "xls" && ext !== "csv")
    reject("仅支持 xlsx、xls、csv 文件");
  return { name: value, ext };
}
function decodeBase64(value: string): Buffer {
  // Avoid repeated capture groups: V8 can overflow its regexp stack on a valid 10MiB file.
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > Math.ceil(MAX_BYTES / 3) * 4 ||
    value.length % 4 !== 0 ||
    /[^A-Za-z0-9+/=]/.test(value)
  )
    reject("文件编码无效或文件超过 10MiB");
  const padding = value.indexOf("=");
  if (
    padding !== -1 &&
    (padding < value.length - 2 || !/^={1,2}$/.test(value.slice(padding)))
  )
    reject("文件编码无效或文件超过 10MiB");
  const bytes = Buffer.from(value, "base64");
  if (
    !bytes.length ||
    bytes.length > MAX_BYTES ||
    bytes.toString("base64") !== value
  )
    reject("文件编码无效或文件超过 10MiB");
  return bytes;
}
const CRC_TABLE = Array.from({ length: 256 }, (_, i) => {
  let n = i;
  for (let bit = 0; bit < 8; bit++)
    n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let n = 0xffffffff;
  for (let __cuhIterator1 = (bytes)[Symbol.iterator](), __cuhStep1 = __cuhIterator1.next(); !__cuhStep1.done; __cuhStep1 = __cuhIterator1.next()) { const b = __cuhStep1.value; n = CRC_TABLE[(n ^ b) & 255] ^ (n >>> 8); }
  return (n ^ 0xffffffff) >>> 0;
}
function extraFields(bytes: Buffer): void {
  for (let p = 0; p < bytes.length; ) {
    if (p + 4 > bytes.length) reject("ZIP 结构无效");
    const id = bytes.readUInt16LE(p),
      size = bytes.readUInt16LE(p + 2);
    if (id === 1 || p + 4 + size > bytes.length)
      reject("不支持 Zip64 或无效 ZIP 结构");
    p += 4 + size;
  }
}
type ZipEntry = {
  name: string;
  start: number;
  end: number;
  packed: number;
  size: number;
  crc: number;
  method: number;
};
/** Read every central/local header and enforce limits BEFORE any decompression. */
function checkedZip(bytes: Buffer): Map<string, Buffer> {
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) {
    if (
      bytes.readUInt32LE(p) === 0x06054b50 &&
      p + 22 + bytes.readUInt16LE(p + 20) === bytes.length
    ) {
      end = p;
      break;
    }
  }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6))
    reject("ZIP 结构无效");
  const count = bytes.readUInt16LE(end + 10),
    cdSize = bytes.readUInt32LE(end + 12),
    cdStart = bytes.readUInt32LE(end + 16);
  if (
    !count ||
    count > MAX_ENTRIES ||
    count === 0xffff ||
    cdSize === 0xffffffff ||
    cdStart === 0xffffffff ||
    bytes.readUInt16LE(end + 8) !== count ||
    cdStart + cdSize !== end
  )
    reject("ZIP 结构无效或资源超限");
  const entries: ZipEntry[] = [],
    names = new Set<string>();
  let p = cdStart,
    expanded = 0,
    compressed = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > end || bytes.readUInt32LE(p) !== 0x02014b50)
      reject("ZIP 结构无效");
    const flags = bytes.readUInt16LE(p + 8),
      method = bytes.readUInt16LE(p + 10),
      crc = bytes.readUInt32LE(p + 16),
      packed = bytes.readUInt32LE(p + 20),
      size = bytes.readUInt32LE(p + 24);
    const nlen = bytes.readUInt16LE(p + 28),
      xlen = bytes.readUInt16LE(p + 30),
      clen = bytes.readUInt16LE(p + 32),
      start = bytes.readUInt32LE(p + 42);
    // ZIP APPNOTE 4.4.4: bits 1/2 are compression options for Deflate,
    // not encryption. Other methods must not acquire these allowed bits.
    if (
      bytes.readUInt16LE(p + 6) > 20 ||
      flags & ~(0x0808 | (method === 8 ? 0x0006 : 0)) ||
      (method !== 0 && method !== 8) ||
      bytes.readUInt16LE(p + 34) ||
      p + 46 + nlen + xlen + clen > end ||
      !nlen ||
      nlen > 512 ||
      packed === 0xffffffff ||
      size === 0xffffffff ||
      start === 0xffffffff ||
      ((bytes.readUInt32LE(p + 38) >>> 16) & 0xf000) === 0xa000
    )
      reject("拒绝加密、Zip64 或不支持的 ZIP 条目");
    const name = utf8(bytes.subarray(p + 46, p + 46 + nlen));
    const parts = name.endsWith("/")
      ? name.slice(0, -1).split("/")
      : name.split("/");
    if (
      /^[\/\\]|[\\:%\x00-\x1f\x7f]/.test(name) ||
      parts.some(
        v =>
          !v ||
          v === "." ||
          v === ".." ||
          /^(?:__proto__|constructor|prototype)$/i.test(v)
      ) ||
      names.has(name.toLowerCase())
    )
      reject("ZIP 路径或重复条目无效");
    names.add(name.toLowerCase());
    extraFields(bytes.subarray(p + 46 + nlen, p + 46 + nlen + xlen));
    expanded += size;
    compressed += packed;
    if (
      expanded > MAX_INFLATED ||
      size > MAX_INFLATED ||
      size > Math.max(1, packed) * MAX_RATIO ||
      (method === 0 && packed !== size) ||
      (name.endsWith("/") && size)
    )
      reject("ZIP 解压资源超限");
    if (
      start + 30 > cdStart ||
      bytes.readUInt32LE(start) !== 0x04034b50 ||
      bytes.readUInt16LE(start + 4) !== bytes.readUInt16LE(p + 6) ||
      bytes.readUInt16LE(start + 6) !== flags ||
      bytes.readUInt16LE(start + 8) !== method
    )
      reject("ZIP 本地头不一致");
    const ln = bytes.readUInt16LE(start + 26),
      lx = bytes.readUInt16LE(start + 28),
      dataStart = start + 30 + ln + lx;
    if (
      ln !== nlen ||
      dataStart + packed > cdStart ||
      !bytes
        .subarray(start + 30, start + 30 + ln)
        .equals(bytes.subarray(p + 46, p + 46 + nlen))
    )
      reject("ZIP 本地头不一致");
    extraFields(bytes.subarray(start + 30 + ln, dataStart));
    const lc = bytes.readUInt32LE(start + 14),
      lp = bytes.readUInt32LE(start + 18),
      ls = bytes.readUInt32LE(start + 22);
    let entryEnd = dataStart + packed;
    if (flags & 8) {
      if ((lc && lc !== crc) || (lp && lp !== packed) || (ls && ls !== size))
        reject("ZIP 本地头不一致");
      if (entryEnd + 12 > cdStart) reject("ZIP 数据描述符无效");
      if (bytes.readUInt32LE(entryEnd) === 0x08074b50) entryEnd += 4;
      if (
        entryEnd + 12 > cdStart ||
        bytes.readUInt32LE(entryEnd) !== crc ||
        bytes.readUInt32LE(entryEnd + 4) !== packed ||
        bytes.readUInt32LE(entryEnd + 8) !== size
      )
        reject("ZIP 数据描述符无效");
      entryEnd += 12;
    } else if (lc !== crc || lp !== packed || ls !== size)
      reject("ZIP 本地头不一致");
    entries.push({ name, start, end: entryEnd, packed, size, crc, method });
    p += 46 + nlen + xlen + clen;
  }
  if (p !== end || expanded > Math.max(1, compressed) * MAX_RATIO)
    reject("ZIP 结构无效或资源超限");
  const sorted = [...entries].sort((a, b) => a.start - b.start);
  let previous = 0;
  for (const e of sorted) {
    if (e.start !== previous) reject("ZIP 越界、重叠或伪装文件");
    previous = e.end;
  }
  if (previous !== cdStart) reject("ZIP 结构无效");
  const output = new Map<string, Buffer>();
  for (const e of entries) {
    const dataStart =
      e.start +
      30 +
      bytes.readUInt16LE(e.start + 26) +
      bytes.readUInt16LE(e.start + 28);
    const packed = bytes.subarray(dataStart, dataStart + e.packed);
    let unpacked: Buffer;
    if (e.method === 0) unpacked = packed;
    else {
      try {
        const result = inflateRawSync(packed, {
          maxOutputLength: Math.max(1, e.size + 1),
          info: true,
        }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
        if (result.engine.bytesWritten !== e.packed) reject("ZIP 压缩数据无效");
        unpacked = result.buffer;
      } catch {
        return reject("ZIP 压缩数据无效或资源超限");
      }
    }
    if (unpacked.length !== e.size || crc32(unpacked) !== e.crc)
      reject("ZIP 大小或校验不一致");
    output.set(e.name, unpacked);
  }
  return output;
}
function xml(bytes: Buffer): string {
  const value = utf8(bytes);
  if (
    /<!DOCTYPE|<!ENTITY|<\?|xmlns[^=]*=["'](?:https?:\/\/)?[^"']*(?:xinclude)/i.test(
      value.replace(/^\uFEFF?<\?xml[^?]*\?>/, "")
    ) ||
    /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-f]+;)/i.test(value)
  )
    reject("不支持的 XML 内容");
  return value;
}
function unescapeXml(value: string): string {
  return value.replace(
    /&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi,
    (_, e: string) => {
      const basic: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
      };
      if (basic[e]) return basic[e];
      const code = e.startsWith("#x")
        ? parseInt(e.slice(2), 16)
        : Number(e.slice(1));
      if (
        !Number.isSafeInteger(code) ||
        code <= 0 ||
        code > 0x10ffff ||
        (code >= 0xd800 && code <= 0xdfff)
      )
        reject("XML 字符无效");
      return String.fromCodePoint(code);
    }
  );
}
function attrs(tag: string): Record<string, string> {
  const output: Record<string, string> = Object.create(null);
  for (let __cuhIterator2 = (tag.matchAll(/([\w:.-]+)\s*=\s*(["'])([\s\S]*?)\2/g))[Symbol.iterator](), __cuhStep2 = __cuhIterator2.next(); !__cuhStep2.done; __cuhStep2 = __cuhIterator2.next()) {
      const m = __cuhStep2.value;
    if (Object.hasOwn(output, m[1])) reject("XML 属性重复");
    output[m[1]] = unescapeXml(m[3]);
  }
  return output;
}
function address(value: string): { r: number; c: number } {
  if (!/^[A-Z]{1,3}[1-9]\d*$/.test(value)) reject("单元格地址无效");
  const a = XLSX.utils.decode_cell(value);
  if (a.r >= MAX_ROWS || a.c >= MAX_COLS) reject("工作表行列资源超限");
  return a;
}
function checkRange(value: string): void {
  const parts = value.split(":");
  if (parts.length > 2) reject("工作表范围无效");
  const a = address(parts[0]),
    b = address(parts.at(-1)!);
  if (a.r > b.r || a.c > b.c) reject("工作表范围无效");
}
type RawSheet = {
  name: string;
  cells: Map<string, string>;
  rows: Set<number>;
  byRow: Map<number, Array<[string, string]>>;
};
function checkedXlsx(bytes: Buffer): RawSheet[] {
  const zip = checkedZip(bytes),
    docs = new Map<string, string>();
  let xmlTags = 0;
  for (let __cuhIterator3 = (zip)[Symbol.iterator](), __cuhStep3 = __cuhIterator3.next(); !__cuhStep3.done; __cuhStep3 = __cuhIterator3.next()) {
      const [name, content] = __cuhStep3.value;
    if (
      /(?:vba|activex|externallinks|embeddings|macrosheet|dialogsheet|encrypted|encryption)/i.test(
        name
      ) ||
      /\.(?:bin|exe|dll|com|scr|js|vbs|bat|ps1)$/i.test(name)
    )
      reject("拒绝宏、外链、加密或嵌入可执行内容");
    if (
      content.subarray(0, 2).toString("ascii") === "MZ" ||
      content.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) ||
      content.subarray(0, 8).equals(CFB_MAGIC)
    )
      reject("拒绝伪装的二进制或可执行内容");
    if (/\.(?:xml|rels)$/i.test(name)) {
      const value = xml(content);
      for (let __cuhIterator4 = (value.matchAll(/<[A-Za-z_:][^>]*>/g))[Symbol.iterator](), __cuhStep4 = __cuhIterator4.next(); !__cuhStep4.done; __cuhStep4 = __cuhIterator4.next()) { const _tag = __cuhStep4.value; if (++xmlTags > 1000000) reject("XML 结构资源超限"); }
      // SheetJS emits an unused macro-enabled .bin Default even for ordinary xlsx.
      // No .bin parts are accepted; an actual macro Override is rejected independently.
      const securityContent =
        name === "[Content_Types].xml"
          ? value.replace(/<Default\b[^>]*\/?\s*>/g, "")
          : value;
      if (
        /(?:macroEnabled|vbaProject|activeX|externalLink|oleObject|ddeLink|TargetMode\s*=\s*["']External["'])/i.test(
          securityContent
        )
      )
        reject("拒绝宏、外链或嵌入内容");
      if (name.endsWith(".rels")) {
        const ids = new Set<string>();
        for (let __cuhIterator5 = (value.matchAll(/<Relationship\b[^>]*>/g))[Symbol.iterator](), __cuhStep5 = __cuhIterator5.next(); !__cuhStep5.done; __cuhStep5 = __cuhIterator5.next()) {
      const tag = __cuhStep5.value;
          const a = attrs(tag[0]);
          if (!a.Id || !a.Target || !a.Type || ids.has(a.Id))
            reject("工作簿关系无效");
          ids.add(a.Id);
          if (
            (a.TargetMode && a.TargetMode.toLowerCase() !== "internal") ||
            /(?:externalLink|vba|activeX|oleObject)/i.test(a.Type) ||
            /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(a.Target)
          )
            reject("拒绝外链或不支持的关系");
        }
      }
      docs.set(name, value);
    }
  }
  const types = docs.get("[Content_Types].xml"),
    workbook = docs.get("xl/workbook.xml"),
    rels = docs.get("xl/_rels/workbook.xml.rels");
  if (
    !types?.includes(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"
    ) ||
    !workbook ||
    !rels
  )
    reject("不是受支持的 xlsx 工作簿");
  const overrides = new Map<string, string>(),
    defaults = new Map<string, string>();
  for (let __cuhIterator6 = (types.matchAll(/<(Override|Default)\b[^>]*>/g))[Symbol.iterator](), __cuhStep6 = __cuhIterator6.next(); !__cuhStep6.done; __cuhStep6 = __cuhIterator6.next()) {
      const m = __cuhStep6.value;
    const a = attrs(m[0]),
      key = m[1] === "Override" ? a.PartName : a.Extension,
      destination = m[1] === "Override" ? overrides : defaults;
    if (!key || !a.ContentType || destination.has(key))
      reject("工作簿内容类型无效");
    destination.set(key, a.ContentType);
  }
  for (let __cuhIterator7 = (zip.keys())[Symbol.iterator](), __cuhStep7 = __cuhIterator7.next(); !__cuhStep7.done; __cuhStep7 = __cuhIterator7.next()) {
      const name = __cuhStep7.value;
    const contentType =
      overrides.get(`/${name}`) ?? defaults.get(name.split(".").at(-1)!);
    if (
      contentType &&
      /(?:macroEnabled|vbaProject|activeX|externalLink|oleObject)/i.test(
        contentType
      )
    )
      reject("拒绝宏、外链或嵌入内容");
  }
  if (
    overrides.get("/xl/workbook.xml") !==
    MIME.xlsx.replace(".sheet", ".sheet.main+xml")
  )
    reject("不是标准 xlsx 工作簿内容类型");
  const targets = new Map<string, string>();
  for (let __cuhIterator8 = (rels.matchAll(/<Relationship\b[^>]*\/?\s*>/g))[Symbol.iterator](), __cuhStep8 = __cuhIterator8.next(); !__cuhStep8.done; __cuhStep8 = __cuhIterator8.next()) {
      const m = __cuhStep8.value;
    const a = attrs(m[0]);
    if (!a.Id || !a.Target || targets.has(a.Id)) reject("工作表关系无效");
    if (a.Type?.endsWith("/worksheet")) {
      if (/[\\:#?]/.test(a.Target)) reject("工作表关系无效");
      const target = a.Target.startsWith("/")
        ? a.Target.slice(1)
        : path.posix.normalize(`xl/${a.Target}`);
      if (!/^xl\/worksheets\/[^/]+\.xml$/.test(target))
        reject("工作表关系无效");
      targets.set(a.Id, target);
    }
  }
  const sheets: RawSheet[] = [],
    used = new Set<string>(),
    names = new Set<string>();
  let totalCells = 0,
    totalRows = 0;
  for (let __cuhIterator9 = (workbook.matchAll(/<sheet\b[^>]*\/?\s*>/g))[Symbol.iterator](), __cuhStep9 = __cuhIterator9.next(); !__cuhStep9.done; __cuhStep9 = __cuhIterator9.next()) {
      const m = __cuhStep9.value;
    const a = attrs(m[0]),
      target = targets.get(a["r:id"]),
      name = a.name;
    if (
      !target ||
      used.has(target) ||
      !name ||
      name.length > 128 ||
      /^(?:__proto__|constructor|prototype)$/i.test(name) ||
      names.has(name) ||
      sheets.length >= MAX_SHEETS
    )
      reject("工作表清单无效或超过 64 张");
    used.add(target);
    names.add(name);
    const sheet = docs.get(target);
    if (!sheet || !/<worksheet\b/.test(sheet) || !/<sheetData\b/.test(sheet))
      reject("工作表无法完整提取");
    if (
      overrides.get(`/${target}`) !==
      "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"
    )
      reject("工作表内容类型无效");
    for (let __cuhIterator10 = (sheet.matchAll(/<dimension\b[^>]*>/g))[Symbol.iterator](), __cuhStep10 = __cuhIterator10.next(); !__cuhStep10.done; __cuhStep10 = __cuhIterator10.next()) {
      const d = __cuhStep10.value;
      const ref = attrs(d[0]).ref;
      if (!ref) reject("工作表范围无效");
      checkRange(ref);
    }
    const cells = new Map<string, string>(),
      rows = new Set<number>(),
      byRow = new Map<number, Array<[string, string]>>();
    for (let __cuhIterator11 = (sheet.matchAll(
      /<row\b[^>]*(?:\/>|>[\s\S]*?<\/row\s*>)/g
    ))[Symbol.iterator](), __cuhStep11 = __cuhIterator11.next(); !__cuhStep11.done; __cuhStep11 = __cuhIterator11.next()) {
      const row = __cuhStep11.value;
      const n = Number(attrs(row[0].slice(0, row[0].indexOf(">") + 1)).r);
      if (!Number.isInteger(n) || n < 1 || n > MAX_ROWS || rows.has(n))
        reject("工作表行号无效或资源超限");
      rows.add(n);
      const rowCells: Array<[string, string]> = [];
      byRow.set(n, rowCells);
      for (let __cuhIterator12 = (row[0].matchAll(
        /<c\b[^>]*(?:\/>|>[\s\S]*?<\/c\s*>)/g
      ))[Symbol.iterator](), __cuhStep12 = __cuhIterator12.next(); !__cuhStep12.done; __cuhStep12 = __cuhIterator12.next()) {
      const cell = __cuhStep12.value;
        const ref = attrs(cell[0].slice(0, cell[0].indexOf(">") + 1)).r;
        if (
          !ref ||
          address(ref).r + 1 !== n ||
          cells.has(ref) ||
          cell[0].length > MAX_TEXT * 4 ||
          ++totalCells > MAX_CELLS
        )
          reject("工作表单元格无效或资源超限");
        cells.set(ref, cell[0]);
        rowCells.push([ref, cell[0]]);
      }
    }
    const declaredCells = [...Array.from(sheet.matchAll(/<c\b/g))].length,
      declaredRows = [...Array.from(sheet.matchAll(/<row\b/g))].length;
    if (
      cells.size !== declaredCells ||
      rows.size !== declaredRows ||
      (totalRows += rows.size) > MAX_TOTAL_ROWS
    )
      reject("工作表无法完整提取或资源超限");
    sheets.push({ name, cells, rows, byRow });
  }
  if (
    !sheets.length ||
    used.size !== targets.size ||
    [...Array.from(docs.keys())]
      .filter(n => /^xl\/worksheets\/[^/]+\.xml$/.test(n))
      .some(n => !used.has(n))
  )
    reject("不能遗漏工作表");
  const sst = docs.get("xl/sharedStrings.xml");
  if (sst) {
    let count = 0;
    for (let __cuhIterator13 = (sst.matchAll(/<si\b[^>]*>[\s\S]*?<\/si\s*>/g))[Symbol.iterator](), __cuhStep13 = __cuhIterator13.next(); !__cuhStep13.done; __cuhStep13 = __cuhIterator13.next()) { const s = __cuhStep13.value; if (++count > MAX_CELLS || s[0].length > MAX_TEXT * 4)
        reject("共享字符串资源超限"); }
    if (count !== [...Array.from(sst.matchAll(/<si\b/g))].length)
      reject("共享字符串无法完整提取");
  }
  return sheets;
}

type XlsEvidence = {
  sheetNames: string[];
  rows: Array<Map<number, string[]>>;
  formulas: Array<Set<string>>;
};
/** Strict CFB v3 structural preflight, including FAT/miniFAT cycles and overlapping allocations. */
function checkedXls(bytes: Buffer): XlsEvidence {
  const END = 0xfffffffe,
    FREE = 0xffffffff;
  if (
    bytes.length < 512 ||
    bytes.length % 512 ||
    bytes.readUInt16LE(26) !== 3 ||
    bytes.readUInt16LE(28) !== 0xfffe ||
    bytes.readUInt16LE(30) !== 9 ||
    bytes.readUInt16LE(32) !== 6 ||
    bytes.readUInt32LE(40) !== 0 ||
    bytes.readUInt32LE(56) !== 4096
  )
    reject("不支持或无效的 xls CFB 结构");
  const sectors = bytes.length / 512 - 1;
  const sector = (id: number): Buffer => {
    if (id >= sectors) reject("CFB 扇区越界");
    return bytes.subarray((id + 1) * 512, (id + 2) * 512);
  };
  const fatCount = bytes.readUInt32LE(44),
    difCount = bytes.readUInt32LE(72),
    miniCount = bytes.readUInt32LE(64);
  if (
    !fatCount ||
    fatCount > sectors ||
    difCount > sectors ||
    miniCount > sectors
  )
    reject("CFB 资源超限");
  const fatIds: number[] = [],
    reserved = new Set<number>();
  const addFat = (id: number) => {
    if (id === FREE) return;
    if (id >= sectors || reserved.has(id)) reject("CFB FAT 无效");
    reserved.add(id);
    fatIds.push(id);
  };
  for (let i = 0; i < 109; i++) addFat(bytes.readUInt32LE(76 + i * 4));
  let dif = bytes.readUInt32LE(68);
  for (let i = 0; i < difCount; i++) {
    if (dif >= sectors || reserved.has(dif)) reject("CFB DIFAT 无效");
    reserved.add(dif);
    const data = sector(dif);
    for (let k = 0; k < 127; k++) addFat(data.readUInt32LE(k * 4));
    dif = data.readUInt32LE(508);
  }
  if (difCount ? dif !== END : dif !== END && dif !== FREE)
    reject("CFB DIFAT 无效");
  if (fatIds.length !== fatCount || fatCount * 128 < sectors)
    reject("CFB FAT 不一致");
  const fat = fatIds.flatMap(id =>
    Array.from({ length: 128 }, (_, i) => sector(id).readUInt32LE(i * 4))
  );
  for (let __cuhIterator14 = (reserved)[Symbol.iterator](), __cuhStep14 = __cuhIterator14.next(); !__cuhStep14.done; __cuhStep14 = __cuhIterator14.next()) { const id = __cuhStep14.value; if (fat[id] !== (fatIds.includes(id) ? 0xfffffffd : 0xfffffffc))
      reject("CFB FAT 标记无效"); }
  function chain(
    start: number,
    table: number[],
    limit: number,
    allocations: Set<number>
  ): number[] {
    const output: number[] = [];
    let id = start;
    while (id !== END) {
      if (
        id >= table.length ||
        id >= limit ||
        allocations.has(id) ||
        output.length >= limit
      )
        reject("CFB 链越界、重叠或循环");
      allocations.add(id);
      output.push(id);
      id = table[id];
    }
    return output;
  }
  const dirIds = chain(bytes.readUInt32LE(48), fat, sectors, reserved);
  if (!dirIds.length || dirIds.length > 128) reject("CFB 目录资源超限");
  const dir = Buffer.concat(dirIds.map(sector));
  type Stream = { name: string; start: number; size: number; type: number };
  const streams: Stream[] = [];
  let root: Stream | undefined,
    aggregate = 0;
  for (let p = 0; p < dir.length; p += 128) {
    const type = dir[p + 66];
    if (!type) continue;
    const length = dir.readUInt16LE(p + 64);
    if (
      ![1, 2, 5].includes(type) ||
      length < 2 ||
      length > 64 ||
      length % 2 ||
      dir.readUInt32LE(p + 124)
    )
      reject("CFB 目录无效");
    const name = dir.subarray(p, p + length - 2).toString("utf16le");
    const stream = {
      name,
      type,
      start: dir.readUInt32LE(p + 116),
      size: dir.readUInt32LE(p + 120),
    };
    if (/(?:vba|macro|activex|objectpool|encrypted|encryption)/i.test(name))
      reject("拒绝宏、加密或嵌入内容");
    if (dir.readUInt16LE(p + length - 2) !== 0 || name.includes("\0"))
      reject("CFB 目录名称无效");
    if (stream.size > MAX_BYTES || (aggregate += stream.size) > MAX_INFLATED)
      reject("CFB 资源超限");
    if (type === 5) {
      if (root || p !== 0) reject("CFB 根目录无效");
      root = stream;
    } else {
      if (
        type !== 2 ||
        !/^(?:Workbook|Book|\x05SummaryInformation|\x05DocumentSummaryInformation|\x01CompObj|\x01Sh33tJ5)$/i.test(
          name
        ) ||
        streams.some(s => s.name.toLowerCase() === name.toLowerCase())
      )
        reject("不支持的 CFB 内容");
      streams.push(stream);
    }
  }
  const visited = new Set<number>([0]),
    pending = [dir.readUInt32LE(76)];
  if (dir.readUInt32LE(68) !== FREE || dir.readUInt32LE(72) !== FREE)
    reject("CFB 根目录指针无效");
  while (pending.length) {
    const index = pending.pop()!;
    if (index === FREE) continue;
    if (
      index >= dir.length / 128 ||
      visited.has(index) ||
      dir[index * 128 + 66] !== 2
    )
      reject("CFB 目录树越界或循环");
    visited.add(index);
    const p = index * 128;
    if (dir.readUInt32LE(p + 76) !== FREE) reject("CFB 流目录指针无效");
    pending.push(dir.readUInt32LE(p + 68), dir.readUInt32LE(p + 72));
  }
  if (visited.size !== streams.length + 1) reject("CFB 目录不能遗漏流");
  if (
    !root ||
    streams.filter(s => /^(Workbook|Book)$/i.test(s.name)).length !== 1
  )
    reject("没有唯一 xls 工作簿");
  const rootIds = root.size ? chain(root.start, fat, sectors, reserved) : [];
  if (rootIds.length !== Math.ceil(root.size / 512)) reject("CFB 根流大小无效");
  const miniIds = miniCount
    ? chain(bytes.readUInt32LE(60), fat, sectors, reserved)
    : [];
  if (miniIds.length !== miniCount) reject("CFB miniFAT 大小无效");
  const miniFat = miniIds.flatMap(id =>
    Array.from({ length: 128 }, (_, i) => sector(id).readUInt32LE(i * 4))
  );
  const rootBytes = Buffer.concat(rootIds.map(sector)).subarray(0, root.size),
    usedMini = new Set<number>();
  let workbook: Buffer | undefined;
  for (const s of streams) {
    const mini = s.size < 4096,
      ids = s.size
        ? chain(
            s.start,
            mini ? miniFat : fat,
            mini ? Math.floor(root.size / 64) : sectors,
            mini ? usedMini : reserved
          )
        : [];
    if (ids.length !== Math.ceil(s.size / (mini ? 64 : 512)))
      reject("CFB 流大小无效");
    const content = Buffer.concat(
      ids.map(id =>
        mini ? rootBytes.subarray(id * 64, (id + 1) * 64) : sector(id)
      )
    ).subarray(0, s.size);
    if (/^(Workbook|Book)$/i.test(s.name)) workbook = content;
  }
  if (
    !workbook ||
    workbook.length < 8 ||
    workbook.readUInt16LE(0) !== 0x0809 ||
    workbook.readUInt16LE(6) !== 0x0005
  )
    reject("仅支持标准 BIFF8 xls 工作簿");
  let sheets = 0,
    records = 0,
    cells = 0;
  const offsets: number[] = [],
    sheetNames: string[] = [];
  const recordList: Array<{
    p: number;
    id: number;
    data: Buffer;
    raw: string;
  }> = [];
  for (let p = 0; p < workbook.length; ) {
    if (p + 4 > workbook.length) reject("xls 记录无效");
    const id = workbook.readUInt16LE(p),
      length = workbook.readUInt16LE(p + 2),
      data = workbook.subarray(p + 4, p + 4 + length);
    if (p + 4 + length > workbook.length || ++records > 1000000)
      reject("xls 记录无效或资源超限");
    if (
      id === 0x002f ||
      id === 0x00d3 ||
      id === 0x005d ||
      id === 0x0023 ||
      id === 0x01b8
    )
      reject("拒绝 xls 加密、宏、外链或嵌入内容");
    if (id === 0x01ae && (length !== 4 || data.readUInt16LE(2) !== 0x0401))
      reject("拒绝 xls 外部链接");
    if (id === 0x0085) {
      if (
        length < 8 ||
        data[5] !== 0 ||
        ++sheets > MAX_SHEETS ||
        !data[6] ||
        data[7] > 1 ||
        length !== 8 + data[6] * (data[7] ? 2 : 1)
      )
        reject("xls 非标准工作表或工作表过多");
      const name = data[7]
          ? data.subarray(8).toString("utf16le")
          : data.subarray(8).toString("latin1"),
        offset = data.readUInt32LE(0);
      if (
        name.length > 128 ||
        /^(?:__proto__|constructor|prototype)$/i.test(name) ||
        sheetNames.includes(name) ||
        offsets.includes(offset) ||
        offset + 8 > workbook.length ||
        workbook.readUInt16LE(offset) !== 0x0809 ||
        workbook.readUInt16LE(offset + 6) !== 0x0010
      )
        reject("xls 工作表地址或名称无效");
      sheetNames.push(name);
      offsets.push(offset);
    }
    if (
      [
        0x0006, 0x0203, 0x027e, 0x0204, 0x00fd, 0x0205, 0x0201, 0x00bd, 0x00be,
      ].includes(id)
    ) {
      if (
        length < 6 ||
        data.readUInt16LE(0) >= MAX_ROWS ||
        data.readUInt16LE(2) >= MAX_COLS
      )
        reject("xls 单元格资源超限");
      const multi = id === 0x00bd || id === 0x00be;
      if (
        multi &&
        (data.readUInt16LE(length - 2) >= MAX_COLS ||
          data.readUInt16LE(length - 2) < data.readUInt16LE(2))
      )
        reject("xls 单元格资源超限");
      cells += multi
        ? data.readUInt16LE(length - 2) - data.readUInt16LE(2) + 1
        : 1;
      if (cells > MAX_CELLS) reject("xls 单元格资源超限");
    }
    if (
      id === 0x0200 &&
      (length < 14 ||
        data.readUInt32LE(4) > MAX_ROWS ||
        data.readUInt16LE(10) > MAX_COLS)
    )
      reject("xls 行列资源超限");
    if (
      id === 0x0208 &&
      (length < 16 ||
        data.readUInt16LE(0) >= MAX_ROWS ||
        data.readUInt16LE(4) > MAX_COLS)
    )
      reject("xls 原行资源超限");
    if (
      id === 0x00fc &&
      (length < 8 ||
        data.readUInt32LE(0) > MAX_CELLS ||
        data.readUInt32LE(4) > MAX_CELLS ||
        data.readUInt32LE(4) > data.readUInt32LE(0))
    )
      reject("xls 共享字符串资源超限");
    recordList.push({
      p,
      id,
      data,
      raw: workbook.subarray(p, p + 4 + length).toString("hex"),
    });
    p += 4 + length;
  }
  if (!sheets) reject("xls 没有工作表");
  const rows = offsets.map(() => new Map<number, string[]>()),
    formulas = offsets.map(() => new Set<string>());
  let currentSheet = -1,
    worksheetBofs = 0;
  for (const record of recordList) {
    if (record.id === 0x0809) {
      currentSheet = offsets.indexOf(record.p);
      if (
        record.data.length < 4 ||
        record.data.readUInt16LE(2) !== (record.p === 0 ? 0x0005 : 0x0010) ||
        (record.p !== 0 && currentSheet < 0)
      )
        reject("xls 非标准或遗漏工作表");
      if (currentSheet >= 0) worksheetBofs++;
    }
    if (
      [
        0x0208, 0x0006, 0x0203, 0x027e, 0x0204, 0x00fd, 0x0205, 0x0201, 0x00bd,
        0x00be,
      ].includes(record.id)
    ) {
      if (currentSheet < 0) reject("xls 原行位置无效");
      const n = record.data.readUInt16LE(0) + 1,
        list = rows[currentSheet].get(n) ?? [];
      list.push(record.raw);
      rows[currentSheet].set(n, list);
      if (record.id === 0x0006)
        formulas[currentSheet].add(
          XLSX.utils.encode_cell({ r: n - 1, c: record.data.readUInt16LE(2) })
        );
    }
    if (record.id === 0x000a) currentSheet = -1;
  }
  if (
    worksheetBofs !== sheets ||
    rows.reduce((n, row) => n + row.size, 0) > MAX_TOTAL_ROWS
  )
    reject("xls 工作表或原行不能完整提取");
  return { sheetNames, rows, formulas };
}
function rowEvidence(
  sheetIndex: number,
  sheetName: string,
  rowNumber: number,
  cells: (string | number | null)[],
  evidence: unknown
): OriginalWorkbookManifest["sheets"][number]["rows"][number] {
  const originalContent = JSON.stringify({
    sheetIndex,
    sheetName,
    rowNumber,
    evidence,
  });
  return {
    rowNumber,
    originalRowHash: hash(originalContent),
    originalContent,
    cells,
  };
}
function workbookManifest(
  bytes: Buffer,
  raw?: RawSheet[],
  xls?: XlsEvidence
): OriginalWorkbookManifest {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(bytes, {
      type: "buffer",
      cellFormula: true,
      cellText: true,
      cellNF: true,
      cellDates: false,
      sheetStubs: true,
      bookVBA: false,
      WTF: true,
    });
  } catch {
    return reject("工作簿无法完整提取，请提供未加密的标准文件");
  }
  if (
    !wb.SheetNames?.length ||
    wb.SheetNames.length > MAX_SHEETS ||
    new Set(wb.SheetNames).size !== wb.SheetNames.length ||
    (raw &&
      (raw.length !== wb.SheetNames.length ||
        raw.some((s, i) => s.name !== wb.SheetNames[i])))
  )
    reject("工作表无法完整提取");
  if (
    xls &&
    (xls.sheetNames.length !== wb.SheetNames.length ||
      xls.sheetNames.some((name, i) => name !== wb.SheetNames[i]))
  )
    reject("xls 工作表不能遗漏");
  const manifest: OriginalWorkbookManifest = { sheets: [] };
  let totalRows = 0,
    totalCells = 0,
    totalContent = 0;
  wb.SheetNames.forEach((sheetName, sheetIndex) => {
    if (sheetName.length > 128) reject("工作表名称过长");
    const ws = wb.Sheets[sheetName];
    if (!ws) reject("工作表无法提取");
    if (ws["!ref"]) checkRange(ws["!ref"]);
    const map = new Map<
      number,
      Array<{ ref: string; c: number; cell: XLSX.CellObject }>
    >();
    for (const ref of Object.keys(ws)) {
      if (ref.startsWith("!")) continue;
      const a = address(ref),
        cell = ws[ref] as XLSX.CellObject;
      if (
        ++totalCells > MAX_CELLS ||
        !cell ||
        (raw && !raw[sheetIndex].cells.has(ref))
      )
        reject("单元格无法完整提取或资源超限");
      if (xls && !xls.rows[sheetIndex].has(a.r + 1))
        reject("xls 单元格不能完整映射到原行");
      const row = map.get(a.r + 1) ?? [];
      row.push({ ref, c: a.c, cell });
      map.set(a.r + 1, row);
    }
    if (raw)
      for (let __cuhIterator15 = (raw[sheetIndex].rows)[Symbol.iterator](), __cuhStep15 = __cuhIterator15.next(); !__cuhStep15.done; __cuhStep15 = __cuhIterator15.next()) { const row = __cuhStep15.value; if (!map.has(row)) map.set(row, []); }
    if (xls)
      for (let __cuhIterator16 = (xls.rows[sheetIndex].keys())[Symbol.iterator](), __cuhStep16 = __cuhIterator16.next(); !__cuhStep16.done; __cuhStep16 = __cuhIterator16.next()) { const row = __cuhStep16.value; if (!map.has(row)) map.set(row, []); }
    const rows: OriginalWorkbookManifest["sheets"][number]["rows"] = [];
    for (const [rowNumber, entries] of [...Array.from(map)].sort((a, b) => a[0] - b[0])) {
      if (++totalRows > MAX_TOTAL_ROWS) reject("原行清单资源超限");
      const cells: (string | number | null)[] = [],
        evidence: unknown[] = [];
      for (let __cuhIterator17 = (entries.sort((a, b) => a.c - b.c))[Symbol.iterator](), __cuhStep17 = __cuhIterator17.next(); !__cuhStep17.done; __cuhStep17 = __cuhIterator17.next()) {
      const { ref, c, cell } = __cuhStep17.value;
        while (cells.length <= c) cells.push(null);
        if (
          (typeof cell.v === "string" && cell.v.length > MAX_TEXT) ||
          (cell.f && cell.f.length > MAX_TEXT)
        )
          reject("单元格文本资源超限");
        if (
          cell.t === "n" &&
          (typeof cell.v !== "number" || !Number.isFinite(cell.v))
        )
          reject("数字单元格无效");
        if (!["n", "s", "str", "b", "e", "z"].includes(cell.t))
          reject("不支持的单元格类型");
        // Formula caches are evidence only, never importable numbers. Do not reconstruct lost numeric digits.
        const formulaPresent = Boolean(
          cell.f ||
            cell.F ||
            /<f\b/.test(raw?.[sheetIndex].cells.get(ref) ?? "") ||
            xls?.formulas[sheetIndex].has(ref)
        );
        cells[c] = formulaPresent
          ? null
          : cell.t === "n"
            ? (cell.v as number)
            : cell.t === "b"
              ? String(cell.v)
              : cell.t === "e"
                ? (cell.w ?? `#ERROR:${cell.v}`)
                : typeof cell.v === "string"
                  ? cell.v
                  : null;
        const numericPrecisionWarning =
          cell.t === "n" &&
          typeof cell.v === "number" &&
          ((Number.isInteger(cell.v) && Math.abs(cell.v) >= 1e15) ||
            (!Number.isSafeInteger(cell.v) && Number.isInteger(cell.v)));
        evidence.push({
          cell: ref,
          type: cell.t,
          value: cell.v ?? null,
          formulaPresent,
          formula: cell.f ?? null,
          arrayFormula: cell.F ?? null,
          formattedText: cell.w ?? null,
          numberFormat: cell.z ?? null,
          numericPrecisionWarning,
          rawXml: raw?.[sheetIndex].cells.get(ref) ?? null,
        });
      }
      const extractedRefs = new Set(entries.map(e => e.ref));
      if (raw)
        for (const [ref, rawXml] of raw[sheetIndex].byRow.get(rowNumber) ?? [])
          if (!extractedRefs.has(ref)) {
            if (!/^<c\b[^>]*\/>$/.test(rawXml) && /<(?:v|f|is)\b/.test(rawXml))
              reject("单元格未被完整提取");
            evidence.push({ cell: ref, type: "empty", rawXml });
          }
      if (xls)
        evidence.push({
          kind: "biff8-row-records",
          recordsHex: xls.rows[sheetIndex].get(rowNumber) ?? [],
        });
      const row = rowEvidence(
        sheetIndex,
        sheetName,
        rowNumber,
        cells,
        evidence
      );
      if (
        (totalContent += Buffer.byteLength(JSON.stringify(row)) + 1) >
        MAX_MANIFEST
      )
        reject("原行清单超过 8MiB，请拆分文件");
      rows.push(row);
    }
    manifest.sheets.push({ sheetIndex, sheetName, rows });
  });
  if (Buffer.byteLength(JSON.stringify(manifest)) > MAX_MANIFEST)
    reject("原行清单超过 8MiB，请拆分文件");
  return manifest;
}
function csvManifest(bytes: Buffer): OriginalWorkbookManifest {
  const text = utf8(bytes);
  if (
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text) ||
    /^\s*(?:MZ|#!|<\?xml|<!doctype|<html\b|<svg\b|%PDF-|PK\x03\x04)/i.test(text)
  )
    reject("csv 包含二进制或伪装内容");
  const rows: OriginalWorkbookManifest["sheets"][number]["rows"] = [];
  let fields: string[] = [],
    value = "",
    quoted = false,
    closed = false,
    start = 0,
    totalCells = 0,
    contentSize = 0;
  const field = () => {
    if (
      value.length > MAX_TEXT ||
      fields.length >= MAX_COLS ||
      ++totalCells > MAX_CELLS
    )
      reject("csv 单元格资源超限");
    fields.push(value);
    value = "";
    closed = false;
  };
  const row = (end: number) => {
    field();
    if (rows.length >= MAX_ROWS) reject("csv 行数资源超限");
    const record = text.slice(start, end),
      cells = fields;
    const evidence = {
      rawRecord: record,
      cells,
      formulaLikeColumns: cells.flatMap((v, i) =>
        /^[\s]*[=+@-]/.test(v) ? [i] : []
      ),
    };
    const output = rowEvidence(0, "CSV", rows.length + 1, cells, evidence);
    if (
      (contentSize += Buffer.byteLength(JSON.stringify(output)) + 1) >
      MAX_MANIFEST
    )
      reject("原行清单超过 8MiB，请拆分文件");
    rows.push(output);
    fields = [];
  };
  for (let p = 0; p < text.length; p++) {
    const ch = text[p];
    if (quoted) {
      if (ch === '"') {
        if (text[p + 1] === '"') {
          value += '"';
          p++;
        } else {
          quoted = false;
          closed = true;
        }
      } else value += ch;
    } else if (ch === '"') {
      if (value.length || closed) reject("csv 引号无效");
      quoted = true;
    } else if (ch === ",") field();
    else if (ch === "\r" || ch === "\n") {
      row(p);
      if (ch === "\r" && text[p + 1] === "\n") p++;
      start = p + 1;
    } else {
      if (closed) reject("csv 引号后内容无效");
      value += ch;
    }
    if (value.length > MAX_TEXT) reject("csv 单元格资源超限");
  }
  if (quoted) reject("csv 引号未闭合");
  if (start < text.length) row(text.length);
  if (!rows.length) reject("csv 没有原行");
  const manifest = { sheets: [{ sheetIndex: 0, sheetName: "CSV", rows }] };
  if (Buffer.byteLength(JSON.stringify(manifest)) > MAX_MANIFEST)
    reject("原行清单超过 8MiB，请拆分文件");
  return manifest;
}

export function inspectCustomerUploadFile(file: FileInput): {
  bytes: Buffer;
  fileName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  manifest: OriginalWorkbookManifest | null;
} {
  if (!file || typeof file !== "object") reject("上传文件无效");
  const { name, ext } = filename(file.fileName),
    bytes = decodeBase64(file.base64);
  if (typeof file.mimeType !== "string" || file.mimeType !== MIME[ext])
    reject("文件 MIME 与格式不匹配");
  let manifest: OriginalWorkbookManifest;
  if (ext === "xlsx") {
    if (bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50)
      reject("xlsx 魔术字节不匹配");
    manifest = workbookManifest(bytes, checkedXlsx(bytes));
  } else if (ext === "xls") {
    if (!bytes.subarray(0, 8).equals(CFB_MAGIC)) reject("xls 魔术字节不匹配");
    manifest = workbookManifest(bytes, undefined, checkedXls(bytes));
  } else manifest = csvManifest(bytes);
  return {
    bytes,
    fileName: name,
    mimeType: MIME[ext],
    byteSize: bytes.length,
    sha256: hash(bytes),
    manifest,
  };
}

function checkedRoot(root: string): { root: string; testing: boolean } {
  if (
    typeof root !== "string" ||
    !path.isAbsolute(root) ||
    root !== path.normalize(root) ||
    root.includes("\0") ||
    root.split(path.sep).some(p => /^(public|uploads)$/i.test(p)) ||
    root === "/opt/releases" ||
    root.startsWith("/opt/releases/")
  )
    reject("私有存储配置无效");
  const testing =
    process.env.NODE_ENV === "test" &&
    path.dirname(root) === os.tmpdir() &&
    /^[\w.-]+[A-Za-z0-9]{6}$/.test(path.basename(root));
  if (root !== ROOT && !testing) reject("私有存储必须使用固定共享目录");
  return { root, testing };
}
async function openRoot(
  root: string,
  testing: boolean,
  allowCreate: boolean
): Promise<FileHandle> {
  let current = path.parse(root).root;
  const segments = root.slice(current.length).split(path.sep);
  const uid = process.getuid?.();
  for (let i = -1; i < segments.length; i++) {
    if (i >= 0) current = path.join(current, segments[i]);
    const last = i === segments.length - 1;
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if (
        allowCreate &&
        !testing &&
        (error as NodeJS.ErrnoException).code === "ENOENT" &&
        i >= 0
      ) {
        await fs.mkdir(current, { mode: 0o700 });
        stat = await fs.lstat(current);
      } else throw error;
    }
    const stickyTestTmp =
      testing &&
      current === os.tmpdir() &&
      stat.uid === 0 &&
      (stat.mode & 0o1000) !== 0;
    if (
      stat.isSymbolicLink() ||
      !stat.isDirectory() ||
      (stat.uid !== 0 && stat.uid !== uid) ||
      (last && ((stat.mode & 0o7777) !== 0o700 || stat.uid !== uid)) ||
      (!last && !stickyTestTmp && (stat.mode & 0o022) !== 0)
    )
      reject("私有存储目录不安全");
  }
  // Pin the directory inode; all child operations use the kernel's fd path (Linux deployment).
  const handle = await fs.open(
    root,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
  );
  const pinned = await handle.stat(),
    checked = await fs.lstat(root);
  if (
    pinned.dev !== checked.dev ||
    pinned.ino !== checked.ino ||
    (pinned.mode & 0o7777) !== 0o700 ||
    pinned.uid !== uid
  ) {
    await handle.close();
    reject("私有存储目录不安全");
  }
  return handle;
}
/** Only inject into an ACL-enforcing service. Locators are selectors, not authorization or URLs. */
export function createCustomerUploadPrivateStorage(options: { root: string }): {
  put(file: FileInput): Promise<PrivateStoredFile>;
  read(locator: string): Promise<Buffer>;
} {
  const { root, testing } = checkedRoot(options.root);
  return {
    async put(file) {
      const inspected = inspectCustomerUploadFile(file);
      let directory: FileHandle | undefined,
        temporary: string | undefined,
        handle: FileHandle | undefined;
      let temporaryOwned = false;
      try {
        directory = await openRoot(root, testing, true);
        const dir = `/proc/self/fd/${directory.fd}`;
        const locator = randomUUID();
        if (!LOCATOR.test(locator)) reject("存储标识生成失败");
        temporary = `${dir}/.${randomUUID()}.tmp`;
        handle = await fs.open(
          temporary,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600
        );
        temporaryOwned = true;
        await handle.chmod(0o600);
        await handle.writeFile(inspected.bytes);
        await handle.sync();
        await handle.close();
        handle = undefined;
        // rename() overwrites on POSIX. link()+unlink() is atomic no-clobber publication instead.
        await fs.link(temporary, `${dir}/${locator}`);
        await fs.unlink(temporary);
        temporary = undefined;
        await directory.sync();
        const { bytes: _bytes, ...metadata } = inspected;
        return { locator, ...metadata };
      } catch {
        throw new Error("私有文件保存失败");
      } finally {
        if (handle) await handle.close().catch(() => undefined);
        if (temporaryOwned && temporary)
          await fs.unlink(temporary).catch(() => undefined);
        // A published object, including a DB orphan or fsync/ack failure, is retained privately.
        if (directory) await directory.close().catch(() => undefined);
      }
    },
    async read(locator) {
      if (typeof locator !== "string" || !LOCATOR.test(locator))
        reject("私有文件不可读取");
      let directory: FileHandle | undefined, handle: FileHandle | undefined;
      try {
        directory = await openRoot(root, testing, false);
        handle = await fs.open(
          `/proc/self/fd/${directory.fd}/${locator}`,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
        );
        const before = await handle.stat();
        if (
          !before.isFile() ||
          before.nlink !== 1 ||
          (before.mode & 0o7777) !== 0o600 ||
          before.uid !== process.getuid?.() ||
          before.size < 1 ||
          before.size > MAX_BYTES
        )
          reject("私有文件不可读取");
        const bytes = Buffer.alloc(before.size);
        let offset = 0;
        while (offset < bytes.length) {
          const result = await handle.read(
            bytes,
            offset,
            bytes.length - offset,
            offset
          );
          if (!result.bytesRead) reject("私有文件不可读取");
          offset += result.bytesRead;
        }
        const after = await handle.stat();
        if (
          after.size !== before.size ||
          after.mtimeMs !== before.mtimeMs ||
          after.ctimeMs !== before.ctimeMs ||
          after.nlink !== 1
        )
          reject("私有文件不可读取");
        // The authorized caller must compare these original bytes with its persisted byteSize/sha256.
        return bytes;
      } catch {
        throw new Error("私有文件不可读取");
      } finally {
        if (handle) await handle.close().catch(() => undefined);
        if (directory) await directory.close().catch(() => undefined);
      }
    },
  };
}
