import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { unzipSync, zipSync } from "fflate";
import { inspectCustomerUploadFile } from "../client/src/business/platform/front-router-types/server/services/customerUploadPrivateStorage";

const MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const OPTIONS = [0, 2, 4, 6];

// Synthetic data only: never load a customer workbook or invoke storage.put.
function workbook(): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["型号", "数量"],
    ["SYNTHETIC-12345678901234567", 12],
    ["formula", { t: "n", v: 42, f: "40+2" }],
  ]), "合成表");
  const second = XLSX.utils.aoa_to_sheet([["synthetic", 8]]);
  second.A4 = { t: "s", v: "保留原行号" };
  second["!ref"] = "A1:B4";
  XLSX.utils.book_append_sheet(wb, second, "第二张");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), "空表");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}
const entries = unzipSync(workbook());
function archive(method: 0 | 8 = 8, change?: (parts: Record<string, Uint8Array>) => void): Buffer {
  const parts = { ...entries };
  change?.(parts);
  return Buffer.from(zipSync(parts, { level: method === 8 ? 6 : 0 }));
}

// Locate headers via EOCD and central-directory lengths, not signature searches
// through compressed data. Every flag/metadata patch updates BOTH headers.
function headers(bytes: Buffer): { local: number; central: number }[] {
  const end = bytes.length - 22; // Our generated archives have no ZIP comment.
  expect(bytes.readUInt32LE(end)).toBe(0x06054b50);
  const count = bytes.readUInt16LE(end + 10);
  const output: { local: number; central: number }[] = [];
  let central = bytes.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    expect(bytes.readUInt32LE(central)).toBe(0x02014b50);
    const local = bytes.readUInt32LE(central + 42);
    expect(bytes.readUInt32LE(local)).toBe(0x04034b50);
    output.push({ local, central });
    central += 46 + bytes.readUInt16LE(central + 28)
      + bytes.readUInt16LE(central + 30) + bytes.readUInt16LE(central + 32);
  }
  expect(central).toBe(end);
  return output;
}
function patchHeaders(bytes: Buffer, change: (b: Buffer, local: number, central: number) => void): Buffer {
  const copy = Buffer.from(bytes);
  for (const { local, central } of headers(copy)) change(copy, local, central);
  return copy;
}
function withFlags(bytes: Buffer, flags: number): Buffer {
  return patchHeaders(bytes, (b, local, central) => {
    b.writeUInt16LE(flags, local + 6);
    b.writeUInt16LE(flags, central + 8);
  });
}
function assertHeaders(bytes: Buffer, method: number, flags: number): void {
  const pairs = headers(bytes);
  expect(pairs.length).toBeGreaterThan(0);
  for (const { local, central } of pairs) {
    expect(bytes.readUInt16LE(local + 4)).toBe(20);
    expect(bytes.readUInt16LE(central + 6)).toBe(20);
    expect(bytes.readUInt16LE(local + 8)).toBe(method);
    expect(bytes.readUInt16LE(central + 10)).toBe(method);
    expect(bytes.readUInt16LE(local + 6)).toBe(flags);
    expect(bytes.readUInt16LE(central + 8)).toBe(flags);
  }
}

// Insert real (signed or unsigned) data descriptors, adjusting all local offsets
// and EOCD. Merely setting bit 3 without a descriptor would be an invalid ZIP.
function withDescriptors(bytes: Buffer, signed: boolean): Buffer {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const { local, central } of headers(bytes)) {
    const packed = bytes.readUInt32LE(central + 20);
    const data = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const localPart = Buffer.from(bytes.subarray(local, data + packed));
    const centralEnd = central + 46 + bytes.readUInt16LE(central + 28)
      + bytes.readUInt16LE(central + 30) + bytes.readUInt16LE(central + 32);
    const centralPart = Buffer.from(bytes.subarray(central, centralEnd));
    const flags = bytes.readUInt16LE(central + 8);
    expect(flags & 8).toBe(0);
    localPart.writeUInt16LE(flags | 8, 6);
    centralPart.writeUInt16LE(flags | 8, 8);
    localPart.fill(0, 14, 26);
    centralPart.writeUInt32LE(offset, 42);
    const descriptor = Buffer.alloc(signed ? 16 : 12);
    const p = signed ? 4 : 0;
    if (signed) descriptor.writeUInt32LE(0x08074b50);
    bytes.copy(descriptor, p, central + 16, central + 28);
    locals.push(localPart, descriptor);
    centrals.push(centralPart);
    offset += localPart.length + descriptor.length;
  }
  const end = Buffer.from(bytes.subarray(bytes.length - 22));
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}
function inspect(bytes: Buffer) {
  return inspectCustomerUploadFile({ fileName: "合成回归.xlsx", mimeType: MIME, base64: bytes.toString("base64") });
}
const baseline = archive();

