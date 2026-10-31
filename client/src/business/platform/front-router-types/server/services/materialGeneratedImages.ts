import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { materialGeneratedImages } from "../../drizzle/schema";
import { getDb } from "../db";
import { readGeneratedImageDictionaryRows } from "../adminDb";
import { generatedDictionaryId, generatedImageIdentityKey, normalizeGeneratedImageBrand, normalizeGeneratedImageInput, normalizeGeneratedImagePartNumber, resolveGeneratedImageIdentitiesFromRows, type GeneratedImageIdentity, type GeneratedImageInput } from "./generatedImageIdentity";
export { normalizeGeneratedImagePartNumber, generatedImageIdentityKey } from "./generatedImageIdentity";
export type { GeneratedImageIdentity, GeneratedImageInput } from "./generatedImageIdentity";
const PRIVATE_WATERMARKED_KEY = /^material-generated-private\/v1\/[A-Z0-9_-]{1,78}_[a-f0-9]{10}\/[a-f0-9]{64}\.png$/;
const PRIVATE_PINOUT_KEY = /^material-generated-pinout\/v1\/[A-Z0-9_-]{1,78}_[a-f0-9]{10}\/[a-f0-9]{64}\.png$/;
const SHA256 = /^[a-f0-9]{64}$/;
export type MaterialGeneratedImageKind = "appearance" | "pinout";
export type ApprovedGeneratedAsset = { key: string; sha256: string; url: string };
export type ApprovedMaterialGeneratedImage = GeneratedImageIdentity & { key: string; watermarkedSha256: string; url: string; generatedAt: Date | null; pinout: (ApprovedGeneratedAsset & { pinCount: number }) | null };
export function isValidGeneratedWatermarkedKey(value: string): boolean { return PRIVATE_WATERMARKED_KEY.test(value); }
export function isValidGeneratedPinoutKey(value: string): boolean { return PRIVATE_PINOUT_KEY.test(value); }
function approvedProxyUrl(identity: GeneratedImageIdentity, hash: string, kind: MaterialGeneratedImageKind): string {
  const suffix = kind === "pinout" ? "&kind=pinout" : "";
  return `/api/material-generated-image?part=${encodeURIComponent(identity.partNumber)}&brand=${encodeURIComponent(identity.brand)}&dictId=${identity.dictionaryMaterialId}&v=${hash}${suffix}`;
}
function validatedApprovedRow(row: { partNumber: string; brand: string; dictionaryMaterialId: number | null; status: string; key: string | null; watermarkedSha256: string | null; pinoutKey: string | null; pinoutSha256: string | null; pinoutPinCount: number | null; generatedAt: Date | null }): ApprovedMaterialGeneratedImage | null {
  const partNumber = normalizeGeneratedImagePartNumber(row.partNumber);
  const brand = normalizeGeneratedImageBrand(row.brand);
  const dictionaryMaterialId = generatedDictionaryId(row.dictionaryMaterialId);
  const key = row.key?.trim() ?? "";
  const hash = row.watermarkedSha256?.trim().toLowerCase() ?? "";
  if (row.status !== "approved" || !partNumber || !brand || !dictionaryMaterialId || !isValidGeneratedWatermarkedKey(key) || !SHA256.test(hash) || !key.endsWith(`/${hash}.png`)) return null;
  const identity = { partNumber, brand, dictionaryMaterialId };
  const pinoutKey = row.pinoutKey?.trim() ?? "";
  const pinoutHash = row.pinoutSha256?.trim().toLowerCase() ?? "";
  const pinCount = Number(row.pinoutPinCount);
  const pinout = pinoutKey && SHA256.test(pinoutHash) && isValidGeneratedPinoutKey(pinoutKey) && pinoutKey.endsWith(`/${pinoutHash}.png`) && Number.isInteger(pinCount) && pinCount >= 2 && pinCount <= 2000
    ? { key: pinoutKey, sha256: pinoutHash, pinCount, url: approvedProxyUrl(identity, pinoutHash, "pinout") } : null;
  return { ...identity, key, watermarkedSha256: hash, url: approvedProxyUrl(identity, hash, "appearance"), generatedAt: row.generatedAt, pinout };
}
async function readApprovedGeneratedImageIndex(inputs: GeneratedImageInput[]): Promise<{ identities: Array<GeneratedImageIdentity | null>; images: Map<string, ApprovedMaterialGeneratedImage> }> {
  const empty = () => ({ identities: inputs.map(() => null), images: new Map<string, ApprovedMaterialGeneratedImage>() });
  if (!inputs.length || inputs.length > 1000) return empty();
  const normalized = inputs.map(normalizeGeneratedImageInput).filter((item): item is NonNullable<typeof item> => !!item);
  if (!normalized.length) return empty();
  try {
    const db = await getDb();
    if (!db) return empty();
    const dictionary = await readGeneratedImageDictionaryRows(normalized);
    const identities = resolveGeneratedImageIdentitiesFromRows(inputs, dictionary);
    const exact = identities.filter((identity): identity is GeneratedImageIdentity => !!identity);
    if (!exact.length) return { identities, images: new Map() };
    const parts = Array.from(new Set(exact.map(identity => identity.partNumber)));
    const ids = Array.from(new Set(exact.map(identity => identity.dictionaryMaterialId)));
    const rows = await db.select({
      partNumber: materialGeneratedImages.partNumberNormalized, brand: materialGeneratedImages.brand,
      dictionaryMaterialId: materialGeneratedImages.dictionaryMaterialId, status: materialGeneratedImages.status,
      key: materialGeneratedImages.watermarkedPrivateKey, watermarkedSha256: materialGeneratedImages.watermarkedSha256,
      pinoutKey: materialGeneratedImages.pinoutPrivateKey, pinoutSha256: materialGeneratedImages.pinoutSha256,
      pinoutPinCount: materialGeneratedImages.pinoutPinCount, generatedAt: materialGeneratedImages.generatedAt,
    }).from(materialGeneratedImages).where(and(eq(materialGeneratedImages.status, "approved"), isNotNull(materialGeneratedImages.watermarkedPrivateKey), isNotNull(materialGeneratedImages.watermarkedSha256), inArray(materialGeneratedImages.partNumberNormalized, parts), inArray(materialGeneratedImages.dictionaryMaterialId, ids)));
    const requested = new Set(exact.map(generatedImageIdentityKey));
    const buckets = new Map<string, ApprovedMaterialGeneratedImage[]>();
    for (const row of rows) {
      const approved = validatedApprovedRow(row);
      if (!approved) continue;
      const key = generatedImageIdentityKey(approved);
      if (!requested.has(key)) continue;
      const bucket = buckets.get(key) ?? []; bucket.push(approved); buckets.set(key, bucket);
    }
    const images = new Map<string, ApprovedMaterialGeneratedImage>();
    for (const [key, bucket] of Array.from(buckets.entries())) if (bucket.length === 1) images.set(key, bucket[0]);
    return { identities, images };
  } catch { console.warn("generated_image_identity_lookup_failed"); return empty(); }
}
/** Full identity Map. A legacy string/part-only input never yields an image. */
export async function approvedMaterialGeneratedImageMap(inputs: GeneratedImageInput[]): Promise<Map<string, ApprovedMaterialGeneratedImage>> { return (await readApprovedGeneratedImageIndex(inputs)).images; }
/** Each result remains associated with exactly its original input, including duplicates. */
export async function approvedMaterialGeneratedImagesForItems(inputs: GeneratedImageInput[]): Promise<Array<ApprovedMaterialGeneratedImage | null>> {
  const { identities, images } = await readApprovedGeneratedImageIndex(inputs);
  return identities.map(identity => identity ? images.get(generatedImageIdentityKey(identity)) ?? null : null);
}
export async function approvedMaterialGeneratedImageItemMap<T extends GeneratedImageInput>(items: T[]): Promise<Map<T, ApprovedMaterialGeneratedImage>> {
  const images = await approvedMaterialGeneratedImagesForItems(items);
  const result = new Map<T, ApprovedMaterialGeneratedImage>();
  items.forEach((item, index) => { if (images[index]) result.set(item, images[index]!); });
  return result;
}
export async function approvedMaterialGeneratedImageByPart(rawPartNumber: string, expectedHash: string, kind: MaterialGeneratedImageKind = "appearance", context?: { brand: unknown; dictionaryMaterialId: unknown }): Promise<ApprovedGeneratedAsset | null> {
  const hash = typeof expectedHash === "string" ? expectedHash.trim().toLowerCase() : "";
  if (!context || !generatedDictionaryId(context.dictionaryMaterialId) || !SHA256.test(hash) || (kind !== "appearance" && kind !== "pinout")) return null;
  const [approved] = await approvedMaterialGeneratedImagesForItems([{ partNumber: rawPartNumber, brand: context.brand, dictionaryMaterialId: context.dictionaryMaterialId }]);
  if (!approved) return null;
  const asset = kind === "pinout" ? approved.pinout : { key: approved.key, sha256: approved.watermarkedSha256, url: approved.url };
  return asset?.sha256 === hash ? asset : null;
}
export async function mergeApprovedMaterialGeneratedImages<T extends { partNumber: string; brand?: string | null; package: string; dictionaryMaterialId?: number | null; displayPartNumber?: string; coverImageUrl?: string; pinImageUrl?: string; pinoutImages?: Array<{ package: string; pinCount: number; imageUrl: string; source?: "dictionary" | "generated" }> }>(items: T[], identity?: (item: T) => GeneratedImageInput): Promise<Array<T & { coverImageSource: "dictionary" | "generated" | "none" }>> {
  const generated = await approvedMaterialGeneratedImagesForItems(identity ? items.map(identity) : items);
  return items.map((item, index) => {
    const match = generated[index];
    const generatedPinout = match?.pinout ? [{ package: item.package, pinCount: match.pinout.pinCount, imageUrl: match.pinout.url, source: "generated" as const }] : [];
    const dictionaryPinouts = item.pinoutImages ?? [];
    const pinoutImages = item.pinImageUrl || dictionaryPinouts.length ? dictionaryPinouts : generatedPinout;
    if (item.coverImageUrl) return { ...item, pinoutImages, coverImageSource: "dictionary" as const };
    if (!match) return { ...item, pinoutImages, coverImageSource: "none" as const };
    return { ...item, pinoutImages, coverImageUrl: match.url, coverImageSource: "generated" as const };
  });
}
