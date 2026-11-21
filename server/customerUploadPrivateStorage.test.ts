import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { zipSync, unzipSync } from "fflate";
import { inflateRawSync } from "node:zlib";
import {
  createCustomerUploadPrivateStorage,
  inspectCustomerUploadFile,
  type FileInput,
} from "../client/src/business/platform/front-router-types/server/services/customerUploadPrivateStorage";

const controls = vi.hoisted(() => ({ uuid: undefined as string | undefined }));
vi.mock("node:crypto", async importOriginal => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, randomUUID: () => controls.uuid ?? actual.randomUUID() };
});
vi.mock("xlsx", async importOriginal => {
  const actual = await importOriginal<typeof import("xlsx")>();
  const cjs = (actual as typeof actual & { default?: typeof actual }).default ?? actual;
  return { ...actual, ...cjs, read: vi.fn(actual.read ?? cjs.read) };
});
vi.mock("node:zlib", async importOriginal => {
  const actual = await importOriginal<typeof import("node:zlib")>();
  return { ...actual, inflateRawSync: vi.fn(actual.inflateRawSync) };
});

const MIME = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
};
const roots: string[] = [];
async function root(): Promise<string> {
  const r = await fs.mkdtemp(path.join(os.tmpdir(), "customer-private-storage-"));
  roots.push(r); return r;
}
function file(bytes: Buffer | string, ext: keyof typeof MIME = "csv"): FileInput {
  return { fileName: `原库存.${ext}`, mimeType: MIME[ext], base64: Buffer.from(bytes).toString("base64") };
}
function workbook(ext: "xlsx" | "xls" = "xlsx"): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["型号", "数量"], ["12345678901234567", 12], [12345678901234568, 3], ["formula", { t: "n", v: 42, f: "40+2" }]]), "第一张");
  const second = XLSX.utils.aoa_to_sheet([["第二张型号", 8]]); second["A4"] = { t: "s", v: "保留原行号" }; second["!ref"] = "A1:B4";
  XLSX.utils.book_append_sheet(wb, second, "第二张");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), "空表");
  return XLSX.write(wb, { type: "buffer", bookType: ext });
}
function alteredZip(change: (entries: Record<string, Uint8Array>) => void): Buffer {
  const entries = unzipSync(workbook()); change(entries);
  return Buffer.from(zipSync(entries, { level: 6 }));
}
function zipWithFlags(flags: number, level: 0 | 6 = 6): Buffer {
  const bytes = Buffer.from(zipSync(unzipSync(workbook()), { level }));
  let p = central(bytes);
  while (p >= 0 && bytes.readUInt32LE(p) === 0x02014b50) {
    const local = bytes.readUInt32LE(p + 42);
    bytes.writeUInt16LE(flags, p + 8); bytes.writeUInt16LE(flags, local + 6);
    p += 46 + bytes.readUInt16LE(p + 28) + bytes.readUInt16LE(p + 30) + bytes.readUInt16LE(p + 32);
  }
  return bytes;
}
function central(bytes: Buffer): number { return bytes.indexOf(Buffer.from("504b0102", "hex")); }
function xlsWithRecord(id: number, payload: Buffer): Buffer {
  const cfb = XLSX.CFB.read(workbook("xls"), { type: "buffer" });
  const entry = XLSX.CFB.find(cfb, "Workbook")!;
  const original = Buffer.from(entry.content as Uint8Array);
  const len = original.readUInt16LE(2) + 4;
  const record = Buffer.alloc(payload.length + 4); record.writeUInt16LE(id); record.writeUInt16LE(payload.length, 2); payload.copy(record, 4);
  XLSX.CFB.utils.cfb_add(cfb, "Workbook", Buffer.concat([original.subarray(0, len), record, original.subarray(len)]));
  return Buffer.from(XLSX.CFB.write(cfb, { type: "buffer" }));
}
afterEach(async () => { controls.uuid = undefined; vi.clearAllMocks(); vi.restoreAllMocks(); for (const r of roots.splice(0)) await fs.rm(r, { recursive: true, force: true }); });

