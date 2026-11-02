import { useMemo } from "react";
import { useAuth } from "../../../../../api/business-auth";
import { useOptionalEnterpriseSession } from "../../../../../api/business-enterprise-session";
import {
  CONTACT_METHOD_TYPES,
  contactMethodSchema,
  customerContactBasicDataSchema,
  customerMutableContactSchema,
  type ContactMethodType,
  type ContactRecord as ContactRecordDto,
  type ContactSummary as ContactSummaryDto,
  type ContactsListResult,
  type CustomerContactBasicData,
  type CustomerContactMethod,
  type CustomerMutableContactInput,
} from "../../../../shared/customerContacts";
import {
  beijingDateTimeLocalToIso,
  makeCustomerRequestId,
  type CustomerFormState,
} from "./customerUtils";

export { CONTACT_METHOD_TYPES };
export type { ContactMethodType };
export type ContactMethodDraft = CustomerContactMethod;
export type ContactRecord = ContactRecordDto;
export type ContactsListData = ContactsListResult;
export type ContactSummary = ContactSummaryDto;

export type ContactDraft = {
  id: string;
  name: string;
  department: string;
  position: string;
  methods: ContactMethodDraft[];
  isPrimary: boolean;
};
export type CustomerContactScope = {
  actorUserId: number;
  enterpriseId: number;
  canManageAll: boolean;
};

export const CONTACT_METHOD_LABELS: Record<ContactMethodType, string> = {
  mobile: "手机",
  landline: "座机",
  wechat: "微信",
  qq: "QQ",
  email: "邮箱",
  other: "其他",
};

export function emptyContact(primary = false): ContactDraft {
  return {
    id: makeCustomerRequestId(),
    name: "",
    department: "",
    position: "",
    methods: [{ type: "mobile", value: "" }],
    isPrimary: primary,
  };
}

export function plainContactText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function contactInput(contact: ContactDraft): CustomerMutableContactInput {
  return {
    name: plainContactText(contact.name),
    department: plainContactText(contact.department),
    position: plainContactText(contact.position),
    methods: contact.methods.flatMap(method => {
      const value = plainContactText(method.value);
      if (!value) return [];
      const label = plainContactText(method.label);
      return [{ type: method.type, value, ...(label ? { label } : {}) }];
    }),
  };
}

export function draftFromContact(contact: ContactRecord): ContactDraft {
  return {
    id: contact.id,
    name: contact.name,
    department: contact.department,
    position: contact.position,
    methods: contact.methods.length
      ? contact.methods.map(method => ({ ...method, label: method.label || undefined }))
      : [{ type: "mobile", value: "" }],
    isPrimary: contact.isPrimary,
  };
}

export function validateContact(contact: ContactDraft, prefix = ""): Record<string, string> {
  const errors: Record<string, string> = {};
  const submitted = contactInput(contact);
  contact.methods.forEach((method, index) => {
    if (!plainContactText(method.value)) return;
    const parsedMethod = contactMethodSchema.safeParse({
      type: method.type,
      value: plainContactText(method.value),
      ...(plainContactText(method.label) ? { label: plainContactText(method.label) } : {}),
    });
    if (!parsedMethod.success) {
      errors[`${prefix}method-${index}`] = parsedMethod.error.issues[0]?.message ?? "联系方式格式无效";
    }
  });
  const parsed = customerMutableContactSchema.safeParse(submitted);
  if (!parsed.success) {
    parsed.error.issues.forEach(issue => {
      const field = String(issue.path[0] ?? "methods");
      if (!errors[`${prefix}${field}`]) errors[`${prefix}${field}`] = issue.message;
    });
  }
  return errors;
}

export function validateContactSet(contacts: ContactDraft[]): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!contacts.length) errors.contacts = "请至少添加一位联系人";
  if (contacts.length > 100) errors.contacts = "联系人不能超过100位";
  if (contacts.filter(contact => contact.isPrimary).length !== 1) errors.primary = "请且仅选择一位主联系人";
  contacts.forEach((contact, index) => Object.assign(errors, validateContact(contact, `contact-${index}-`)));
  return errors;
}

