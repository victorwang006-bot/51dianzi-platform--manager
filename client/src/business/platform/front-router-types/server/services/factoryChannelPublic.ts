import { decodePublication, type DecodedPublication, type FactoryChannelPublicItem } from "./factoryChannelSnapshot";
import { readMainChannelMaterialPublications } from "./channelFactoryPublicationPublic";
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

export type { FactoryChannelPublicItem } from "./factoryChannelSnapshot";

export type FactoryChannelListResult = {
  items: FactoryChannelPublicItem[];
  total: number;
  pageCount: number;
  brands: string[];
};

export type FactoryChannelPublicServiceDependencies = {
  readPublications: () => Promise<OfficialChannelPublicationReadRow[]>;
  /** Explicit DI only. Omission never calls the main DB (legacy tests/adapters). */
  readMaterialPublications?: () => Promise<OfficialChannelPublicationReadRow[]>;
};

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
      const [official, material] = await Promise.all([
        dependencies.readPublications(),
        dependencies.readMaterialPublications?.() ?? Promise.resolve([]),
      ]);
      const decoded = [...official, ...material]
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
  readMaterialPublications: readMainChannelMaterialPublications,
});

export async function listFactoryChannelPublic(
  input: FactoryChannelListInput
): Promise<FactoryChannelListResult> {
  return factoryChannelPublicService.list(input);
}
