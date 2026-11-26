import {
  CNY_TAX_INCLUDED,
  DEFAULT_INBOUND_TAX_RATE,
  type InboundPriceBasis,
} from "../../../shared/inboundPricing";
import {
  INBOUND_PAYMENT_UNPAID,
  type InboundPaymentMode,
} from "../../../shared/inboundPayment";
export const currentYear = new Date().getFullYear();
export const todayLocal = () => {
  const now = new Date();
  const local = new Date(
    now.getTime() - now.getTimezoneOffset() * 60_000,
  );
  return local.toISOString().slice(0, 10);
};
export const newRequestId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
export const uppercasePartNumber = (value: string) =>
  value.normalize("NFKC").toUpperCase().slice(0, 128);
export type InboundPhoto = {
  key: string;
  url: string;
  name: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  size: number;
};
export const emptyForm = () => ({
  status: "in_transit" as "in_transit" | "received",
  partNumber: "",
  brand: "",
  qty: "",
  unitCost: "",
  unitCostBasis: CNY_TAX_INCLUDED as InboundPriceBasis,
  taxRate: String(DEFAULT_INBOUND_TAX_RATE),
  prodYear: String(currentYear),
  supplierName: "",
  supplierContact: "",
  supplierPhone: "",
  packageType: "",
  lotNumber: "",
  supplierOrderNo: "",
  inboundDate: todayLocal(),
  operator: "",
  buyerUserId: "",
  location: "",
  note: "",
  photos: [] as InboundPhoto[],
  paymentMode: INBOUND_PAYMENT_UNPAID as InboundPaymentMode,
  paymentPercent: "50" as "30" | "50" | "custom",
  paymentAmount: "",
  paymentDate: todayLocal(),
  paymentNote: "",
});