export function customerContactBaseData(form: CustomerFormState): CustomerContactBasicData {
  const assignedUserId = Number(form.assignedUserId);
  return {
    name: form.name.trim(),
    grade: form.grade,
    scale: form.scale,
    stage: form.stage,
    source: form.source.trim(),
    nextFollowUpAt: beijingDateTimeLocalToIso(form.nextFollowUpAt),
    province: form.province.trim(),
    city: form.city.trim(),
    district: form.district.trim(),
    address: form.address.trim(),
    ...(Number.isSafeInteger(assignedUserId) && assignedUserId > 0 ? { assignedUserId } : {}),
  };
}

export function validateCustomerContactBase(form: CustomerFormState): Record<string, string> {
  const errors: Record<string, string> = {};
  const parsed = customerContactBasicDataSchema.safeParse(customerContactBaseData(form));
  if (!parsed.success) {
    parsed.error.issues.forEach(issue => {
      const field = String(issue.path[0] ?? "name");
      if (!errors[field]) errors[field] = issue.message;
    });
  }
  return errors;
}

export function isDuplicateContactConflict(error: unknown): boolean {
  const value = error as { data?: { code?: unknown }; code?: unknown; message?: unknown } | null;
  const code = value?.data?.code ?? value?.code;
  const message = typeof value?.message === "string" ? value.message : "";
  return String(code).toUpperCase() === "CONFLICT" && /(重复|相似|duplicate|already)/i.test(message);
}

/** Retry only outcomes that may have committed on the server, using the original requestId. */
export function isUnknownContactOutcome(error: unknown): boolean {
  const value = error as { data?: { code?: unknown }; code?: unknown; message?: unknown } | null;
  const code = String(value?.data?.code ?? value?.code ?? "").toUpperCase();
  if (["BAD_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "UNPROCESSABLE_CONTENT", "PAYLOAD_TOO_LARGE"].includes(code)) return false;
  const message = typeof value?.message === "string" ? value.message : "";
  return !/(校验|validation|格式|权限|forbidden|not found|不存在|版本冲突)/i.test(message);
}

export function contactErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : "操作失败，请稍后重试";
}

export function formatContactMethod(method: ContactMethodDraft): string {
  return `${CONTACT_METHOD_LABELS[method.type]}：${method.value}${method.label ? `（${method.label}）` : ""}`;
}

/**
 * A UI-side freshness guard only. Server procedures remain authoritative for enterprise
 * membership and customer permission; this prevents a stale dialog from issuing calls.
 */
export function useCustomerContactScope(context: unknown) {
  const auth = useAuth();
  const enterpriseSession = useOptionalEnterpriseSession();
  const value = context as { actorUserId?: unknown; canManageAll?: unknown } | undefined;
  const actorUserId = Number(value?.actorUserId);
  const enterprise = enterpriseSession?.activeEnterprise ?? null;
  const enterpriseId = Number(enterprise?.enterpriseId);
  const accountId = Number(auth.user?.id);
  const ready = Boolean(
    !auth.loading
      && auth.isAuthenticated
      && Number.isSafeInteger(accountId)
      && accountId > 0
      && accountId === actorUserId
      && Number.isSafeInteger(actorUserId)
      && actorUserId > 0
      && enterprise
      && enterprise.memberStatus === "active"
      && enterprise.accessStatus === "enabled"
      && Number.isSafeInteger(enterpriseId)
      && enterpriseId > 0,
  );
  const scope = useMemo<CustomerContactScope | null>(() => ready
    ? { actorUserId, enterpriseId, canManageAll: Boolean(value?.canManageAll) }
    : null, [actorUserId, enterpriseId, ready, value?.canManageAll]);
  const identityKey = `${accountId || "anonymous"}:${enterpriseId || "enterprise-unresolved"}:${actorUserId || "scope-unresolved"}:${ready ? "ready" : "blocked"}`;
  return { scope, ready, identityKey };
}

export function withCustomerContactScope<T extends object>(scope: CustomerContactScope, input: T) {
  return { ...input, expectedActorUserId: scope.actorUserId, expectedEnterpriseId: scope.enterpriseId };
}