// Byte hashes legitimately differ when ZIP flags differ. Workbook/row evidence
// must be identical, while each result must retain its own exact bytes/hash.
function expectAccepted(bytes: Buffer): void {
  const result = inspect(bytes);
  expect(result.manifest).toEqual(inspect(baseline).manifest);
  expect(result.bytes.equals(bytes)).toBe(true);
  expect(result.byteSize).toBe(bytes.length);
  expect(result.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
  expect(result.fileName).toBe("合成回归.xlsx");
  expect(result.mimeType).toBe(MIME);
  expect(result.manifest!.sheets.map(s => s.sheetName)).toEqual(["合成表", "第二张", "空表"]);
  expect(result.manifest!.sheets[1].rows.map(r => r.rowNumber)).toEqual([1, 4]);
  expect(result.manifest!.sheets[0].rows[2].cells[1]).toBeNull();
}

describe("customer upload DEFLATE options regression 20261119 (inspection only)", () => {
  for (const utf8 of [0, 0x0800]) {
    it.each(OPTIONS)(`accepts method 8 option %i with UTF8 flag ${utf8}`, option => {
      const bytes = withFlags(baseline, utf8 | option);
      assertHeaders(bytes, 8, utf8 | option);
      expectAccepted(bytes);
    });
    for (const signed of [false, true]) {
      it.each(OPTIONS)(`accepts option %i with UTF8 ${utf8} and ${signed ? "signed" : "unsigned"} data descriptors`, option => {
        const bytes = withDescriptors(withFlags(baseline, utf8 | option), signed);
        assertHeaders(bytes, 8, utf8 | option | 8);
        expectAccepted(bytes);
      });
    }
  }

  it.each([0, 0x0800])("retains method 0 support with flags %i", flags => {
    const bytes = withFlags(archive(0), flags);
    assertHeaders(bytes, 0, flags);
    expectAccepted(bytes);
  });
  for (const original of [0, 0x0800, 8, 0x0808]) {
    it.each([2, 4, 6])(`rejects DEFLATE option %i on method 0 with original flags ${original}`, option => {
      let bytes = withFlags(archive(0), (original & ~8) | option);
      if (original & 8) bytes = withDescriptors(bytes, true);
      assertHeaders(bytes, 0, original | option);
      expect(() => inspect(bytes)).toThrow(/拒绝加密、Zip64 或不支持的 ZIP 条目/);
    });
  }

  // All other general-purpose bits remain prohibited, not just encryption.
  it.each([
    ["encryption", 0x0001], ["enhanced deflate", 0x0010],
    ["patched data", 0x0020], ["strong encryption", 0x0040],
    ["reserved bit 7", 0x0080], ["reserved bit 8", 0x0100],
    ["reserved bit 9", 0x0200], ["reserved bit 10", 0x0400],
    ["reserved bit 12", 0x1000], ["masked headers", 0x2000],
    ["reserved bit 14", 0x4000], ["reserved bit 15", 0x8000],
  ])("rejects %s even with legitimate DEFLATE options", (_, bit) => {
    const bytes = withFlags(baseline, 0x0806 | Number(bit));
    assertHeaders(bytes, 8, 0x0806 | Number(bit));
    expect(() => inspect(bytes)).toThrow(/拒绝加密、Zip64 或不支持的 ZIP 条目/);
  });

  it("still checks actual CRC after both header CRC values agree", () => {
    const bytes = patchHeaders(withFlags(baseline, 6), (b, local, central) => {
      const wrong = (b.readUInt32LE(central + 16) ^ 1) >>> 0;
      b.writeUInt32LE(wrong, local + 14);
      b.writeUInt32LE(wrong, central + 16);
    });
    expect(() => inspect(bytes)).toThrow(/ZIP 大小或校验不一致/);
  });
  it("still checks data descriptor CRC", () => {
    const bytes = withDescriptors(withFlags(baseline, 6), true);
    const { local, central } = headers(bytes)[0];
    const descriptor = local + 30 + bytes.readUInt16LE(local + 26)
      + bytes.readUInt16LE(local + 28) + bytes.readUInt32LE(central + 20);
    bytes.writeUInt32LE((bytes.readUInt32LE(descriptor + 4) ^ 1) >>> 0, descriptor + 4);
    expect(() => inspect(bytes)).toThrow(/ZIP 数据描述符无效/);
  });
  it("still rejects Zip64 metadata", () => {
    const bytes = patchHeaders(withFlags(baseline, 6), (b, local, central) => {
      b.writeUInt32LE(0xffffffff, local + 22);
      b.writeUInt32LE(0xffffffff, central + 24);
    });
    expect(() => inspect(bytes)).toThrow(/Zip64/);
  });
  it("still rejects unsupported ZIP versions", () => {
    const bytes = patchHeaders(withFlags(baseline, 6), (b, local, central) => {
      b.writeUInt16LE(45, local + 4);
      b.writeUInt16LE(45, central + 6);
    });
    expect(() => inspect(bytes)).toThrow(/Zip64/);
  });
  it.each([9, 99])("still rejects unsupported compression method %i", method => {
    const bytes = patchHeaders(withFlags(baseline, 6), (b, local, central) => {
      b.writeUInt16LE(method, local + 8);
      b.writeUInt16LE(method, central + 10);
    });
    expect(() => inspect(bytes)).toThrow(/不支持的 ZIP 条目/);
  });

  it.each(["xl/vbaProject.bin", "xl/externalLinks/externalLink1.xml"])("still rejects forbidden part %s", name => {
    const bytes = withFlags(archive(8, parts => { parts[name] = Buffer.from("synthetic forbidden part"); }), 6);
    expect(() => inspect(bytes)).toThrow(/拒绝宏、外链/);
  });
  it("still rejects external relationships", () => {
    const bytes = withFlags(archive(8, parts => {
      const name = "xl/_rels/workbook.xml.rels";
      const rels = Buffer.from(parts[name]).toString();
      expect(rels).toContain('<Relationship Id="rId1"');
      parts[name] = Buffer.from(rels.replace('<Relationship Id="rId1"', '<Relationship TargetMode="External" Id="rId1"'));
    }), 6);
    expect(() => inspect(bytes)).toThrow(/拒绝宏、外链/);
  });
  it("still rejects macro content types", () => {
    const bytes = withFlags(archive(8, parts => {
      const name = "[Content_Types].xml";
      const types = Buffer.from(parts[name]).toString();
      expect(types).toContain("spreadsheetml.sheet.main+xml");
      parts[name] = Buffer.from(types.replace("spreadsheetml.sheet.main+xml", "ms-excel.sheet.macroEnabled.main+xml"));
    }), 6);
    expect(() => inspect(bytes)).toThrow(/拒绝宏、外链/);
  });
  it.each(["../evil.xml", "/evil.xml", "xl/../evil.xml", "xl\\evil.xml"])("still rejects unsafe ZIP path %s", name => {
    const bytes = withFlags(archive(8, parts => { parts[name] = Buffer.from("synthetic"); }), 6);
    expect(() => inspect(bytes)).toThrow(/ZIP 路径/);
  });
  it("still rejects decompression ratio resource abuse", () => {
    const bytes = withFlags(archive(8, parts => { parts["big.xml"] = Buffer.alloc(1024 * 1024, 65); }), 6);
    expect(() => inspect(bytes)).toThrow(/ZIP 解压资源超限/);
  });
});
