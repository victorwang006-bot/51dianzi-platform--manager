import { describe, expect, it } from "vitest";
import { assertCurrentCnRegistrationDocumentReferences } from "./cnRegistrationDocumentPolicy";

const OWNER = "7001";
const UUID = "12345678-1234-4abc-8abc-1234567890ab";
const references = {
  licenseUrl: null,
  licenseObjectKey: `licenses/user-${OWNER}-1795000000000-${UUID}_1a2b3c4d.pdf`,
  licenseFileName: "营业执照.pdf",
  bankLicenseUrl: null,
  bankLicenseObjectKey: `bank-licenses/user-${OWNER}-1795000000001-${UUID}_5e6f7a8b.png`,
  bankLicenseFileName: "开户许可证.png",
};

function verify(documents: Partial<typeof references> = {}, owner: string | number | null = OWNER) {
  return assertCurrentCnRegistrationDocumentReferences({
    dataOwnerUserId: owner,
    documents: { ...references, ...documents },
  });
}

describe("CN 注册私有材料既有生产者策略", () => {
  it("接受两个既有 protected upload producer 写入的 owner、时间、UUID、后缀和扩展名", () => {
    expect(() => verify()).not.toThrow();
  });

  it.each([
    ["营业执照 foreign owner", { licenseObjectKey: `licenses/user-7002-1795000000000-${UUID}_1a2b3c4d.pdf` }],
    ["银行资料 foreign owner", { bankLicenseObjectKey: `bank-licenses/user-7002-1795000000001-${UUID}_5e6f7a8b.png` }],
    ["错误 namespace", { licenseObjectKey: `bank-licenses/user-${OWNER}-1795000000000-${UUID}_1a2b3c4d.pdf` }],
    ["路径穿越", { licenseObjectKey: `licenses/user-${OWNER}-1795000000000-${UUID}_../license.pdf` }],
    ["缺少 producer hash", { bankLicenseObjectKey: `bank-licenses/user-${OWNER}-1795000000001-${UUID}.png` }],
    ["非法扩展名", { licenseObjectKey: `licenses/user-${OWNER}-1795000000000-${UUID}_1a2b3c4d.exe` }],
    ["非 UUID", { bankLicenseObjectKey: `bank-licenses/user-${OWNER}-1795000000001-not-a-uuid_5e6f7a8b.png` }],
    ["非时间戳", { licenseObjectKey: `licenses/user-${OWNER}-not-time-${UUID}_1a2b3c4d.pdf` }],
    ["URL-only", { licenseObjectKey: null, licenseUrl: "https://untrusted.example/license.pdf" }],
    ["外部 URL", { bankLicenseUrl: "https://untrusted.example/bank.pdf" }],
    ["缺少展示文件名", { bankLicenseFileName: null }],
  ])("拒绝%s", (_label, documents) => {
    expect(() => verify(documents)).toThrow("CN_REVIEW_DOCUMENT_REFERENCE_INVALID");
  });

  it("拒绝无法作为当前已认证数据所有者的 owner id", () => {
    expect(() => verify({}, "7001 ")).toThrow("CN_REVIEW_DOCUMENT_REFERENCE_INVALID");
    expect(() => verify({}, null)).toThrow("CN_REVIEW_DOCUMENT_REFERENCE_INVALID");
  });
});
