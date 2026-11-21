// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  hasLockedSalesOrderDraft,
  isUnstartedSalesOrderDraft,
} from "./salesOrderDraftRecovery";
import {
  listPreservedSalesOrderDrafts,
  loadPreservedSalesOrderDraft,
  preserveSalesOrderDraft,
} from "./salesOrderDraftArchive";
import {
  salesOrderDraftKey,
  saveSalesOrderDraft,
} from "./salesOrderDraftStore";
import { emptyCompanyStockDraft } from "./companyStockOrderDraft";
import { serializeSalesOrderEntryDraft } from "./salesOrderEntryDraft";
import type { SalesOrderDraftPayload } from "../../../shared/crmSalesOrderDrafts";
const blank = () =>
  serializeSalesOrderEntryDraft({
    customer: null,
    source: "company_stock",
    selectedDemand: null,
    lines: [],
    dueDate: "",
    confirmationNote: "",
    customerConfirmed: false,
    pendingRequest: null,
    company: emptyCompanyStockDraft(),
  });
beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
describe("unstarted order draft classification is lossless and fail closed", () => {
  it("recognizes only absent/default business fields and keeps automatically supplied embedded customer ephemeral", () => {
    const p = blank();
    expect(isUnstartedSalesOrderDraft(p)).toBe(true);
    p.source = "demand";
    expect(isUnstartedSalesOrderDraft(p)).toBe(true);
    p.customer = { id: 1, name: "甲" };
    expect(isUnstartedSalesOrderDraft(p)).toBe(false);
    expect(isUnstartedSalesOrderDraft(p, 1)).toBe(true);
    expect(isUnstartedSalesOrderDraft(p, 2)).toBe(false);
  });
  it.each([
    "customerSearch",
    "dueDate",
    "confirmationNote",
    "customerConfirmed",
    "selectedDemand",
    "lines",
    "pendingRequest",
    "completed",
    "unknownNewField",
  ])("retains nonempty or unknown form field %s", key => {
    const p = blank();
    const values: Record<string, any> = {
      customerSearch: " ",
      dueDate: "2026-12-01",
      confirmationNote: "未完成",
      customerConfirmed: true,
      selectedDemand: { id: 1 },
      lines: [{ demandItemId: 1, qty: "", agreedUnitPrice: "" }],
      pendingRequest: {},
      completed: true,
      unknownNewField: null,
    };
    p.form![key] = values[key];
    expect(isUnstartedSalesOrderDraft(p)).toBe(false);
  });
  it.each([
    "lines",
    "salesTaxMode",
    "dueDate",
    "confirmationNote",
    "customerConfirmed",
    "uncertain",
    "expense",
  ])("retains company field %s even under demand source", key => {
    const p = blank();
    p.source = "demand";
    const values: Record<string, any> = {
      lines: [{}],
      salesTaxMode: "tax_excluded",
      dueDate: "2026-12-01",
      confirmationNote: "保留",
      customerConfirmed: true,
      uncertain: {},
      expense: "0",
    };
    (p.company as Record<string, any>)[key] = values[key];
    expect(isUnstartedSalesOrderDraft(p)).toBe(false);
    if (key === "uncertain") expect(hasLockedSalesOrderDraft(p)).toBe(true);
  });
  it("does not reinterpret a selected demand ID or inactive source pending request as blank", () => {
    const p = blank();
    p.demandId = 1;
    expect(isUnstartedSalesOrderDraft(p)).toBe(false);
    p.demandId = null;
    p.form!.pendingRequest = {};
    expect(hasLockedSalesOrderDraft(p)).toBe(true);
  });
});
describe("explicit preserved drafts never overwrite existing work", () => {
  const identity = JSON.stringify([7, 19, 3]);
  const record = () => ({
    payload: {
      ...blank(),
      customer: { id: 2, name: "乙" },
      form: { version: 1, customerSearch: "原搜索", extra: "完整保留" },
    } as SalesOrderDraftPayload,
    revision: 9,
    savedAt: 123,
    dirty: false,
  });
  it("retains full content/revision and reads it back without changing current draft or legacy backup", () => {
    const original = record();
    saveSalesOrderDraft(identity, original);
    localStorage.setItem(
      `${salesOrderDraftKey(identity)}:conflict-backup`,
      "old-backup"
    );
    const a = preserveSalesOrderDraft(identity, original)!;
    const b = preserveSalesOrderDraft(identity, {
      ...original,
      payload: { ...original.payload, form: { note: "second" } },
    })!;
    expect(a.archiveId).not.toBe(b.archiveId);
    expect(
      loadPreservedSalesOrderDraft(identity, a.archiveId)?.payload
    ).toEqual(original.payload);
    expect(listPreservedSalesOrderDrafts(identity)).toHaveLength(2);
    expect(listPreservedSalesOrderDrafts(JSON.stringify([7, 19, 4]))).toEqual(
      []
    );
    expect(
      localStorage.getItem(`${salesOrderDraftKey(identity)}:conflict-backup`)
    ).toBe("old-backup");
    expect(
      JSON.parse(localStorage.getItem(salesOrderDraftKey(identity))!).payload
    ).toEqual(original.payload);
  });
  it("fails on a random-key collision instead of overwriting the old preservation", () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "00000000-0000-4000-8000-000000000000"
    );
    const first = preserveSalesOrderDraft(identity, record())!;
    expect(first).not.toBeNull();
    const before = localStorage.getItem(
      `${salesOrderDraftKey(identity)}:preserved:${first.archiveId}`
    );
    expect(preserveSalesOrderDraft(identity, record())).toBeNull();
    expect(
      localStorage.getItem(
        `${salesOrderDraftKey(identity)}:preserved:${first.archiveId}`
      )
    ).toBe(before);
  });
  it.each(["pendingRequest", "completed", "inactive-company-request"])(
    "refuses frozen/cleanup state %s without any archival write",
    key => {
      const p = record();
      if (key === "inactive-company-request") {
        p.payload.source = "demand";
        p.payload.company!.uncertain = {};
      } else p.payload.form![key] = key === "completed" ? true : {};
      expect(preserveSalesOrderDraft(identity, p)).toBeNull();
      expect(localStorage.length).toBe(0);
    }
  );
  it("fails closed when storage is unavailable or full", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(preserveSalesOrderDraft(identity, record())).toBeNull();
  });
});

describe("malformed falsy pending markers remain frozen", () => {
  it.each(["", 0, false])(
    "does not reinterpret pendingRequest %s as absent",
    value => {
      const payload = blank();
      payload.form!.pendingRequest = value;
      expect(hasLockedSalesOrderDraft(payload)).toBe(true);
      expect(isUnstartedSalesOrderDraft(payload)).toBe(false);
      expect(
        preserveSalesOrderDraft("same-account", {
          payload,
          revision: 3,
          savedAt: 123,
          dirty: false,
        })
      ).toBeNull();
    }
  );
});
