import type { CustomerData, CustomerRecord } from "../../../../shared/crmCustomers";
import { formatBeijingDateTime } from "../../../../shared/beijingTime";

/** Controlled browser-form representation. datetime-local values are Beijing civil time. */
export type CustomerFormState = {
  name: string;
  contactName: string;
  phone: string;
  email: string;
  province: string;
  city: string;
  district: string;
  address: string;
  scale: CustomerData["scale"];
  grade: CustomerData["grade"];
  stage: CustomerData["stage"];
  source: string;
  nextFollowUpAt: string;
  assignedUserId: string;
  initialFollowUp: string;
};

export const EMPTY_CUSTOMER_FORM: CustomerFormState = {
  name: "",
  contactName: "",
  phone: "",
  email: "",
  province: "",
  city: "",
  district: "",
  address: "",
  scale: "unknown",
  grade: "C",
  stage: "new",
  source: "",
  nextFollowUpAt: "",
  assignedUserId: "",
  initialFollowUp: "",
};

/**
 * Render an ISO instant as a datetime-local value in Beijing, never in the
 * visitor's browser timezone. Intl is used rather than Date getters so that a
 * sales user outside China sees the same business time as the rest of CRM.
 */
export function isoToBeijingDateTimeLocal(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

/**
 * Treat a datetime-local value as Beijing civil time and serialize its actual
 * UTC instant. Parsing it with new Date(value) would incorrectly use the
 * browser timezone for users outside China.
 */
export function beijingDateTimeLocalToIso(value: string): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const y = Number(year);
  const m = Number(month);
 const d = Number(day);
 const h = Number(hour);
 const min = Number(minute);
  const civil = new Date(Date.UTC(y, m - 1, d, h, min));
  // Reject calendar overflow (for example 2026-02-30) before sending it.
  if (
    civil.getUTCFullYear() !== y ||
    civil.getUTCMonth() !== m - 1 ||
    civil.getUTCDate() !== d ||
    civil.getUTCHours() !== h ||
    civil.getUTCMinutes() !== min
  ) return null;
 const utcMs = Date.UTC(y, m - 1, d, h - 8, min);
  return new Date(utcMs).toISOString();
}

export function recordToCustomerForm(customer: CustomerRecord): CustomerFormState {
  return {
    name: customer.name,
    contactName: customer.contactName,
    phone: customer.phone,
    email: customer.email,
    province: customer.province,
    city: customer.city,
    district: customer.district,
    address: customer.address,
    scale: customer.scale,
    grade: customer.grade,
    stage: customer.stage,
    source: customer.source,
    nextFollowUpAt: isoToBeijingDateTimeLocal(customer.nextFollowUpAt),
    assignedUserId: String(customer.assignedUserId),
    initialFollowUp: "",
  };
}

export function customerFormToData(form: CustomerFormState): CustomerData {
  const assignedUserId = Number(form.assignedUserId);
  return {
    name: form.name.trim(),
    contactName: form.contactName.trim(),
    phone: form.phone.trim(),
    email: form.email.trim(),
    province: form.province.trim(),
    city: form.city.trim(),
    district: form.district.trim(),
    address: form.address.trim(),
    scale: form.scale,
    grade: form.grade,
    stage: form.stage,
    source: form.source.trim(),
    nextFollowUpAt: beijingDateTimeLocalToIso(form.nextFollowUpAt),
    ...(Number.isInteger(assignedUserId) && assignedUserId > 0 ? { assignedUserId } : {}),
  };
}

/** A request id stays stable for a matching payload and is safe to persist through retry. */
export function makeCustomerRequestId(): string {
  const uuid = globalThis.crypto?.randomUUID?.().replace(/-/g, "");
  const entropy = uuid ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `customer_${entropy}`.slice(0, 80);
}

export function customerPayloadFingerprint(form: CustomerFormState): string {
  const { initialFollowUp, ...data } = form;
  return JSON.stringify({ data, initialFollowUp });
}

export function formatCustomerDateTime(value: string | null | undefined): string {
  return value ? formatBeijingDateTime(value) : "—";
}

export function customerAddress(customer: Pick<CustomerData, "province" | "city" | "district" | "address">): string {
  return [customer.province, customer.city, customer.district, customer.address].filter(Boolean).join(" ") || "—";
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请稍后重试";
}

export function isDuplicateConflict(error: unknown): boolean {
  return /相似客户|重复|duplicate|conflict/i.test(errorMessage(error));
}

export function nowBeijingDateTimeLocal(): string {
  return isoToBeijingDateTimeLocal(new Date().toISOString());
}

export function isTodayInBeijing(value: string | null | undefined): boolean {
  if (!value) return false;
  return isoToBeijingDateTimeLocal(value).slice(0, 10) === isoToBeijingDateTimeLocal(new Date().toISOString()).slice(0, 10);
}

export function formatRequestIdInfo(): string {
  return "重复提交会安全复用本次请求，不会重复写入记录。";
}

export { formatBeijingDateTime };
