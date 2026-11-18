import { describe, expect, it } from "vitest";
import { customerContactSummaryQueryVerified, customerNeedsCompletion } from "./crmCustomers";
import { contactMethodSchema, type ContactSummary, type CustomerContactMethod } from "./customerContacts";

const customer = { name: "合成示例客户", contactName: "", phone: "" };
function summary(methods: CustomerContactMethod[], name = "合成主联系人", legacy = false): ContactSummary {
  return { customerId: 801, contactCount: 1, primaryContact: { id: "synthetic-primary", name, methods, legacy } };
}
const methods: CustomerContactMethod[] = [
  { type: "wechat", value: "synthetic_wechat_only" },
  { type: "mobile", value: "+1 202-555-0100" },
  { type: "landline", value: "010-00000001 转 123" },
  { type: "email", value: "synthetic@example.invalid" },
  { type: "qq", value: "000000001" },
  { type: "other", value: "合成其他联系渠道" },
];

describe("customer completion uses an active primary contact, not the legacy phone projection", () => {
  it.each(methods)("accepts $type alone without writing/faking a phone", method => {
    const before = JSON.stringify(customer);
    expect(customerNeedsCompletion(customer, summary([method]))).toBe(false);
    expect(JSON.stringify(customer)).toBe(before);
    expect(customer.phone).toBe("");
  });
  it("uses the primary summary's name, not a missing or stale contactName", () => {
    expect(customerNeedsCompletion({ ...customer, contactName: "过时投影", phone: "" }, summary([methods[0]]))).toBe(false);
    expect(customerNeedsCompletion({ ...customer, contactName: "过时投影", phone: "+1 202-555-0100" }, summary([methods[0]], "  "))).toBe(true);
  });
  it.each(["", "  "])("requires a customer name even with valid methods or unknown summary (%j)", name => {
    expect(customerNeedsCompletion({ ...customer, name }, summary([methods[0]]))).toBe(true);
    expect(customerNeedsCompletion({ ...customer, name }, undefined)).toBe(true);
  });
  it("requires a primary, even when secondary active contacts remain", () => {
    expect(customerNeedsCompletion(customer, { customerId: 801, contactCount: 2, primaryContact: null })).toBe(true);
    expect(customerNeedsCompletion(customer, null)).toBe(true);
  });
  it("rejects empty methods and stopped-contact/method service projections rather than falling back to old phone", () => {
    const stale = { ...customer, contactName: "合成旧联系人", phone: "+1 202-555-0100" };
    // contactsSummary filters stopped profiles to null and stopped methods out.
    expect(customerNeedsCompletion(stale, { customerId: 801, contactCount: 0, primaryContact: null })).toBe(true);
    expect(customerNeedsCompletion(stale, summary([]))).toBe(true);
  });
  it.each([
    { type: "mobile", value: "synthetic_wechat_not_a_phone" },
    { type: "landline", value: "123" },
    { type: "email", value: "not-an-email" },
    { type: "wechat", value: "  " },
    { type: "qq", value: "" },
    { type: "other", value: " " },
    { type: "other", value: "x".repeat(255) },
  ] as CustomerContactMethod[])("rejects invalid $type method and agrees with the input schema", method => {
    expect(contactMethodSchema.safeParse(method).success).toBe(false);
    expect(customerNeedsCompletion(customer, summary([method]))).toBe(true);
  });
  it("requires only one valid method among invalid/blank methods", () => {
    expect(customerNeedsCompletion(customer, summary([{ type: "email", value: "invalid" }, methods[0]]))).toBe(false);
  });
  it("keeps legacy other text compatible without inventing a valid phone", () => {
    expect(customerNeedsCompletion(customer, summary([{ type: "other", value: "合成历史联系方式", label: "历史电话" }], "合成历史联系人", true))).toBe(false);
  });
  it("keeps one-argument callers unchanged, but explicit undefined is unknown (not false)", () => {
    expect(customerNeedsCompletion(customer)).toBe(true);
    const old = { name: "合成客户", contactName: "合成联系人", phone: "历史文本" };
    expect(customerNeedsCompletion(old)).toBe(false);
    expect(customerNeedsCompletion(customer, undefined)).toBeUndefined();
    expect(customerNeedsCompletion(old, undefined)).toBeUndefined();
  });
});

const verifiedQuery = { isSuccess: true, isError: false, isPending: false, isFetching: false, isPlaceholderData: false, isFetchedAfterMount: true };
describe("current authorized contacts summary query proof", () => {
  it("accepts only successful current-mount reads in a ready scope", () => {
    expect(customerContactSummaryQueryVerified(verifiedQuery, true)).toBe(true);
    expect(customerContactSummaryQueryVerified(verifiedQuery, false)).toBe(false);
  });
  it.each([
    { isSuccess: false }, { isSuccess: undefined }, { isError: true }, { isPending: true },
    { isFetching: true }, { isPlaceholderData: true }, { isFetchedAfterMount: false }, { isFetchedAfterMount: undefined },
  ])("rejects unknown, loading, cached, placeholder and error state %j", overrides => {
    expect(customerContactSummaryQueryVerified({ ...verifiedQuery, ...overrides }, true)).toBe(false);
  });
});
