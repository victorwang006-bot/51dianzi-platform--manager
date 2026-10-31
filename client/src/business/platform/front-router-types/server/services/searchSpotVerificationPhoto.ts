import { TRPCError as SearchSpotPhotoError } from "@trpc/server";
import { sql as searchSpotPhotoSql } from "drizzle-orm";
import { getDb } from "../db";
import { storageGetAccessUrl } from "../storage";
import { searchDiscoverableCondition, normalizeExactInventoryKeyword as searchSpotPhotoNormalizeKeyword } from "./inventoryVisibility";

const SEARCH_SPOT_VERIFICATION_PHOTO_URL_TTL_SECONDS = 120;
const SEARCH_SPOT_VERIFICATION_PHOTO_SIGN_FAILURE_MESSAGE = "核验图片暂时不可用，请重试";
const SEARCH_SPOT_VERIFICATION_PHOTO_EMPTY_RESULT = {
  photoUrl: null,
  verifiedAt: null,
  expiresAt: null,
} as const;

type SearchSpotVerificationPhotoRecord = {
  photoKey: unknown;
  photoSha256: unknown;
  verifiedAt: unknown;
  expiresAt: unknown;
};

export type SearchSpotVerificationPhotoResult = {
  photoUrl: string | null;
  verifiedAt: string | null;
  expiresAt: string | null;
};

export type SearchSpotVerificationPhotoDependencies = {
  findCurrentRecord: (inventoryId: number, partNumber?: string) => Promise<SearchSpotVerificationPhotoRecord | null>;
  getAccessUrl: (key: string, expiresSeconds: number) => Promise<string>;
  now: () => Date;
};

function searchSpotVerificationPhotoIsoDate(value: unknown): string | null {
  const searchSpotVerificationPhotoDate = value instanceof Date
    ? value
    : typeof value === "string" || typeof value === "number"
      ? new Date(typeof value === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
          ? `${value.replace(" ", "T")}+08:00` : value)
      : null;
  if (!searchSpotVerificationPhotoDate || Number.isNaN(searchSpotVerificationPhotoDate.getTime())) {
    return null;
  }
  return searchSpotVerificationPhotoDate.toISOString();
}

/**
 * storagePutPrivate appends an eight-hex collision suffix to the canonical
 * SHA-256 object name. The optional form is retained only for historical rows
 * written before that helper was used; both forms must bind to photoSha256.
 */
function searchSpotVerificationPhotoHasSafeKey(
  photoKey: unknown,
  photoSha256: unknown,
): photoKey is string {
  if (
    typeof photoKey !== "string"
    || typeof photoSha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(photoSha256)
  ) {
    return false;
  }
  const searchSpotVerificationPhotoKeyPattern = new RegExp(
    `^inventory-spot-verifications/${photoSha256}(?:_[a-f0-9]{8})?\\.(?:jpg|jpeg|png|webp)$`,
  );
  return searchSpotVerificationPhotoKeyPattern.test(photoKey);
}

async function searchSpotVerificationPhotoFindCurrentRecord(
  inventoryId: number,
  partNumber?: string,
): Promise<SearchSpotVerificationPhotoRecord | null> {
  const searchSpotVerificationPhotoDatabase = await getDb();
  if (!searchSpotVerificationPhotoDatabase) return null;

  /*
   * This is intentionally one read query. The latest record is selected before
   * its validity test: a cancellation expires that latest row and must never
   * fall back to an earlier photo. The supplied exact part number preserves the existing search-only inventory
   * visibility while the bound inventory ID prevents cross-row substitution.
   */
  const searchSpotVerificationPhotoQuery = await searchSpotVerificationPhotoDatabase.execute(searchSpotPhotoSql`
    SELECT verification.photoKey AS photoKey,
           verification.photoSha256 AS photoSha256,
           verification.verifiedAt AS verifiedAt,
           verification.expiresAt AS expiresAt
      FROM inventories
      INNER JOIN inventory_spot_verifications verification
        ON verification.inventoryId = inventories.id
     WHERE inventories.id = ${inventoryId}
       AND inventories.status = 'published'
       AND inventories.qtyOnSale > 0
       AND ${searchDiscoverableCondition(partNumber)}
       ${partNumber ? searchSpotPhotoSql`AND inventories.partNumberNormalized = ${searchSpotPhotoNormalizeKeyword(partNumber)}` : searchSpotPhotoSql``}
       AND verification.id = (
         SELECT MAX(searchSpotVerificationPhotoLatest.id)
           FROM inventory_spot_verifications searchSpotVerificationPhotoLatest
          WHERE searchSpotVerificationPhotoLatest.inventoryId = inventories.id
       )
       AND verification.inventoryId = inventories.id
       AND verification.dataOwnerUserId = inventories.userId
       AND verification.enterpriseId = inventories.enterpriseId
       AND verification.expiresAt > NOW()
       AND verification.inventoryFingerprint = CASE
         WHEN verification.matchRule = 'packaging' THEN SHA2(CONCAT_WS(CHAR(10),
           'spot-packaging-v1',
           SHA2(CONCAT_WS(CHAR(10),
             UPPER(TRIM(inventories.partNumber)),
             CAST(inventories.qtyOnSale AS CHAR),
             CAST(inventories.qtyStock AS CHAR),
             COALESCE(UPPER(TRIM(inventories.dateCode)), ''),
             COALESCE(UPPER(TRIM(inventories.grade)), ''),
             COALESCE(UPPER(TRIM(inventories.source)), ''),
             COALESCE(UPPER(TRIM(inventories.warehouseAddress)), '')
           ), 256),
           UPPER(TRIM(inventories.brand))
         ), 256)
         ELSE SHA2(CONCAT_WS(CHAR(10),
           UPPER(TRIM(inventories.partNumber)),
           CAST(inventories.qtyOnSale AS CHAR),
           CAST(inventories.qtyStock AS CHAR),
           COALESCE(UPPER(TRIM(inventories.dateCode)), ''),
           COALESCE(UPPER(TRIM(inventories.grade)), ''),
           COALESCE(UPPER(TRIM(inventories.source)), ''),
           COALESCE(UPPER(TRIM(inventories.warehouseAddress)), '')
         ), 256)
       END
     LIMIT 1
  `);
  const searchSpotVerificationPhotoRows = (
    searchSpotVerificationPhotoQuery as unknown as [SearchSpotVerificationPhotoRecord[], unknown]
  )[0] ?? [];
  return searchSpotVerificationPhotoRows[0] ?? null;
}

