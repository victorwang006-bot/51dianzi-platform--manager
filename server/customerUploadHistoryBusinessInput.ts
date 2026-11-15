import {
  CUSTOMER_UPLOAD_HISTORY_INPUT_SCHEMAS,
} from "../client/src/business/platform/shared/customerUploadHistory";

/** Fixed history surface only. Selectors never define a tenant or trusted actor. */
export { CUSTOMER_UPLOAD_HISTORY_INPUT_SCHEMAS };
export function isCustomerUploadHistoryBusinessMethod(method: string | undefined): method is keyof typeof CUSTOMER_UPLOAD_HISTORY_INPUT_SCHEMAS {
  return typeof method === "string" && Object.prototype.hasOwnProperty.call(CUSTOMER_UPLOAD_HISTORY_INPUT_SCHEMAS, method);
}
