import { createHash } from "node:crypto";

/** 现货核验有效期：从通过时刻起45天。 */
export const SPOT_VERIFICATION_VALID_DAYS = 45;
/** 综合排序最高加分；之后按已过自然天数线性衰减。 */
export const SPOT_VERIFICATION_MAX_BOOST = 12;
/** 自动通过所需最低匹配分。 */
export const SPOT_VERIFICATION_MIN_MATCH_SCORE = 0.9;
/** 第一、第二候选至少拉开该分差，避免相似库存误配。 */
export const SPOT_VERIFICATION_MIN_MATCH_MARGIN = 0.08;

export type SpotInventoryMatchCandidate = {
  id: number;
  partNumber: string;
};

export type SpotInventoryMatch = {
  inventoryId: number;
  inventoryPartNumber: string;
  recognizedPartNumber: string;
  score: number;
  rule: "exact" | "single_character" | "packaging";
};

/**
 * 仅做不会改变订购型号语义的展示归一化：统一大小写、全半角与空白。
 * 连字符、斜杠等订购后缀字符保留，避免把不同物料合并。
 */
export function normalizeSpotPartNumber(value: string): string {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

/**
 * 标签常在厂商型号前加仓库/客户物料码，例如 841-S012ZVC12F0MLF。
 * 只剥离单层“2至4位数字+分隔符”的明确业务前缀。
 */
export function spotLabelPartNumberCandidates(value: string): string[] {
  const initial = normalizeSpotPartNumber(value).replace(
    /^(?:P\/N|PN|MPN|PARTNO|PARTNUMBER)[:：#-]*/i,
    ""
  );
  if (!initial) return [];
  const candidates = [initial];
  const match = initial.match(/^\d{2,4}[-_](.+)$/);
  const next = match?.[1] || "";
  if (next.length >= 8 && /[A-Z]/.test(next) && /\d/.test(next))
    candidates.push(next);
  return Array.from(new Set(candidates));
}

/** 长料号只需判断是否恰好一字符不同，无需构造完整编辑距离矩阵。 */
const OCR_CONFUSABLE_GROUPS = ["0OQD9", "1IL", "2Z", "5S", "6G", "8B"];

function differsByOneConfusableCharacter(a: string, b: string): boolean {
  if (a.length !== b.length || a.length < 10) return false;
  let mismatch: [string, string] | null = null;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] === b[index]) continue;
    if (mismatch) return false;
    mismatch = [a[index], b[index]];
  }
  return Boolean(
    mismatch &&
      OCR_CONFUSABLE_GROUPS.some(group =>
        mismatch!.every(character => group.includes(character))
      )
  );
}

function scorePair(
  recognized: string,
  inventoryPartNumber: string,
  allowSingleCharacter: boolean
): Pick<SpotInventoryMatch, "score" | "rule"> | null {
  if (recognized === inventoryPartNumber) return { score: 1, rule: "exact" };

  if (
    allowSingleCharacter &&
    differsByOneConfusableCharacter(recognized, inventoryPartNumber)
  ) {
    return { score: 0.92, rule: "single_character" };
  }
  return null;
}

/**
 * 现货照片核验可人工选择的包装等价关系。这里刻意不复用通用包装后缀：
 * 只有已核准的厂牌和完整订货型号组合才能进入候选，避免 T6/T7、容量或版本混淆。
 */
const APPROVED_BRAND_PACKAGING_PAIRS = [
  {
    brandAliases: new Set([
      "ST",
      "STMICROELECTRONICS",
      "STMICROELECTRONICSNV",
      "意法半导体",
      "意法半導體",
    ]),
    variants: ["STM32F103C8T6", "STM32F103C8T6TR"] as const,
  },
  {
    brandAliases: new Set([
      "NXP",
      "NXPSEMICONDUCTORS",
      "恩智浦",
      "恩智浦半导体",
      "恩智浦半導體",
    ]),
    variants: ["TJA1042T/3/1", "TJA1042T/3/1J"] as const,
  },
] as const;

/** User-approved listing relation, not a generic parentheses or substitute rule.
 * The historical "packaging" wire/audit value covers these brand-bound non-exact
 * candidates too; bracket listings always require explicit user selection.
 */
const APPROVED_BRAND_BRACKET_LISTINGS = [
  {
    brandAliases: new Set(["TM", "天微", "TM(天微)", "TM/天微", "TM天微"]),
    listing: "TM1640(TA2103)",
    components: ["TM1640", "TA2103"] as const,
  },
] as const;

