export const CRM_APPLICATION_CODES = [
  "CRM_APPLICATION_ACCEPTED",
  "CRM_APPLICATION_REAPPLIED",
  "CRM_APPLICATION_PENDING",
  "CRM_ALREADY_ENABLED",
  "CRM_ACCESS_DISABLED",
  "CRM_COMPANY_APPLICATION_PENDING",
  "CRM_COMPANY_ALREADY_ENABLED",
  "CRM_COMPANY_ALREADY_BOUND",
  "CRM_BINDING_REQUIRED",
  "CRM_ACCOUNT_REQUIRED",
] as const;

export type CrmApplicationCode = (typeof CRM_APPLICATION_CODES)[number];

export const CRM_ACCESS_CODES = [
  "CRM_ACCESS_GRANTED",
  "CRM_NOT_APPLIED",
  "CRM_APPLICATION_PENDING",
  "CRM_APPLICATION_REJECTED",
  "CRM_ACCESS_DISABLED",
  "CRM_COMPANY_APPLICATION_PENDING",
  "CRM_COMPANY_ALREADY_ENABLED",
  "CRM_COMPANY_ALREADY_BOUND",
  "CRM_BINDING_REQUIRED",
  "CRM_ACCOUNT_REQUIRED",
] as const;

export type CrmAccessCode = (typeof CRM_ACCESS_CODES)[number];

export type CrmStatus = "none" | "pending" | "enabled" | "disabled" | "rejected";

export type CrmApplicationResult = {
  success: true;
  accepted: boolean;
  created: boolean;
  code: CrmApplicationCode;
  crmStatus: CrmStatus;
  message: string;
  merchantId?: number;
  merchantNo?: string;
};

export type CrmAccessResult = {
  allowed: boolean;
  code: CrmAccessCode;
  crmStatus: CrmStatus;
  message: string | null;
  merchantNo?: string;
  crmThreadNo?: string | null;
};