describe("strict customer workbook inspection", () => {
  it.each([0x0000, 0x0002, 0x0004, 0x0006, 0x0806])("accepts legal Deflate compression options 0x%s without changing original bytes", flags => {
    const bytes = zipWithFlags(flags), inspected = inspectCustomerUploadFile(file(bytes, "xlsx"));
    expect(inspected.bytes.equals(bytes)).toBe(true);
    expect(inspected.sha256).toBe(crypto.createHash("sha256").update(bytes).digest("hex"));
    expect(inspected.manifest).toEqual(inspectCustomerUploadFile(file(zipWithFlags(0), "xlsx")).manifest);
  });
  it.each([0x0007, 0x0046, 0x2006, 0x0016])("still rejects encryption and unsupported flags 0x%s before workbook parsing", flags => {
    vi.mocked(XLSX.read).mockClear();
    expect(() => inspectCustomerUploadFile(file(zipWithFlags(flags), "xlsx"))).toThrow(/拒绝加密、Zip64/);
    expect(XLSX.read).not.toHaveBeenCalled();
  });
  it("does not allow Deflate option bits for stored entries and still checks header consistency", () => {
    expect(() => inspectCustomerUploadFile(file(zipWithFlags(0x0006, 0), "xlsx"))).toThrow(/拒绝加密、Zip64/);
    const bytes = zipWithFlags(0x0006); bytes.writeUInt16LE(0, 6);
    expect(() => inspectCustomerUploadFile(file(bytes, "xlsx"))).toThrow(/本地头不一致/);
  });
  it("returns the unmodified bytes and deterministic sha256/row evidence from ALL sheets", () => {
    const bytes = workbook(); const result = inspectCustomerUploadFile(file(bytes, "xlsx"));
    expect(result.bytes.equals(bytes)).toBe(true);
    expect(result.sha256).toBe(crypto.createHash("sha256").update(bytes).digest("hex"));
    expect(result.manifest!.sheets.map(s => s.sheetName)).toEqual(["第一张", "第二张", "空表"]);
    expect(result.manifest!.sheets[1].rows.map(r => r.rowNumber)).toEqual([1, 4]);
    expect(result.manifest!.sheets[2].rows).toEqual([]);
    for (const sheet of result.manifest!.sheets) for (const row of sheet.rows) expect(row.originalRowHash).toBe(crypto.createHash("sha256").update(row.originalContent).digest("hex"));
    expect(inspectCustomerUploadFile(file(bytes, "xlsx")).manifest).toEqual(result.manifest);
  });
  it("retains numeric/text evidence without reconstructing >15-digit models; formula caches are not model values", () => {
    const rows = inspectCustomerUploadFile(file(workbook(), "xlsx")).manifest!.sheets[0].rows;
    expect(rows[1].cells[0]).toBe("12345678901234567");
    expect(rows[2].cells[0]).toBe(12345678901234568);
    expect(JSON.parse(rows[2].originalContent).evidence[0]).toMatchObject({ type: "n", numericPrecisionWarning: true });
    expect(rows[2].originalContent).toContain("<v>12345678901234568</v>");
    expect(rows[3].cells[1]).toBeNull();
    expect(JSON.parse(rows[3].originalContent).evidence[1]).toMatchObject({ value: 42, formula: "40+2" });
  });
  it("keeps original xlsx lexical numeric evidence even when JavaScript has rounded it", () => {
    const bytes = alteredZip(e => { const n = "xl/worksheets/sheet1.xml"; e[n] = Buffer.from(Buffer.from(e[n]).toString().replace("<v>12345678901234568</v>", "<v>12345678901234567</v>")); });
    const row = inspectCustomerUploadFile(file(bytes, "xlsx")).manifest!.sheets[0].rows[2];
    expect(row.cells[0]).toBe(12345678901234568);
    expect(row.originalContent).toContain("<v>12345678901234567</v>");
  });
  it("does not treat an empty/shared-formula cached number as an ordinary number", () => {
    const bytes = alteredZip(e => { const n = "xl/worksheets/sheet1.xml"; e[n] = Buffer.from(Buffer.from(e[n]).toString().replace("<f>40+2</f>", '<f t="shared" si="9"/>')); });
    const row = inspectCustomerUploadFile(file(bytes, "xlsx")).manifest!.sheets[0].rows[3];
    expect(row.cells[1]).toBeNull();
    expect(JSON.parse(row.originalContent).evidence[1]).toMatchObject({ value: 42, formulaPresent: true });
  });
  it("supports UTF8/BOM CSV, quoted multiline records, text models, and inert formula text", () => {
    const input = file(Buffer.from('\uFEFF型号,数量\r\n12345678901234567,12\r\n"a\nb",=HYPERLINK(""https://example.invalid"")\r\n'));
    // Formula strings with embedded quotes must themselves be CSV quoted.
    input.base64 = Buffer.from('\uFEFF型号,数量\r\n12345678901234567,12\r\n"a\nb","=HYPERLINK(""https://example.invalid"")"\r\n').toString("base64");
    const result = inspectCustomerUploadFile(input);
    expect(result.manifest!.sheets[0].rows).toHaveLength(3);
    expect(result.manifest!.sheets[0].rows[1].cells).toEqual(["12345678901234567", "12"]);
    expect(result.manifest!.sheets[0].rows[2].cells).toEqual(["a\nb", '=HYPERLINK("https://example.invalid")']);
    expect(JSON.parse(result.manifest!.sheets[0].rows[2].originalContent).evidence.formulaLikeColumns).toEqual([1]);
    expect(result.bytes.equals(Buffer.from(input.base64, "base64"))).toBe(true);
  });
  it.each(["../a.csv", "a/b.csv", "a\\b.csv", "a\r\nb.csv", "a\0.csv", " a.csv", "a.csv ", "a:csv.csv", "a..csv", "a.exe"])("rejects unsafe filename %j", name => {
    expect(() => inspectCustomerUploadFile({ ...file("a,b"), fileName: name })).toThrow();
  });
  it.each(["", "Zg", "Zg=", "Zg===", "Zh==", "Zm9=", "Z g==", "Zg==\n", "Zg-_", "data:text/csv;base64,Zg=="])("rejects noncanonical base64 %j", base64 => {
    expect(() => inspectCustomerUploadFile({ ...file("a,b"), base64 })).toThrow();
  });
  it("caps encoded and actual decoded bytes independently, including same encoded length at boundary", () => {
    const cap = 10 * 1024 * 1024;
    const tooBig = Buffer.alloc(cap + 1, 65).toString("base64");
    expect(tooBig.length).toBe(Buffer.alloc(cap).toString("base64").length);
    expect(() => inspectCustomerUploadFile({ ...file("a,b"), base64: tooBig })).toThrow(/10MiB/);
    expect(() => inspectCustomerUploadFile({ ...file("a,b"), base64: "A".repeat(Math.ceil(cap / 3) * 4 + 4) })).toThrow(/10MiB/);
    const row = `${"a".repeat(1000)},${"b".repeat(1000)}\n`;
    const fullRows = Math.floor(cap / Buffer.byteLength(row));
    const csv = row.repeat(fullRows) + "c".repeat(cap - fullRows * row.length);
    expect(Buffer.byteLength(csv)).toBe(cap);
    // Exactly 10MiB passes binary/base64 checks; the independently bounded 8MiB manifest fails.
    expect(() => inspectCustomerUploadFile(file(csv))).toThrow(/原行清单超过 8MiB，请拆分文件/);
  });
  it("bounds the FULL manifest JSON including cells and originalContent, with no truncation", () => {
    const csv = (`${"a".repeat(1000)},${"b".repeat(1000)}\n`).repeat(1000);
    const result = inspectCustomerUploadFile(file(csv));
    expect(result.manifest!.sheets[0].rows).toHaveLength(1000);
    expect(Buffer.byteLength(JSON.stringify(result.manifest))).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(() => inspectCustomerUploadFile(file(csv.repeat(2)))).toThrow(/请拆分文件/);
  });
  it("rejects magic/extension/MIME mismatch and executable or binary masquerading as csv", () => {
    for (const input of [file(workbook(), "xls"), file(workbook("xls"), "xlsx"), file("a,b", "xlsx"), file(Buffer.from([0xff, 0xfe, 0, 0])), file("MZ executable"), file("#! /bin/sh\necho secret"), file("<html>bad</html>"), { ...file("a,b"), mimeType: "application/octet-stream" }, { ...file(workbook(), "xlsx"), mimeType: MIME.xls }]) expect(() => inspectCustomerUploadFile(input)).toThrow();
  });
  it.each(['"unterminated', 'a"b,c', '"a"x,b'])("rejects malformed CSV %j", csv => { expect(() => inspectCustomerUploadFile(file(csv))).toThrow(); });
  it("rejects >64 sheets, excessive dimensions, cells, and oversized text rather than truncating", () => {
    const wb = XLSX.utils.book_new(); for (let i = 0; i < 65; i++) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[i]]), `s${i}`);
    expect(() => inspectCustomerUploadFile(file(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), "xlsx"))).toThrow();
    const bytes = alteredZip(e => { const n = "xl/worksheets/sheet1.xml"; e[n] = Buffer.from(Buffer.from(e[n]).toString().replace('ref="A1:B4"', 'ref="A1:XFD1048576"')); });
    expect(() => inspectCustomerUploadFile(file(bytes, "xlsx"))).toThrow();
    expect(() => inspectCustomerUploadFile(file("a,".repeat(256) + "b"))).toThrow();
    expect(() => inspectCustomerUploadFile(file("a".repeat(16385)))).toThrow();
    expect(() => inspectCustomerUploadFile(file("a\n".repeat(10001)))).toThrow();
  });
  it.each(["xl/vbaProject.bin", "xl/activeX/activeX1.xml", "xl/externalLinks/externalLink1.xml", "xl/embeddings/oleObject1.bin", "xl/EncryptedPackage"])("rejects forbidden ZIP part %s", name => {
    const bytes = alteredZip(e => { e[name] = Buffer.from("forbidden"); });
    expect(() => inspectCustomerUploadFile(file(bytes, "xlsx"))).toThrow();
  });
  it("rejects external relationships, macro content types, and DTD/entity XML", () => {
    for (const tweak of [
      (e: Record<string, Uint8Array>) => { e["xl/_rels/workbook.xml.rels"] = Buffer.from(Buffer.from(e["xl/_rels/workbook.xml.rels"]).toString().replace('<Relationship Id="rId1"', '<Relationship TargetMode="External" Id="rId1"')); },
      (e: Record<string, Uint8Array>) => { e["[Content_Types].xml"] = Buffer.from(Buffer.from(e["[Content_Types].xml"]).toString().replace("spreadsheetml.sheet.main+xml", "ms-excel.sheet.macroEnabled.main+xml")); },
      (e: Record<string, Uint8Array>) => { e["xl/workbook.xml"] = Buffer.from('<!DOCTYPE workbook [<!ENTITY x SYSTEM "file:///secret">]><workbook>&x;</workbook>'); },
    ]) expect(() => inspectCustomerUploadFile(file(alteredZip(tweak), "xlsx"))).toThrow();
  });
  it("rejects entity-encoded external relationships and actual macro content types", () => {
    const external = alteredZip(e => { const n = "xl/_rels/workbook.xml.rels"; e[n] = Buffer.from(Buffer.from(e[n]).toString().replace('<Relationship Id="rId1"', '<Relationship TargetMode="&#69;xternal" Id="rId1"')); });
    expect(() => inspectCustomerUploadFile(file(external, "xlsx"))).toThrow();
    const macro = alteredZip(e => { const n = "[Content_Types].xml"; e[n] = Buffer.from(Buffer.from(e[n]).toString().replace("spreadsheetml.sheet.main+xml", "ms-excel.sheet.macro&#69;nabled.main+xml")); });
    expect(() => inspectCustomerUploadFile(file(macro, "xlsx"))).toThrow();
  });
  it("rejects an executable renamed as an image inside an otherwise valid workbook", () => {
    const disguised = alteredZip(e => { e["xl/media/photo.png"] = Buffer.from("MZ executable masquerade"); });
    expect(() => inspectCustomerUploadFile(file(disguised, "xlsx"))).toThrow(/伪装/);
  });
  it("rejects ZIP traversal, duplicates/case collisions, symlink entries, CRC and header inconsistencies", () => {
    for (const name of ["../evil.xml", "/evil.xml", "xl/../evil.xml", "xl\\evil.xml", "xl//evil.xml", "xl/WORKBOOK.xml"]) expect(() => inspectCustomerUploadFile(file(alteredZip(e => { e[name] = Buffer.from("x"); }), "xlsx"))).toThrow();
    const duplicate = Buffer.from(zipSync({ "a.xml": Buffer.from("a"), "b.xml": Buffer.from("b") }, { level: 0 }));
    let p = 0; while ((p = duplicate.indexOf(Buffer.from("b.xml"), p)) !== -1) { duplicate[p] = 97; p++; }
    expect(() => inspectCustomerUploadFile(file(duplicate, "xlsx"))).toThrow();
    for (const tweak of [
      (b: Buffer) => b.writeUInt32LE(0xa1ff0000, central(b) + 38),
      (b: Buffer) => b.writeUInt16LE(1, central(b) + 8),
      (b: Buffer) => b.writeUInt32LE(123, 14),
      (b: Buffer) => b.writeUInt32LE(0xffffffff, central(b) + 42),
      (b: Buffer) => b.writeUInt16LE(45, central(b) + 6),
      (b: Buffer) => { const n = b.readUInt16LE(26), x = b.readUInt16LE(28); b[30 + n + x] ^= 255; },
    ]) { const b = Buffer.from(workbook()); tweak(b); expect(() => inspectCustomerUploadFile(file(b, "xlsx"))).toThrow(); }
  });
  it("rejects zipbomb declared/actual size mismatches, aggregate inflation, ratios and entry limits before SheetJS", () => {
    const read = vi.mocked(XLSX.read); read.mockClear();
    const ratio = alteredZip(e => { e["big.xml"] = Buffer.alloc(1024 * 1024, 65); });
    expect(() => inspectCustomerUploadFile(file(ratio, "xlsx"))).toThrow(/资源/);
    const b = Buffer.from(workbook()); const c = central(b); b.writeUInt32LE(65 * 1024 * 1024, c + 24); b.writeUInt32LE(65 * 1024 * 1024, 22);
    expect(() => inspectCustomerUploadFile(file(b, "xlsx"))).toThrow();
    const entries: Record<string, Uint8Array> = {}; for (let i = 0; i < 2049; i++) entries[`${i}.xml`] = Buffer.from("a");
    expect(() => inspectCustomerUploadFile(file(Buffer.from(zipSync(entries)), "xlsx"))).toThrow();
    const wrong = Buffer.from(zipSync({ "a.xml": Buffer.from("some compressed content here".repeat(30)) })); const cc = central(wrong); wrong.writeUInt32LE(2, 22); wrong.writeUInt32LE(2, cc + 24);
    expect(() => inspectCustomerUploadFile(file(wrong, "xlsx"))).toThrow();
    expect(read).not.toHaveBeenCalled();
  });
  it("checks aggregate 64MiB inflation BEFORE decompressing even the first entry", () => {
    const entries: Record<string, Uint8Array> = {}; for (let i = 0; i < 9; i++) entries[`${i}.xml`] = Buffer.alloc(45000, 65);
    const bytes = Buffer.from(zipSync(entries, { level: 0 }));
    let p = 0; while ((p = bytes.indexOf(Buffer.from("504b0102", "hex"), p)) !== -1) {
      bytes.writeUInt16LE(8, p + 10); bytes.writeUInt32LE(8 * 1024 * 1024, p + 24);
      const local = bytes.readUInt32LE(p + 42); bytes.writeUInt16LE(8, local + 8); bytes.writeUInt32LE(8 * 1024 * 1024, local + 22); p += 46;
    }
    vi.mocked(inflateRawSync).mockClear(); vi.mocked(XLSX.read).mockClear();
    expect(() => inspectCustomerUploadFile(file(bytes, "xlsx"))).toThrow(/资源超限/);
    expect(inflateRawSync).not.toHaveBeenCalled(); expect(XLSX.read).not.toHaveBeenCalled();
  });
  it("supports standard unencrypted BIFF8 xls with every worksheet", () => {
    const result = inspectCustomerUploadFile(file(workbook("xls"), "xls"));
    expect(result.manifest!.sheets.map(s => s.sheetName)).toEqual(["第一张", "第二张", "空表"]);
    expect(result.manifest!.sheets[1].rows.map(r => r.rowNumber)).toEqual([1, 4]);
    expect(result.manifest!.sheets[0].rows[2].originalContent).toContain('"numericPrecisionWarning":true');
    expect(JSON.parse(result.manifest!.sheets[0].rows[2].originalContent).evidence.at(-1)).toMatchObject({ kind: "biff8-row-records" });
    expect(JSON.parse(result.manifest!.sheets[0].rows[2].originalContent).evidence.at(-1).recordsHex.length).toBeGreaterThan(0);
  });
  it("rejects encrypted and macro CFB streams and encrypted/external BIFF records", () => {
    for (const name of ["EncryptedPackage", "EncryptionInfo", "_VBA_PROJECT", "VBA/dir", "ObjectPool/obj"]) {
      const cfb = XLSX.CFB.read(workbook("xls"), { type: "buffer" }); XLSX.CFB.utils.cfb_add(cfb, name, Buffer.from("x"));
      expect(() => inspectCustomerUploadFile(file(Buffer.from(XLSX.CFB.write(cfb, { type: "buffer" })), "xls"))).toThrow();
    }
    expect(() => inspectCustomerUploadFile(file(xlsWithRecord(0x002f, Buffer.alloc(6)), "xls"))).toThrow(/加密/);
    expect(() => inspectCustomerUploadFile(file(xlsWithRecord(0x01ae, Buffer.from([1, 0, 1, 0])), "xls"))).toThrow(/外部/);
    expect(() => inspectCustomerUploadFile(file(xlsWithRecord(0x00d3, Buffer.alloc(0)), "xls"))).toThrow();
  });
  it("rejects cyclic, out-of-bounds and inflated CFB before the SheetJS reader", () => {
    const read = vi.mocked(XLSX.read); read.mockClear();
    for (const tweak of [
      (b: Buffer) => b.writeUInt32LE(0xffffff, 44),
      (b: Buffer) => b.writeUInt32LE(0xffffff, 48),
      (b: Buffer) => { const d = (b.readUInt32LE(48) + 1) * 512; b.writeUInt32LE(0x7fffffff, d + 120); },
      (b: Buffer) => { const fat = (b.readUInt32LE(76) + 1) * 512, d = b.readUInt32LE(48); b.writeUInt32LE(d, fat + d * 4); },
    ]) { const b = Buffer.from(workbook("xls")); tweak(b); expect(() => inspectCustomerUploadFile(file(b, "xls"))).toThrow(); }
    expect(read).not.toHaveBeenCalled();
  });
});