export function spotVerificationRequiresExplicitSelection(
  inventoryPartNumber: string,
  brand: string | null | undefined
): boolean {
  const listing = normalizeSpotPartNumber(inventoryPartNumber);
  const normalizedBrand = normalizeSpotInventoryBrand(brand);
  return APPROVED_BRAND_BRACKET_LISTINGS.some(
    entry => entry.listing === listing && entry.brandAliases.has(normalizedBrand)
  );
}

function isApprovedBracketListingMatch(
  recognizedPartNumber: string,
  inventoryPartNumber: string,
  brand: string | null | undefined
): boolean {
  const normalizedBrand = normalizeSpotInventoryBrand(brand);
  return APPROVED_BRAND_BRACKET_LISTINGS.some(entry =>
    entry.listing === inventoryPartNumber &&
    entry.brandAliases.has(normalizedBrand) &&
    entry.components.some(component => component === recognizedPartNumber)
  );
}

/** 仅规范厂牌展示写法；未列入明确别名的品牌绝不视为已核准。 */
function normalizeSpotInventoryBrand(value: string | null | undefined): string {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/[\s._-]+/g, "");
}

function isApprovedPackagingPair(
  recognizedPartNumber: string,
  inventoryPartNumber: string,
  brand: string | null | undefined
): boolean {
  const normalizedBrand = normalizeSpotInventoryBrand(brand);
  if (!normalizedBrand) return false;

  return APPROVED_BRAND_PACKAGING_PAIRS.some(({ brandAliases, variants }) => {
    if (!brandAliases.has(normalizedBrand)) return false;
    const [base, packaging] = variants;
    return (
      (recognizedPartNumber === base && inventoryPartNumber === packaging) ||
      (recognizedPartNumber === packaging && inventoryPartNumber === base)
    );
  });
}

/**
 * 为上游受限精确查询提供料号键：标签原文候选之外，仅加入已登记包装配对的另一端。
 * 不按尾缀泛化、不做 LIKE，也不枚举库存；调用方仍须按当前用户白名单限制查询范围。
 */
export function spotVerificationSearchPartNumbers(
  recognized: string
): string[] {
  const searchPartNumbers: string[] = [];
  const add = (partNumber: string) => {
    if (
      partNumber &&
      !searchPartNumbers.includes(partNumber) &&
      searchPartNumbers.length < 6
    ) {
      searchPartNumbers.push(partNumber);
    }
  };

  for (const candidate of spotLabelPartNumberCandidates(recognized)) {
    add(candidate);
    for (const { variants } of APPROVED_BRAND_PACKAGING_PAIRS) {
      const [base, packaging] = variants;
      if (candidate === base) add(packaging);
      else if (candidate === packaging) add(base);
    }
    for (const entry of APPROVED_BRAND_BRACKET_LISTINGS) {
      if (entry.components.some(component => component === candidate)) add(entry.listing);
    }
  }

  return searchPartNumbers;
}

/**
 * 为照片核验返回当前白名单库存中的可选项，不做自动通过。
 *
 * 完整料号匹配始终可用；包装匹配只接受上方登记的品牌/完整型号成对关系。
 * 结果保留同型号的多个库存，供用户明确单选；精确项优先，再按库存 ID 稳定排序。
 */
export function selectSpotInventoryCandidates(
  recognizedPartNumber: string,
  inventories: Array<{ id: number; partNumber: string; brand?: string | null }>,
  limit = 5
): Array<SpotInventoryMatch & { matchKind: "exact" | "packaging" }> {
  const recognizedCandidates =
    spotLabelPartNumberCandidates(recognizedPartNumber);
  const ranked: Array<
    SpotInventoryMatch & { matchKind: "exact" | "packaging" }
  > = [];

  for (const inventory of inventories) {
    const inventoryPartNumber = normalizeSpotPartNumber(inventory.partNumber);
    if (!inventoryPartNumber) continue;

    const isExact = recognizedCandidates.some(
      candidate => candidate === inventoryPartNumber
    );
    const isPackaging =
      !isExact &&
      recognizedCandidates.some(candidate =>
        isApprovedPackagingPair(candidate, inventoryPartNumber, inventory.brand) ||
        isApprovedBracketListingMatch(candidate, inventoryPartNumber, inventory.brand)
      );
    if (!isExact && !isPackaging) continue;

    ranked.push({
      inventoryId: inventory.id,
      inventoryPartNumber: inventory.partNumber,
      recognizedPartNumber: recognizedPartNumber.trim(),
      score: 1,
      rule: isExact ? "exact" : "packaging",
      matchKind: isExact ? "exact" : "packaging",
    });
  }

  const normalizedLimit = Number.isFinite(limit)
    ? Math.max(0, Math.floor(limit))
    : 5;
  return ranked
    .sort(
      (a, b) =>
        (a.matchKind === "exact" ? 0 : 1) - (b.matchKind === "exact" ? 0 : 1) ||
        a.inventoryId - b.inventoryId
    )
    .slice(0, Math.min(5, normalizedLimit));
}