const searchSpotVerificationPhotoDefaultDependencies: SearchSpotVerificationPhotoDependencies = {
  findCurrentRecord: searchSpotVerificationPhotoFindCurrentRecord,
  getAccessUrl: storageGetAccessUrl,
  now: () => new Date(),
};

export function createSearchSpotVerificationPhotoService(
  overrides: Partial<SearchSpotVerificationPhotoDependencies> = {},
) {
  const searchSpotVerificationPhotoDependencies = {
    ...searchSpotVerificationPhotoDefaultDependencies,
    ...overrides,
  };

  return {
    async read(input: { inventoryId: number; partNumber?: string }): Promise<SearchSpotVerificationPhotoResult> {
      const searchSpotVerificationPhotoRecord = await searchSpotVerificationPhotoDependencies.findCurrentRecord(
        input.inventoryId, input.partNumber,
      );
      if (!searchSpotVerificationPhotoRecord) return SEARCH_SPOT_VERIFICATION_PHOTO_EMPTY_RESULT;

      const searchSpotVerificationPhotoVerifiedAt = searchSpotVerificationPhotoIsoDate(
        searchSpotVerificationPhotoRecord.verifiedAt,
      );
      const searchSpotVerificationPhotoExpiresAt = searchSpotVerificationPhotoIsoDate(
        searchSpotVerificationPhotoRecord.expiresAt,
      );
      if (
        !searchSpotVerificationPhotoVerifiedAt
        || !searchSpotVerificationPhotoExpiresAt
        || new Date(searchSpotVerificationPhotoExpiresAt).getTime()
          <= searchSpotVerificationPhotoDependencies.now().getTime()
        || !searchSpotVerificationPhotoHasSafeKey(
          searchSpotVerificationPhotoRecord.photoKey,
          searchSpotVerificationPhotoRecord.photoSha256,
        )
      ) {
        return SEARCH_SPOT_VERIFICATION_PHOTO_EMPTY_RESULT;
      }

      try {
        const searchSpotVerificationPhotoUrl = await searchSpotVerificationPhotoDependencies.getAccessUrl(
          searchSpotVerificationPhotoRecord.photoKey,
          SEARCH_SPOT_VERIFICATION_PHOTO_URL_TTL_SECONDS,
        );
        if (typeof searchSpotVerificationPhotoUrl !== "string" || !searchSpotVerificationPhotoUrl.trim()) {
          throw new Error("SEARCH_SPOT_VERIFICATION_PHOTO_EMPTY_SIGNED_URL");
        }
        return {
          photoUrl: searchSpotVerificationPhotoUrl,
          verifiedAt: searchSpotVerificationPhotoVerifiedAt,
          expiresAt: searchSpotVerificationPhotoExpiresAt,
        };
      } catch {
        // Never log a private object key or provider response here.
        throw new SearchSpotPhotoError({
          code: "SERVICE_UNAVAILABLE",
          message: SEARCH_SPOT_VERIFICATION_PHOTO_SIGN_FAILURE_MESSAGE,
        });
      }
    },
  };
}

const searchSpotVerificationPhotoService = createSearchSpotVerificationPhotoService();

export function readSearchSpotVerificationPhoto(input: { inventoryId: number; partNumber?: string }) {
  return searchSpotVerificationPhotoService.read(input);
}
