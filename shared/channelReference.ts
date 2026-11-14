export type ChannelReferenceSource = "lcsc" | "ickey";
export type ChannelReferenceStatus = "pending" | "ok" | "not_found" | "ambiguous" | "price_unavailable" | "access_restricted" | "unavailable";
export type ChannelReferencePriceTier = { minQuantity: number; unitPrice: string };

/** Public webpage data only. Native quantities/prices and customer/source identities are never written here. */
export type ChannelReferenceQuote = {
  source: ChannelReferenceSource;
  status: ChannelReferenceStatus;
  matchedPartNumber: string | null;
  matchedBrand: string | null;
  productCode: string | null;
  pageUrl: string | null;
  stockQuantity: number | null;
  unitPrice: string | null;
  tierQuantity: number | null;
  tiers: ChannelReferencePriceTier[];
  currency: "CNY" | "USD" | "HKD" | null;
  unit: string | null;
  taxStatus: "included" | "excluded" | "unknown";
  packaging: string | null;
  fetchedAt: string | null;
  expiresAt: string | null;
  stockInsufficientForTier: boolean;
  message: string | null;
};

export type ChannelReferenceRow = {
  materialId: number;
  partNumber: string;
  brand: string;
  references: Record<ChannelReferenceSource, ChannelReferenceQuote>;
};
export type ChannelReferenceLookupResult = { items: ChannelReferenceRow[] };

export const CHANNEL_REFERENCE_SOURCE_LABELS: Record<ChannelReferenceSource, string> = {
  lcsc: "立创商城",
  ickey: "云汉芯城",
};
