import { describe, expect, it } from "vitest";
import {
  assertHkDocumentObjectKey,
  toMerchantHkRegistrationDetail,
} from "./db";
import {
  displayHkDate,
  hkRegistrationDataSchema,
  hkRegistrationIdentifier,
  normalizeHkDate,
} from "../shared/hongKongRegistration";

const validRegistration = {
  companyName: "Example Hong Kong Limited",
  chineseName: "示例香港有限公司",
  businessNature: "Electronics trading",
  legalStatus: "Private company limited by shares",
  brn: "12345678",
  registrationNumber: "12345678-001-23-4",
  brStartDate: "01/01/2025",
  brExpiryDate: "31/12/2099",
  ciNumber: "CI-123456",
  establishedAt: "01/01/2020",
  regAddress: "1 Example Road, Hong Kong",
  bankAccountName: "Example Hong Kong Limited",
  bankAccountNumber: "001-123-456789",
  bankName: "Example Bank",
  bankAddress: "Hong Kong",
  swift: "",
  bankCode: "",
  companyRole: "supplier",
  salesOwner: "",
  salesOwnerCode: "",
};

describe("HK registration contract", () => {
  it("normalizes only real calendar dates and displays dates as day/month/year", () => {
    expect(normalizeHkDate("29/02/2024")).toBe("2024-02-29");
    expect(normalizeHkDate("29/02/2025")).toBeNull();
    expect(displayHkDate("2024-02-29")).toBe("29/02/2024");
    expect(hkRegistrationIdentifier("12345678")).toBe("HK:12345678");
  });

  it("requires BRN/full-number consistency, valid dates, and rejects sole proprietorship", () => {
    expect(hkRegistrationDataSchema.safeParse(validRegistration).success).toBe(true);
    expect(hkRegistrationDataSchema.safeParse({ ...validRegistration, registrationNumber: "87654321-001-23-4" }).success).toBe(false);
    expect(hkRegistrationDataSchema.safeParse({ ...validRegistration, legalStatus: "Sole proprietorship" }).success).toBe(false);
  });

  it("accepts only owner-scoped UUID files with jpg/png/pdf suffixes", () => {
    const owner = "390005";
    const key = "hk-registration/user-390005/BR/123e4567-e89b-12d3-a456-426614174000_br-proof.pdf";
    expect(assertHkDocumentObjectKey(key, owner, "BR")).toBe(key);
    expect(() => assertHkDocumentObjectKey(
      "hk-registration/user-390005/BR/123e4567-e89b-12d3-a456-426614174000_br-proof.exe",
      owner,
      "BR",
    )).toThrow("HK_DOCUMENT_OBJECT_KEY_INVALID");
    expect(() => assertHkDocumentObjectKey(
      "hk-registration/user-other/BR/123e4567-e89b-12d3-a456-426614174000_br-proof.pdf",
      owner,
      "BR",
    )).toThrow("HK_DOCUMENT_OBJECT_KEY_INVALID");
  });

  it("allowlists detail fields without exposing bank account number, Swift, object keys, or pending data", () => {
    const detail = toMerchantHkRegistrationDetail({
      registrationRegion: "HK",
      registrationIdentifier: "HK:12345678",
      businessLicense: null,
      registrationData: {
        registration: validRegistration,
        documents: {
          BR: { fileName: "BR.pdf" },
          CI: { fileName: "CI.pdf" },
          BANK: { fileName: "Bank.pdf" },
        },
      },
      registrationPendingData: { registration: { bankAccountNumber: "must-not-leak" } },
      licenseObjectKey: "hk-registration/user-390005/BR/123e4567-e89b-12d3-a456-426614174000_br-proof.pdf",
      ciObjectKey: "hk-registration/user-390005/CI/123e4567-e89b-12d3-a456-426614174000_ci-proof.pdf",
      bankDocumentObjectKey: "hk-registration/user-390005/BANK/123e4567-e89b-12d3-a456-426614174000_bank-proof.pdf",
    } as never);
    expect(detail).toMatchObject({ identity: "HK:12345678", brn: "12345678" });
    expect(detail).not.toHaveProperty("bankAccountNumber");
    expect(detail).not.toHaveProperty("swift");
    expect(JSON.stringify(detail)).not.toContain("hk-registration/");
    expect(JSON.stringify(detail)).not.toContain("must-not-leak");
  });
});