describe("private storage (temporary local files only, no DB/network)", () => {
  it.skipIf(!process.env.CUSTOMER_UPLOAD_REGRESSION_FILE)("preserves the user's original 0x0006 Excel bytes through local private save/read", async () => {
    const bytes = await fs.readFile(process.env.CUSTOMER_UPLOAD_REGRESSION_FILE!);
    expect(crypto.createHash("sha256").update(bytes).digest("hex")).toBe("869c66b352c06b9e2864793a9c005bc812c81f794b84763795b23640f583d001");
    const input = { ...file(bytes, "xlsx"), fileName: "工作簿1--宝.xlsx" };
    const r = await root(), storage = createCustomerUploadPrivateStorage({ root: r });
    const stored = await storage.put(input);
    expect(stored.byteSize).toBe(47835);
    expect(stored.manifest!.sheets).toHaveLength(1);
    expect(stored.manifest!.sheets[0].rows).toHaveLength(319);
    expect((await storage.read(stored.locator)).equals(bytes)).toBe(true);
    expect((await fs.readFile(process.env.CUSTOMER_UPLOAD_REGRESSION_FILE!)).equals(bytes)).toBe(true);
  });
  it("publishes original bytes with opaque UUID, 0700 directory and 0600 file, and reads exact bytes", async () => {
    const r = await root(), storage = createCustomerUploadPrivateStorage({ root: r }), input = file("型号,数量\nA,1");
    const stored = await storage.put(input);
    expect(stored.locator).toMatch(/^[0-9a-f-]{36}$/); expect(stored.locator).not.toContain("原库存");
    expect(Object.keys(stored).sort()).toEqual(["byteSize", "fileName", "locator", "manifest", "mimeType", "sha256"]);
    expect((await storage.read(stored.locator)).equals(Buffer.from(input.base64, "base64"))).toBe(true);
    expect((await fs.stat(r)).mode & 0o777).toBe(0o700);
    expect((await fs.stat(path.join(r, stored.locator))).mode & 0o777).toBe(0o600);
    expect(await fs.readdir(r)).toEqual([stored.locator]);
  });
  it("does not deduplicate or overwrite identical uploads", async () => {
    const r = await root(), storage = createCustomerUploadPrivateStorage({ root: r });
    const [a, b] = await Promise.all([storage.put(file("a,b")), storage.put(file("a,b"))]);
    expect(a.locator).not.toBe(b.locator); expect(a.sha256).toBe(b.sha256); expect(await fs.readdir(r)).toHaveLength(2);
  });
  it("fails no-clobber collision, preserves existing bytes, and removes only its temporary file", async () => {
    const r = await root(), storage = createCustomerUploadPrivateStorage({ root: r });
    const id = "11111111-1111-4111-8111-111111111111";
    await fs.writeFile(path.join(r, id), "original", { mode: 0o600 });
    controls.uuid = id;
    await expect(storage.put(file("new,bytes"))).rejects.toThrow("私有文件保存失败");
    expect(await fs.readFile(path.join(r, id), "utf8")).toBe("original"); expect(await fs.readdir(r)).toEqual([id]);
  });
  it("does not unlink an existing temporary name when O_EXCL fails", async () => {
    const r = await root(), storage = createCustomerUploadPrivateStorage({ root: r });
    const id = "11111111-1111-4111-8111-111111111111", temp = `.${id}.tmp`;
    await fs.writeFile(path.join(r, temp), "other upload", { mode: 0o600 }); controls.uuid = id;
    await expect(storage.put(file("new,bytes"))).rejects.toThrow("私有文件保存失败");
    expect(await fs.readFile(path.join(r, temp), "utf8")).toBe("other upload"); expect(await fs.readdir(r)).toEqual([temp]);
  });
  it("rejects fixed-root escape, releases, public/uploads and relative paths synchronously", () => {
    for (const r of ["relative", "/opt/releases/a/private", "/opt/apps/public/private", "/opt/apps/uploads/private", "/opt/apps/a/../private", "/home/ubuntu/private", "/tmp/customer-private\0abcdef"]) expect(() => createCustomerUploadPrivateStorage({ root: r })).toThrow();
  });
  it("disallows non-test custom roots", async () => {
    const r = await root(); const env = process.env.NODE_ENV; process.env.NODE_ENV = "production";
    try { expect(() => createCustomerUploadPrivateStorage({ root: r })).toThrow(); }
    finally { process.env.NODE_ENV = env; }
  });
  it("rejects symlink roots and unsafe permissions without changing them", async () => {
    const r = await root(), link = await root(); await fs.rmdir(link); await fs.symlink(r, link);
    const storage = createCustomerUploadPrivateStorage({ root: link });
    await expect(storage.put(file("a,b"))).rejects.toThrow("私有文件保存失败");
    await fs.chmod(r, 0o750); await expect(createCustomerUploadPrivateStorage({ root: r }).put(file("a,b"))).rejects.toThrow();
    expect((await fs.stat(r)).mode & 0o777).toBe(0o750); expect(await fs.readdir(r)).toEqual([]);
  });
  it("rejects traversal, arbitrary paths, symlink locators, extra hardlinks, and public-mode files", async () => {
    const r = await root(), storage = createCustomerUploadPrivateStorage({ root: r }), stored = await storage.put(file("a,b"));
    for (const id of ["../secret", `/tmp/${stored.locator}`, stored.locator + "/a", stored.locator.toUpperCase(), "00000000-0000-4000-8000-000000000000"]) await expect(storage.read(id)).rejects.toThrow("私有文件不可读取");
    const link = "22222222-2222-4222-8222-222222222222"; await fs.symlink(path.join(r, stored.locator), path.join(r, link));
    await expect(storage.read(link)).rejects.toThrow();
    const hard = "33333333-3333-4333-8333-333333333333"; await fs.link(path.join(r, stored.locator), path.join(r, hard));
    await expect(storage.read(stored.locator)).rejects.toThrow(); await fs.unlink(path.join(r, hard));
    await fs.chmod(path.join(r, stored.locator), 0o644); await expect(storage.read(stored.locator)).rejects.toThrow();
  });
  it("rejects nonregular and oversized files without reading their bytes", async () => {
    const r = await root(), storage = createCustomerUploadPrivateStorage({ root: r });
    const id = "44444444-4444-4444-8444-444444444444"; await fs.mkdir(path.join(r, id), { mode: 0o700 });
    await expect(storage.read(id)).rejects.toThrow(); await fs.rmdir(path.join(r, id));
    await fs.writeFile(path.join(r, id), Buffer.alloc(10 * 1024 * 1024 + 1), { mode: 0o600 });
    await expect(storage.read(id)).rejects.toThrow();
  });
  it("does not include any path or raw cause in errors", async () => {
    const r = await root(), storage = createCustomerUploadPrivateStorage({ root: r }); await fs.rmdir(r);
    await expect(storage.put(file("a,b"))).rejects.toThrow(/^私有文件保存失败$/);
    await expect(storage.read("11111111-1111-4111-8111-111111111111")).rejects.toThrow(/^私有文件不可读取$/);
    await expect(fs.lstat(r)).rejects.toThrow();
  });
});