/**
 * 在当前用户全部在售库存中选出唯一匹配项。
 * 相似候选不唯一时一律不自动通过，避免把照片核验到错误物料。
 */
export function selectSpotInventoryMatch(
  recognizedPartNumber: string,
  inventories: SpotInventoryMatchCandidate[]
): SpotInventoryMatch | null {
  const recognizedCandidates =
    spotLabelPartNumberCandidates(recognizedPartNumber);
  const strippedBusinessPrefix = recognizedCandidates.length > 1;
  const ranked: SpotInventoryMatch[] = [];

  for (const inventory of inventories) {
    const inventoryPartNumber = normalizeSpotPartNumber(inventory.partNumber);
    let best: SpotInventoryMatch | null = null;
    for (let index = 0; index < recognizedCandidates.length; index += 1) {
      const recognized = recognizedCandidates[index];
      const scored = scorePair(
        recognized,
        inventoryPartNumber,
        strippedBusinessPrefix && index > 0
      );
      if (!scored || (best && best.score >= scored.score)) continue;
      best = {
        inventoryId: inventory.id,
        inventoryPartNumber: inventory.partNumber,
        recognizedPartNumber: recognizedPartNumber.trim(),
        ...scored,
      };
    }
    if (best) ranked.push(best);
  }

  ranked.sort((a, b) => b.score - a.score || a.inventoryId - b.inventoryId);
  const best = ranked[0];
  if (!best || best.score < SPOT_VERIFICATION_MIN_MATCH_SCORE) return null;
  const runnerUp = ranked[1];
  if (
    runnerUp &&
    ((best.score === 1 && runnerUp.score === 1) ||
      (best.score < 1 &&
        best.score - runnerUp.score < SPOT_VERIFICATION_MIN_MATCH_MARGIN))
  )
    return null;
  return best;
}

/** 按已过完整天数线性衰减，满45天归零。 */
export function spotVerificationBoostForAgeDays(ageDays: number): number {
  const days = Math.max(0, Math.floor(Number(ageDays) || 0));
  if (days >= SPOT_VERIFICATION_VALID_DAYS) return 0;
  return (
    Math.round(
      SPOT_VERIFICATION_MAX_BOOST *
        (1 - days / SPOT_VERIFICATION_VALID_DAYS) *
        100
    ) / 100
  );
}

export type SpotVerificationInventorySnapshot = {
  partNumber: string;
  qtyOnSale: number;
  qtyStock: number;
  dateCode: string | null;
  grade: string | null;
  source: string | null;
  warehouseAddress: string | null;
};

/** 核验后影响“现货是否仍是同一批库存”的字段摘要；价格变化不使核验失效。 */
export function spotVerificationInventoryFingerprint(
  inventory: SpotVerificationInventorySnapshot
): string {
  const payload = [
    String(inventory.partNumber || "")
      .trim()
      .toUpperCase(),
    String(inventory.qtyOnSale),
    String(inventory.qtyStock),
    inventory.dateCode?.trim().toUpperCase() || "",
    inventory.grade?.trim().toUpperCase() || "",
    inventory.source?.trim().toUpperCase() || "",
    inventory.warehouseAddress?.trim().toUpperCase() || "",
  ].join("\n");
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/** Preserve legacy exact fingerprints; packaging claims additionally commit the manufacturer. */
export function spotVerificationMatchFingerprint(
  inventory: SpotVerificationInventorySnapshot & { brand?: string | null },
  matchKind: "exact" | "packaging",
): string {
  const legacy = spotVerificationInventoryFingerprint(inventory);
  if (matchKind !== "packaging") return legacy;
  return createHash("sha256").update([
    "spot-packaging-v1",
    legacy,
    String(inventory.brand || "").trim().toUpperCase(),
  ].join("\n"), "utf8").digest("hex");
}
