// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AUTH_SESSION_CLEARED_EVENT } from "../../lib/authSessionEvents";
import { PAGE_IDENTITY_CHANGED_EVENT } from "../../lib/pageMemory";
import {
  CUSTOMER_ENTRY_DRAFTS_INVALIDATED_EVENT,
  __resetCustomerCreateDraftStoreForTests,
  clearCustomerCreateDraft,
  completeCustomerCreateDraft,
  customerCreateDraftEntry,
  customerCreateDraftIdentityForNamespace,
  retainOnlyCustomerCreateDraftIdentity,
  normalizeCustomerCreateDraft,
  updateCustomerCreateDraft,
} from "../../lib/customerCreateDraftStore";
import { emptyContact } from "./customerContacts";
import { EMPTY_CUSTOMER_FORM } from "./customerUtils";

const firstIdentity = "business-domain:v1:staff:7:admin:5:enterprise:31:merchant:30061:binding:2:customer-create:actor:7:enterprise:31:manage-all:no";
const secondIdentity = "business-domain:v1:staff:8:admin:5:enterprise:31:merchant:30061:binding:2:customer-create:actor:8:enterprise:31:manage-all:no";

function fallback() {
  return {
    form: { ...EMPTY_CUSTOMER_FORM },
    contacts: [emptyContact(true)],
    request: null,
    pendingSave: null,
  };
}

beforeEach(__resetCustomerCreateDraftStoreForTests);
afterEach(__resetCustomerCreateDraftStoreForTests);

describe("customer create draft memory", () => {
  it("finds only a unique previously verified draft for the exact namespace", () => {
    updateCustomerCreateDraft(firstIdentity, fallback(), current => current);
    const namespace = firstIdentity.split(":customer-create:")[0];
    expect(customerCreateDraftIdentityForNamespace(namespace)).toBe(firstIdentity);
    expect(customerCreateDraftIdentityForNamespace(namespace.replace("merchant:30061", "merchant:30062"))).toBeNull();
    expect(customerCreateDraftIdentityForNamespace(namespace.replace("admin:5", "admin:6"))).toBeNull();
    expect(customerCreateDraftIdentityForNamespace(null)).toBeNull();
  });

  it("keeps bodies only in their exact identity and removes earlier identities on a switch", () => {
    updateCustomerCreateDraft(firstIdentity, fallback(), current => ({
      ...current,
      form: { ...current.form, name: "虚构客户甲" },
    }));
    updateCustomerCreateDraft(secondIdentity, fallback(), current => ({
      ...current,
      form: { ...current.form, name: "虚构客户乙" },
    }));

    retainOnlyCustomerCreateDraftIdentity(secondIdentity);
    expect(customerCreateDraftEntry(firstIdentity).draft).toBeNull();
    expect(customerCreateDraftEntry(secondIdentity).draft?.form.name).toBe("虚构客户乙");
  });

  it("does not let a late result from a cleared instance close a fresh same-identity draft", () => {
    const original = updateCustomerCreateDraft(firstIdentity, fallback(), current => ({
      ...current,
      form: { ...current.form, name: "已失效的虚构客户" },
    }));
    clearCustomerCreateDraft(firstIdentity);
    const fresh = updateCustomerCreateDraft(firstIdentity, fallback(), current => ({
      ...current,
      form: { ...current.form, name: "新的虚构客户" },
    }));

    expect(completeCustomerCreateDraft(firstIdentity, original.token, { id: 701, mode: "close" })).toBe(false);
    expect(customerCreateDraftEntry(firstIdentity).draft?.token).toBe(fresh.token);
    expect(customerCreateDraftEntry(firstIdentity).draft?.form.name).toBe("新的虚构客户");
  });

  it("clears all current-session drafts for logout and verified binding/access invalidation events", () => {
    const writeDraft = () => updateCustomerCreateDraft(firstIdentity, fallback(), current => ({
      ...current,
      form: { ...current.form, name: "仅测试的敏感草稿" },
      request: { fingerprint: "fixture", requestId: "customer_fixture_request" },
      pendingSave: { kind: "unknown", mode: "close", confirmDuplicate: false, fingerprint: "fixture", requestId: "customer_fixture_request" },
    }));

    writeDraft();
    window.dispatchEvent(new Event(AUTH_SESSION_CLEARED_EVENT));
    expect(customerCreateDraftEntry(firstIdentity).draft).toBeNull();

    writeDraft();
    window.dispatchEvent(new Event(CUSTOMER_ENTRY_DRAFTS_INVALIDATED_EVENT));
    expect(customerCreateDraftEntry(firstIdentity).draft).toBeNull();

    writeDraft();
    window.dispatchEvent(new Event(PAGE_IDENTITY_CHANGED_EVENT));
    expect(customerCreateDraftEntry(firstIdentity).draft).toBeNull();
  });
});


describe("industry draft compatibility", () => {
  it.each(["saving", "unknown", "duplicate"] as const)("normalizes only a legacy form for %s without rewriting frozen request data", kind => {
    const original = updateCustomerCreateDraft(firstIdentity, fallback(), current => ({ ...current, form: { ...current.form, name: "旧客户", initialFollowUp: "原始备注" }, contacts: [{ ...current.contacts[0], name: "旧联系人", methods: [{ type: "mobile", value: "13800138000" }, { type: "wechat", value: "kept_wechat" }] }], request: { requestId: "customer_original_legacy_id", fingerprint: '{"data":{"name":"旧客户"}}' }, pendingSave: { kind, mode: "close", confirmDuplicate: kind === "duplicate", requestId: "customer_original_legacy_id", fingerprint: '{"data":{"name":"旧客户"}}' } }));
    delete (original.form as Partial<typeof original.form>).industryCode;
    const restored = normalizeCustomerCreateDraft(original);
    expect(restored.form).toEqual({ ...original.form, industryCode: "" });
    expect(restored.contacts).toEqual(original.contacts);
    expect(restored.contacts).not.toBe(original.contacts);
    expect(restored.contacts[0].methods).not.toBe(original.contacts[0].methods);
    expect(restored.request).toEqual(original.request);
    expect(restored.pendingSave).toEqual(original.pendingSave);
    expect(restored.token).toBe(original.token);
    expect(original.form).not.toHaveProperty("industryCode");
  });

  it("preserves an already-selected industry and mints no replacement request when upgrading an editable old draft", () => {
    const original = updateCustomerCreateDraft(firstIdentity, fallback(), current => ({ ...current, form: { ...current.form, name: "已选客户", industryCode: "medical" } }));
    expect(normalizeCustomerCreateDraft(original).form.industryCode).toBe("medical");
    expect(normalizeCustomerCreateDraft(original).request).toBeNull();
  });
});
