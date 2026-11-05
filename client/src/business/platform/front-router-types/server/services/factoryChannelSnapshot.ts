import { createHash } from "node:crypto";
import type { OfficialChannelPublicationReadRow } from "../adminDb";

/** Exact contract for one public factory-channel card. */
export type FactoryChannelPublicItem = {
  publicId: string;
  listingKind: "factory_channel";
  label: "工厂渠道";
  assistanceLabel: "平台协助询价";
  channelCode: string;
  partNumber: string;
  brand: string;
  qty: number;
  dateCode: string | null;
  price: string | null;
  currency: "CNY";
  taxIncluded: boolean | null;
  leadTime: string | null;
};

export type DecodedPublication = FactoryChannelPublicItem & {
  publishedAtMs: number;
};

type SnapshotRecord = Record<string, unknown>;

const SNAPSHOT_FIELDS = [
  "listingKind",
  "label",
  "assistanceLabel",
  "publicId",
  "partNumber",
  "brand",
  "qty",
  "dateCode",
  "price",
  "currency",
  "taxIncluded",
  "leadTime",
] as const;
const SNAPSHOT_FIELD_SET = new Set<string>(SNAPSHOT_FIELDS);
const OPAQUE_PUBLIC_ID = /^ocp_[a-f0-9]{32}$/;
const MAX_PART_NUMBER_LENGTH = 256;
const MAX_BRAND_LENGTH = 128;
const MAX_DATE_CODE_LENGTH = 64;
const MAX_LEAD_TIME_LENGTH = 128;
const MAX_PRICE_LENGTH = 64;
const MAX_UNSIGNED_INT = 4_294_967_295;

function toSnapshotRecord(value: unknown): SnapshotRecord | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as SnapshotRecord;
  }
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as SnapshotRecord)
      : null;
  } catch {
    return null;
  }
}

function hasExactSnapshotWhitelist(snapshot: SnapshotRecord): boolean {
  const keys = Object.keys(snapshot);
  return (
    keys.length === SNAPSHOT_FIELDS.length &&
    keys.every(key => SNAPSHOT_FIELD_SET.has(key))
  );
}

function requiredText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.normalize("NFKC").trim();
  return text.length > 0 && text.length <= maxLength ? text : null;
}

function optionalText(
  value: unknown,
  maxLength: number
): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const text = value.normalize("NFKC").trim();
  return text.length <= maxLength ? text || null : undefined;
}

/**
 * Prices remain decimal strings so large commercial values are never rounded by
 * JavaScript. Empty, malformed, zero, and negative values safely become a
 * quote-required null rather than an exposed price.
 */
function safePositiveDecimal(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const price = value.trim();
  if (price.length === 0) return null;
  if (
    price.length > MAX_PRICE_LENGTH ||
    !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(price)
  ) {
    return null;
  }
  return /[1-9]/.test(price) ? price : null;
}

function channelCodeFor(publicId: string): string {
  return `FC-${createHash("sha256").update(publicId, "utf8").digest("hex").slice(0, 12).toUpperCase()}`;
}

function timestamp(value: Date | string): number {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function decodePublication(
  row: OfficialChannelPublicationReadRow
): DecodedPublication | null {
  const publicationPublicId = requiredText(row.publicId, 64);
  if (!publicationPublicId || !OPAQUE_PUBLIC_ID.test(publicationPublicId))
    return null;

  const snapshot = toSnapshotRecord(row.snapshot);
  if (!snapshot || !hasExactSnapshotWhitelist(snapshot)) return null;
  if (
    snapshot.listingKind !== "factory_channel" ||
    snapshot.label !== "工厂渠道" ||
    snapshot.assistanceLabel !== "平台协助询价" ||
    snapshot.publicId !== publicationPublicId ||
    snapshot.currency !== "CNY"
  )
    return null;

  const partNumber = requiredText(snapshot.partNumber, MAX_PART_NUMBER_LENGTH);
  const brand = requiredText(snapshot.brand, MAX_BRAND_LENGTH);
  const qty = snapshot.qty;
  const dateCode = optionalText(snapshot.dateCode, MAX_DATE_CODE_LENGTH);
  const price = safePositiveDecimal(snapshot.price);
  const leadTime = optionalText(snapshot.leadTime, MAX_LEAD_TIME_LENGTH);
  if (
    !partNumber ||
    !brand ||
    typeof qty !== "number" ||
    !Number.isSafeInteger(qty) ||
    qty <= 0 ||
    qty > MAX_UNSIGNED_INT ||
    dateCode === undefined ||
    price === undefined ||
    leadTime === undefined ||
    (snapshot.taxIncluded !== null && typeof snapshot.taxIncluded !== "boolean")
  )
    return null;

  return {
    publicId: publicationPublicId,
    listingKind: "factory_channel",
    label: "工厂渠道",
    assistanceLabel: "平台协助询价",
    channelCode: channelCodeFor(publicationPublicId),
    partNumber,
    brand,
    qty,
    dateCode,
    price,
    currency: "CNY",
    taxIncluded: snapshot.taxIncluded,
    leadTime,
    publishedAtMs: timestamp(row.publishedAt),
  };
}

