import { customerDataSchema } from "../../../../shared/crmCustomers";
import { customerFormToData, type CustomerFormState } from "./customerUtils";

import { businessIndustryCodeSchema } from "../../../../shared/businessIndustry";

export type CustomerFieldErrors = Partial<Record<keyof CustomerFormState, string>>;
export function validateCustomerForm(form: CustomerFormState) {
  const candidate = customerFormToData(form);
  const parsed = customerDataSchema.safeParse(candidate);
  const errors: CustomerFieldErrors = {};
  if (!businessIndustryCodeSchema.safeParse(form.industryCode).success) errors.industryCode = "请选择所属行业";
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof CustomerFormState;
      if (key && !errors[key]) errors[key] = issue.message;
    }
  }
  if (form.nextFollowUpAt && !candidate.nextFollowUpAt) errors.nextFollowUpAt = "请输入有效的下次跟进时间";
  if (form.initialFollowUp.trim().length > 4000) errors.initialFollowUp = "首次跟进备注不能超过4000字";
  if (!parsed.success || Object.keys(errors).length) return { success: false as const, errors };
  return { success: true as const, data: parsed.data, errors };
}
