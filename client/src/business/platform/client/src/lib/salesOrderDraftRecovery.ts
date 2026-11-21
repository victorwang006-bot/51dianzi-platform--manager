import type { SalesOrderDraftPayload } from "../../../shared/crmSalesOrderDrafts";

/** Both source branches matter, even if a stale UI source switch hid one request. */
export function hasLockedSalesOrderDraft(payload: SalesOrderDraftPayload) {
  return (
    (payload.form?.completed != null && payload.form.completed !== false) ||
    payload.form?.pendingRequest != null ||
    payload.company?.uncertain != null
  );
}

/** Fail closed for unknown fields: a newer/partial form is never silently discarded. */
export function isUnstartedSalesOrderDraft(
  payload: SalesOrderDraftPayload,
  automaticCustomerId?: number
): boolean {
  if (hasLockedSalesOrderDraft(payload)) return false;
  if (payload.customer != null) {
    // Only the current embedded form's automatically supplied customer is ignored.
    // Restore classification never supplies this parameter.
    if (
      automaticCustomerId === undefined ||
      payload.customer.id !== automaticCustomerId
    )
      return false;
  }
  if (payload.demandId != null) return false;
  const formDefaults: Record<string, unknown> = {
    version: 1,
    customerSearch: "",
    selectedDemand: null,
    lines: [],
    dueDate: "",
    confirmationNote: "",
    customerConfirmed: false,
    pendingRequest: null,
  };
  const companyDefaults: Record<string, unknown> = {
    lines: [],
    salesTaxMode: "tax_included",
    dueDate: "",
    confirmationNote: "",
    customerConfirmed: false,
    uncertain: null,
  };
  const matchesDefaults = (
    value: Record<string, unknown> | undefined,
    defaults: Record<string, unknown>
  ) =>
    !value ||
    Object.entries(value).every(
      ([key, item]) =>
        Object.prototype.hasOwnProperty.call(defaults, key) &&
        JSON.stringify(item) === JSON.stringify(defaults[key])
    );
  return (
    matchesDefaults(payload.form, formDefaults) &&
    matchesDefaults(payload.company, companyDefaults)
  );
}
