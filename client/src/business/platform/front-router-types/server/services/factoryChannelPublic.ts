import { createHash } from "node:crypto";
import {
  readOfficialChannelPublications,
  type OfficialChannelPublicationReadRow,
} from "../adminDb";

export const FACTORY_CHANNEL_SORTS = [
  "recent",
  "priceAsc",
  "quantityDesc",
  "leadTime",
] as const;

export type FactoryChannelSort = (typeof FACTORY_CHANNEL_SORTS)[number];

export type FactoryChannelListInput = {
  query?: string;
  brand?: string;
  pricedOnly: boolean;
  sort: FactoryChannelSort;
  limit: number;
  offset: number;
};

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

export type FactoryChannelListResult = {
  items: FactoryChannelPublicItem[];
  total: number;
  pageCount: number;
  brands: string[];
};

export type FactoryChannelPublicServiceDependencies = {
  readPublications: () => Promise<OfficialChannelPublicationReadRow[]>;
};

type DecodedPublication = FactoryChannelPublicItem & {
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

function decodePublication(
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

function normalized(value: string | undefined): string {
  return (value ?? "").normalize("NFKC").trim().toLocaleLowerCase();
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "zh-Hans-CN", {
    numeric: true,
    sensitivity: "base",
  });
}

/** Compare positive decimal strings exactly without parsing them as JS numbers. */
function compareDecimal(left: string, right: string): number {
  const [leftWhole, leftFraction = ""] = left.split(".");
  const [rightWhole, rightFraction = ""] = right.split(".");
  if (leftWhole.length !== rightWhole.length)
    return leftWhole.length - rightWhole.length;
  const wholeComparison = leftWhole.localeCompare(rightWhole);
  if (wholeComparison !== 0) return wholeComparison;
  const width = Math.max(leftFraction.length, rightFraction.length);
  return leftFraction
    .padEnd(width, "0")
    .localeCompare(rightFraction.padEnd(width, "0"));
}

function compareRecent(
  left: DecodedPublication,
  right: DecodedPublication
): number {
  return (
    right.publishedAtMs - left.publishedAtMs ||
    left.publicId.localeCompare(right.publicId)
  );
}

function sortPublications(
  rows: DecodedPublication[],
  sort: FactoryChannelSort
): DecodedPublication[] {
  return rows.slice().sort((left, right) => {
    if (sort === "priceAsc") {
      if (left.price && right.price) {
        const compared = compareDecimal(left.price, right.price);
        if (compared !== 0) return compared;
      } else if (left.price) {
        return -1;
      } else if (right.price) {
        return 1;
      }
    } else if (sort === "quantityDesc") {
      if (left.qty !== right.qty) return right.qty - left.qty;
    } else if (sort === "leadTime") {
      if (left.leadTime && right.leadTime) {
        const compared = compareText(left.leadTime, right.leadTime);
        if (compared !== 0) return compared;
      } else if (left.leadTime) {
        return -1;
      } else if (right.leadTime) {
        return 1;
      }
    }
    return compareRecent(left, right);
  });
}

function toPublicItem(item: DecodedPublication): FactoryChannelPublicItem {
  const { publishedAtMs: _publishedAtMs, ...publicItem } = item;
  return publicItem;
}

export function createFactoryChannelPublicService(
  dependencies: FactoryChannelPublicServiceDependencies
) {
  return {
    async list(
      input: FactoryChannelListInput
    ): Promise<FactoryChannelListResult> {
      const decoded = (await dependencies.readPublications())
        .map(decodePublication)
        .filter((row): row is DecodedPublication => row !== null);
      const query = normalized(input.query);
      const brand = normalized(input.brand);
      const queryMatched = query
        ? decoded.filter(
            item =>
              normalized(item.partNumber).includes(query) ||
              normalized(item.brand).includes(query)
          )
        : decoded;
      const brands = Array.from(
        new Set(queryMatched.map(item => item.brand))
      ).sort(compareText);
      const filtered = queryMatched.filter(
        item =>
          (!brand || normalized(item.brand) === brand) &&
          (!input.pricedOnly || item.price !== null)
      );
      const sorted = sortPublications(filtered, input.sort);
      const total = sorted.length;

      return {
        items: sorted
          .slice(input.offset, input.offset + input.limit)
          .map(toPublicItem),
        total,
        pageCount: Math.ceil(total / input.limit),
        brands,
      };
    },
  };
}

const factoryChannelPublicService = createFactoryChannelPublicService({
  readPublications: readOfficialChannelPublications,
});

export async function listFactoryChannelPublic(
  input: FactoryChannelListInput
): Promise<FactoryChannelListResult> {
  return factoryChannelPublicService.list(input);
}
