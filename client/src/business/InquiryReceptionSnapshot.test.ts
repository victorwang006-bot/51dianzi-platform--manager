import { describe, expect, it } from "vitest";
import { receptionInquiryId, receptionRequestedQuantity, type InquiryReceptionRow } from "./InquiryReceptionModel";
const row = (value: Record<string, unknown>) => value as unknown as InquiryReceptionRow;
describe("specific inquiry snapshot selection", () => {
  it("requires one positive valid inquiry ID", () => {
    expect(receptionInquiryId("conversationId=11&inquiryId=101")).toBe(101);
    for (const value of ["", "inquiryId=0", "inquiryId=-1", "inquiryId=1.2", "inquiryId=2&inquiryId=2"]) expect(receptionInquiryId(value)).toBeNull();
  });
  it("uses actual persisted purchase quantity, never the seller stock quantity", () => {
    expect(receptionRequestedQuantity(row({ quantity: 1000, requestedQty: 10 }))).toBe(10);
    expect(receptionRequestedQuantity(row({ quantity: 1000, requestedQty: null }))).toBeNull();
    expect(receptionRequestedQuantity(row({ quantity: 1000 }))).toBeNull();
    expect(receptionRequestedQuantity(row({ quantity: 0, requestedQty: 0 }))).toBeNull();
  });
});
